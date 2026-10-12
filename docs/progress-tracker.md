# Project Progress Tracker

Status is based on verified runtime behavior, not file presence.

Legend: `Done`, `Partial`, `Demo`, `Not started`, `Blocked by OP`.

## Packet 0: Truthful Prototype

| Deliverable | Status | Evidence / next action |
|---|---|---|
| Single NestJS runtime | Done | `backend/src/main.ts`; obsolete standalone server removed |
| Canonical domain APIs | Done | Offline under `/agent`, online under `/realtime` |
| Architecture and walkthrough | Done | `ARCHITECTURE.md`, `CODE_WALKTHROUGH.md` |
| Explicit live/mock provenance | Not started | Add environment/source fields to persisted objects |
| Live mode fails closed | Not started | Remove automatic mock fallback from live policy |
| Authenticated write APIs | Not started | Required before any public deployment |
| Guarded trade-state transitions | Not started | Replace client-authoritative confirmation |

## Packet 1: Offline Research Foundation

| Deliverable | Status | Evidence / next action |
|---|---|---|
| CMC/CoinGecko ingestion | Partial | Live with static fallback |
| TradingView ingestion | Demo | Hard-coded rows |
| Dune ingestion | Demo | Hard-coded rows |
| Cleaning | Partial | Basic duplicate/negative-value filters |
| Normalization/features | Demo | Pass-through implementation |
| LLM summary | Partial | Configurable model with generic fallback |
| Deterministic strategy | Demo | RSI threshold only |
| Point-in-time dataset | Not started | Needed before meaningful backtests |
| Backtest and walk-forward gate | Not started | `BacktestResult` currently unused |
| Versioned, expiring signal | Not started | Define signal contract and durable outbox |

## Packet 2: Paper-Trading Engine

| Deliverable | Status | Evidence / next action |
|---|---|---|
| Pyth parser and subscription | Partial | Works, but reconnect/heartbeat/fallback need hardening |
| DEX adapter abstraction | Done | Jupiter, Raydium, Orca, Injective, mock |
| Adapter production validation | Not started | Add real payload fixtures and integration tests |
| nBBO route selection | Done | Highest bid / lowest ask |
| Basic pre-trade risk | Partial | Missing portfolio, loss, exposure, and open-order checks |
| Trade persistence/events | Partial | Demo lifecycle persisted and broadcast |
| Paper executor | Demo | UI and Injective mock can synthesize statuses/hashes |
| Idempotent state machine | Not started | Required for continuous operation |
| Position/PnL ledger | Not started | Required for sizing and reconciliation |
| Operational metrics | Not started | Define latency and error SLOs after OP-02 |

## Packet 3: Solana Testnet Execution

| Deliverable | Status | Evidence / next action |
|---|---|---|
| Jupiter unsigned transaction | Partial | Builder exists |
| Wallet signing isolation | Not started | Blocked by custody decision OP-03 |
| Simulation and submission | Not started | Add idempotent submitter |
| RPC endpoint fallback | Not started | Multiple providers and backoff required |
| Confirmation/finality reconciler | Not started | Must be independent of client |
| Balance reservation | Not started | Prevent concurrent overspend |
| Anchor guardrail program | Demo | Compiles, no tests, not called by backend |

## Packet 4: Limited Production

| Deliverable | Status |
|---|---|
| Strategy promotion criteria | Blocked by OP |
| Capital and loss limits | Blocked by OP |
| Kill switches and alerts | Not started |
| Incident/runbook documentation | Not started |
| Small capped mainnet rollout | Blocked by OP |

## Deferred Scope

Injective identity, MCP interoperability, and cross-chain arbitrage remain
experimental. Cross-chain live execution should begin only after single-chain
submission, reconciliation, accounting, and incident handling are reliable.

See [OP_Pending_Items.md](OP_Pending_Items.md) for decisions requiring operator
confirmation.
