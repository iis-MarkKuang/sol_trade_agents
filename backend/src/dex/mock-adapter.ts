import type { DexAdapter } from "./adapter.js";
import type { DexQuote, DexQuoteRequest, DexSource } from "../types.js";
import { inputOutputForSide, outputAmountFromPrice } from "../utils/amounts.js";

export interface MockDexAdapterConfig {
  source?: DexSource;
  midPrice: number;
  bidSpreadBps?: number;
  askSpreadBps?: number;
  liquidityUsd?: number;
  feeBps?: number;
  priceImpactBps?: number;
  latencyMs?: number;
}

export class MockDexAdapter implements DexAdapter {
  readonly source: DexSource;

  constructor(private readonly config: MockDexAdapterConfig) {
    this.source = config.source ?? "mock";
  }

  async quote(request: DexQuoteRequest): Promise<DexQuote[]> {
    const latencyMs = this.config.latencyMs ?? 1;
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }

    const spreadBps = request.side === "bid" ? this.config.bidSpreadBps ?? 10 : this.config.askSpreadBps ?? 10;
    const sideMultiplier = request.side === "bid" ? 1 - spreadBps / 10_000 : 1 + spreadBps / 10_000;
    const executablePrice = this.config.midPrice * sideMultiplier;
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
        liquidityUsd: this.config.liquidityUsd ?? 1_000_000,
        priceImpactBps: this.config.priceImpactBps ?? 2,
        latencyMs,
        routeId: `${this.source}:mock:${request.side}`,
        receivedAt: Date.now()
      }
    ];
  }
}
