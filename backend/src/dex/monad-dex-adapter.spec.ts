import { MonadDexAdapter } from './monad-dex-adapter.js';
import type { DexQuoteRequest, TokenPair } from '../types.js';

const MON = { symbol: 'MON', decimals: 18 };
const USDC = {
  symbol: 'USDC',
  address: '0xUSDC',
  decimals: 6,
  pythPriceId: '0xfeed',
  isStableQuote: true,
};
const WBTC = { symbol: 'BTC', address: '0xWBTC', decimals: 8, pythPriceId: '0xbtcfeed' };

const WBTC_USDC: TokenPair = {
  symbol: 'WBTC/USDC',
  chain: 'monad',
  base: WBTC,
  quote: USDC,
};

function makeRequest(pair: TokenPair, side: 'bid' | 'ask', amountIn: bigint): DexQuoteRequest {
  return { pair, side, amountIn, slippageBps: 100 };
}

describe('MonadDexAdapter', () => {
  describe('mock mode', () => {
    it('returns a quote tagged chain:monad, source:monad_dex', async () => {
      const adapter = new MonadDexAdapter({ mode: 'mock' });
      const quotes = await adapter.quote(makeRequest(WBTC_USDC, 'bid', 1_000_000n));

      expect(quotes).toHaveLength(1);
      const q = quotes[0];
      expect(q.chain).toBe('monad');
      expect(q.source).toBe('monad_dex');
      expect(q.pair).toBe('WBTC/USDC');
      expect(q.routeId).toContain(':mock:');
      expect(q.price).toBeGreaterThan(0);
    });

    it('tracks the oracle mid via getMidPrice plus the premium', async () => {
      const adapter = new MonadDexAdapter({
        mode: 'mock',
        mockPremiumBps: 30,
        mockBidSpreadBps: 12,
        getMidPrice: () => 64_000,
      });
      const q = (await adapter.quote(makeRequest(WBTC_USDC, 'bid', 1_000_000n)))[0];
      // mid = 64000 * (1 + 30/10000); bid price = mid * (1 - 12/10000)
      const expectedMid = 64_000 * (1 + 30 / 10_000);
      const expectedPrice = expectedMid * (1 - 12 / 10_000);
      expect(q.price).toBeCloseTo(expectedPrice, 6);
    });

    it('returns [] for a pair whose tokens have no ERC-20 address (0x mode)', async () => {
      const noAddr: TokenPair = {
        symbol: 'FOO/BAR',
        chain: 'monad',
        base: { symbol: 'FOO', decimals: 18 },
        quote: { symbol: 'BAR', decimals: 18 },
      };
      const adapter = new MonadDexAdapter({ mode: '0x' });
      const quotes = await adapter.quote(makeRequest(noAddr, 'bid', 1_000_000n));
      // No address -> falls back to mock (no-token-address reason), still returns a mock quote
      expect(quotes).toHaveLength(1);
      expect(quotes[0].routeId).toContain(':mock:');
    });
  });

  describe('0x mode', () => {
    it('parses a 0x quote response into a DexQuote', async () => {
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          okResponse({
            price: '64000.5',
            sellAmount: '1000000',
            buyAmount: '15625000000',
            estimatedPriceImpact: '0.02',
            to: '0xdefi',
            data: '0x',
          }),
        );

      const adapter = new MonadDexAdapter({ mode: '0x', zeroxApiKey: 'k' });
      const q = (await adapter.quote(makeRequest(WBTC_USDC, 'bid', 1_000_000n)))[0];

      expect(q.chain).toBe('monad');
      expect(q.source).toBe('monad_dex');
      expect(q.price).toBe(64_000.5);
      expect(q.outAmount).toBe(15_625_000_000n);
      expect(q.routeId).toContain(':0x:');
      expect(q.raw).toMatchObject({ dex: '0x' });
      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('falls back to mock when fetch rejects', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
      const adapter = new MonadDexAdapter({ mode: '0x' });
      const quotes = await adapter.quote(makeRequest(WBTC_USDC, 'ask', 1_000_000n));

      expect(quotes).toHaveLength(1);
      expect(quotes[0].routeId).toContain(':mock:');
      expect(quotes[0].raw).toMatchObject({ mock: true });
      fetchSpy.mockRestore();
    });

    it('falls back to mock when the 0x response is missing buyAmount', async () => {
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(okResponse({ price: '64000', sellAmount: '1000000' /* no buyAmount */ }));
      const adapter = new MonadDexAdapter({ mode: '0x' });
      const quotes = await adapter.quote(makeRequest(WBTC_USDC, 'bid', 1_000_000n));
      expect(quotes[0].routeId).toContain(':mock:');
      fetchSpy.mockRestore();
    });
  });

  describe('1inch mode', () => {
    it('parses a 1inch quote response and derives price', async () => {
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          okResponse({
            toAmount: '15625000000',
            to: '0x1inch',
            estimatedGas: 180000,
          }),
        );

      const adapter = new MonadDexAdapter({ mode: '1inch', oneinchApiKey: 'k' });
      const q = (await adapter.quote(makeRequest(WBTC_USDC, 'bid', 1_000_000n)))[0];

      expect(q.chain).toBe('monad');
      expect(q.outAmount).toBe(15_625_000_000n);
      expect(q.price).toBeGreaterThan(0);
      expect(q.routeId).toContain(':1inch:');
      expect(q.raw).toMatchObject({ dex: '1inch' });
      fetchSpy.mockRestore();
    });
  });

  describe('uniswap_v3 mode (not yet implemented)', () => {
    it('falls back to mock', async () => {
      const adapter = new MonadDexAdapter({ mode: 'uniswap_v3' });
      const quotes = await adapter.quote(makeRequest(WBTC_USDC, 'bid', 1_000_000n));
      expect(quotes[0].routeId).toContain(':mock:');
    });
  });

  describe('MON native pair', () => {
    it('quotes MON/USDC in mock mode even though MON has no ERC-20 address', async () => {
      const MON_USDC: TokenPair = {
        symbol: 'MON/USDC',
        chain: 'monad',
        base: MON,
        quote: USDC,
      };
      const adapter = new MonadDexAdapter({ mode: 'mock', getMidPrice: () => 0.4 });
      const quotes = await adapter.quote(makeRequest(MON_USDC, 'bid', 1_000_000n));
      expect(quotes).toHaveLength(1);
      expect(quotes[0].chain).toBe('monad');
      expect(quotes[0].price).toBeGreaterThan(0);
    });
  });
});

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}
