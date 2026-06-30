# SOL Trade Agent — v0.0.1-dev

| Field | Value |
|---|---|
| **Version** | `0.0.1-dev` |
| **Channel** | `dev` (internal preview / pre-alpha) |
| **Release date** | 2026-05-12 |
| **Branch** | `feature/offline_agent_skeleton` |
| **Tip commit** | `7e19508` |
| **Status** | Demo-ready, not production-ready |

---

## Overview

First internal preview of **SOL Trade Agent** — a Web3 LLM agent platform for autonomous Solana trading. This build delivers the full end-to-end skeleton of both planned agents, runnable locally against Supabase with **no Redis, no Solana wallet, and no paid API keys required**:

- **Offline agent** — scheduled multi-source data ingestion (CoinMarketCap / TradingView / Dune) → cleaning → normalization → LangChain LLM analysis → strategy signal generation.
- **Realtime agent** — Pyth oracle subscription → multi-DEX aggregation (Jupiter / Raydium / Orca) → nBBO selection → risk checks → trade-lifecycle persistence, all streamed live over Socket.IO.
- **Frontend** — Vite + React + Tailwind dashboard with `Insights` and `Live Trading` pages backed by live WebSocket feeds.

The goal of `0.0.1-dev` is a **reproducible, fully-instrumented demo**, not a tradeable product.

---

## Highlights

- One-command local stack: `npx supabase start` + `npm run start:dev` boots the entire backend with deterministic mocks.
- Layered price-data sourcing: real **CoinMarketCap** → free public **CoinGecko** → updated static mock, with every row recording its provenance.
- Live **Pyth Hermes** price subscription with an in-memory price cache warmed at boot, so the first trade after startup already has a valid mid.
- **nBBO engine** aggregates BID/ASK from 3 DEX adapters (mocked by default, real adapters one env flag away).
- Full **trade lifecycle persistence**: every realtime trade lands in `realtime_trade` with structured logs in `realtime_agent_log`, queryable via REST.
- **Risk policy** enforced before any execution path: max slippage, max notional, oracle deviation, price impact, quote staleness.
- **Frontend dashboards** stream pipeline and trade events live; no polling.
- 23 automated tests passing across Jest (NestJS services) and Vitest (realtime core / nBBO / Pyth parser).

---

## What's new

### Backend — offline agent

- **`OfflineAgentService`** wires the full pipeline: crawl → clean → normalize → LLM → strategy signals, with per-step duration accounting.
- **Crawlers**
  - `CoinmarketcapCrawlerService` — three-tier sourcing: paid CMC (if `COINMARKETCAP_API_KEY` is set) → free CoinGecko `/coins/markets` → static mock with current snapshots (BTC ~$81k, ETH ~$3.2k, SOL ~$190). Each `MarketData` row records the actual source.
  - `TradingviewCrawlerService` — mocked technical indicators (RSI, MACD, Bollinger Bands).
  - `DuneCrawlerService` — mocked on-chain metrics (TVL, active addresses, tx volume).
- **Data pipeline**
  - `DataCleanerService` — dedupe + missing-value handling.
  - `DataNormalizerService` — schema standardization + derived metrics.
- **LLM**
  - `LlmAgentService` with LangChain, supports OpenAI / Anthropic; falls back to deterministic mock analysis when no key is provided.
- **Strategy**
  - Pluggable `Strategy` interface; ships `SimpleMomentumStrategy`.
- **Scheduling**
  - `SchedulerService` only initializes BullMQ when `ENABLE_SCHEDULER=true`. Without Redis, `triggerPipelineNow()` runs inline.
- **API**
  - `POST /agent/run-pipeline` — run end-to-end pipeline on demand.
  - `POST /agent/schedule-pipeline` — enqueue (requires BullMQ).
  - `GET /agent/status | /market-data | /analysis | /signals`.
- **WebSocket**
  - `/offline` namespace emits `pipeline.started` / `pipeline.completed` / `pipeline.failed`.

### Backend — realtime agent

- **`RealtimeService`** orchestrates: Pyth subscribe → DEX aggregate → nBBO → risk check → persist.
- **Oracle**
  - `PythPriceFeedService` against Pyth Hermes (`PYTH_HERMES_ENDPOINT`, default public endpoint).
  - In-memory `priceCache` keyed by symbol, eagerly warmed via `priceFeed.getLatest()`.
- **DEX layer**
  - `JupiterQuoteAdapter`, `RaydiumOrderBookAdapter`, `OrcaWhirlpoolOrderBookAdapter` (gated behind `ENABLE_REAL_DEX=true`).
  - **`OracleMockAdapter`** *(new in 0.0.1)* — replaces the static `MockDexAdapter`; mid price tracks the live oracle so executable quotes stay within bps of truth even in mock mode.
  - `DexOrderBookAggregator` runs adapters in parallel with per-adapter timeout.
