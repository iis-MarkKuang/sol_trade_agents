import type { AggregatedOrderBook, DexQuote, NbboSnapshot, QuoteSide, RouteSelection, TradeIntent } from "../types.js";

export class NbboEngine {
  calculate(orderBook: AggregatedOrderBook): NbboSnapshot {
    const bids = orderBook.bids.filter(isExecutableQuote).sort(bestBidFirst);
    const asks = orderBook.asks.filter(isExecutableQuote).sort(bestAskFirst);
    const bestBid = bids.at(0);
    const bestAsk = asks.at(0);
    const spreadBps =
      bestBid && bestAsk && bestAsk.price > 0 ? ((bestAsk.price - bestBid.price) / bestAsk.price) * 10_000 : undefined;

    return {
      pair: orderBook.pair,
      bestBid,
      bestAsk,
      spreadBps,
      bidDepthUsd: bids.reduce((sum, quote) => sum + quote.liquidityUsd, 0),
      askDepthUsd: asks.reduce((sum, quote) => sum + quote.liquidityUsd, 0),
      quoteCount: bids.length + asks.length,
      failures: orderBook.failures,
      generatedAt: Date.now()
    };
  }

  selectRoute(intent: TradeIntent, snapshot: NbboSnapshot): RouteSelection {
    const side: QuoteSide = intent.side === "sell" ? "bid" : "ask";
    const quote = side === "bid" ? snapshot.bestBid : snapshot.bestAsk;
    if (!quote) {
      throw new Error(`No executable ${side} route available for ${snapshot.pair.symbol}`);
    }

    return {
      side,
      quote,
      reason:
        side === "bid"
          ? `highest executable bid from ${quote.source}`
          : `lowest executable ask from ${quote.source}`
    };
  }
}

function isExecutableQuote(quote: DexQuote): boolean {
  return quote.outAmount > 0n && quote.price > 0 && Number.isFinite(quote.price);
}

function bestBidFirst(a: DexQuote, b: DexQuote): number {
  return b.price - a.price || b.liquidityUsd - a.liquidityUsd || a.latencyMs - b.latencyMs;
}

function bestAskFirst(a: DexQuote, b: DexQuote): number {
  return a.price - b.price || b.liquidityUsd - a.liquidityUsd || a.latencyMs - b.latencyMs;
}
