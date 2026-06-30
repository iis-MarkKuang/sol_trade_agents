import type { DexAdapter } from "./adapter.js";
import type { DexQuote, DexQuoteRequest } from "../types.js";
import { inputOutputForSide, outputAmountFromPrice } from "../utils/amounts.js";

export interface InjectiveHelixMarket {
  marketId: string;
  type: "spot" | "derivative";
}

export interface InjectiveHelixAdapterConfig {
  /** Map pair symbol (e.g. "INJ/USDC") to Helix market metadata. */
  markets: Record<string, InjectiveHelixMarket>;
  /** Injective exchange REST API base URL. */
  apiBaseUrl?: string;
  /** Default taker fee in bps (Helix spot ~10 bps). */
  feeBps?: number;
  /** Max orderbook levels to sum when estimating depth. */
  maxDepthLevels?: number;
}

interface HelixOrderbookLevel {
  price: string;
  quantity: string;
}

interface HelixOrderbookResponse {
  orderbook?: {
    buys?: HelixOrderbookLevel[];
    sells?: HelixOrderbookLevel[];
  };
}

/**
 * DexAdapter backed by the Injective Helix exchange public REST API.
 *
 * The adapter maps a TokenPair (whose base/quote carry Injective denoms) to a
 * Helix market id, fetches the top-of-book, and synthesizes an executable
 * DexQuote at the best available price for the requested amount. Quotes are
 * tagged `chain: "injective"` so the nBBO engine and RealTimeAgentCore can
 * route execution to the Injective MCP server.
 */
export class InjectiveHelixAdapter implements DexAdapter {
  readonly source = "injective_helix" as const;

  private readonly apiBaseUrl: string;
  private readonly feeBps: number;
  private readonly maxDepthLevels: number;
  private readonly markets: Record<string, InjectiveHelixMarket>;

  constructor(config: InjectiveHelixAdapterConfig) {
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.injective.exchange";
    this.feeBps = config.feeBps ?? 10;
    this.maxDepthLevels = config.maxDepthLevels ?? 8;
    this.markets = config.markets;
  }

  async quote(request: DexQuoteRequest): Promise<DexQuote[]> {
    const market = this.config_markets(request);
    if (!market) {
      return [];
    }

    const started = Date.now();
    const path =
      market.type === "derivative"
        ? `/api/exchange/v2/derivative/orderbook?marketId=${encodeURIComponent(market.marketId)}`
        : `/api/exchange/v2/spot/orderbook?marketId=${encodeURIComponent(market.marketId)}`;
    const url = new URL(path, this.apiBaseUrl).toString();

    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Injective Helix orderbook request failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as HelixOrderbookResponse;
    const orderbook = payload.orderbook;
    if (!orderbook) {
      return [];
    }

    const levels = request.side === "bid" ? orderbook.buys ?? [] : orderbook.sells ?? [];
    if (levels.length === 0) {
      return [];
    }

    const sorted = [...levels].sort((a, b) => {
      const pa = Number(a.price);
      const pb = Number(b.price);
      return request.side === "bid" ? pb - pa : pa - pb;
    });

    const top = sorted[0];
    const executablePrice = Number(top.price);
    if (!Number.isFinite(executablePrice) || executablePrice <= 0) {
      return [];
    }

    const outAmount = outputAmountFromPrice(request, executablePrice);
    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);
    const liquidityUsd = sumDepthUsd(sorted, this.maxDepthLevels, executablePrice, request);

    return [
      {
        source: this.source,
        chain: "injective",
        side: request.side,
        pair: request.pair.symbol,
        inputMint,
        outputMint,
        inAmount: request.amountIn,
        outAmount,
        price: executablePrice,
        feeBps: this.feeBps,
        liquidityUsd,
        priceImpactBps: 0,
        latencyMs: Date.now() - started,
        routeId: `injective_helix:${market.marketId}:${request.side}`,
        receivedAt: Date.now(),
        raw: { marketId: market.marketId, marketType: market.type, top }
      }
    ];
  }

  private config_markets(request: DexQuoteRequest): InjectiveHelixMarket | undefined {
    return this.markets[request.pair.symbol];
  }
}

function sumDepthUsd(
  levels: HelixOrderbookLevel[],
  maxLevels: number,
  topPrice: number,
  request: DexQuoteRequest
): number {
  let quantity = 0;
  for (const level of levels.slice(0, maxLevels)) {
    quantity += Number(level.quantity);
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  // Depth in USD ≈ base quantity * price. For bid side the input is base token,
  // for ask side the input is quote token; we approximate liquidity uniformly.
  const baseDecimals = request.pair.base.decimals;
  return (quantity / 10 ** baseDecimals) * topPrice;
}
