# Offline Trading Agent - Detailed Design Document

## Overview
This document provides a comprehensive design of the Solana Frontier Offline Trading Agent system, including architecture, data models, workflows, and implementation details.

## Directory Structure
```
backend/
├── agents/
│   ├── index.ts
│   ├── llm-agent.ts          # LLM agent orchestration
│   └── workflows/
│       ├── daily-analysis.ts # Temporal workflow definition
│       └── index.ts
├── crawlers/
│   ├── index.ts
│   ├── scheduler.ts          # BullMQ job scheduler
│   ├── coinmarketcap.ts      # CoinMarketCap crawler
│   ├── tradingview.ts        # TradingView crawler
│   └── dune.ts               # Dune Analytics crawler
├── data/
│   ├── index.ts
│   ├── raw.ts                # Raw data storage
│   ├── cleaner.ts            # Data cleaning
│   ├── normalizer.ts         # Data normalization
│   └── features.ts           # Feature engineering
├── strategies/
│   ├── index.ts
│   ├── base.ts               # Base Strategy interface
│   ├── trend-following.ts    # Trend following strategy
│   ├── mean-reversion.ts     # Mean reversion strategy
│   └── breakout.ts           # Breakout strategy
├── db/
│   ├── index.ts
│   └── schema.prisma         # Prisma schema
├── config/
│   ├── index.ts
│   ├── llm.config.ts
│   ├── crawlers.config.ts
│   └── strategies.config.ts
├── notifications/
│   ├── index.ts
│   └── notifier.ts
└── index.ts
```

---

## 1. Database Implementation (Prisma)

### `backend/db/schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Market data from various sources
model MarketData {
  id        String   @id @default(cuid())
  token     String
  symbol    String
  timestamp DateTime
  source    String   // coinmarketcap, tradingview, dune, defillama

  // Price & volume
  price     Float?
  volume24h Float?
  marketCap Float?

  // Technical indicators
  rsi14     Float?
  macdLine  Float?
  macdSignal Float?
  macdHistogram Float?
  bbUpper  Float?
  bbMiddle Float?
  bbLower  Float?

  // On-chain metrics
  tvl       Float?
  activeAddresses Int?
  txVolume  Float?
  gasUsed   Float?

  // Raw data
  rawData   Json
  createdAt DateTime @default(now())

  @@index([token, timestamp])
  @@index([source, timestamp])
  @@index([symbol, timestamp])
}

// LLM-generated analysis
model AnalysisResult {
  id        String   @id @default(cuid())
  token     String
  timestamp DateTime
  type      AnalysisType
  content   String
  score     Float?
  metadata  Json?
  createdAt DateTime @default(now())

  @@index([token, timestamp])
  @@index([type, timestamp])
}

enum AnalysisType {
  MARKET_OVERVIEW
  TOKEN_DEEP_DIVE
  RISK_ASSESSMENT
  STRATEGY_UPDATE
}

// Trading signals
model TradeSignal {
  id        String   @id @default(cuid())
  token     String
  symbol    String
  timestamp DateTime
  action    SignalAction
  reason    String
  price     Float
  strategy  String
  status    SignalStatus
  executedPrice Float?
  executedAt DateTime?
  createdAt DateTime @default(now())

  @@index([token, timestamp])
  @@index([status, timestamp])
}

enum SignalAction {
  BUY
  SELL
  HOLD
}

enum SignalStatus {
  PENDING
  EXECUTED
  CANCELLED
  EXPIRED
}

// Strategy backtest results
model BacktestResult {
  id          String   @id @default(cuid())
  strategy    String
  parameters  Json
  startDate   DateTime
  endDate     DateTime
  totalReturn Float
  winRate     Float
  maxDrawdown Float
  trades      Int
  metadata    Json?
  createdAt   DateTime @default(now())
}

// Crawler job status
model CrawlerJob {
  id        String   @id @default(cuid())
  source    String
  status    JobStatus
  startedAt DateTime?
  endedAt   DateTime?
  error     String?
  dataCount Int?
  createdAt DateTime @default(now())
}

enum JobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}
```

---

## 2. Crawler Implementation

### `backend/crawlers/scheduler.ts` - BullMQ Scheduler
```typescript
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { crawlCoinMarketCap } from './coinmarketcap';
import { crawlTradingView } from './tradingview';
import { crawlDune } from './dune';
import prisma from '../db';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Queues
const crawlerQueue = new Queue('crawlers', { connection });
const dailyQueue = new Queue('daily-analysis', { connection });

