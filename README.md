# Solana Frontier Web3 LLM Trading Agent

A Web3 LLM agent platform for autonomous Solana trading, similar to b.ai, combining AI-driven market insights, real-time nBBO execution, and **Injective cross-chain arbitrage** (Nova Program).

> **Need to run or deploy this?** See [`docs/MANUAL.md`](docs/MANUAL.md) — local startup + Azure demo website deployment.

---

## 📁 Project Structure
```
sol_trade_agent/
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md        # High-level system architecture
│   ├── offline-agent-design.md  # Detailed offline agent design
│   ├── realtime-agent-design.md # Detailed realtime agent design
│   └── progress-tracker.md    # Project progress tracking
├── backend/                   # NestJS backend
│   ├── src/
│   │   ├── prisma/            # Prisma ORM module
│   │   ├── main.ts            # NestJS entry point
│   │   └── app.module.ts      # Main app module
│   ├── prisma/
│   │   └── schema.prisma      # Database schema
│   └── ...config files
├── frontend/                  # Vite + React + Tailwind frontend
├── supabase/                  # Supabase local development & migrations
│   ├── migrations/            # Database migrations
│   └── config.toml            # Supabase config
└── docker-compose.yml         # (Optional) Local Redis if not using Supabase Edge Functions
```

---

## 🚀 Quickstart - Supabase Only

### Step 1: Install Docker (if you haven't already)
Supabase local dev requires Docker

### Step 2: Start the local Supabase stack
```bash
# From project root
npx supabase start
```

