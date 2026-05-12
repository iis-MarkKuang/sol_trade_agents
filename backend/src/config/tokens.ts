import type { TokenInfo, TokenPair } from "../types.js";

export const TOKENS = {
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

export const DEFAULT_PAIRS: Record<string, TokenPair> = {
  "SOL/USDC": { symbol: "SOL/USDC", base: TOKENS.SOL, quote: TOKENS.USDC },
  "BTC/USDC": { symbol: "BTC/USDC", base: TOKENS.BTC, quote: TOKENS.USDC },
  "ETH/USDC": { symbol: "ETH/USDC", base: TOKENS.ETH, quote: TOKENS.USDC }
};

export function normalizePairSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace("-", "/");
}

export function getTokenPair(symbol: string, registry = DEFAULT_PAIRS): TokenPair {
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