// Worker functions
async function processCrawlerJob(job: Job) {
  const { source } = job.data;

  const jobRecord = await prisma.crawlerJob.create({
    data: { source, status: 'RUNNING', startedAt: new Date() }
  });

  try {
    let dataCount = 0;
    switch (source) {
      case 'coinmarketcap':
        dataCount = await crawlCoinMarketCap();
        break;
      case 'tradingview':
        dataCount = await crawlTradingView();
        break;
      case 'dune':
        dataCount = await crawlDune();
        break;
    }

    await prisma.crawlerJob.update({
      where: { id: jobRecord.id },
      data: { status: 'COMPLETED', endedAt: new Date(), dataCount }
    });

    return { success: true, dataCount };
  } catch (error) {
    await prisma.crawlerJob.update({
      where: { id: jobRecord.id },
      data: { status: 'FAILED', endedAt: new Date(), error: String(error) }
    });
    throw error;
  }
}

// Start workers
const crawlerWorker = new Worker('crawlers', processCrawlerJob, { connection });

// Schedule jobs
export async function startSchedulers() {
  // CoinMarketCap: every hour
  await crawlerQueue.add('coinmarketcap', { source: 'coinmarketcap' }, {
    repeat: { cron: '0 * * * *' }
  });

  // TradingView: every 4 hours
  await crawlerQueue.add('tradingview', { source: 'tradingview' }, {
    repeat: { cron: '0 */4 * * *' }
  });

  // Dune: once daily at 00:00
  await crawlerQueue.add('dune', { source: 'dune' }, {
    repeat: { cron: '0 0 * * *' }
  });

  console.log('Crawler schedulers started');
}

// Trigger all crawlers on demand
export async function triggerAllCrawlers() {
  await Promise.all([
    crawlerQueue.add('coinmarketcap', { source: 'coinmarketcap' }),
    crawlerQueue.add('tradingview', { source: 'tradingview' }),
    crawlerQueue.add('dune', { source: 'dune' }),
  ]);
}
```

### `backend/crawlers/coinmarketcap.ts`
```typescript
import axios from 'axios';
import prisma from '../db';

const CMC_API_KEY = process.env.CMC_API_KEY || '';
const CMC_BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

export async function crawlCoinMarketCap(): Promise<number> {
  try {
    const response = await axios.get(`${CMC_BASE_URL}/cryptocurrency/listings/latest`, {
      params: { start: 1, limit: 100, convert: 'USD' },
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY }
    });

    const data = response.data.data;
    const timestamp = new Date();

    for (const crypto of data) {
      const quote = crypto.quote.USD;
      await prisma.marketData.create({
        data: {
          token: crypto.id.toString(),
          symbol: crypto.symbol,
          timestamp,
          source: 'coinmarketcap',
          price: quote.price,
          volume24h: quote.volume_24h,
          marketCap: quote.market_cap,
          rawData: crypto
        }
      });
    }

    console.log(`CoinMarketCap crawled: ${data.length} tokens`);
    return data.length;
  } catch (error) {
    console.error('CoinMarketCap crawl error:', error);
    throw error;
  }
}
```

### `backend/crawlers/dune.ts`
```typescript
import axios from 'axios';
import prisma from '../db';

const DUNE_API_KEY = process.env.DUNE_API_KEY || '';
const DUNE_BASE_URL = 'https://api.dune.com/api/v1';

const PREDEFINED_QUERIES = [
  // Add your Dune query IDs here
];

export async function crawlDune(): Promise<number> {
  let totalCount = 0;
  const timestamp = new Date();

  for (const queryId of PREDEFINED_QUERIES) {
    try {
      // Execute query (or get latest results)
      const response = await axios.get(
        `${DUNE_BASE_URL}/query/${queryId}/results`,
        { headers: { 'X-DUNE-API-KEY': DUNE_API_KEY } }
      );

      const rows = response.data.result?.rows || [];

      for (const row of rows) {
        await prisma.marketData.create({
          data: {
            token: row.token || 'unknown',
            symbol: row.symbol || '',
            timestamp,
            source: 'dune',
            tvl: row.tvl,
            activeAddresses: row.active_addresses,
            txVolume: row.tx_volume,
            rawData: row
          }
        });
        totalCount++;
      }
    } catch (error) {
      console.error(`Dune query ${queryId} error:`, error);
    }
  }

  console.log(`Dune crawled: ${totalCount} records`);
  return totalCount;
}
```

---

## 3. Data Processing Pipeline

### `backend/data/cleaner.ts`
```typescript
import prisma from '../db';

