import type { PriceFeedReader, PriceFeedSubscription, PriceFeedSubscriber } from "./pyth-price-feed.js";
import type { PriceUpdate, TokenPair } from "../types.js";

/**
 * Injective shares the same Pyth Hermes oracle network as Solana, so the same
 * `PythPriceFeedService` can serve Injective pairs (INJ/USDC etc.) as long as
 * the token registry carries a `pythPriceId`.
 *
 * This adapter is a thin, chain-scoped wrapper around a base `PriceFeedReader`.
 * It exists so the realtime wiring can request "Injective prices" explicitly
 * and so we can later swap in an Injective-native oracle (e.g. Band) without
 * touching the rest of the pipeline. It validates that the requested pairs
 * carry Injective denoms before delegating.
 */
export class InjectivePythPriceFeedService implements PriceFeedSubscriber {
  constructor(private readonly delegate: PriceFeedReader) {}

  async getLatest(pairs: TokenPair[]): Promise<Map<string, PriceUpdate>> {
    const injectivePairs = pairs.filter((pair) => Boolean(pair.base.denom || pair.quote.denom));
    if (injectivePairs.length === 0) {
      return new Map<string, PriceUpdate>();
    }
    return this.delegate.getLatest(injectivePairs);
  }

  async subscribe(
    pairs: TokenPair[],
    onUpdate: (update: PriceUpdate) => void
  ): Promise<PriceFeedSubscription> {
    const subscriber = this.delegate as PriceFeedSubscriber;
    if (typeof subscriber.subscribe !== "function") {
      throw new Error("Wrapped PriceFeedReader does not implement subscribe()");
    }
    const injectivePairs = pairs.filter((pair) => Boolean(pair.base.denom || pair.quote.denom));
    if (injectivePairs.length === 0) {
      return { close() {} };
    }
    return subscriber.subscribe(injectivePairs, onUpdate);
  }
}