- **nBBO engine** computes best bid / best ask across all sources and returns the optimal route id.
- **Risk engine** enforces: slippage cap, notional cap, oracle deviation, price impact, minimum liquidity, quote age.
- **Persistence**
  - `RealtimeTrade` model with full lifecycle status (`READY` / `SUBMITTED` / `CONFIRMED` / `FAILED` / `REJECTED`).
  - `RealtimeAgentLog` model for structured event logging, soft-linked to trades.
- **API**
  - `GET /realtime/health`
  - `GET /realtime/market/nbbo?pair=SOL/USDC`
  - `POST /realtime/trade/prepare`
  - `POST /realtime/trade/confirm` (lifecycle mark: submitted / confirmed / failed)
  - `GET /realtime/trades`
- **WebSocket**
  - `/realtime` namespace emits `price.update` and `trade.event` (intent → plan → submitted → confirmed → failed) with per-trade and per-pair rooms.

### Frontend

- **Vite + React 18 + TypeScript + Tailwind CSS + Zustand**, Socket.IO client.
- **`InsightsPage`** — manual pipeline trigger, last-run summary, latest LLM analyses, strategy signals, live pipeline event feed, ingested market data table.
- **`LiveTradingPage`** — live Pyth oracle card, best bid / best ask / spread, prepare-trade form, plan summary, mock submit/confirm/fail buttons, trade event feed, recent trades table.
- Shared `AppLayout` with live WS connection indicators (green = `/realtime` and `/offline` both connected).
- Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3000`.

### Database

- Prisma models: `MarketData`, `AnalysisResult`, `TradeSignal`, `BacktestResult`, `CrawlerJob`, `RealtimeTrade`, `RealtimeAgentLog`.
- Parallel SQL migration `supabase/migrations/20260512000000_realtime_tables.sql` for the manual-migration path.
- **`db:push`** added to `package.json` as the canonical schema-sync path for the demo (Prisma schema → live DB 1:1).

### Developer experience

- Test suites split: **Jest** for NestJS unit tests (`*.spec.ts`), **Vitest** for realtime core (`*.test.ts`). `npm run test:all` runs both.
- `nest build`, `vite build`, both clean.
- Health endpoints on backend (`/health`) and realtime (`/realtime/health`).
- Project icon (1024×1024 PNG, Solana brand gradient) shipped at `assets/sol-trade-agent-icon.png` and `frontend/public/icon.png`.

### Configuration toggles

| Env var | Default | Purpose |
|---|---|---|
| `ENABLE_SCHEDULER` | `false` | Spin up BullMQ for scheduled pipeline runs (requires Redis). |
| `ENABLE_REAL_DEX` | `false` | Replace mock DEX with real Jupiter/Raydium/Orca adapters. |
| `SOLANA_RPC_URL` | `mainnet-beta` | RPC for live DEX adapters. |
| `PYTH_HERMES_ENDPOINT` | public Hermes | Override the Pyth feed endpoint. |
| `PYTH_STALE_MS` | `15000` | Reject prices older than N ms. |
| `PYTH_MAX_CONFIDENCE_BPS` | `75` | Reject prices with confidence band wider than N bps. |
| `MAX_SLIPPAGE_BPS` | `100` | Risk-engine slippage cap. |
| `MAX_POSITION_NOTIONAL_USD` | `25000` | Risk-engine notional cap. |
| `MAX_ORACLE_DEVIATION_BPS` | `150` | Reject quotes too far from oracle mid. |
| `MAX_PRICE_IMPACT_BPS` | `100` | Risk-engine impact cap. |
| `MAX_QUOTE_AGE_MS` | `5000` | Reject stale DEX quotes. |
| `DEX_QUOTE_TIMEOUT_MS` | `2500` | Per-adapter quote timeout. |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_TEMPERATURE` | `openai` / `gpt-4o` / `0.7` | LangChain provider config. |

---

## Verification

- **Backend tests (Jest):** 8 suites / 20 tests — all passing.
- **Realtime tests (Vitest):** 3 suites / 3 tests — all passing.
- **`nest build`:** clean.
- **`vite build`:** clean.
- **Live `POST /agent/run-pipeline`:** verified end-to-end with real CoinGecko prices flowing into the LLM analysis output.

---

## Known issues and limitations

This is a **pre-alpha / dev** release. The following are deliberate gaps for now and tracked for `0.0.2+`.

