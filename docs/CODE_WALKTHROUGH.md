# Code Walkthrough

This is the canonical file-level guide to the repository. Read
[ARCHITECTURE.md](ARCHITECTURE.md) first for the product boundary and roadmap.

## Start Here

The application is a NestJS backend plus a React operator UI.

- Backend entry: `backend/src/main.ts`
- Backend composition: `backend/src/app.module.ts`
- Frontend entry: `frontend/src/main.tsx`
- Frontend routes: `frontend/src/App.tsx`
- Database schema: `backend/prisma/schema.prisma`

There is one supported backend runtime. Historical standalone server code has
been removed.

## Repository Map

```text
backend/
  prisma/                 PostgreSQL schema
  src/
    agent/                realtime core and Injective identity
    agents/               LLM research summaries
    config/               environment parsing and token registry
    crawlers/             offline data-source adapters
    data/                 cleaning and normalization
    dex/                  quote adapters and aggregator
    nbbo/                 best bid/ask and route selection
    oracle/               Pyth feed parsing/subscription
    realtime/             REST, WebSocket, orchestration, persistence
    risk/                 deterministic pre-trade checks
    scheduler/            offline pipeline and BullMQ schedule
    strategy/             deterministic signal logic
    transactions/         chain-specific transaction helpers
    utils/                amount and retry utilities
contracts/
  programs/trade_execution/  Anchor guardrail prototype
frontend/
  src/pages/              Insights and Live Trading screens
  src/lib/                typed REST and Socket.IO clients
supabase/
  migrations/             manual SQL migration path
docs/                     architecture, operations, and design notes
```

## Runtime Composition

`AppModule` wires these main modules:

- `SchedulerModule`: offline research pipeline.
- `RealtimeModule`: online quote/risk/plan API.
- `AgentIdentityModule`: optional Injective registry read path.
- `CrawlersModule`, `DataModule`, `AgentsModule`, `StrategyModule`: pipeline
  dependencies.
- `PrismaModule`: shared durable persistence.

`AppController` now only owns `/` and `/health`. Domain APIs belong to their
domain controllers.

## Offline Walkthrough

### Entry points

- `POST /agent/run-pipeline`: synchronous manual run.
- `POST /agent/schedule-pipeline`: enqueue when BullMQ is enabled.
- `SchedulerService`: creates the optional Redis queue and repeat job.

### Execution

`OfflineAgentService.runPipeline()`:

1. Runs CoinMarketCap/CoinGecko, TradingView, and Dune adapters concurrently.
2. Each crawler persists its own source rows.
3. `DataCleanerService` removes exact-key duplicates and invalid negative
   values.
4. `DataNormalizerService` currently returns the rows unchanged.
5. `LlmAgentService` creates a short market summary or a generic fallback.
6. `StrategyEngineService` runs `SimpleMomentumStrategy`.
7. Analysis and signals are persisted and a `/offline` Socket.IO event is sent.

### Important reality checks

- TradingView and Dune return hard-coded data.
- CoinMarketCap may silently fall through CoinGecko to hard-coded data.
- The LLM sees only five rows and is not the strategy engine.
- RSI signals only occur on rows that already contain RSI and price.
- There is no point-in-time join, feature store, backtest gate, portfolio state,
  or signal expiry.

These signals are advice/research artifacts, not executable orders.

## Online Walkthrough

### Startup

`RealtimeService.onModuleInit()`:

1. Builds a risk policy from environment settings.
2. Probes Pyth and may replace it with a deterministic mock feed.
3. Builds live Solana adapters only when `ENABLE_REAL_DEX=true`; otherwise it
   uses an oracle-tracking mock DEX.
4. Optionally adds Injective Helix and an MCP or mock executor.
5. Creates `RealTimeAgentCore` and starts Pyth price broadcasting.

### Prepare path

`POST /realtime/trade/prepare`:

1. `PrepareTradeDtoSchema` parses the request.
2. `RealtimeService` converts UI amounts to native integer units.
3. A `RealtimeTrade(PENDING)` row is created.
4. `RealTimeAgentCore.prepareTrade()` reads an oracle price.
5. `RiskEngine.validateIntent()` checks pair, slippage, amount, freshness, and
   maximum notional.
