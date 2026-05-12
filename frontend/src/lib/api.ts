import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "/api";

export const api = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" }
});

export interface PipelineSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  crawled: { coinmarketcap: number; tradingview: number; dune: number };
  cleaned: number;
  normalized: number;
  signalsGenerated: number;
  analysisId?: string;
  analysisPreview: string;
}

export interface MarketDataRow {
  id: string;
  token: string;
  symbol: string;
  timestamp: string;
  source: string;
  price?: string | number | null;
  volume24h?: string | number | null;
  marketCap?: string | number | null;
  rsi14?: string | number | null;
  macdLine?: string | number | null;
  tvl?: string | number | null;
  activeAddresses?: number | null;
  rawData?: unknown;
}

export interface AnalysisRow {
  id: string;
  type?: string | null;
  content: string;
  timestamp: string;
  token?: string | null;
}

export interface TradeSignalRow {
  id: string;
  token: string;
  symbol: string;
  action: string;
  reason: string;
  price: string | number;
  strategy: string;
  status: string;
  timestamp: string;
}

export interface NbboSnapshot {
  pair: { symbol: string; base: { symbol: string }; quote: { symbol: string } };
  bestBid?: NbboQuote;
  bestAsk?: NbboQuote;
  spreadBps?: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  quoteCount: number;
  failures: Array<{ source: string; side: string; message: string; latencyMs: number }>;
  generatedAt: number;
}

export interface NbboQuote {
  source: string;
  side: "bid" | "ask";
  pair: string;
  price: number;
  feeBps: number;
  liquidityUsd: number;
  priceImpactBps: number;
  latencyMs: number;
  routeId: string;
  inAmount: string;
  outAmount: string;
}

export interface TradeRecord {
  id: string;
  intentId?: string | null;
  userPubkey?: string | null;
  pair: string;
  side: "buy" | "sell";
  amountIn: string;
  maxSlippageBps: number;
  status: string;
  selectedDex?: string | null;
  oraclePrice?: string | number | null;
  executionPrice?: string | number | null;
  minOutAmount?: string | null;
  txSignature?: string | null;
  rejectionReason?: string | null;
  plan?: unknown;
  createdAt: string;
  updatedAt: string;
  logs?: Array<{
    id: string;
    level: string;
    event: string;
    message?: string | null;
    metadata?: unknown;
    createdAt: string;
  }>;
}

export interface PreparedTradeResponse {
  tradeId: string;
  plan: {
    status: "ready" | "rejected";
    rejectionReason?: string;
    minOutAmount?: string;
    selectedRoute?: { quote: NbboQuote; reason: string };
    nbbo: NbboSnapshot;
    oraclePrice: { price: number; confidenceBps: number; isStale: boolean; publishTime: number };
  };
}

export const offlineApi = {
  status: () => api.get<{ schedulerEnabled: boolean; timestamp: string }>("/agent/status"),
  runPipeline: () => api.post<PipelineSummary>("/agent/run-pipeline"),
  marketData: (limit = 50) => api.get<MarketDataRow[]>(`/agent/market-data?limit=${limit}`),
  analysis: (limit = 5) => api.get<AnalysisRow[]>(`/agent/analysis?limit=${limit}`),
  signals: (limit = 50) => api.get<TradeSignalRow[]>(`/agent/signals?limit=${limit}`)
};

export interface PrepareTradePayload {
  pair: string;
  side: "buy" | "sell";
  amountIn: string;
  maxSlippageBps: number;
  user?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface ConfirmTradePayload {
  tradeId: string;
  status: "SUBMITTED" | "CONFIRMED" | "FAILED";
  txSignature?: string;
  executionPrice?: number;
  message?: string;
}

export const realtimeApi = {
  health: () => api.get<{ status: string; policy: any }>("/realtime/health"),
  nbbo: (params: { pair: string; mockMid?: number; bidBaseAmount?: number; askQuoteAmount?: number }) =>
    api.get<NbboSnapshot>("/realtime/market/nbbo", { params }),
  prepare: (payload: PrepareTradePayload) =>
    api.post<PreparedTradeResponse>("/realtime/trade/prepare", payload),
  confirm: (payload: ConfirmTradePayload) =>
    api.post<{ ok: true }>("/realtime/trade/confirm", payload),
  trades: (limit = 25) => api.get<TradeRecord[]>(`/realtime/trades?limit=${limit}`),
  trade: (id: string) => api.get<TradeRecord>(`/realtime/trades/${id}`)
};
