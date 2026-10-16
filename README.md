# Solana ↔ Injective Cross-Chain Quant Agent

An open-source, near-real-time **cross-chain quantitative trading agent** that bridges
**Solana** DEXs and the **Injective Helix** exchange. It pairs an offline market-research
pipeline with a live nBBO (national best bid/offer) engine, deterministic pre-trade risk
checks, and a natural-language quant assistant — all exposed as an on-chain
**ERC-8004 agent** that also serves its own **MCP endpoint**.

> **Status:** research & demo prototype. It can prepare and persist trade plans and run
> the full pipeline end-to-end with **zero paid API keys** (mock fallbacks). Solana
> signing is not wired; Injective trades are simulated unless you provide a testnet
> mnemonic. Not production trading software.

---

## ✨ Features

- **Offline research pipeline** — crawl CoinMarketCap + TradingView + Dune, clean &
  normalize, run an LLM analysis, emit BUY/SELL strategy signals.
- **Realtime nBBO engine** — aggregate quotes across Solana DEXes (Jupiter/Raydium/Orca)
  **and** Injective Helix into a single cross-chain best bid/offer.
- **Cross-chain arbitrage scanner** — detect BTC/ETH spreads between Solana and Injective,
  net of bridge cost.
- **Deterministic risk gate** — slippage / notional / liquidity / oracle-deviation caps
  applied to every prepared trade (LLM never has execution authority).
- **Natural-language quant assistant** — ask "find me an arb for BTC between Solana and
  Injective" and get a plan via LangChain tools.
- **ERC-8004 agent identity** — our agent registers on the Injective Identity Registry and
  **exposes its own MCP server** (`POST /mcp`) with 4 callable tools.
- **Provider-neutral usage ledger** — optional cost controls for Dune / CMC / LLM / JEV
  with Postgres as source of truth + Redis hot-path cache.
- **Typed decision quality gate (JEV)** — optional shadow/enforce gate for research signals.

---

## 📸 Sneak peek

### Insights page (offline agent)

**Empty state** — before the first pipeline run:

![Insights page — empty](docs/images/insights-initial.png)

**After running the pipeline** — crawl counts, LLM analysis, trade signals, and the
cross-chain arbitrage panel populate:

![Insights page — populated](docs/images/insights-populated.png)

### Live Trading page (realtime agent)

Agent identity card, nBBO snapshot, and the cross-chain arbitrage scanner:

![Live Trading page](docs/images/live-trading.png)

The cross-chain arbitrage scanner flags BTC/ETH net edge after bridge cost:

![Cross-chain arbitrage scanner](docs/images/live-arb-scanner.png)

Prepare a trade — the nBBO pipeline runs (Pyth oracle → DEX aggregation → route
selection → risk check) and a plan summary card appears:

![Prepare trade](docs/images/live-trade-plan.png)

The trade event feed streams lifecycle events over WebSocket and recent trades persist
to Postgres:

![Trade event feed](docs/images/live-event-feed.png)

---

## 📋 Prerequisites

| Tool | Why | Min version |
|---|---|---|
| **Node.js** | backend + frontend | 20.x |
| **npm** | dependencies | 10.x |
| **Docker Desktop** | local Postgres / Redis | latest |
| `supabase` CLI | local Postgres (`npx supabase start`) | latest (via npx) |
| Git | clone | any |

> No Phantom wallet, no real Solana DEX traffic, no real funds needed for the demo.
> Solana trades are mock-signed; Injective trades are simulated unless you set
> `INJECTIVE_MNEMONIC`.

---

## 🚀 Quickstart (5 minutes, zero API keys)

The demo runs end-to-end with just a local Postgres — every external API has a safe
default or mock fallback.

### Step 1 — Start local Postgres

```bash
# From the repo root — starts Postgres + Supabase Studio at http://localhost:54323
npx supabase start
```

> **Standalone Postgres alternative:** if `supabase start` is too slow, run a plain
> Postgres container instead:
> ```bash
> docker run -d --name sol-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
> docker exec sol-pg psql -U postgres -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
> ```
> Then set `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"`.

### Step 2 — Configure & start the backend

```bash
cd backend
cp .env.example .env          # only DATABASE_URL is strictly required
npm install
npm run db:generate           # generate Prisma client
npm run db:push               # sync schema to Postgres (creates all tables)
npm run start:dev             # http://localhost:3000
```

