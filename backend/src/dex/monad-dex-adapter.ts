import { Logger } from "@nestjs/common";
import type { DexAdapter } from "./adapter.js";
import type { DexQuote, DexQuoteRequest } from "../types.js";
import { inputOutputForSide, outputAmountFromPrice, amountToDecimal } from "../utils/amounts.js";

/** DEX mode selecting which aggregator/API to call. */
export type MonadDexMode = "0x" | "1inch" | "uniswap_v3" | "mock";

export interface MonadDexAdapterConfig {
  /** Which quote source to use. "mock" always returns the deterministic fallback. */
  mode: MonadDexMode;
  /** Monad RPC base URL (chain id 143 mainnet / 10143 testnet). */
  rpcUrl?: string;
  /** 0x API key (optional; public endpoints are rate-limited). */
  zeroxApiKey?: string;
  /** 1inch API key (optional). */
  oneinchApiKey?: string;
  /** Per-fetch timeout in ms. */
  fetchTimeoutMs?: number;
  /** Optional mid-price lookup (e.g. live Pyth cache) used by the mock fallback. */
  getMidPrice?: (pairSymbol: string) => number | undefined;
  /** Deterministic Monad premium (bps) used by the mock fallback. */
  mockPremiumBps?: number;
  mockBidSpreadBps?: number;
  mockAskSpreadBps?: number;
  mockLiquidityUsd?: number;
  /** Fee bps assumed for the aggregator path (overridden by API when available). */
  defaultFeeBps?: number;
}

/** Last-resort reference USD prices for the mock fallback (only used if getMidPrice misses). */
const REFERENCE_USD: Record<string, number> = {
  BTC: 64_000,
  ETH: 3_500,
  MON: 0.4,
  WBTC: 64_000,
  WETH: 3_500,
};

interface ZeroxQuoteResponse {
  price?: string;
  sellAmount?: string;
  buyAmount?: string;
  estimatedPriceImpact?: string;
  gasPrice?: string;
  to?: string;
  data?: string;
}

interface OneinchQuoteResponse {
  toAmount?: string;
  dstAmount?: string;
  fromToken?: { decimals: number };
  toToken?: { decimals: number };
  estimatedGas?: number;
  to?: string;
}

/**
 * DexAdapter backed by a Monad (EVM-compatible L1) DEX aggregator.
 *
 * The adapter maps a TokenPair (whose base/quote carry ERC-20 `address` fields)
 * to a sell/buy token pair, fetches a routed quote from the 0x or 1inch Swap API,
 * and synthesizes an executable DexQuote at the best available price. Quotes are
 * tagged `chain: "monad"` so the nBBO engine and RealTimeAgentCore can route
 * execution to the Monad executor (viem signer).
 *
 * When the selected mode is "mock", or the API is unconfigured/unreachable, a
 * deterministic fallback tracks the live oracle mid + a small Monad premium so
 * the cross-chain nBBO and arb scan stay meaningful — same pattern as
 * InjectiveHelixAdapter.
 */
export class MonadDexAdapter implements DexAdapter {
  readonly source = "monad_dex" as const;
  private readonly logger = new Logger("MonadDexAdapter");

  private readonly mode: MonadDexMode;
  private readonly rpcUrl: string;
  private readonly zeroxApiKey?: string;
  private readonly oneinchApiKey?: string;
  private readonly fetchTimeoutMs: number;
  private readonly getMidPrice?: (pairSymbol: string) => number | undefined;
  private readonly mockPremiumBps: number;
  private readonly mockBidSpreadBps: number;
  private readonly mockAskSpreadBps: number;
  private readonly mockLiquidityUsd: number;
  private readonly defaultFeeBps: number;

