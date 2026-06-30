import { getTokenPair } from "../config/tokens.js";
import { DexOrderBookAggregator } from "../dex/aggregator.js";
import { NbboEngine } from "../nbbo/engine.js";
import type { PriceFeedReader } from "../oracle/pyth-price-feed.js";
import { RiskEngine, TradeIntentSchema } from "../risk/risk-engine.js";
import type {
  DexQuote,
  InjectiveExecutionPlan,
  RiskPolicy,
  TokenPair,
  TradeExecutionPlan,
  TradeIntent,
} from "../types.js";
import { amountToDecimal, applyBps } from "../utils/amounts.js";
import { withRetry } from "../utils/async.js";
import type { JupiterTransactionBuilder } from "../transactions/jupiter-transaction-builder.js";
import type { InjectiveTradeExecutor } from "../transactions/injective-mcp-client.js";

export interface RealTimeAgentCoreConfig {
  priceFeed: PriceFeedReader;
  aggregator: DexOrderBookAggregator;
  nbbo: NbboEngine;
  risk: RiskEngine;
  policy: RiskPolicy;
  tokenPairs?: Record<string, TokenPair>;
  txBuilder?: JupiterTransactionBuilder;
  injectiveExecutor?: InjectiveTradeExecutor;
  retries?: number;
}

export class RealTimeAgentCore {
  constructor(private readonly config: RealTimeAgentCoreConfig) {}

  async prepareTrade(input: unknown): Promise<TradeExecutionPlan> {
    const intent = TradeIntentSchema.parse(input) as TradeIntent;
    const pair = getTokenPair(intent.pair, this.config.tokenPairs);
    const oracleMap = await withRetry(() => this.config.priceFeed.getLatest([pair]), {
      retries: this.config.retries ?? 2,
      baseDelayMs: 100,
      maxDelayMs: 750,
      jitter: true
    });
    const oraclePrice = oracleMap.get(pair.symbol);
    if (!oraclePrice) {
      throw new Error(`Missing oracle price for ${pair.symbol}`);
    }

    this.config.risk.validateIntent(intent, pair, this.config.policy, oraclePrice);

    const request = {
      pair,
      side: intent.side === "sell" ? ("bid" as const) : ("ask" as const),
      amountIn: intent.amountIn,
      slippageBps: intent.maxSlippageBps
    };
    const quoteResult = await withRetry(() => this.config.aggregator.queryAll(request), {
      retries: this.config.retries ?? 2,
      baseDelayMs: 100,
      maxDelayMs: 750,
      jitter: true
    });
    const orderBook =
      request.side === "bid"
        ? { pair, bids: quoteResult.quotes, asks: [], failures: quoteResult.failures, queriedAt: Date.now() }
        : { pair, bids: [], asks: quoteResult.quotes, failures: quoteResult.failures, queriedAt: Date.now() };
    const nbbo = this.config.nbbo.calculate(orderBook);
    const selectedRoute = this.config.nbbo.selectRoute(intent, nbbo);

    this.config.risk.validateRoute(selectedRoute, oraclePrice, this.config.policy);

    const minOutAmount = applyBps(selectedRoute.quote.outAmount, intent.maxSlippageBps);
    const plan: TradeExecutionPlan = {
      status: "ready",
      intent,
      pair,
      oraclePrice,
      nbbo,
      selectedRoute,
      minOutAmount,
      createdAt: Date.now()
    };

    const chain = selectedRoute.quote.chain;

    if (chain === "injective") {
      plan.injectiveExecutionPlan = this.buildInjectivePlan(pair, intent, selectedRoute.quote, oraclePrice.price);
    } else if (
      intent.user &&
      selectedRoute.quote.source === "jupiter" &&
      this.config.txBuilder
    ) {
      plan.unsignedTransactionBase64 = await this.config.txBuilder.buildSwapTransaction({
        quote: selectedRoute.quote,
        userPublicKey: intent.user
      });
    }

    return plan;
  }

  private buildInjectivePlan(
    pair: TokenPair,
    intent: TradeIntent,
    quote: DexQuote,
    oraclePrice: number
  ): InjectiveExecutionPlan {
    const raw = quote.raw as { marketId?: string; marketType?: "spot" | "derivative" } | undefined;
    const marketId = raw?.marketId ?? pair.symbol;
    const marketType = raw?.marketType ?? "spot";
    const notionalUsd =
      intent.side === "buy"
        ? amountToDecimal(intent.amountIn, pair.quote.decimals).toNumber()
        : amountToDecimal(intent.amountIn, pair.base.decimals).mul(oraclePrice).toNumber();

    return {
      marketId,
      marketType,
      side: intent.side,
      amount: intent.amountIn.toString(),
      price: quote.price,
      notionalUsd,
      reason: `Injective Helix ${marketType} ${marketId} ${intent.side} via MCP`
    };
  }
}
