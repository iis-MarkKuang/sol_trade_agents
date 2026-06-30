import type { ChainId, TokenInfo, TokenPair } from "../types.js";

/**
 * Solana-side tokens (SPL mint addresses + Pyth feed ids).
 */
export const SOLANA_TOKENS = {
  SOL: {
    symbol: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    pythPriceId: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
  },
  USDC: {
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    pythPriceId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    isStableQuote: true
  },
  BTC: {
    symbol: "BTC",
    mint: "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
    decimals: 6,
    pythPriceId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
  },
  ETH: {
    symbol: "ETH",
    mint: "7vfCXTUXx3o9PcKjQTs8TPyWC4G6PwnU89R7LZ5cK1g",
    decimals: 8,
    pythPriceId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
  }
} satisfies Record<string, TokenInfo>;

/**
 * Injective-side tokens (bank/IBC/Peggy denoms).
 * USDT/USDC are Peggy-wrapped ERC-20s on Injective; INJ is the native staking token.
 */
export const INJECTIVE_TOKENS = {
  INJ: {
    symbol: "INJ",
    denom: "inj",
    decimals: 18,
    pythPriceId: "0x7a5bc1d2b56ad029048cd63964b3ad2776eadf812edc1a43a31406cb54bff592"
  },
  USDC: {
    symbol: "USDC",
    denom: "peggy0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    pythPriceId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    isStableQuote: true
  },
  USDT: {
    symbol: "USDT",
    denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
    pythPriceId: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
    isStableQuote: true
  }
} satisfies Record<string, TokenInfo>;

export const TOKENS = { ...SOLANA_TOKENS, ...INJECTIVE_TOKENS };

/**
 * Default Solana spot pairs (Jupiter/Raydium/Orca).
 */
export const DEFAULT_PAIRS: Record<string, TokenPair> = {
  "SOL/USDC": { symbol: "SOL/USDC", base: SOLANA_TOKENS.SOL, quote: SOLANA_TOKENS.USDC },
  "BTC/USDC": { symbol: "BTC/USDC", base: SOLANA_TOKENS.BTC, quote: SOLANA_TOKENS.USDC },
  "ETH/USDC": { symbol: "ETH/USDC", base: SOLANA_TOKENS.ETH, quote: SOLANA_TOKENS.USDC }
};

/**
 * Injective Helix pairs. Includes INJ spot pairs and BTC/ETH perpetuals so the
 * cross-chain arb strategy has an overlapping asset (BTC, ETH) with Solana.
 */
export const INJECTIVE_PAIRS: Record<string, TokenPair> = {
  "INJ/USDC": { symbol: "INJ/USDC", chain: "injective", base: INJECTIVE_TOKENS.INJ, quote: INJECTIVE_TOKENS.USDC },
  "INJ/USDT": { symbol: "INJ/USDT", chain: "injective", base: INJECTIVE_TOKENS.INJ, quote: INJECTIVE_TOKENS.USDT },
  "BTC/USDT": {
    symbol: "BTC/USDT",
    chain: "injective",
    base: { symbol: "BTC", decimals: 8, pythPriceId: SOLANA_TOKENS.BTC.pythPriceId },
    quote: INJECTIVE_TOKENS.USDT,
  },
  "ETH/USDT": {
    symbol: "ETH/USDT",
    chain: "injective",
    base: { symbol: "ETH", decimals: 8, pythPriceId: SOLANA_TOKENS.ETH.pythPriceId },
    quote: INJECTIVE_TOKENS.USDT,
  }
};

/**
 * Helix market tickers keyed by pair symbol. The InjectiveHelixAdapter maps a
 * TokenPair to its exchange market id via this registry.
 */
export const INJECTIVE_HELIX_MARKETS: Record<string, { marketId: string; type: "spot" | "derivative" }> = {
  "INJ/USDC": { marketId: "INJ/USDC", type: "spot" },
  "INJ/USDT": { marketId: "INJ/USDT", type: "spot" },
  "BTC/USDT": { marketId: "BTC/USDT", type: "derivative" },
  "ETH/USDT": { marketId: "ETH/USDT", type: "derivative" }
};

/** Merged registry of all supported pairs across chains. */
export const ALL_PAIRS: Record<string, TokenPair> = { ...DEFAULT_PAIRS, ...INJECTIVE_PAIRS };

export function chainOfPair(pair: TokenPair): ChainId {
  if (pair.chain) {
    return pair.chain;
  }
  if (pair.base.denom && !pair.base.mint) {
    return "injective";
  }
  return "solana";
}

/** Map a base asset symbol (BTC, ETH, INJ, SOL) to its pair symbol on a chain. */
export function pairSymbolForChain(baseSymbol: string, chain: ChainId): string | undefined {
  const target = baseSymbol.toUpperCase();
  for (const pair of Object.values(ALL_PAIRS)) {
    if (chainOfPair(pair) === chain && pair.base.symbol === target) {
      return pair.symbol;
    }
  }
  return undefined;
}

export function normalizePairSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace("-", "/");
}

export function getTokenPair(symbol: string, registry = ALL_PAIRS): TokenPair {
  const pair = registry[normalizePairSymbol(symbol)];
  if (!pair) {
    throw new Error(`Unsupported token pair: ${symbol}`);
  }

  return pair;
}

export function resolvePythPriceId(pair: TokenPair): string {
  if (pair.quote.isStableQuote && pair.base.pythPriceId) {
    return pair.base.pythPriceId;
  }

  throw new Error(`No direct Pyth price feed configured for ${pair.symbol}`);
}
