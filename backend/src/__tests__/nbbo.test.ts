import { describe, expect, it } from "vitest";
import { DEFAULT_PAIRS } from "../config/tokens.js";
import { DexOrderBookAggregator } from "../dex/aggregator.js";
import { MockDexAdapter } from "../dex/mock-adapter.js";
import { NbboEngine } from "../nbbo/engine.js";
import { toNativeAmount } from "../utils/amounts.js";

describe("NbboEngine", () => {
  it("selects highest bid and lowest ask across DEX sources", async () => {
    const pair = DEFAULT_PAIRS["SOL/USDC"];
    const aggregator = new DexOrderBookAggregator([
      new MockDexAdapter({ source: "jupiter", midPrice: 160, bidSpreadBps: 10, askSpreadBps: 12, liquidityUsd: 1_000_000 }),
      new MockDexAdapter({ source: "raydium", midPrice: 160, bidSpreadBps: 6, askSpreadBps: 15, liquidityUsd: 2_000_000 }),
      new MockDexAdapter({ source: "orca", midPrice: 160, bidSpreadBps: 9, askSpreadBps: 8, liquidityUsd: 3_000_000 })
    ]);

    const book = await aggregator.queryBook(
      { pair, side: "bid", amountIn: toNativeAmount(1, pair.base.decimals), slippageBps: 100 },
      { pair, side: "ask", amountIn: toNativeAmount(160, pair.quote.decimals), slippageBps: 100 }
    );
    const snapshot = new NbboEngine().calculate(book);

    expect(snapshot.bestBid?.source).toBe("raydium");
    expect(snapshot.bestAsk?.source).toBe("orca");
    expect(snapshot.spreadBps).toBeGreaterThan(0);
  });
});
