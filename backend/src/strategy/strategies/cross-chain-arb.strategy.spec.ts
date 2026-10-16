import { CrossChainArbStrategy } from './cross-chain-arb.strategy.js';
import type { ChainId, NbboSnapshot } from '../../types.js';

function makeSnapshot(symbol: string, mid: number): NbboSnapshot {
  return {
    pair: { symbol } as never,
    bestBid: {
      source: 'mock',
      chain: 'solana',
      side: 'bid',
      pair: symbol,
      inputMint: 'base',
      outputMint: 'quote',
      inAmount: 1n,
      outAmount: 1n,
      price: mid * 0.999,
      feeBps: 4,
      liquidityUsd: 1_000_000,
      priceImpactBps: 0,
      latencyMs: 1,
      routeId: 'mock',
      receivedAt: Date.now(),
    },
    bestAsk: {
      source: 'mock',
      chain: 'solana',
      side: 'ask',
      pair: symbol,
      inputMint: 'quote',
      outputMint: 'base',
      inAmount: 1n,
      outAmount: 1n,
      price: mid * 1.001,
      feeBps: 4,
      liquidityUsd: 1_000_000,
      priceImpactBps: 0,
      latencyMs: 1,
      routeId: 'mock',
      receivedAt: Date.now(),
    },
    spreadBps: 20,
    bidDepthUsd: 1_000_000,
    askDepthUsd: 1_000_000,
    quoteCount: 2,
    failures: [],
    generatedAt: Date.now(),
  };
}

describe('CrossChainArbStrategy', () => {
  const strategy = new CrossChainArbStrategy();

  describe('default 2-chain (backward compatible)', () => {
    it('emits a solana<->injective signal when the spread exceeds bridge cost', () => {
      const snapshots = {
        'BTC/USDC': makeSnapshot('BTC/USDC', 64_000),
        'BTC/USDT': makeSnapshot('BTC/USDT', 64_400), // +62.5 bps
      };
      const signals = strategy.detectArb(snapshots, { bridgeCostBps: 25 });
      expect(signals).toHaveLength(1);
      const s = signals[0];
      expect(s.buyChain).toBe('solana');
      expect(s.sellChain).toBe('injective');
      expect(s.solanaPair).toBe('BTC/USDC');
      expect(s.injectivePair).toBe('BTC/USDT');
      expect(s.netEdgeBps).toBeGreaterThan(0);
      expect(s.bridgePath).toContain('solana');
      expect(s.bridgePath).toContain('injective');
    });

    it('returns no signal when the net edge is below the threshold', () => {
      const snapshots = {
        'BTC/USDC': makeSnapshot('BTC/USDC', 64_000),
        'BTC/USDT': makeSnapshot('BTC/USDT', 64_010), // ~1.5 bps, below 25 bridge
      };
      const signals = strategy.detectArb(snapshots, { bridgeCostBps: 25 });
      expect(signals).toHaveLength(0);
    });

    it('returns [] when chains has fewer than 2 entries', () => {
      const snapshots = { 'BTC/USDC': makeSnapshot('BTC/USDC', 64_000) };
      const signals = strategy.detectArb(snapshots, { chains: ['solana'] as ChainId[] });
      expect(signals).toEqual([]);
    });
  });

  describe('3-chain pairwise', () => {
    it('emits one signal per qualifying chain pair', () => {
      const snapshots = {
        'BTC/USDC': makeSnapshot('BTC/USDC', 64_000), // solana
        'BTC/USDT': makeSnapshot('BTC/USDT', 64_400), // injective +62.5 bps
        'WBTC/USDC': makeSnapshot('WBTC/USDC', 64_200), // monad +31 bps
      };
      const signals = strategy.detectArb(snapshots, {
        bridgeCostBps: 25,
        chains: ['solana', 'injective', 'monad'],
      });
      // solana<->injective: 62.5 - 25 = 37.5 >= 30 -> signal
      // solana<->monad: 31.25 - 25 = 6.25 < 30 -> no signal
      // injective<->monad: ~31 - 25 = 6 < 30 -> no signal
      expect(signals).toHaveLength(1);
      expect(signals[0].buyChain).toBe('solana');
      expect(signals[0].sellChain).toBe('injective');
    });

    it('emits multiple signals when several pairs qualify', () => {
      const snapshots = {
        'BTC/USDC': makeSnapshot('BTC/USDC', 64_000), // solana
        'BTC/USDT': makeSnapshot('BTC/USDT', 64_500), // injective +78 bps
        'WBTC/USDC': makeSnapshot('WBTC/USDC', 64_500), // monad +78 bps
      };
      const signals = strategy.detectArb(snapshots, {
        bridgeCostBps: 25,
        chains: ['solana', 'injective', 'monad'],
      });
      // solana<->injective: 78-25=53 >= 30
      // solana<->monad: 78-25=53 >= 30
      // injective<->monad: 0 -> no
      expect(signals).toHaveLength(2);
      const buyChains = signals.map((s) => s.buyChain);
      expect(buyChains).toContain('solana');
    });

    it('respects per-pair bridgeCostBps map', () => {
      const snapshots = {
        'BTC/USDC': makeSnapshot('BTC/USDC', 64_000),
        'WBTC/USDC': makeSnapshot('WBTC/USDC', 64_400), // monad +62.5 bps
      };
      // High bridge cost for solana|monad suppresses the signal.
      const signals = strategy.detectArb(snapshots, {
        bridgeCostBps: { 'monad|solana': 100 },
        chains: ['solana', 'monad'],
      });
      expect(signals).toHaveLength(0);
    });

    it('sets solanaPair only when solana is a leg', () => {
      const snapshots = {
        'BTC/USDT': makeSnapshot('BTC/USDT', 64_000), // injective
        'WBTC/USDC': makeSnapshot('WBTC/USDC', 64_500), // monad +78 bps
      };
      const signals = strategy.detectArb(snapshots, {
        bridgeCostBps: 25,
        chains: ['injective', 'monad'],
      });
      expect(signals).toHaveLength(1);
      expect(signals[0].solanaPair).toBeUndefined();
      expect(signals[0].buyPair).toBe('BTC/USDT');
      expect(signals[0].sellPair).toBe('WBTC/USDC');
    });
  });
});