1. **CMC env-var naming mismatch.** `backend/.env.example` defines `CMC_API_KEY` but `backend/src/config/config.service.ts` reads `COINMARKETCAP_API_KEY`. Even with a valid CMC key in `.env`, the crawler currently falls through to CoinGecko. Fix planned in 0.0.2.
2. **No real on-chain execution.** All trade lifecycle transitions (`Mark Submitted` / `Confirmed` / `Failed`) are mock-driven from the UI. The Anchor program is scaffolded but not wired to the lifecycle endpoints.
3. **No wallet signing flow.** Solana Wallet Adapter integration is planned; for now `userPubkey` is captured as a free-text field.
4. **TradingView and Dune crawlers are mocked.** No real Playwright scraping or Dune query execution yet — they emit deterministic fixture rows so the pipeline shape is realistic.
5. **LLM defaults to mock fallback.** Real GPT-4 / Claude analysis only kicks in when `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) is set.
6. **Scheduler requires opt-in.** `ENABLE_SCHEDULER=false` by default; no Redis means no automatic recurring runs.
7. **No production deployment story.** Docker compose is included only for local Redis. No Dockerfiles for backend/frontend, no CI/CD, no infra-as-code, no Prometheus/Grafana/ELK wiring yet (referenced in architecture docs as future work).
8. **No auth.** All REST and WebSocket endpoints are open. Do not expose this build to the public internet.
9. **`backend/.env.example` placeholder is `CMC_API_KEY`** — once issue (1) is resolved, the placeholder name will be updated too.
10. **Workspace deps may be uneven.** This release ships `backend/package.json` and `frontend/package.json` at `0.1.0` despite the release line being `0.0.1-dev`; package versions will be aligned in 0.0.2.

---

## Setup / upgrade

```bash
# 1. From repo root — start local Postgres + Supabase Studio
npx supabase start

# 2. Backend
cd backend
cp .env.example .env          # only DATABASE_URL is strictly required
npm install
npm run db:generate
npm run db:push               # syncs prisma/schema.prisma → live DB
npm run start:dev             # http://localhost:3000

# 3. Frontend (separate terminal)
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

Open `http://localhost:5173`. Both WS indicators in the top-right should turn green within ~1s.

### Optional power-ups

```bash
ENABLE_SCHEDULER=true REDIS_URL=redis://localhost:6379 npm run start:dev   # BullMQ scheduled runs
ENABLE_REAL_DEX=true SOLANA_RPC_URL=https://...      npm run start:dev   # real Jupiter/Raydium/Orca
OPENAI_API_KEY=sk-...                                npm run start:dev   # real LLM analysis
```

---

## Tech stack snapshot

| Layer | Tech |
|---|---|
| Backend | NestJS 10, Node 20, TypeScript |
| ORM | Prisma |
| Database | Supabase (PostgreSQL) |
| Queue | BullMQ + Redis (optional) |
| Workflow | Temporal (optional, scaffolding only) |
| LLM | LangChain (OpenAI / Anthropic / mock) |
| Realtime | Socket.IO |
| Validation | Zod |
| Tests | Jest + Vitest |
| Solana | Anchor Framework, Jupiter, Raydium, Orca |
| Oracle | Pyth Network (Hermes) |
| Frontend | Vite + React 18 + TypeScript + Tailwind + Zustand |
| Local dev | Supabase CLI, Docker |

---

## What's next (0.0.2 roadmap)

- Fix `CMC_API_KEY` ↔ `COINMARKETCAP_API_KEY` env-var mismatch.
- Wire Solana Wallet Adapter into Live Trading and bind `userPubkey` to a connected wallet.
- Real TradingView + Dune crawlers (Playwright + Dune API).
- Sign-and-send path through the Anchor program for at least one DEX route.
- Backend + frontend Dockerfiles and a one-shot `docker-compose up` story.
- Auth (API key + optional Solana sign-in-with-Solana for the dashboard).
- Align all workspace versions to `0.0.2`.

---

## Commits in this release

```
7e19508 chore(db): add db:push script and document schema-sync flow
98283b5 feat(realtime): track Pyth oracle in mock DEX and persist trade lifecycle
2be6f0e feat(branding): add SOL Trade Agent project icon
7e59ba1 fix(crawlers): add CoinGecko fallback and refresh stale CMC mock prices
e23c75d Add realtime NestJS module, fix offline pipeline, ship Vite/React frontend
d2716f4 Implement offline agent modules: data, agents, strategy, scheduler with all tests passing
7298569 Update package-lock.json after merge and test run
4904fa5 Merge branch origin/integration/zaky into feature/offline_agent_skeleton
5e6b798 Update architecture documentation and backend configuration
428a4ba Implement crawlers module with tests and Supabase setup
834dbd3 Design document
```

---

## Credits

Authored by **iis-MarkKuang** with pair-programming assistance from Cursor.