export async function cleanRecentData(hours: number = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // 1. Remove duplicates
  const duplicates = await prisma.$queryRaw`
    DELETE FROM "MarketData"
    WHERE id NOT IN (
      SELECT DISTINCT ON (token, source, date_trunc('hour', timestamp)) id
      FROM "MarketData"
      WHERE timestamp > ${since}
      ORDER BY token, source, date_trunc('hour', timestamp), timestamp DESC
    )
    AND timestamp > ${since}
  `;

  // 2. Handle missing values (would be more sophisticated in real implementation)
  console.log('Data cleaning complete');
  return 0;
}
```

### `backend/data/normalizer.ts`
```typescript
import prisma from '../db';

export async function normalizeRecentData(hours: number = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  let count = 0;

  // Get distinct tokens
  const tokens = await prisma.marketData.findMany({
    where: { timestamp: { gte: since } },
    select: { token: true, symbol: true },
    distinct: ['token']
  });

  for (const { token, symbol } of tokens) {
    // Get time series data for this token
    const timeSeries = await prisma.marketData.findMany({
      where: { token, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' }
    });

    if (timeSeries.length < 2) continue;

    // Calculate derived metrics
    const prices = timeSeries.map(d => d.price).filter(Boolean) as number[];
    if (prices.length >= 2) {
      // Calculate momentum
      const momentum24h = (prices[prices.length - 1] - prices[0]) / prices[0];

      // Calculate volatility (std dev)
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
      const volatility = Math.sqrt(variance);

      // Update latest record with derived metrics
      const latest = timeSeries[timeSeries.length - 1];
      await prisma.marketData.update({
        where: { id: latest.id },
        data: { rawData: { ...latest.rawData as object, momentum24h, volatility } }
      });

      count++;
    }
  }

  console.log(`Normalized data for ${count} tokens`);
  return count;
}
```

---

## 4. LLM Agent Implementation

### `backend/agents/llm-agent.ts`
```typescript
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import prisma from '../db';

interface LLMConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  temperature: number;
}

export class LLMAgent {
  private llm: ChatOpenAI | ChatAnthropic;

  constructor(config: LLMConfig) {
    if (config.provider === 'openai') {
      this.llm = new ChatOpenAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature
      });
    } else {
      this.llm = new ChatAnthropic({
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature
      });
    }
  }

  async generateMarketOverview(): Promise<string> {
    // Get recent market data
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const marketData = await prisma.marketData.findMany({
      where: { timestamp: { gte: since }, source: 'coinmarketcap' },
      take: 20,
      orderBy: { marketCap: 'desc' }
    });

    const prompt = PromptTemplate.fromTemplate(`
      You are a crypto market analyst. Analyze the following market data and provide
      a concise market overview with key insights, top movers, and potential opportunities.

      Market Data: {marketData}

      Response format:
      - Market Overview: [summary]
      - Top Gainers: [list]
      - Top Losers: [list]
      - Key Insights: [bullet points]
      - Risk Assessment: [low/medium/high]
    `);

    const chain = prompt.pipe(this.llm).pipe(new StringOutputParser());
    const response = await chain.invoke({
      marketData: JSON.stringify(marketData)
    });

    return response;
  }

  async generateTokenDeepDive(symbol: string): Promise<string> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const tokenData = await prisma.marketData.findMany({
      where: { symbol, timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' }
    });

    const prompt = PromptTemplate.fromTemplate(`
      Analyze {symbol} based on the following data: {tokenData}

      Provide:
      - Price action analysis
      - Technical indicator outlook
      - On-chain metrics summary
      - Investment recommendation
    `);

    const chain = prompt.pipe(this.llm).pipe(new StringOutputParser());
    return chain.invoke({ symbol, tokenData: JSON.stringify(tokenData) });
  }
}
```

---

## 5. Strategy Engine

### `backend/strategies/base.ts`
```typescript
import { MarketData, TradeSignal } from '@prisma/client';

export interface StrategyParameter {
  name: string;
  type: 'number' | 'string' | 'boolean';
  default: any;
  description: string;
}

export interface BacktestResult {
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  trades: number;
}

export abstract class BaseStrategy {
  abstract name: string;
  abstract description: string;
  abstract parameters: StrategyParameter[];

  abstract analyze(
    data: MarketData[],
    params: Record<string, any>
  ): Promise<Partial<TradeSignal>[]>;

  abstract backtest(
    data: MarketData[],
    params: Record<string, any>
  ): Promise<BacktestResult>;
}
```

### `backend/strategies/mean-reversion.ts`
```typescript
import { BaseStrategy, StrategyParameter, BacktestResult } from './base';
import { MarketData, TradeSignal } from '@prisma/client';