This will start:
- Postgres database
- Supabase Studio (UI at http://localhost:54323)
- And more!

### Step 3: Configure your .env
Update `/backend/.env` with the local database URL printed by `supabase start`:
```env
# Database (Local Supabase - provided by "supabase start")
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Redis (local or use Upstash)
REDIS_URL="redis://localhost:6379"

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

### Step 4: Set Up the Backend
```bash
cd backend

# 1. Install all dependencies
npm install

# 2. Generate Prisma Client
npm run db:generate

# 3. Sync the Prisma schema to your local Postgres
#    (creates market_data / trade_signal / realtime_trade / …)
npm run db:push

# 4. Start NestJS dev server
npm run start:dev
```

> Note: `db:push` is the canonical schema sync for this project — it always
> matches what the Prisma Client expects. The `supabase/migrations/*.sql`
> files exist as a parallel manual-migration path; they are kept in sync but
> not required for the demo.

### Step 5: Verify Setup
- Check Supabase Studio: http://localhost:54323
- Check health endpoint: http://localhost:3000/health
- Run a full offline pipeline (no Redis required):
  `curl -X POST http://localhost:3000/agent/run-pipeline`
- Inspect realtime nBBO for SOL/USDC:
  `curl 'http://localhost:3000/realtime/market/nbbo?pair=SOL/USDC'`

### Step 6: Run the Frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

The frontend has two pages:
- **Insights** — offline agent (run pipeline, view analyses + signals)
- **Live Trading** — realtime agent (nBBO snapshot, prepare/confirm trade, live event feed)

The dev server proxies `/api` and `/socket.io` to `http://localhost:3000`.

---

## 🎬 Demo Flow (no Redis, no wallet required)

Everything below works end-to-end with just Supabase running locally — no Redis,
no Phantom wallet, no real DEX traffic.

### One-time setup

```bash
# 1. From repo root — start local Postgres (Supabase)
npx supabase start

# 2. Configure backend (only DATABASE_URL is strictly required)
cd backend
cp .env.example .env   # (skip if .env already exists)
npm install
npm run db:generate
npm run db:push        # syncs Prisma schema to the live DB

# 3. Configure frontend
cd ../frontend
npm install
```

### Start both servers (in two terminals)

```bash
# Terminal A — backend (NestJS, http://localhost:3000)
cd backend
npm run start:dev

# Terminal B — frontend (Vite, http://localhost:5173)
cd frontend
npm run dev
```

Open <http://localhost:5173>. The top-right WS indicators should turn green
("Realtime WS" and "Offline WS").

### 1. Offline Agent — Insights page

Navigate to **Insights** (default route).

1. Click **Run pipeline now**.
   - Triggers `POST /agent/run-pipeline`.
   - Backend runs: crawl (CMC + TradingView + Dune mocks) → clean → normalize →
     LLM analysis (mock fallback if no `OPENAI_API_KEY`) → strategy signals.
   - The Pipeline Live Feed card at the bottom shows the WebSocket
     `pipeline.started` / `pipeline.completed` events.
2. The page auto-refreshes when completion arrives. You should now see:
   - **Last Run Summary** card with crawl counts + duration.
   - **Latest LLM Analysis** with the generated insight.
   - **Trade Signals** list (BUY/SELL with reasons from `SimpleMomentumStrategy`).
   - **Recent Market Data** table with the ingested rows.

Optional — verify via curl:

```bash
curl -X POST http://localhost:3000/agent/run-pipeline | jq
curl 'http://localhost:3000/agent/analysis?limit=3' | jq
curl 'http://localhost:3000/agent/signals?limit=10' | jq
```

### 2. Realtime Agent — Live Trading page

Click **Live Trading** in the top nav.

1. Top stat cards show:
   - **Oracle SOL/USDC** — live Pyth price streaming via WebSocket (mock-friendly).
   - **Best Bid / Best Ask / Spread** — aggregated nBBO from the mock DEX
     (Jupiter/Raydium/Orca adapters are gated behind `ENABLE_REAL_DEX=true`).
2. Fill the **Prepare Trade** form:
   - Pair: `SOL/USDC`
   - Side: `Buy`
   - Amount: `160` (USDC)
   - Max slippage: `100` bps
   - Wallet: any pubkey or leave blank
3. Click **Prepare nBBO Trade** → calls `POST /realtime/trade/prepare`.
   - Backend runs: Pyth oracle fetch → DEX aggregation → nBBO selection →
     risk check → trade persisted as `RealtimeTrade(status=READY)`.
   - The right column updates the nBBO Snapshot.
   - A green plan summary card appears under the form with selected DEX,
     quote price vs oracle price, liquidity, price impact, route latency.
4. Click any of the three lifecycle buttons (mock execution):
   - **Mark Submitted** → status `SUBMITTED` + fake tx signature.
   - **Mark Confirmed** → status `CONFIRMED` + records execution price.
   - **Mark Failed** → status `FAILED` with a rejection reason.
5. Watch the **Trade Event Feed** card stream the lifecycle events as they
   happen (`trade.intent.received` → `trade.plan.ready` → `trade.confirmed`).
6. The **Recent Trades** card persists everything to Postgres
   (`realtime_trade` + `realtime_agent_log` tables) so you can refresh and
   see the full history.

Optional — verify via curl:

```bash
curl 'http://localhost:3000/realtime/market/nbbo?pair=SOL/USDC' | jq
curl -X POST http://localhost:3000/realtime/trade/prepare \
  -H 'content-type: application/json' \
  -d '{"pair":"SOL/USDC","side":"buy","amountIn":"160000000","maxSlippageBps":100}' | jq
curl 'http://localhost:3000/realtime/trades?limit=5' | jq
```

### Optional power-ups

| Toggle | What it does |
|--------|--------------|
| `ENABLE_SCHEDULER=true` (+ Redis on `REDIS_URL`) | BullMQ runs the offline pipeline on a configurable interval (default 1h). |
| `ENABLE_REAL_DEX=true` (+ `SOLANA_RPC_URL`) | Swap the mock DEX for live Jupiter/Raydium/Orca quotes. |
| `OPENAI_API_KEY=…` | Replace the mock LLM analysis with real GPT-4 output via LangChain. |
| `PYTH_HERMES_ENDPOINT=…` | Point at a custom Pyth Hermes endpoint (default is the public one). |

### Sanity checks

```bash
cd backend
npm run test:all      # Jest (20) + Vitest (3) — should all pass
npx nest build        # Should complete cleanly

cd ../frontend
npm run build         # tsc -b && vite build — should complete cleanly
```

---

## 🔧 Key Scripts (Backend)

From the `backend/` directory:
```bash
npm run db:generate       # Generate Prisma Client
npm run db:push           # Sync Prisma schema directly to live DB (preferred for demo)
npm run db:migrate        # Apply SQL migrations from supabase/migrations/
npm run db:reset          # Reset database and re-run all migrations
npm run db:status         # Check Supabase status
npm run supabase:start    # Start Supabase local stack
npm run supabase:stop     # Stop Supabase local stack
npm run start:dev         # Start NestJS dev server with hot-reload
npm run test              # Jest unit tests (NestJS services + gateways)
npm run test:vitest       # Vitest unit tests (realtime agent core / NBBO / Pyth)
npm run test:all          # Run both Jest and Vitest
```

### Environment Toggles

| Env Var                  | Default                                  | Description |
|--------------------------|------------------------------------------|-------------|
| `ENABLE_SCHEDULER`       | `false`                                  | Start BullMQ queue on boot (requires Redis). When false, pipeline runs on demand only. |
| `ENABLE_REAL_DEX`        | `false`                                  | Use real Jupiter/Raydium/Orca adapters. When false, a deterministic mock DEX is used. |
| `SOLANA_RPC_URL`         | `https://api.mainnet-beta.solana.com`    | RPC endpoint for live DEX adapters. |
| `PYTH_HERMES_ENDPOINT`   | `https://hermes.pyth.network`            | Pyth Hermes base URL for price feeds. |
| `MAX_SLIPPAGE_BPS`       | `100`                                    | Risk policy cap for slippage. |
| `MAX_POSITION_NOTIONAL_USD` | `25000`                               | Risk policy cap for notional position size. |

---

## 📚 Documentation

- [High-level System Architecture](/docs/ARCHITECTURE.md)
- [Offline Agent Detailed Design](/docs/offline-agent-design.md)
- [Realtime Agent Detailed Design](/docs/realtime-agent-design.md)
- [Project Progress Tracker](/docs/progress-tracker.md)

---

## 🛠️ Tech Stack

| Component | Technologies |
|-----------|--------------|
| **Backend Framework** | NestJS 10 + TypeScript |
| **Database** | Supabase (PostgreSQL) with optional TimescaleDB |
| **ORM** | Prisma |
| **LLM Integration** | LangChain (OpenAI, Anthropic, local models) |
| **Job Queues** | BullMQ + Redis (local or Upstash) |
| **Workflow Orchestration** | Temporal (optional, production-grade) |
| **Real-time** | Socket.IO |
| **Frontend** | Vite + React 18 + TypeScript + Tailwind CSS + Zustand + Socket.IO client |
| **Smart Contracts** | Anchor Framework + Jupiter (Solana) |

---

## 🌌 Injective Integration (Nova Program)

This project is being extended for the **Injective Nova Program** (Injective × Microsoft × Web3Labs) — turning the Solana-only agent into a **Solana ↔ Injective cross-chain AI quant assistant**. It targets the *Agent infrastructure* and *Open innovation* directions.

### Design

The realtime agent is now chain-agnostic: the `DexOrderBookAggregator` fans out to both Solana DEX adapters (Jupiter/Raydium/Orca) **and** an Injective Helix adapter, producing a single cross-chain nBBO. When the winning route lives on Injective, `RealTimeAgentCore` emits an `injectiveExecutionPlan`; a dedicated executor hands it to the official **Injective MCP server** for real signing/broadcast.

```mermaid
flowchart LR
    Pyth["Pyth (shared oracle)"] --> Core["RealTimeAgentCore"]
    Sol["Solana DEX adapters"] --> Agg["Aggregator"]
    Inj["Injective Helix adapter"] --> Agg
    Agg --> NBBO["nBBO (cross-chain)"]
    NBBO --> Core
    Core -->|chain=solana| SolTx["Jupiter tx (mock)"]
    Core -->|chain=injective| MCP["Injective MCP Server"]
    Arb["CrossChainArbStrategy"] --> NL["NL Agent (LangChain tools)"]
    NL --> MCP
```

### What was added

| Area | Files |
|------|-------|
| Chain abstraction | `backend/src/types.ts` (`DexSource`/`DexQuote.chain`/`TokenPair.chain`), `backend/src/utils/amounts.ts` |
| Injective token registry | `backend/src/config/tokens.ts` (INJ/USDC/USDT denoms + Helix markets + BTC/ETH perps) |
| Helix market data | `backend/src/dex/injective-helix-adapter.ts` (REST orderbook → `DexAdapter`) |
| Shared oracle | `backend/src/oracle/injective-pyth-adapter.ts` (Injective pairs reuse Pyth Hermes) |
| MCP execution | `backend/src/transactions/injective-mcp-client.ts` (stdio JSON-RPC client + mock executor) |
| Cross-chain arb | `backend/src/strategy/strategies/cross-chain-arb.strategy.ts` |
| NL quant assistant | `backend/src/realtime/cross-chain-agent.service.ts` (LangChain `query_cross_chain_nbbo` + `propose_arb_plan` tools) |
| Agent identity (ERC-8004) | `backend/src/agent/injective-agent-identity.service.ts`, `injective-registry.viem.ts`, `injective-agent-identity.types.ts`, `agent-identity.controller.ts`, `agent-identity.module.ts` |
| Exposed MCP server | `backend/src/realtime/agent-mcp-server.service.ts`, `agent-mcp.controller.ts` (`POST /mcp`, Streamable HTTP) |
| Wiring + API | `backend/src/realtime/realtime.service.ts`, `realtime.controller.ts`, `realtime.module.ts` |
| Frontend | `frontend/src/pages/LiveTradingPage.tsx`, `InsightsPage.tsx`, `lib/api.ts` |

### New REST endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/realtime/cross-chain/arb` | Scan BTC/ETH spreads across Solana & Injective |
| `POST` | `/realtime/cross-chain/plan` | Natural-language cross-chain plan via LangChain tools |
| `POST` | `/realtime/trade/injective-execute` | Execute a prepared Injective plan via the MCP server |
| `GET` | `/agent/identity` | Our agent's ERC-8004 identity card (real or simulated) |
| `GET` | `/agent/registry` | Browse the Injective Agent Registry (live scan or samples) |
| `POST` | `/mcp` | **MCP server endpoint** we expose (Streamable HTTP) — tools below |

### Injective Agent Identity (ERC-8004) + our own MCP server

Beyond *consuming* the official Injective MCP server for execution, the agent now participates in the Injective agent stack as a first-class citizen:

- **On-chain identity** — `backend/src/agent/injective-agent-identity.service.ts` + `injective-registry.viem.ts` talk directly to the canonical Injective Identity Registry (ERC-8004) via `viem` (read-only). Set `INJECTIVE_AGENT_ID` to fetch our agent's real on-chain card; otherwise a deterministic simulated card is returned. Set `INJECTIVE_AGENT_REGISTRY_ENABLED=true` for a live bounded scan of registered agents (falls back to clearly-labelled samples).
- **Agent Card** — our card declares `services` including our own MCP endpoint (`MCP_PUBLIC_URL`), so the agent is discoverable with capabilities on [agents.injective.com](https://agents.injective.com).
- **We expose an MCP server** — `backend/src/realtime/agent-mcp-server.service.ts` mounts a standards-compliant MCP endpoint at `POST /mcp` (Streamable HTTP, via `@modelcontextprotocol/sdk`) with four tools:
  - `query_cross_chain_nbbo` — live nBBO for a pair across Solana + Injective
  - `propose_arb_plan` — cross-chain arbitrage scan
  - `execute_injective_trade` — prepare + execute an Injective Helix trade
  - `get_agent_identity` — our ERC-8004 identity card

This makes the story bidirectional: our agent **calls** the Injective MCP server to trade, **and** is itself an on-chain registered agent that **exposes** an MCP server other agents can call.

### Injective environment variables

| Env Var | Default | Description |
|---------|---------|-------------|
| `ENABLE_INJECTIVE` | `false` | Register the Helix adapter + Injective executor |
| `INJECTIVE_NETWORK` | `testnet` | `testnet` or `mainnet` (passed to the MCP server) |
| `INJECTIVE_EXCHANGE_API` | `https://api.injective.exchange` | Helix public REST base URL |
| `INJECTIVE_MCP_BIN` | `npx -y @injectivelabs/mcp-server` | Command used to spawn the official MCP server (stdio) |
| `INJECTIVE_MNEMONIC` | _(empty)_ | Injective account mnemonic for MCP signing. Empty → `MockInjectiveTradeExecutor` (simulated tx hashes) |
| `INJECTIVE_HELI_MARKETS` | _(empty)_ | Optional overrides, e.g. `INJ/USDC=INJ/USDC:spot,BTC/USDT=BTC/USDT:derivative` |

### LLM provider (Azure OpenAI for Nova credits)

The NL quant assistant and offline LLM agent share a single factory (`backend/src/agents/llm-factory.ts`) that supports both the public OpenAI API and **Azure OpenAI Service**, so you can spend the Nova Program's Microsoft Azure credits instead of your own OpenAI quota.

| Env Var | When | Description |
|---------|------|-------------|
| `LLM_PROVIDER` | optional | `azure` or `openai`. Auto-detects: Azure wins if `AZURE_OPENAI_API_KEY` is set. |
| `AZURE_OPENAI_API_KEY` | Azure | Azure OpenAI resource key |
| `AZURE_OPENAI_API_INSTANCE_NAME` | Azure | Azure resource name |
| `AZURE_OPENAI_API_DEPLOYMENT_NAME` | Azure | Deployment name (e.g. `gpt-4o-mini`) |
| `AZURE_OPENAI_API_VERSION` | Azure | API version, default `2024-08-01-preview` |
| `AZURE_OPENAI_BASE_PATH` | Azure | Optional custom endpoint |
| `OPENAI_API_KEY` | OpenAI | Public OpenAI API key |
| `OPENAI_BASE_URL` | OpenAI | Optional custom base URL (e.g. proxy) |
| `LLM_MODEL` | OpenAI | Model name, default `gpt-4o-mini` |

When neither Azure nor OpenAI credentials are present, both services fall back to deterministic/mock output so the demo still runs end-to-end.

### Run the Injective-enabled demo

```bash
# 1. Backend with Injective enabled (testnet, simulated execution)
cd backend
ENABLE_INJECTIVE=true INJECTIVE_NETWORK=testnet npm run start:dev

# 2. Real signing via the official MCP server (advanced)
ENABLE_INJECTIVE=true INJECTIVE_NETWORK=testnet \
INJECTIVE_MNEMONIC="your testnet mnemonic" \
npm run start:dev

# 3. Use Nova Azure OpenAI credits for the NL agent
LLM_PROVIDER=azure \
AZURE_OPENAI_API_KEY="..." \
AZURE_OPENAI_API_INSTANCE_NAME="my-resource" \
AZURE_OPENAI_API_DEPLOYMENT_NAME="gpt-4o-mini" \
ENABLE_INJECTIVE=true npm run start:dev
```

With `ENABLE_INJECTIVE=true` and no mnemonic, the Helix adapter fetches **real** Injective orderbooks and trades are simulated by `MockInjectiveTradeExecutor` — safe for demos. Set `INJECTIVE_MNEMONIC` to let the spawned [Injective MCP server](https://github.com/InjectiveLabs/mcp-server) sign and broadcast real testnet orders.

### Nova Program compliance checklist

- [x] Deploys/integrates with Injective (Helix market data + MCP execution)
- [x] Open-source codebase (this repo)
- [ ] ≤ 3 minute demo video
- [ ] Pitch deck
- [ ] Register at [injectivenova.com](https://injectivenova.com) (recruitment window May 21 – Jun 30)
- [ ] Attend offline Demo Day (finalists)
