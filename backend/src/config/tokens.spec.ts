import {
  MONAD_TOKENS,
  MONAD_PAIRS,
  ALL_PAIRS,
  chainOfPair,
  pairSymbolForChain,
  getTokenPair,
} from './tokens.js';

describe('Monad token registry', () => {
  it('MON is the native gas token (decimals 18, no ERC-20 address)', () => {
    expect(MONAD_TOKENS.MON.decimals).toBe(18);
    expect(MONAD_TOKENS.MON).not.toHaveProperty('address');
  });

  it('WMON/USDC/USDT/WBTC/WETH carry ERC-20 addresses', () => {
    expect(MONAD_TOKENS.WMON.address).toBeTruthy();
    expect(MONAD_TOKENS.USDC.address).toBeTruthy();
    expect(MONAD_TOKENS.USDT.address).toBeTruthy();
    expect(MONAD_TOKENS.WBTC.address).toBeTruthy();
    expect(MONAD_TOKENS.WETH.address).toBeTruthy();
  });

  it('reuses shared Pyth feed ids for USDC/WBTC/WETH', () => {
    expect(MONAD_TOKENS.USDC.pythPriceId).toMatchInlineSnapshot(
      `"0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"`,
    );
    expect(MONAD_TOKENS.WBTC.pythPriceId).toMatchInlineSnapshot(
      `"0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"`,
    );
    expect(MONAD_TOKENS.WETH.pythPriceId).toMatchInlineSnapshot(
      `"0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"`,
    );
  });

  it('MONAD_PAIRS has 3 entries all tagged chain: monad', () => {
    expect(Object.keys(MONAD_PAIRS)).toHaveLength(3);
    for (const pair of Object.values(MONAD_PAIRS)) {
      expect(pair.chain).toBe('monad');
    }
  });

  it('ALL_PAIRS includes the Monad pairs without shadowing Solana/Injective', () => {
    expect(ALL_PAIRS['MON/USDC']).toBeDefined();
    expect(ALL_PAIRS['WBTC/USDC']).toBeDefined();
    expect(ALL_PAIRS['WETH/USDC']).toBeDefined();
    // existing pairs untouched
    expect(ALL_PAIRS['SOL/USDC']).toBeDefined();
    expect(ALL_PAIRS['INJ/USDC']).toBeDefined();
    expect(ALL_PAIRS['BTC/USDT']).toBeDefined();
  });
});

describe('chainOfPair', () => {
  it('returns monad for an explicit monad pair', () => {
    expect(chainOfPair(getTokenPair('MON/USDC'))).toBe('monad');
    expect(chainOfPair(getTokenPair('WBTC/USDC'))).toBe('monad');
  });

  it('returns solana for a Solana SPL pair', () => {
    expect(chainOfPair(getTokenPair('SOL/USDC'))).toBe('solana');
  });

  it('returns injective for an Injective denom pair', () => {
    expect(chainOfPair(getTokenPair('INJ/USDC'))).toBe('injective');
  });
});

describe('pairSymbolForChain', () => {
  it('maps BTC to the Monad WBTC pair', () => {
    expect(pairSymbolForChain('BTC', 'monad')).toBe('WBTC/USDC');
  });

  it('maps ETH to the Monad WETH pair', () => {
    expect(pairSymbolForChain('ETH', 'monad')).toBe('WETH/USDC');
  });

  it('still maps BTC/ETH to the existing Solana and Injective pairs', () => {
    expect(pairSymbolForChain('BTC', 'solana')).toBe('BTC/USDC');
    expect(pairSymbolForChain('BTC', 'injective')).toBe('BTC/USDT');
    expect(pairSymbolForChain('ETH', 'solana')).toBe('ETH/USDC');
  });
});