  constructor(config: MonadDexAdapterConfig) {
    this.mode = config.mode;
    this.rpcUrl = config.rpcUrl ?? "https://rpc.monad.xyz";
    this.zeroxApiKey = config.zeroxApiKey;
    this.oneinchApiKey = config.oneinchApiKey;
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? 2_500;
    this.getMidPrice = config.getMidPrice;
    this.mockPremiumBps = config.mockPremiumBps ?? 30;
    this.mockBidSpreadBps = config.mockBidSpreadBps ?? 12;
    this.mockAskSpreadBps = config.mockAskSpreadBps ?? 14;
    this.mockLiquidityUsd = config.mockLiquidityUsd ?? 1_500_000;
    this.defaultFeeBps = config.defaultFeeBps ?? 10;
  }

  async quote(request: DexQuoteRequest): Promise<DexQuote[]> {
    if (this.mode === "mock") {
      // Mock path does not need ERC-20 addresses; it tracks the oracle mid.
      return this.mockQuote(request, "mock-mode", Date.now());
    }

    const tokenIn = this.tokenAddress(request.side === "bid" ? request.pair.base : request.pair.quote);
    const tokenOut = this.tokenAddress(request.side === "bid" ? request.pair.quote : request.pair.base);
    if (!tokenIn || !tokenOut) {
      // Native token (no address) not yet supported on the real API path.
      return this.mockQuote(request, "no-token-address", Date.now());
    }

    const started = Date.now();
    try {
      const result = await this.fetchAggregatorQuote(request, tokenIn, tokenOut);
      if (!result) {
        return this.mockQuote(request, "empty-response", started);
      }
      return [result];
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Monad DEX fetch failed for ${request.pair.symbol} (${this.mode}); using mock fallback: ${reason}`,
      );
      return this.mockQuote(request, "fetch-failed", started);
    }
  }

  private tokenAddress(token: { address?: string }): string | undefined {
    return token.address;
  }

  private async fetchAggregatorQuote(
    request: DexQuoteRequest,
    tokenIn: string,
    tokenOut: string,
  ): Promise<DexQuote | undefined> {
    const started = Date.now();
    if (this.mode === "0x") {
      return this.fetchZerox(request, tokenIn, tokenOut, started);
    }
    if (this.mode === "1inch") {
      return this.fetchOneinch(request, tokenIn, tokenOut, started);
    }
    // uniswap_v3 not implemented in v1 — fall through to mock.
    this.logger.debug(`Monad DEX mode ${this.mode} not yet implemented; using mock`);
    return undefined;
  }

  private async fetchZerox(
    request: DexQuoteRequest,
    tokenIn: string,
    tokenOut: string,
    started: number,
  ): Promise<DexQuote | undefined> {
    const sellAmount = request.amountIn.toString();
    const params = new URLSearchParams({
      sellToken: tokenIn,
      buyToken: tokenOut,
      sellAmount,
      // 0x uses chain id via the API path; the public Monad endpoint is rate-limited.
      ...(this.zeroxApiKey ? {} : {}),
    });
    const url = `https://api.0x.org/swap/v1/quote?${params.toString()}`;
    const payload = (await this.fetchJson(url, this.zeroxApiKey)) as ZeroxQuoteResponse;

    const buyAmount = payload.buyAmount ? BigInt(payload.buyAmount) : 0n;
    const price = payload.price ? Number(payload.price) : 0;
    if (!buyAmount || !price || !Number.isFinite(price) || price <= 0) {
      return undefined;
    }

    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);
    return {
      source: this.source,
      chain: "monad",
      side: request.side,
      pair: request.pair.symbol,
      inputMint,
      outputMint,
      inAmount: request.amountIn,
      outAmount: buyAmount,
      price,
      feeBps: this.defaultFeeBps,
      liquidityUsd: this.mockLiquidityUsd,
      priceImpactBps: payload.estimatedPriceImpact
        ? Math.max(0, Math.floor(Number(payload.estimatedPriceImpact) * 100))
        : 0,
      latencyMs: Date.now() - started,
      routeId: `monad_dex:0x:${request.pair.symbol}:${request.side}`,
      receivedAt: Date.now(),
      raw: { dex: "0x", to: payload.to, hasData: Boolean(payload.data) },
    };
  }