Verify it's up:

```bash
curl http://localhost:3000/health
# → {"status":"ok",...}
```

### Step 3 — Start the frontend

```bash
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

Open <http://localhost:5173>. The top-right **Realtime WS** + **Offline WS** indicators
should turn green. You're ready to explore.

---

## 🧭 Using the app

The frontend has two pages, linked in the top nav.

### 1. Insights page (offline agent)

This is the default route. It runs the offline research pipeline: crawl → clean →
normalize → LLM analysis → strategy signals.

1. Click **Run pipeline now** (triggers `POST /agent/run-pipeline`).
2. The **Pipeline Live Feed** card streams `pipeline.started` / `pipeline.completed`
   WebSocket events in real time.
3. When it completes, the page auto-refreshes and you'll see:
   - **Last Run Summary** — crawl counts (CMC, TradingView, Dune) + duration.
   - **Latest LLM Analysis** — the generated insight (mock text if no LLM key).
   - **Trade Signals** — BUY/SELL with reasons from the momentum strategy.
   - **Recent Market Data** — the ingested rows.
   - **Cross-Chain Arbitrage** — Solana ↔ Injective spread panel.

**Without any API keys**, the LLM falls back to deterministic demo output and Dune uses
mock data (`DUNE_USE_MOCK=true`), so the pipeline still produces a full result.

<details>
<summary>Verify via curl</summary>

```bash
curl -X POST http://localhost:3000/agent/run-pipeline | jq
curl 'http://localhost:3000/agent/analysis?limit=3' | jq
curl 'http://localhost:3000/agent/signals?limit=10' | jq
```
</details>

### 2. Live Trading page (realtime agent)

Click **⚡ Live Trading** in the top nav.

**Top — Injective Agent Identity (ERC-8004):**
- Shows our agent's on-chain identity card (Agent ID, builder code, network, MCP
  endpoint). Without `INJECTIVE_AGENT_ID` it shows a deterministic simulated card; set it
  to fetch the real on-chain record. Set `INJECTIVE_AGENT_REGISTRY_ENABLED=true` to do a
  live scan of registered agents (otherwise clearly-labelled samples are shown).

**Market data cards:**
- **Oracle SOL/USDC** — live Pyth price (mock-friendly via `PYTH_USE_MOCK=true`).
- **Best Bid / Best Ask / Spread** — aggregated nBBO from the configured DEXes.

**Prepare a trade:**
1. Pick a pair from the dropdown (Solana pairs: SOL/USDC, BTC/USDC, ETH/USDC; Injective
   pairs: INJ/USDC, BTC/USDT, ETH/USDT).
2. Choose **Buy** or **Sell**, enter an amount (USDC) and max slippage (bps).
3. Click **Prepare nBBO Trade** → the backend runs the full pipeline:
   Pyth oracle → DEX aggregation → nBBO selection → risk check → trade persisted as
   `RealtimeTrade(status=READY)`.
4. A green plan summary card appears with the selected DEX, quote price vs oracle price,
   liquidity, price impact, and route latency.
5. Click any lifecycle button to simulate execution:
   - **Mark Submitted** → status `SUBMITTED` + fake tx signature.
   - **Mark Confirmed** → status `CONFIRMED` + records execution price.
   - **Mark Failed** → status `FAILED` with a rejection reason.

**Cross-Chain Arbitrage Scanner:**
- Lists live BTC/ETH spreads across Solana and Injective, net of bridge cost, with the
  recommended direction (e.g. "Buy on Solana, sell on Injective · deBridge/Peggy").

**Natural-Language Quant Assistant:**
- Type e.g. *"Find BTC and ETH arbitrage between Solana and Injective"* → click **Ask
  Agent** → returns a plan via LangChain tools.

**Trade Event Feed & Recent Trades:**
- The event feed streams lifecycle events (`trade.intent.received` →
  `trade.plan.ready` → `trade.confirmed`) over WebSocket.
- Recent trades persist to Postgres so they survive refreshes.

<details>
<summary>Verify via curl</summary>

```bash
curl 'http://localhost:3000/realtime/market/nbbo?pair=SOL/USDC' | jq
curl -X POST http://localhost:3000/realtime/trade/prepare \
  -H 'content-type: application/json' \
  -d '{"pair":"SOL/USDC","side":"buy","amountIn":"160000000","maxSlippageBps":100}' | jq
