import { createServer } from "node:http";
import { Connection } from "@solana/web3.js";
import { DEFAULT_PAIRS, getTokenPair } from "./config/tokens.js";
import { DexOrderBookAggregator } from "./dex/aggregator.js";
import type { DexAdapter } from "./dex/adapter.js";
import { JupiterQuoteAdapter } from "./dex/jupiter-adapter.js";
import { MockDexAdapter } from "./dex/mock-adapter.js";
import { OrcaWhirlpoolOrderBookAdapter } from "./dex/orca-adapter.js";
import { RaydiumOrderBookAdapter } from "./dex/raydium-adapter.js";
import { NbboEngine } from "./nbbo/engine.js";
import { PythPriceFeedService } from "./oracle/pyth-price-feed.js";
import { RiskEngine } from "./risk/risk-engine.js";
import type { RiskPolicy } from "./types.js";
import { jsonReplacer, toNativeAmount } from "./utils/amounts.js";
import { RealTimeAgentCore } from "./agent/realtime-agent-core.js";
import { JupiterTransactionBuilder } from "./transactions/jupiter-transaction-builder.js";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const enableRealDex = process.env.ENABLE_REAL_DEX === "true";
const port = Number(process.env.PORT ?? 3001);

const policy: RiskPolicy = {
  allowedPairs: Object.keys(DEFAULT_PAIRS),
  allowedDexes: enableRealDex ? ["jupiter", "raydium", "orca", "mock"] : ["mock"],
  maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS ?? 100),
  maxPositionNotionalUsd: Number(process.env.MAX_POSITION_NOTIONAL_USD ?? 25_000),
  minLiquidityUsd: Number(process.env.MIN_LIQUIDITY_USD ?? 1_000),
  maxOracleDeviationBps: Number(process.env.MAX_ORACLE_DEVIATION_BPS ?? 150),
  maxPriceImpactBps: Number(process.env.MAX_PRICE_IMPACT_BPS ?? 100),
  maxQuoteAgeMs: Number(process.env.MAX_QUOTE_AGE_MS ?? 5_000)
};

const connection = new Connection(rpcUrl, "confirmed");
const adapters: DexAdapter[] = enableRealDex
  ? [
      new JupiterQuoteAdapter({ apiKey: process.env.JUPITER_API_KEY }),
      new RaydiumOrderBookAdapter({ connection }),
      new OrcaWhirlpoolOrderBookAdapter({
        connection,
        walletPublicKey: process.env.ORCA_WALLET_PUBLIC_KEY,
        poolsByPair: parsePoolMap(process.env.ORCA_POOLS_BY_PAIR)
      })
    ]
  : [
      new MockDexAdapter({ source: "mock", midPrice: 160, bidSpreadBps: 8, askSpreadBps: 10, liquidityUsd: 5_000_000 })
    ];

const core = new RealTimeAgentCore({
  priceFeed: new PythPriceFeedService({
    endpoint: process.env.PYTH_HERMES_ENDPOINT,
    staleMs: Number(process.env.PYTH_STALE_MS ?? 15_000),
    maxConfidenceBps: Number(process.env.PYTH_MAX_CONFIDENCE_BPS ?? 75)
  }),
  aggregator: new DexOrderBookAggregator(adapters, {
    quoteTimeoutMs: Number(process.env.DEX_QUOTE_TIMEOUT_MS ?? 2_500)
  }),
  nbbo: new NbboEngine(),
  risk: new RiskEngine(),
  policy,
  tokenPairs: DEFAULT_PAIRS,
  txBuilder: new JupiterTransactionBuilder({ apiKey: process.env.JUPITER_API_KEY }),
  retries: 2
});

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { status: "ok", realDex: enableRealDex, pairs: Object.keys(DEFAULT_PAIRS) });
    }

    if (request.method === "GET" && request.url?.startsWith("/market/nbbo")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pair = getTokenPair(url.searchParams.get("pair") ?? "SOL/USDC");
      const mid = Number(url.searchParams.get("mockMid") ?? 160);
      const bidAmount = toNativeAmount(url.searchParams.get("bidBaseAmount") ?? "1", pair.base.decimals);
      const askAmount = toNativeAmount(url.searchParams.get("askQuoteAmount") ?? String(mid), pair.quote.decimals);
      const aggregator = new DexOrderBookAggregator([
        new MockDexAdapter({ source: "mock", midPrice: mid, bidSpreadBps: 7, askSpreadBps: 9, liquidityUsd: 2_500_000 })
      ]);
      const book = await aggregator.queryBook(
        { pair, side: "bid", amountIn: bidAmount, slippageBps: 100 },
        { pair, side: "ask", amountIn: askAmount, slippageBps: 100 }
      );
      return sendJson(response, 200, new NbboEngine().calculate(book));
    }

    if (request.method === "POST" && request.url === "/trade/prepare") {
      const body = await readJson(request);
      const plan = await core.prepareTrade(body);
      return sendJson(response, 200, plan);
    }

    return sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`sol-trade-agent backend listening on http://localhost:${port}`);
});

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, jsonReplacer);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function parsePoolMap(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  return value.split(",").reduce<Record<string, string>>((accumulator, item) => {
    const [pair, pool] = item.split("=");
    if (pair && pool) {
      accumulator[pair.trim().toUpperCase()] = pool.trim();
    }
    return accumulator;
  }, {});
}
