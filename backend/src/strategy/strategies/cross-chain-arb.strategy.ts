import { Injectable, Logger } from '@nestjs/common';
import { pairSymbolForChain } from '../../config/tokens.js';
import type { ChainId, NbboSnapshot } from '../../types.js';

export interface CrossChainArbSignal {
  asset: string;
  /** Pair symbol on the Solana leg (set when Solana is one of the two legs). */
  solanaPair?: string;
  /** Pair symbol on the Injective leg (set when Injective is one of the two legs). */
  injectivePair?: string;
  /** Pair symbol on the buy leg (generic, always set). */
  buyPair: string;
  /** Pair symbol on the sell leg (generic, always set). */
  sellPair: string;
  /** Mid price on the buy leg. */
  buyMid: number;
  /** Mid price on the sell leg. */
  sellMid: number;
  spreadBps: number;
  bridgeCostBps: number;
  netEdgeBps: number;
  /** Chain to buy the asset on (the cheaper leg). */
  buyChain: ChainId;
  /** Chain to sell the asset on (the richer leg). */
  sellChain: ChainId;
  action: 'buy' | 'sell';
  confidence: number;
  reason: string;
  bridgePath: string;
  estimatedNotionalUsd: number;
  timestamp: number;
}

/** Backward-compatible aliases for the original 2-chain signal fields. */
export interface LegacyCrossChainArbSignal extends CrossChainArbSignal {
  solanaPair: string;
  injectivePair: string;
  solanaMid: number;
  injectiveMid: number;
}

export interface CrossChainArbOptions {
  /** Minimum net edge (after bridge cost) in bps to emit a signal. */
  minNetEdgeBps?: number;
  /** Estimated cross-chain bridge cost. A flat number applies to all pairs;
   * a record keyed by `"buyChain|sellChain"` (alphabetical) gives per-pair costs.
   * Defaults to 25 bps for all pairs. */
  bridgeCostBps?: number | Record<string, number>;
  /** Default notional per leg in USD, used to estimate edge size. */
  notionalUsd?: number;
  /** Shared base assets to scan (defaults to BTC, ETH). */
  assets?: string[];
  /** Chains to scan pairwise (defaults to ['solana', 'injective'] for backward compat). */
  chains?: ChainId[];
}

/**
 * Detects cross-chain arbitrage opportunities across N chains for assets that
 * trade on multiple chains (e.g. BTC, ETH on Solana, Injective, Monad). For each
 * shared asset the strategy computes the mid on every chain in `chains`, then
 * emits one signal per unordered chain pair whose net edge (after bridge cost)
 * meets `minNetEdgeBps`. The signal is research-oriented: real execution
 * requires bridging funds across chains, so the strategy emits a recommended
 * buy-chain / sell-chain plan plus a bridge path rather than a same-leg
 * execution intent.
 *
 * Backward compatible: when `chains` is unset it defaults to
 * `['solana', 'injective']` and the output matches the original 2-chain shape
 * (solanaPair/injectivePair/solanaMid/injectiveMid populated).
 */
@Injectable()
export class CrossChainArbStrategy {
  private readonly logger = new Logger(CrossChainArbStrategy.name);

  detectArb(
    snapshots: Record<string, NbboSnapshot>,
    options: CrossChainArbOptions = {},
  ): CrossChainArbSignal[] {
    const minNetEdgeBps = options.minNetEdgeBps ?? 30;
    const flatBridgeCostBps = typeof options.bridgeCostBps === 'number' ? options.bridgeCostBps : 25;
    const bridgeCostMap =
      typeof options.bridgeCostBps === 'object' ? options.bridgeCostBps : {};
    const notionalUsd = options.notionalUsd ?? 1_000;
    const assets = options.assets ?? ['BTC', 'ETH'];
    const chains: ChainId[] = options.chains ?? ['solana', 'injective'];

    if (chains.length < 2) {
      return [];
    }

    const signals: CrossChainArbSignal[] = [];

    for (const asset of assets) {
      // Resolve the mid price for this asset on every chain.
      const mids: { chain: ChainId; symbol: string; mid: number }[] = [];
      for (const chain of chains) {
        const symbol = pairSymbolForChain(asset, chain);
        if (!symbol) continue;
        const snap = snapshots[symbol];
        if (!snap) continue;
        const mid = midPrice(snap);
        if (!mid || !Number.isFinite(mid) || mid <= 0) continue;
        mids.push({ chain, symbol, mid });
      }

      // Emit one signal per unordered chain pair.
      for (let i = 0; i < mids.length; i++) {
        for (let j = i + 1; j < mids.length; j++) {
          const a = mids[i];
          const b = mids[j];
          const spreadBps = ((b.mid - a.mid) / a.mid) * 10_000;
          const absSpread = Math.abs(spreadBps);

          const pairKey = [a.chain, b.chain].sort().join('|');
          const bridgeCostBps = bridgeCostMap[pairKey] ?? flatBridgeCostBps;
          const netEdgeBps = absSpread - bridgeCostBps;
          if (!Number.isFinite(netEdgeBps) || netEdgeBps < minNetEdgeBps) {
            continue;
          }

          // buy on the cheaper leg, sell on the richer leg.
          const buy = spreadBps > 0 ? a : b; // cheaper mid -> buy here
          const sell = spreadBps > 0 ? b : a;
          const buyChain: ChainId = buy.chain;
          const sellChain: ChainId = sell.chain;

          const signal: CrossChainArbSignal = {
            asset,
            buyPair: buy.symbol,
            sellPair: sell.symbol,
            buyMid: buy.mid,
            sellMid: sell.mid,
            spreadBps,
            bridgeCostBps,
            netEdgeBps,
            buyChain,
            sellChain,
            action: 'buy',
            confidence: Math.min(0.9, 0.5 + netEdgeBps / 200),
            reason: `${asset} spread ${spreadBps.toFixed(1)} bps (${buy.chain} ${buy.mid.toFixed(2)} vs ${sell.chain} ${sell.mid.toFixed(2)}); net ${netEdgeBps.toFixed(1)} bps after ${bridgeCostBps} bps bridge`,
            bridgePath: `deBridge: ${buyChain} -> ${sellChain}`,
            estimatedNotionalUsd: notionalUsd,
            timestamp: Date.now(),
          };

          // Backward-compatible leg-specific fields.
          if (buy.chain === 'solana' || sell.chain === 'solana') {
            signal.solanaPair = buy.chain === 'solana' ? buy.symbol : sell.symbol;
          }
          if (buy.chain === 'injective' || sell.chain === 'injective') {
            signal.injectivePair = buy.chain === 'injective' ? buy.symbol : sell.symbol;
          }

          signals.push(signal);
        }
      }
    }

    this.logger.log(`Cross-chain arb scan: ${signals.length} signal(s) across ${assets.join(',')} on ${chains.join(',')}`);
    return signals;
  }
}

function midPrice(snapshot: NbboSnapshot): number | undefined {
  if (snapshot.bestBid && snapshot.bestAsk && snapshot.bestBid.price > 0 && snapshot.bestAsk.price > 0) {
    return (snapshot.bestBid.price + snapshot.bestAsk.price) / 2;
  }
  if (snapshot.bestBid && snapshot.bestBid.price > 0) return snapshot.bestBid.price;
  if (snapshot.bestAsk && snapshot.bestAsk.price > 0) return snapshot.bestAsk.price;
  return undefined;
}
