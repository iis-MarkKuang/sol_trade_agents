export type DexSource = "jupiter" | "raydium" | "orca" | "mock";

export type QuoteSide = "bid" | "ask";

export type TradeSide = "buy" | "sell";

export interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
  pythPriceId?: string;
  isStableQuote?: boolean;
}

export interface TokenPair {
  symbol: string;
  base: TokenInfo;
  quote: TokenInfo;
}

export interface PriceUpdate {
  symbol: string;
  priceId: string;
  price: number;
  confidence: number;
  expo: number;
  publishTime: number;
  receivedAt: number;
  confidenceBps: number;
  isStale: boolean;
  vaa?: string;
  raw?: unknown;
}

export interface DexQuoteRequest {
  pair: TokenPair;
  side: QuoteSide;
  amountIn: bigint;
  slippageBps: number;
}

export interface DexQuote {
  source: DexSource;
  side: QuoteSide;
  pair: string;
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  price: number;
  feeBps: number;
  liquidityUsd: number;
  priceImpactBps: number;
  latencyMs: number;
  routeId: string;
  receivedAt: number;
  raw?: unknown;
}

export interface DexQuoteFailure {
  source: DexSource;
  side: QuoteSide;
  message: string;
  latencyMs: number;
}

export interface AggregatedOrderBook {
  pair: TokenPair;
  bids: DexQuote[];
  asks: DexQuote[];
  failures: DexQuoteFailure[];
  queriedAt: number;
}

export interface NbboSnapshot {
  pair: TokenPair;
  bestBid?: DexQuote;
  bestAsk?: DexQuote;
  spreadBps?: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  quoteCount: number;
  failures: DexQuoteFailure[];
  generatedAt: number;
}

export interface TradeIntent {
  id?: string;
  user?: string;
  pair: string;
  side: TradeSide;
  amountIn: bigint;
  maxSlippageBps: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  delegatedExecution?: boolean;
}

export interface RiskPolicy {
  allowedPairs: string[];
  allowedDexes: DexSource[];
  maxSlippageBps: number;
  maxPositionNotionalUsd: number;
  minLiquidityUsd: number;
  maxOracleDeviationBps: number;
  maxPriceImpactBps: number;
  maxQuoteAgeMs: number;
}

export interface RouteSelection {
  side: QuoteSide;
  quote: DexQuote;
  oraclePrice?: PriceUpdate;
  reason: string;
}

export interface TradeExecutionPlan {
  status: "ready" | "rejected";
  intent: TradeIntent;
  pair: TokenPair;
  oraclePrice: PriceUpdate;
  nbbo: NbboSnapshot;
  selectedRoute?: RouteSelection;
  minOutAmount?: bigint;
  rejectionReason?: string;
  unsignedTransactionBase64?: string;
  createdAt: number;
}