curl 'http://localhost:3000/realtime/cross-chain/arb' | jq
curl 'http://localhost:3000/agent/identity' | jq
# MCP tools/list (JSON-RPC over Streamable HTTP)
curl -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
</details>

---

## ⚡ Optional power-ups

All default off — turn on only what you need.

| Toggle | What it does |
|---|---|
| `ENABLE_SCHEDULER=true` (+ `REDIS_URL`) | BullMQ runs the offline pipeline on a configurable interval (default 1h). |
| `ENABLE_REAL_DEX=true` (+ `SOLANA_RPC_URL`) | Swap the mock DEX for live Jupiter/Raydium/Orca quotes. |
| `ENABLE_INJECTIVE=true` | Register the Injective Helix adapter + Injective executor (on by default in `.env.example`). |
| `INJECTIVE_MNEMONIC=…` | Let the spawned Injective MCP server sign real testnet orders (empty → simulated). |
| `LLM_PROVIDER=deepseek` + `DEEPSEEK_API_KEY` | Replace mock LLM analysis with real DeepSeek output. |
| `LLM_PROVIDER=openai` + `OPENAI_API_KEY` | Use OpenAI (or an OpenAI-compatible gateway like OpenRouter). |
| `LLM_PROVIDER=azure` + `AZURE_OPENAI_*` | Use Azure OpenAI (Nova Program credits). |
| `DECISION_PROVIDER=jev` + `TYPESAFE_API_KEY` | Enable the JEV typed-decision quality gate (start in `shadow` mode). |
| `USAGE_LEDGER_ENABLED=true` (+ `REDIS_URL`) | Turn on provider-neutral cost controls for Dune/CMC/LLM/JEV. |
| `INJECTIVE_AGENT_REGISTRY_ENABLED=true` | Live on-chain scan of the Injective Agent Registry. |

---

## 🔧 Key scripts (backend)

From the `backend/` directory:

```bash
npm run db:generate       # generate Prisma client
npm run db:push           # sync Prisma schema to the live DB (preferred for demo)
npm run db:migrate        # apply SQL migrations from supabase/migrations/
npm run db:reset          # reset DB and re-run all migrations
npm run start:dev         # NestJS dev server with hot-reload
npm run test              # Jest unit tests
npm run test:vitest       # Vitest unit tests (realtime core / nBBO / Pyth)
npm run test:all          # Jest + Vitest
npm run test:workflow      # deterministic gather→analyze→decide workflow sim
npm run build             # nest build
```

### Sanity checks

```bash
cd backend && npm run test:all && npx nest build
cd ../frontend && npm run build
```

---

## 🌌 Injective integration

This project is being extended for the **Injective Nova Program** (Injective × Microsoft ×
Web3Labs). The story is **bidirectional**:

