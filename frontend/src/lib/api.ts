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
  chain?: "solana" | "injective";
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

export interface InjectiveExecutionPlan {
  marketId: string;
  marketType: "spot" | "derivative";
  side: "buy" | "sell";
  amount: string;
  price: number;
  notionalUsd: number;
  reason: string;
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
    injectiveExecutionPlan?: InjectiveExecutionPlan;
  };
}

export interface CrossChainArbSignal {
  asset: string;
  solanaPair: string;
  injectivePair: string;
  solanaMid: number;
  injectiveMid: number;
  spreadBps: number;
  bridgeCostBps: number;
  netEdgeBps: number;
  buyChain: "solana" | "injective";
  sellChain: "solana" | "injective";
  action: "buy" | "sell";
  confidence: number;
  reason: string;
  bridgePath: string;
  estimatedNotionalUsd: number;
  timestamp: number;
}

export interface CrossChainArbResponse {
  signals: CrossChainArbSignal[];
  snapshots: Record<string, NbboSnapshot>;
}

export interface CrossChainPlanResponse {
  prompt: string;
  signals: CrossChainArbSignal[];
  analysis: string;
  toolCallCount: number;
  llmUsed: boolean;
  model?: string;
}

export interface InjectiveExecuteResponse {
  txHash?: string;
  orderHash?: string;
  status: "submitted" | "confirmed" | "failed" | "simulated";
  message: string;
  raw?: unknown;
}

export interface AgentServiceEntry {
  type: string;
  endpoint: string;
  description?: string;
}

export interface AgentCard {
  name: string;
  description: string;
  type: string;
  builderCode: string;
  image?: string;
  x402: boolean;
  services: AgentServiceEntry[];
  version?: string;
  tags?: string[];
  sourceCode?: string;
  documentation?: string;
}

export interface AgentIdentity {
  agentId: string;
  identityTuple: string;
  name: string;
  type: string;
  builderCode: string;
  owner?: string;
  wallet?: string;
  cardUri: string;
  scanUrl: string;
  card: AgentCard;
  registered: boolean;
  simulated: boolean;
  network: string;
  chainId: number;
  registry: string;
  mcpEndpoint: string;
}

export interface RegistryAgent {
  agentId: string;
  name: string;
  type: string;
  owner: string;
  wallet: string;
  builderCode: string;
  tokenUri: string;
  identityTuple: string;
  scanUrl: string;
  card?: AgentCard | null;
  real: boolean;
}

export interface RegistryList {
  network: string;
  total: number;
  offset: number;
  limit: number;
  agents: RegistryAgent[];
  real: boolean;
  note?: string;
}

export const agentIdentityApi = {
  identity: () => api.get<AgentIdentity>("/agent/identity"),
  registry: (offset = 0, limit = 20) =>
    api.get<RegistryList>(`/agent/registry?offset=${offset}&limit=${limit}`),
};

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
  executeInjective: (tradeId: string) =>
    api.post<InjectiveExecuteResponse>("/realtime/trade/injective-execute", { tradeId }),
  trades: (limit = 25) => api.get<TradeRecord[]>(`/realtime/trades?limit=${limit}`),
  trade: (id: string) => api.get<TradeRecord>(`/realtime/trades/${id}`),
  crossChainArb: (params: { notionalUsd?: number; minNetEdgeBps?: number; assets?: string }) =>
    api.get<CrossChainArbResponse>("/realtime/cross-chain/arb", { params }),
  crossChainPlan: (payload: { prompt: string; notionalUsd?: number; minNetEdgeBps?: number }) =>
    api.post<CrossChainPlanResponse>("/realtime/cross-chain/plan", payload)
};
