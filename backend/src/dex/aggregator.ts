import type { DexAdapter } from "./adapter.js";
import { withTimeout } from "../utils/async.js";
import type { AggregatedOrderBook, DexQuote, DexQuoteFailure, DexQuoteRequest } from "../types.js";

export class DexOrderBookAggregator {
  constructor(
    private readonly adapters: DexAdapter[],
    private readonly options: { quoteTimeoutMs?: number } = {}
  ) {}

  async queryAll(request: DexQuoteRequest): Promise<{ quotes: DexQuote[]; failures: DexQuoteFailure[] }> {
    const quoteTimeoutMs = this.options.quoteTimeoutMs ?? 2_500;

    const settled = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        const started = Date.now();
        try {
          const quotes = await withTimeout(
            adapter.quote(request),
            quoteTimeoutMs,
            `${adapter.source} quote timed out`
          );
          return { quotes, failure: undefined };
        } catch (error) {
          return {
            quotes: [],
            failure: {
              source: adapter.source,
              side: request.side,
              message: error instanceof Error ? error.message : String(error),
              latencyMs: Date.now() - started
            } satisfies DexQuoteFailure
          };
        }
      })
    );

    const quotes: DexQuote[] = [];
    const failures: DexQuoteFailure[] = [];

    for (const result of settled) {
      if (result.status === "fulfilled") {
        quotes.push(...result.value.quotes);
        if (result.value.failure) {
          failures.push(result.value.failure);
        }
      } else {
        failures.push({
          source: "mock",
          side: request.side,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          latencyMs: quoteTimeoutMs
        });
      }
    }

    return {
      quotes: quotes
        .filter((quote) => quote.outAmount > 0n && Number.isFinite(quote.price) && quote.price > 0)
        .sort((a, b) => sortQuoteBySide(request.side, a, b)),
      failures
    };
  }

  async queryBook(
    bidRequest: DexQuoteRequest,
    askRequest: DexQuoteRequest
  ): Promise<AggregatedOrderBook> {
    const [bidResult, askResult] = await Promise.all([this.queryAll(bidRequest), this.queryAll(askRequest)]);

    return {
      pair: bidRequest.pair,
      bids: bidResult.quotes,
      asks: askResult.quotes,
      failures: [...bidResult.failures, ...askResult.failures],
      queriedAt: Date.now()
    };
  }
}

function sortQuoteBySide(side: "bid" | "ask", a: DexQuote, b: DexQuote): number {
  if (side === "bid") {
    return b.price - a.price || b.liquidityUsd - a.liquidityUsd || a.latencyMs - b.latencyMs;
  }

  return a.price - b.price || b.liquidityUsd - a.liquidityUsd || a.latencyMs - b.latencyMs;
}