- **We consume** the official [Injective MCP server](https://github.com/InjectiveLabs/mcp-server)
  for execution (Helix market data + MCP signing).
- **We expose** our own MCP server at `POST /mcp` (Streamable HTTP) with four tools:
  `query_cross_chain_nbbo`, `propose_arb_plan`, `execute_injective_trade`,
  `get_agent_identity` — so other Injective agents can discover and call us.

### Injective environment variables

| Env var | Default | Description |
|---|---|---|
| `ENABLE_INJECTIVE` | `true` | Register the Helix adapter + Injective executor. |
| `INJECTIVE_NETWORK` | `testnet` | `testnet` or `mainnet`. |
| `INJECTIVE_EXCHANGE_API` | `https://api.injective.exchange` | Helix REST base URL. |
| `INJECTIVE_MCP_BIN` | `npx -y @injectivelabs/mcp-server` | Command to spawn the official MCP server (stdio). |
| `INJECTIVE_MNEMONIC` | _(empty)_ | Empty → `MockInjectiveTradeExecutor` (simulated tx hashes). Set → real testnet orders. |
| `INJECTIVE_AGENT_ID` | _(empty)_ | Empty → deterministic simulated identity card. Set → real on-chain record. |
| `INJECTIVE_AGENT_REGISTRY_ENABLED` | `false` | `true` → live bounded scan of registered agents. |
| `MCP_PUBLIC_URL` | `http://localhost:3000/mcp` | Public URL declared in our Agent Card services. |

### Run the Injective-enabled demo

```bash
# Backend with Injective enabled (testnet, simulated execution)
cd backend
ENABLE_INJECTIVE=true INJECTIVE_NETWORK=testnet npm run start:dev

# Real signing via the official MCP server (advanced)
ENABLE_INJECTIVE=true INJECTIVE_NETWORK=testnet \
INJECTIVE_MNEMONIC="your testnet mnemonic" \
npm run start:dev
```

With `ENABLE_INJECTIVE=true` and no mnemonic, the Helix adapter fetches **real** Injective
orderbooks and trades are simulated — safe for demos.

---

## 🟣 Monad integration (experimental)

The agent also supports the **Monad** chain — an EVM-compatible L1 (chain ID `143`,
mainnet live since 2025-11-24, ~10k TPS). The integration is fully additive and gated
behind `ENABLE_MONAD` (default `false`), so the app behaves identically to before when the
flag is off. See `docs/monad-integration-research.md` for the full design and
`docs/monad-integration-roadmap.md` for the ticket-by-ticket implementation plan.

### Monad environment variables

| Env var | Default | Description |
|---|---|---|
| `ENABLE_MONAD` | `false` | Register the Monad DEX adapter + viem executor. Off → no behavior change. |
| `MONAD_RPC_URL` | _(empty)_ | Monad JSON-RPC endpoint. Empty → mock mode (no network calls). |
| `MONAD_CHAIN_ID` | `143` | Monad mainnet chain id. Use `10143` for testnet. |
| `MONAD_DEX_MODE` | `mock` | `mock` → deterministic quotes tracking Pyth mid + premium; `aggregator` → 0x/1inch API. |
| `MONAD_AGGREGATOR` | `0x` | `0x` or `1inch` when `MONAD_DEX_MODE=aggregator`. |
| `MONAD_AGGREGATOR_API_KEY` | _(empty)_ | Required only for 0x Pro / 1inch API in non-demo environments. |
| `MONAD_PRIVATE_KEY` | _(empty)_ | EVM private key for `MonadViemExecutor`. Empty → `MockMonadTradeExecutor` (simulated hashes). **Keep in `.env` only — never commit.** |
| `MONAD_MOCK_OFFSET_BPS` | `30` | Premium (bps) the mock adapter adds over the Pyth mid, used in the nBBO path. |

### Run the Monad-enabled demo (zero keys)

```bash
cd backend
ENABLE_MONAD=true MONAD_DEX_MODE=mock MONAD_PRIVATE_KEY="" npm run start:dev
```

With `ENABLE_MONAD=true` and no private key / RPC, the Monad adapter returns
deterministic quotes (Pyth mid + `MONAD_MOCK_OFFSET_BPS` premium) and the executor
returns simulated tx hashes — safe for demos. The Live Trading page dropdown then
exposes three extra pairs tagged **Monad DEX** (MON/USDC, WBTC/USDC, WETH/USDC), the
nBBO panel can surface a Monad best quote, and the **Cross-Chain Arbitrage Scanner**
widens to **Solana ↔ Injective ↔ Monad** (N-chain pairwise scan). Execute a Monad plan
via the **Execute on Monad (viem)** button or `POST /realtime/trade/monad-execute`.

> ⚠️ The `MONAD_TOKENS` ERC-20 contract addresses in `backend/src/config/tokens.ts`
> are **TODO placeholders** (`0xMONAD...USDC` etc.) pending verification against the
> live Monad ecosystem contracts. Mock mode bypasses them; **do not enable
> `MONAD_DEX_MODE=aggregator` or set a real `MONAD_PRIVATE_KEY` until those addresses
> are verified** — a real signature against a wrong ERC-20 could lose funds.

### OP decision gates to turn on real Monad execution

Before flipping `ENABLE_MONAD=true` with real signing in any non-demo environment, the
operator must clear these gates (tracked in `docs/monad-integration-roadmap.md`):

1. **Pyth MON feed** — confirm a published Pyth price feed id for the Monad-native
   assets you intend to quote (currently the registry reuses shared BTC/ETH feed ids).
2. **Paid Monad RPC** — provision a paid/mainnet `MONAD_RPC_URL`; the public RPC may
   rate-limit at demo volumes.
3. **0x / 1inch API key** — obtain `MONAD_AGGREGATOR_API_KEY` if you switch
   `MONAD_DEX_MODE=aggregator`; the free tier is demo-only.
4. **Verified ERC-20 addresses** — replace every `0xMONAD...` placeholder in
   `MONAD_TOKENS` with the real on-chain contract addresses.
5. **Funded signer** — fund the EVM address derived from `MONAD_PRIVATE_KEY` with enough
   MON for gas; testnet faucet is free, mainnet is not.

None of these are required for the zero-key demo path above.

---

## 🛠️ Tech stack

| Component | Technologies |
|---|---|
| **Backend** | NestJS 10 + TypeScript |
| **Database** | Supabase / PostgreSQL |
| **ORM** | Prisma |
| **LLM** | LangChain (DeepSeek / OpenAI / Azure OpenAI adapters) |
| **Decision gate** | TypeSafe JEV (typed decision models) |
| **Job queues** | BullMQ + Redis |
| **Real-time** | Socket.IO |
| **Frontend** | Vite + React 18 + TypeScript + Tailwind + Zustand |
| **Cross-chain** | Injective Helix adapter + Injective MCP server + viem (ERC-8004) |

---

## 🐛 Troubleshooting

| Symptom | Fix |
|---|---|
| `prisma generate` / `db:push` fails | Ensure `npx supabase start` finished; `DATABASE_URL` matches the printed local URL. |
| Using standalone Postgres, `db:push` errors on `uuid_generate_v4` | Run `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` in the DB first. |
| Frontend WS indicators stay red | Backend not up, or `VITE_BACKEND_URL` wrong; check browser console — `/socket.io` must return 200. |
| No Injective quotes | `ENABLE_INJECTIVE=true`? The Helix adapter hits `https://api.injective.exchange`; outbound HTTPS must be allowed. |
| LLM returns "mock" text | The selected DeepSeek/OpenAI/Azure adapter has no key; configure its provider-specific credential. |
| Pyth oracle shows "Waiting for Pyth…" | Set `PYTH_USE_MOCK=true` for a reliable demo (hermes.pyth.network can be TLS-blocked for Node fetch on some networks). |
| `TS2589` type errors in `cross-chain-agent.service.ts` | Known LangChain+zod inference issue, suppressed with `@ts-ignore`; runtime unaffected. |

---

## 📚 Documentation

- [Manual (run + Azure deploy)](docs/MANUAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Code walkthrough](docs/CODE_WALKTHROUGH.md)
- [AI agent rules](docs/AGENTS.md)
- [Offline agent design](docs/offline-agent-design.md)
- [Realtime agent design](docs/realtime-agent-design.md)
- [Usage ledger design](docs/usage-ledger-design.md)
- [Usage ledger roadmap](docs/usage-ledger-roadmap.md)
- [Operator pending decisions](docs/OP_Pending_Items.md)
- [Progress tracker](docs/progress-tracker.md)

---

## 📁 Project structure

```
sol_trade_agent/
├── docs/                        # documentation + images
├── backend/                     # NestJS backend
│   ├── src/
│   │   ├── agents/              # LLM adapters + factory
│   │   ├── crawlers/            # CMC / Dune / TradingView
│   │   ├── decision/            # JEV quality gate
│   │   ├── usage-ledger/        # provider-neutral cost controls
│   │   ├── realtime/            # nBBO + cross-chain agent + MCP server
│   │   ├── scheduler/           # BullMQ offline pipeline controller
│   │   ├── config/              # ConfigService + token registry
│   │   └── prisma/              # Prisma module
│   ├── prisma/schema.prisma     # database schema
│   └── .env.example             # all config knobs documented inline
├── frontend/                    # Vite + React + Tailwind SPA
│   └── src/pages/               # InsightsPage + LiveTradingPage
├── supabase/migrations/         # SQL migrations (parallel to Prisma)
└── docker-compose.yml           # optional local Redis
```

---

Built for the Solana Frontier Hackathon · Demo build. Not production trading software.