  private async fetchOneinch(
    request: DexQuoteRequest,
    tokenIn: string,
    tokenOut: string,
    started: number,
  ): Promise<DexQuote | undefined> {
    const chainId = 143; // Monad mainnet
    const amount = request.amountIn.toString();
    const params = new URLSearchParams({
      src: tokenIn,
      dst: tokenOut,
      amount,
    });
    const url = `https://api.1inch.dev/swap/v6.0/${chainId}/quote?${params.toString()}`;
    const payload = (await this.fetchJson(url, this.oneinchApiKey)) as OneinchQuoteResponse;

    const toAmountStr = payload.toAmount ?? payload.dstAmount;
    const toAmount = toAmountStr ? BigInt(toAmountStr) : 0n;
    if (!toAmount) {
      return undefined;
    }

    // Derive price from the in/out amounts using the correct decimals.
    const inDecimals = request.side === "bid" ? request.pair.base.decimals : request.pair.quote.decimals;
    const outDecimals = request.side === "bid" ? request.pair.quote.decimals : request.pair.base.decimals;
    const inUi = amountToDecimal(request.amountIn, inDecimals);
    const outUi = amountToDecimal(toAmount, outDecimals);
    const price = request.side === "bid"
      ? outUi.div(inUi).toNumber()
      : inUi.div(outUi).toNumber();
    if (!Number.isFinite(price) || price <= 0) {
      return undefined;
    }

    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);
    return {
      source: this.source,
      chain: "monad",
      side: request.side,
      pair: request.pair.symbol,
      inputMint,
      outputMint,
      inAmount: request.amountIn,
      outAmount: toAmount,
      price,
      feeBps: this.defaultFeeBps,
      liquidityUsd: this.mockLiquidityUsd,
      priceImpactBps: 0,
      latencyMs: Date.now() - started,
      routeId: `monad_dex:1inch:${request.pair.symbol}:${request.side}`,
      receivedAt: Date.now(),
      raw: { dex: "1inch", to: payload.to, estimatedGas: payload.estimatedGas },
    };
  }

  private async fetchJson(url: string, apiKey?: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Monad DEX request failed: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deterministic fallback used when the live aggregator is unreachable or the
   * mode is "mock". Tracks the live oracle mid when a getMidPrice provider is
   * wired, plus a fixed Monad premium so the cross-chain nBBO and arb scan stay
   * meaningful — mirrors InjectiveHelixAdapter.mockQuote.
   */
  private mockQuote(
    request: DexQuoteRequest,
    reason: string,
    started: number,
  ): DexQuote[] {
    const base = request.pair.base.symbol;
    const refMid = this.getMidPrice?.(request.pair.symbol) ?? REFERENCE_USD[base] ?? 100;
    const offset = 1 + this.mockPremiumBps / 10_000;
    const mid = refMid * offset;
    const spreadBps = request.side === "bid" ? this.mockBidSpreadBps : this.mockAskSpreadBps;
    const sideMultiplier = request.side === "bid" ? 1 - spreadBps / 10_000 : 1 + spreadBps / 10_000;
    const executablePrice = mid * sideMultiplier;
    if (!Number.isFinite(executablePrice) || executablePrice <= 0) {
      return [];
    }

    const outAmount = outputAmountFromPrice(request, executablePrice);
    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);

    return [
      {
        source: this.source,
        chain: "monad",
        side: request.side,
        pair: request.pair.symbol,
        inputMint,
        outputMint,
        inAmount: request.amountIn,
        outAmount,
        price: executablePrice,
        feeBps: this.defaultFeeBps,
        liquidityUsd: this.mockLiquidityUsd,
        priceImpactBps: 0,
        latencyMs: Date.now() - started,
        routeId: `monad_dex:mock:${request.pair.symbol}:${request.side}`,
        receivedAt: Date.now(),
        raw: { mock: true, reason },
      },
    ];
  }
}
