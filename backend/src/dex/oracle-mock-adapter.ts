import type { DexAdapter } from "./adapter.js";
import type { DexQuote, DexQuoteRequest, DexSource } from "../types.js";
import { inputOutputForSide, outputAmountFromPrice } from "../utils/amounts.js";

export interface OracleMockAdapterConfig {
  source?: DexSource;
  /** Returns the oracle mid price for a given pair symbol (e.g. "SOL/USDC"). */
  getMidPrice: (pairSymbol: string) => number | undefined;
  /** Fallback mid price used when the oracle hasn't published yet. */
  fallbackMidPrice?: number;
  bidSpreadBps?: number;
  askSpreadBps?: number;
  liquidityUsd?: number;
  feeBps?: number;
  priceImpactBps?: number;
  latencyMs?: number;
}

/**
 * A mock DEX adapter whose mid price tracks the live oracle, so executable
 * quotes always sit within a few bps of the oracle. Useful for demo mode where
 * we don't want the risk engine to trip on the gap between a static mock and
 * the real Pyth price.
 */
export class OracleMockAdapter implements DexAdapter {
  readonly source: DexSource;

  constructor(private readonly config: OracleMockAdapterConfig) {
    this.source = config.source ?? "mock";
  }

  async quote(request: DexQuoteRequest): Promise<DexQuote[]> {
    const latencyMs = this.config.latencyMs ?? 1;
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }

    const mid = this.config.getMidPrice(request.pair.symbol) ?? this.config.fallbackMidPrice ?? 0;
    if (!Number.isFinite(mid) || mid <= 0) {
      return [];
    }

    const spreadBps =
      request.side === "bid"
        ? this.config.bidSpreadBps ?? 8
        : this.config.askSpreadBps ?? 10;
    const sideMultiplier =
      request.side === "bid" ? 1 - spreadBps / 10_000 : 1 + spreadBps / 10_000;
    const executablePrice = mid * sideMultiplier;
    const outAmount = outputAmountFromPrice(request, executablePrice);
    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);

    return [
      {
        source: this.source,
        side: request.side,
        pair: request.pair.symbol,
        inputMint,
        outputMint,
        inAmount: request.amountIn,
        outAmount,
        price: executablePrice,
        feeBps: this.config.feeBps ?? 4,
        liquidityUsd: this.config.liquidityUsd ?? 2_500_000,
        priceImpactBps: this.config.priceImpactBps ?? 2,
        latencyMs,
        routeId: `${this.source}:oracle-mock:${request.side}`,
        receivedAt: Date.now()
      }
    ];
  }
}
