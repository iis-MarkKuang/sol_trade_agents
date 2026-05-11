import { Connection } from "@solana/web3.js";
import type { DexAdapter } from "./adapter.js";
import type { DexQuote, DexQuoteRequest } from "../types.js";
import { inputOutputForSide, outputAmountFromPrice } from "../utils/amounts.js";

export interface RaydiumOrderBookAdapterConfig {
  connection: Connection;
  maxPools?: number;
}

export class RaydiumOrderBookAdapter implements DexAdapter {
  readonly source = "raydium" as const;
  private raydiumPromise?: Promise<any>;

  constructor(private readonly config: RaydiumOrderBookAdapterConfig) {}

  async quote(request: DexQuoteRequest): Promise<DexQuote[]> {
    const started = Date.now();
    const raydium = await this.getRaydium();
    const response = await raydium.api.fetchPoolByMints({
      mint1: request.pair.base.mint,
      mint2: request.pair.quote.mint
    });
    const pools = extractPools(response).slice(0, this.config.maxPools ?? 4);
    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);

    return pools
      .map((pool: Record<string, unknown>, index: number): DexQuote | undefined => {
        const midPrice = derivePoolPrice(pool, request.pair.base.mint, request.pair.quote.mint);
        if (!midPrice || !Number.isFinite(midPrice) || midPrice <= 0) {
          return undefined;
        }

        const feeBps = deriveFeeBps(pool);
        const executablePrice =
          request.side === "bid" ? midPrice * (1 - feeBps / 10_000) : midPrice * (1 + feeBps / 10_000);
        const outAmount = outputAmountFromPrice(request, executablePrice);

        return {
          source: this.source,
          side: request.side,
          pair: request.pair.symbol,
          inputMint,
          outputMint,
          inAmount: request.amountIn,
          outAmount,
          price: executablePrice,
          feeBps,
          liquidityUsd: Number(pool.tvl ?? pool.liquidity ?? 0),
          priceImpactBps: estimatePriceImpactBps(pool, request.amountIn),
          latencyMs: Date.now() - started,
          routeId: `raydium:${String(pool.id ?? pool.poolId ?? index)}`,
          receivedAt: Date.now(),
          raw: pool
        };
      })
      .filter((quote): quote is DexQuote => Boolean(quote));
  }

  private async getRaydium(): Promise<any> {
    if (!this.raydiumPromise) {
      this.raydiumPromise = import("@raydium-io/raydium-sdk-v2").then(async ({ Raydium }) =>
        Raydium.load({
          connection: this.config.connection,
          disableLoadToken: true,
          disableFeatureCheck: true,
          blockhashCommitment: "confirmed"
        })
      );
    }

    return this.raydiumPromise;
  }
}

function extractPools(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) {
    return response as Array<Record<string, unknown>>;
  }
  if (response && typeof response === "object") {
    const object = response as { data?: unknown; pools?: unknown };
    if (Array.isArray(object.data)) {
      return object.data as Array<Record<string, unknown>>;
    }
    if (Array.isArray(object.pools)) {
      return object.pools as Array<Record<string, unknown>>;
    }
  }

  return [];
}

function derivePoolPrice(pool: Record<string, unknown>, baseMint: string, quoteMint: string): number | undefined {
  const mintA = extractMint(pool.mintA);
  const mintB = extractMint(pool.mintB);
  const rawPrice = Number(pool.price ?? pool.poolPrice ?? 0);
  const amountA = Number(pool.mintAmountA ?? pool.amountA ?? pool.reserveA ?? 0);
  const amountB = Number(pool.mintAmountB ?? pool.amountB ?? pool.reserveB ?? 0);

  if (amountA > 0 && amountB > 0 && mintA && mintB) {
    if (mintA === baseMint && mintB === quoteMint) {
      return amountB / amountA;
    }
    if (mintA === quoteMint && mintB === baseMint) {
      return amountA / amountB;
    }
  }

  if (rawPrice > 0 && mintA && mintB) {
    if (mintA === baseMint && mintB === quoteMint) {
      return rawPrice;
    }
    if (mintA === quoteMint && mintB === baseMint) {
      return 1 / rawPrice;
    }
  }

  return rawPrice > 0 ? rawPrice : undefined;
}

function extractMint(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const object = value as { address?: unknown; mint?: unknown };
    if (typeof object.address === "string") {
      return object.address;
    }
    if (typeof object.mint === "string") {
      return object.mint;
    }
  }

  return undefined;
}

function deriveFeeBps(pool: Record<string, unknown>): number {
  const raw = Number(pool.feeRate ?? pool.tradeFeeRate ?? pool.feeBps ?? 25);
  if (!Number.isFinite(raw)) {
    return 25;
  }
  return raw < 1 ? raw * 10_000 : raw;
}

function estimatePriceImpactBps(pool: Record<string, unknown>, amountIn: bigint): number {
  const tvl = Number(pool.tvl ?? pool.liquidity ?? 0);
  if (!Number.isFinite(tvl) || tvl <= 0) {
    return 0;
  }

  const roughSize = Number(amountIn) / 1_000_000;
  return Math.min(1_000, (roughSize / tvl) * 10_000);
}
