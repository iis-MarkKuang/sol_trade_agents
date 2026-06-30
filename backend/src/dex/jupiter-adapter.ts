import { createJupiterApiClient } from "@jup-ag/api";
import type { DexAdapter } from "./adapter.js";
import type { DexQuote, DexQuoteRequest } from "../types.js";
import { calculatePairPrice, inputOutputForSide } from "../utils/amounts.js";

export interface JupiterQuoteAdapterConfig {
  basePath?: string;
  apiKey?: string;
}

export class JupiterQuoteAdapter implements DexAdapter {
  readonly source = "jupiter" as const;
  private readonly api: ReturnType<typeof createJupiterApiClient>;

  constructor(config: JupiterQuoteAdapterConfig = {}) {
    this.api = createJupiterApiClient({
      basePath: config.basePath,
      apiKey: config.apiKey
    } as Parameters<typeof createJupiterApiClient>[0]);
  }

  async quote(request: DexQuoteRequest): Promise<DexQuote[]> {
    const started = Date.now();
    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);
    const raw = await this.api.quoteGet({
      inputMint,
      outputMint,
      amount: Number(request.amountIn),
      slippageBps: request.slippageBps
    });

    const outAmount = BigInt(String(raw.outAmount ?? "0"));
    const price = calculatePairPrice(request, outAmount);

    return [
      {
        source: this.source,
        chain: "solana",
        side: request.side,
        pair: request.pair.symbol,
        inputMint,
        outputMint,
        inAmount: request.amountIn,
        outAmount,
        price,
        feeBps: estimateJupiterFeeBps(raw),
        liquidityUsd: estimateLiquidityUsd(request, price),
        priceImpactBps: Number(raw.priceImpactPct ?? 0) * 10_000,
        latencyMs: Date.now() - started,
        routeId: describeJupiterRoute(raw),
        receivedAt: Date.now(),
        raw
      }
    ];
  }
}

function describeJupiterRoute(raw: { routePlan?: Array<{ swapInfo?: { label?: string; ammKey?: string } }> }): string {
  const labels = raw.routePlan
    ?.map((step) => step.swapInfo?.label ?? step.swapInfo?.ammKey)
    .filter(Boolean);
  return labels && labels.length > 0 ? labels.join(" -> ") : "jupiter";
}

function estimateJupiterFeeBps(raw: { platformFee?: { amount?: string }; inAmount?: string }): number {
  const feeAmount = Number(raw.platformFee?.amount ?? 0);
  const inAmount = Number(raw.inAmount ?? 0);
  if (!Number.isFinite(feeAmount) || !Number.isFinite(inAmount) || inAmount <= 0) {
    return 0;
  }
  return (feeAmount / inAmount) * 10_000;
}

function estimateLiquidityUsd(request: DexQuoteRequest, price: number): number {
  const inputIsQuote = request.side === "ask";
  if (inputIsQuote) {
    return Number(request.amountIn) / 10 ** request.pair.quote.decimals;
  }
  return (Number(request.amountIn) / 10 ** request.pair.base.decimals) * price;
}
