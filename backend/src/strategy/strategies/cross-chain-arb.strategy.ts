import { Injectable, Logger } from '@nestjs/common';
import { pairSymbolForChain } from '../../config/tokens.js';
import type { NbboSnapshot } from '../../types.js';

export interface CrossChainArbSignal {
  asset: string;
  solanaPair: string;
  injectivePair: string;
  solanaMid: number;
  injectiveMid: number;
  spreadBps: number;
  bridgeCostBps: number;
  netEdgeBps: number;
  /** Chain to buy the asset on (the cheaper leg). */
  buyChain: 'solana' | 'injective';
  /** Chain to sell the asset on (the richer leg). */
  sellChain: 'solana' | 'injective';
  action: 'buy' | 'sell';
  confidence: number;
  reason: string;
  bridgePath: string;
  estimatedNotionalUsd: number;
  timestamp: number;
}

export interface CrossChainArbOptions {
  /** Minimum net edge (after bridge cost) in bps to emit a signal. */
  minNetEdgeBps?: number;
  /** Estimated cross-chain bridge cost (deBridge/Peggy) in bps. */
  bridgeCostBps?: number;
  /** Default notional per leg in USD, used to estimate edge size. */
  notionalUsd?: number;
  /** Shared base assets to scan (defaults to BTC, ETH). */
  assets?: string[];
}

/**
 * Detects cross-chain arbitrage opportunities between Solana and Injective for
 * assets that trade on both chains (BTC, ETH). The signal is research-oriented:
 * real execution requires bridging funds across chains, so the strategy emits a
 * recommended buy-chain / sell-chain plan plus a bridge path rather than a
 * same-leg execution intent.
 */
@Injectable()
export class CrossChainArbStrategy {
  private readonly logger = new Logger(CrossChainArbStrategy.name);

  detectArb(
    snapshots: Record<string, NbboSnapshot>,
    options: CrossChainArbOptions = {},
  ): CrossChainArbSignal[] {
    const minNetEdgeBps = options.minNetEdgeBps ?? 30;
    const bridgeCostBps = options.bridgeCostBps ?? 25;
    const notionalUsd = options.notionalUsd ?? 1_000;
    const assets = options.assets ?? ['BTC', 'ETH'];

    const signals: CrossChainArbSignal[] = [];

    for (const asset of assets) {
      const solSymbol = pairSymbolForChain(asset, 'solana');
      const injSymbol = pairSymbolForChain(asset, 'injective');
      if (!solSymbol || !injSymbol) {
        continue;
      }
      const solSnap = snapshots[solSymbol];
      const injSnap = snapshots[injSymbol];
      if (!solSnap || !injSnap) {
        continue;
      }

      const solMid = midPrice(solSnap);
      const injMid = midPrice(injSnap);
      if (!solMid || !injMid) {
        continue;
      }

      const spreadBps = ((injMid - solMid) / solMid) * 10_000;
      const netEdgeBps = Math.abs(spreadBps) - bridgeCostBps;
      if (!Number.isFinite(netEdgeBps) || netEdgeBps < minNetEdgeBps) {
        continue;
      }

      const buyChain: 'solana' | 'injective' = spreadBps > 0 ? 'solana' : 'injective';
      const sellChain: 'solana' | 'injective' = buyChain === 'solana' ? 'injective' : 'solana';
      const grossEdgeUsd = (Math.abs(spreadBps) / 10_000) * notionalUsd;
      const bridgePath =
        buyChain === 'solana'
          ? 'deBridge/Peggy: Solana -> Injective'
          : 'deBridge/Peggy: Injective -> Solana';

      signals.push({
        asset,
        solanaPair: solSymbol,
        injectivePair: injSymbol,
        solanaMid: solMid,
        injectiveMid: injMid,
        spreadBps,
        bridgeCostBps,
        netEdgeBps,
        buyChain,
        sellChain,
        action: 'buy',
        confidence: Math.min(0.9, 0.5 + netEdgeBps / 200),
        reason: `${asset} spread ${spreadBps.toFixed(1)} bps (Solana ${solMid.toFixed(2)} vs Injective ${injMid.toFixed(2)}); net ${netEdgeBps.toFixed(1)} bps after ${bridgeCostBps} bps bridge`,
        bridgePath,
        estimatedNotionalUsd: notionalUsd,
        timestamp: Date.now(),
      });
    }

    this.logger.log(`Cross-chain arb scan: ${signals.length} signal(s) across ${assets.join(',')}`);
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
