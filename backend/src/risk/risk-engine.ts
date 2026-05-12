import { z } from "zod";
import type { PriceUpdate, RiskPolicy, RouteSelection, TokenPair, TradeIntent } from "../types.js";
import { amountToDecimal } from "../utils/amounts.js";

export const TradeIntentSchema = z.object({
  id: z.string().optional(),
  user: z.string().optional(),
  pair: z.string().min(3),
  side: z.enum(["buy", "sell"]),
  amountIn: z.union([z.bigint(), z.string(), z.number()]).transform((value) => BigInt(value.toString())),
  maxSlippageBps: z.number().int().min(1).max(5_000).default(100),
  stopLossPrice: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  delegatedExecution: z.boolean().default(false)
});

export class RiskEngine {
  validateIntent(intent: TradeIntent, pair: TokenPair, policy: RiskPolicy, oraclePrice: PriceUpdate): void {
    if (!policy.allowedPairs.includes(pair.symbol)) {
      throw new Error(`Pair ${pair.symbol} is not allowed by policy`);
    }
    if (intent.maxSlippageBps > policy.maxSlippageBps) {
      throw new Error(`Requested slippage ${intent.maxSlippageBps} bps exceeds policy ${policy.maxSlippageBps} bps`);
    }
    if (intent.amountIn <= 0n) {
      throw new Error("Trade amount must be positive");
    }
    if (oraclePrice.isStale) {
      throw new Error(`Oracle price for ${pair.symbol} is stale`);
    }

    const notionalUsd =
      intent.side === "buy"
        ? amountToDecimal(intent.amountIn, pair.quote.decimals).toNumber()
        : amountToDecimal(intent.amountIn, pair.base.decimals).mul(oraclePrice.price).toNumber();

    if (notionalUsd > policy.maxPositionNotionalUsd) {
      throw new Error(`Notional ${notionalUsd.toFixed(2)} exceeds max ${policy.maxPositionNotionalUsd}`);
    }

    if (intent.stopLossPrice && intent.side === "buy" && intent.stopLossPrice >= oraclePrice.price) {
      throw new Error("Buy stop loss must be below current oracle price");
    }
  }

  validateRoute(selection: RouteSelection, oraclePrice: PriceUpdate, policy: RiskPolicy): void {
    const quote = selection.quote;
    if (!policy.allowedDexes.includes(quote.source)) {
      throw new Error(`DEX ${quote.source} is not allowed by policy`);
    }
    if (quote.liquidityUsd < policy.minLiquidityUsd) {
      throw new Error(`Route liquidity ${quote.liquidityUsd} is below minimum ${policy.minLiquidityUsd}`);
    }
    if (quote.priceImpactBps > policy.maxPriceImpactBps) {
      throw new Error(`Price impact ${quote.priceImpactBps} bps exceeds ${policy.maxPriceImpactBps} bps`);
    }
    if (Date.now() - quote.receivedAt > policy.maxQuoteAgeMs) {
      throw new Error("Selected quote is stale");
    }

    const deviationBps = Math.abs((quote.price - oraclePrice.price) / oraclePrice.price) * 10_000;
    if (deviationBps > policy.maxOracleDeviationBps) {
      throw new Error(
        `Route price deviates ${deviationBps.toFixed(2)} bps from oracle, max ${policy.maxOracleDeviationBps}`
      );
    }
  }
}