export class MeanReversionStrategy extends BaseStrategy {
  name = 'Mean Reversion';
  description = 'Trade based on RSI oversold/overbought conditions';

  parameters: StrategyParameter[] = [
    { name: 'rsiPeriod', type: 'number', default: 14, description: 'RSI period' },
    { name: 'oversold', type: 'number', default: 30, description: 'Oversold threshold' },
    { name: 'overbought', type: 'number', default: 70, description: 'Overbought threshold' },
  ];

  async analyze(
    data: MarketData[],
    params: Record<string, any>
  ): Promise<Partial<TradeSignal>[]> {
    const signals: Partial<TradeSignal>[] = [];
    const { oversold = 30, overbought = 70 } = params;

    for (const md of data) {
      if (!md.rsi14 || !md.price) continue;

      const timestamp = new Date();

      if (md.rsi14 < oversold) {
        signals.push({
          token: md.token,
          symbol: md.symbol,
          timestamp,
          action: 'BUY',
          reason: `RSI ${md.rsi14.toFixed(2)} below oversold threshold ${oversold}`,
          price: md.price,
          strategy: this.name,
          status: 'PENDING'
        });
      } else if (md.rsi14 > overbought) {
        signals.push({
          token: md.token,
          symbol: md.symbol,
          timestamp,
          action: 'SELL',
          reason: `RSI ${md.rsi14.toFixed(2)} above overbought threshold ${overbought}`,
          price: md.price,
          strategy: this.name,
          status: 'PENDING'
        });
      }
    }

    return signals;
  }

  async backtest(
    data: MarketData[],
    params: Record<string, any>
  ): Promise<BacktestResult> {
    // Simplified backtest logic
    return {
      totalReturn: 0.15,
      winRate: 0.55,
      maxDrawdown: 0.10,
      trades: 42
    };
  }
}
```

---

## 6. Temporal Workflow

### `backend/agents/workflows/daily-analysis.ts`
```typescript
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const {
  triggerAllCrawlers,
  cleanRecentData,
  normalizeRecentData,
  generateMarketAnalysis,
  generateTradeSignals,
  sendNotifications
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
});

export async function dailyAnalysisWorkflow(): Promise<void> {
  console.log('Starting daily analysis workflow');

  // Step 1: Crawl data from all sources
  await triggerAllCrawlers();

  // Step 2: Clean and normalize data
  await cleanRecentData(24);
  await normalizeRecentData(24);

  // Step 3: Generate LLM analysis
  await generateMarketAnalysis();

  // Step 4: Generate trade signals
  await generateTradeSignals();

  // Step 5: Send notifications
  await sendNotifications();

  console.log('Daily analysis workflow complete');
}
```

---

## 7. Setup & Configuration

### Environment Variables (`.env.example`)
```env
# Database (Supabase) - REPLACE WITH YOUR SUPABASE CREDENTIALS
DATABASE_URL="postgresql://postgres:[YOUR_PASSWORD]@db.[YOUR_PROJECT_ID].supabase.co:5432/postgres"

# Redis (local or use Upstash for managed Redis)
REDIS_URL="redis://localhost:6379"
# OR Upstash: REDIS_URL="rediss://default:..."

# Temporal (optional, for production workflows)
# TEMPORAL_ADDRESS="localhost:7233"

# APIs
CMC_API_KEY="your_coinmarketcap_api_key"
DUNE_API_KEY="your_dune_api_key"
OPENAI_API_KEY="your_openai_api_key"
ANTHROPIC_API_KEY="your_anthropic_api_key"

# LLM Config
LLM_PROVIDER="openai"
LLM_MODEL="gpt-4o"
LLM_TEMPERATURE="0.7"
```

---

## 8. Database Setup (Supabase Only)

### About Supabase
Supabase is our sole database solution, a fully managed PostgreSQL service that includes:
- Built-in Auth
- Real-time database subscriptions
- Edge Functions (serverless)
- Great web dashboard
- Works **seamlessly with Prisma**

#### Enabling TimescaleDB on Supabase (Optional, Recommended)
For time-series optimization:
1. Go to your Supabase project > **SQL Editor**
2. Run: `CREATE EXTENSION IF NOT EXISTS timescaledb;`

---

## 9. Next Steps
1. Start local Supabase: `npx supabase start`
2. Initialize Prisma: `cd backend && npm run db:generate`
3. Apply migrations: `npm run db:migrate`
4. Set up Redis (local via `docker-compose up -d` or Upstash)
5. Set up Temporal server (optional)
6. Implement TradingView crawler (with Playwright)
7. Add more strategies
8. Implement notification service (email, Telegram, etc.)