6. `DexOrderBookAggregator` queries adapters concurrently with timeouts.
7. `NbboEngine` selects the highest bid or lowest ask.
8. `RiskEngine.validateRoute()` checks venue, liquidity, impact, age, and
   oracle deviation.
9. A ready plan is persisted. Jupiter may include an unsigned transaction;
   Injective may include an execution plan.

### Execution path

- Solana: transaction building exists, but wallet signing, submission, and
  confirmation are not wired into the service.
- Injective: `executeInjectiveTrade()` can call a child MCP server when a
  mnemonic is configured; otherwise it produces a simulated hash.
- `POST /realtime/trade/confirm` accepts a client-supplied lifecycle status.
  This supports the demo UI and is not valid production reconciliation.

### Cross-chain path

`CrossChainArbStrategy` compares Solana and Injective midpoint snapshots and
subtracts a fixed bridge cost. In demo mode an intentional Injective mock
premium creates visible spreads. It does not model:

- simultaneous inventory on both chains;
- transfer and finality time;
- funding, borrow, withdrawal, or bridge limits;
- fill probability and depth across the requested size;
- legging and rebalancing risk.

Treat this as a research scanner.

## Data Model

- `MarketData`: source observations and optional indicators.
- `AnalysisResult`: LLM-generated text.
- `TradeSignal`: offline strategy advice.
- `RealtimeTrade`: current demo lifecycle and serialized plan.
- `RealtimeAgentLog`: structured lifecycle events.
- `BacktestResult` and `CrawlerJob`: defined but not used by the current
  runtime.

Prisma `db:push` is the current demo schema path. SQL migrations are a parallel
manual path and can drift; production should choose migrations as the sole
deployment mechanism.

## Contract Walkthrough

`contracts/programs/trade_execution/src/lib.rs` provides:

- multisig initialization and policy updates;
- trade record creation and approvals;
- output, route hash, DEX program, and oracle-deviation checks;
- cancellation and event records.

It is not currently called by the backend. `execute_trade` validates a supplied
execution report but does not perform the DEX CPI itself. `limit_price` is
accepted in `TradeParams` but not stored or checked. There are no Anchor tests,
so the program must remain a prototype.

## Frontend Walkthrough

- `InsightsPage.tsx`: runs the offline pipeline and displays rows, analysis,
  signals, and the cross-chain scanner.
- `LiveTradingPage.tsx`: requests snapshots and plans, displays trade records,
  and exposes simulated lifecycle buttons.
- `lib/api.ts`: REST types and calls.
- `lib/websocket.ts`: one Zustand store for `/realtime` and `/offline`.

The frontend is an operator/demo console. It is not a wallet or execution
authority.

## Known Cleanup and Risk Register

### Must fix before paper trading

- Add explicit `live | simulated | fallback` provenance to all market data,
  quotes, signals, and executions.
- Prevent fallback data from entering a live execution policy.
- Guard trade-state transitions and add idempotency keys.
- Replace or remove hard-coded TradingView and Dune sources.
- Implement real normalization, feature timestamps, and signal expiry.

### Must fix before testnet funds

- Remove client-authoritative confirmation.
- Add signing isolation, submitter, independent reconciler, and RPC fallback.
- Validate balances, positions, daily loss, exposure, and open-order limits.
- Add integration tests against real quote payload fixtures.
- Add Anchor tests and connect or remove the contract layer.

### Simplification candidates

- Remove unused dependencies and architecture claims for Temporal, Winston,
  Anthropic, wallet adapters, and chart libraries unless a current packet uses
  them.
- Consolidate the two database schema paths around Prisma migrations.
- Keep Agent Identity and cross-chain MCP outside the critical execution path
  until the single-chain engine is reliable.

## Suggested Reading Order

1. [ARCHITECTURE.md](ARCHITECTURE.md)
2. `backend/src/app.module.ts`
3. `backend/src/scheduler/offline-agent.service.ts`
4. `backend/src/realtime/realtime.service.ts`
5. `backend/src/agent/realtime-agent-core.ts`
6. `backend/src/risk/risk-engine.ts`
7. `backend/prisma/schema.prisma`
8. [offline-agent-design.md](offline-agent-design.md)
9. [realtime-agent-design.md](realtime-agent-design.md)
10. [OP_Pending_Items.md](OP_Pending_Items.md)
