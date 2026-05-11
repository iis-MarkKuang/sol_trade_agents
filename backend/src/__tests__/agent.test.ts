import { describe, expect, it } from "vitest";
import { RealTimeAgentCore } from "../agent/realtime-agent-core.js";
import { DEFAULT_PAIRS } from "../config/tokens.js";
import { DexOrderBookAggregator } from "../dex/aggregator.js";
import { MockDexAdapter } from "../dex/mock-adapter.js";
import { NbboEngine } from "../nbbo/engine.js";
import { MockPythPriceFeedService } from "../oracle/pyth-price-feed.js";
import { RiskEngine } from "../risk/risk-engine.js";
import type { RiskPolicy } from "../types.js";
import { toNativeAmount } from "../utils/amounts.js";

describe("RealTimeAgentCore", () => {
  it("prepares a buy trade using the lowest executable ask", async () => {
    const pair = DEFAULT_PAIRS["SOL/USDC"];
    const policy: RiskPolicy = {
      allowedPairs: ["SOL/USDC"],
      allowedDexes: ["jupiter", "raydium", "orca", "mock"],
      maxSlippageBps: 100,
      maxPositionNotionalUsd: 10_000,
      minLiquidityUsd: 1_000,
      maxOracleDeviationBps: 200,
      maxPriceImpactBps: 100,
      maxQuoteAgeMs: 5_000
    };
    const core = new RealTimeAgentCore({
      priceFeed: new MockPythPriceFeedService({ "SOL/USDC": 160 }),
      aggregator: new DexOrderBookAggregator([
        new MockDexAdapter({ source: "jupiter", midPrice: 160, askSpreadBps: 20, liquidityUsd: 2_000_000 }),
        new MockDexAdapter({ source: "orca", midPrice: 160, askSpreadBps: 5, liquidityUsd: 2_000_000 })
      ]),
      nbbo: new NbboEngine(),
      risk: new RiskEngine(),
      policy,
      tokenPairs: DEFAULT_PAIRS
    });

    const plan = await core.prepareTrade({
      pair: "SOL/USDC",
      side: "buy",
      amountIn: toNativeAmount(160, pair.quote.decimals).toString(),
      maxSlippageBps: 100
    });

    expect(plan.status).toBe("ready");
    expect(plan.selectedRoute?.quote.source).toBe("orca");
    expect(plan.minOutAmount).toBeGreaterThan(0n);
  });
});
