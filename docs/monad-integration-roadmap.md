# Monad Integration Roadmap & Ticket Harness

This file is the harness for the Monad chain integration work stream. It defines
the ticket template, global red lines, delegation policy, and the ordered roadmap.
Individual atomic tickets live in `docs/tickets/monad-integration/M-NN.md`.

Design reference: [monad-integration-research.md](monad-integration-research.md).
Template: mirrors [usage-ledger-roadmap.md](usage-ledger-roadmap.md).

## Ticket template

Every ticket file uses this structure:

```markdown
# M-NN: <short title>

Status: not-started | in-progress | review | done | blocked
Delegation: high | medium | low      # recommended executor model tier
Depends on: M-NN, M-nn                 # ticket ids that must land first
Blocks: M-nn                           # tickets waiting on this one

## Goal
<one or two sentences: what concrete, verifiable thing this ticket delivers>

## Non-goals
<explicit list of what this ticket must NOT do, to keep it atomic>

## Constraints (red lines)
<rules that must not be crossed; if any is touched, stop and report>
- <red line 1>
- <red line 2>

## Context
<prior tickets / existing code / docs that this builds on or modifies>

## Verification
<how to prove it works: commands to run, expected output, manual checks>

## Tests
<specific test files and cases to add or update; mock-only unless stated>
```

## Global red lines (apply to every ticket in this stream)

These are non-negotiable. If a ticket needs to cross one, stop and report to
the operator instead of proceeding.

1. **No real paid API calls or real on-chain transactions in tests.** 0x/1inch,
   Monad RPC `eth_call`, and any signing must stay mocked/fixture in all tests.
   Real signing requires `MONAD_PRIVATE_KEY` and is never exercised by CI.
2. **No secrets in source, logs, prompts, or commits.** Keys stay in
   `backend/.env` (gitignored). Never print them.
3. **No machine proxy hardcoded.** `HTTPS_PROXY` is a local env concern; do
   not write `127.0.0.1:7897` or any proxy into source.
4. **No float for cost-critical counts.** Token amounts and counts are
   integers/`bigint`; decimal money uses `Decimal` (decimal.js), not `number`.
5. **Do not reset, checkout, restore, or rewrite existing uncommitted
   work.** Read before write; extend, do not replace, existing tested code.
6. **Do not commit or push** unless the operator explicitly asks.
7. **LLM/JEV must not gain execution authority.** Monad execution is a
   deterministic code path; the LLM only proposes, never signs.
8. **No silent mock in non-demo environments.** Any mock/fallback must be
   explicitly labeled and env-gated (`ENABLE_MONAD=false` by default),
   matching AGENTS.md.
9. **Do not break the existing Solana/Injective paths.** When `ENABLE_MONAD=false`
   the system must behave identically to today. All new code is additive.

## Delegation policy

Tickets are classified by the model tier recommended to execute them. The
operator makes the final call; these are defaults.

| Tier | Use when | Tickets |
|---|---|---|
| **low** | Bounded, follows an existing pattern, no cross-module judgment, testable in isolation | M-01, M-02 |
| **medium** | Touches one or two modules, needs some design judgment but scope is clear | M-03, M-04, M-07, M-08 |
| **high** | Touches the hot path, modifies the nBBO/arb/execution routing, or spans multiple chains where a regression could mis-route a trade | M-05, M-06 |

Delegation rules:

- A delegated ticket still must pass its own Verification and Tests sections
  before being marked `done`.
- The orchestrator (this agent) reviews the diff of any delegated ticket
  before accepting it, checking the global red lines and `git diff --check`.
- A `high` ticket is never delegated without operator confirmation; prefer to
  run it in this session.

## Roadmap

```text
Phase 0 — Foundation (sequential; each blocks the next)
  M-01  Chain abstraction + config (types.ts, config.service.ts, .env.example)
  M-02  Token registry (MONAD_TOKENS, MONAD_PAIRS, chainOfPair)

Phase 1 — Adapter + executor (after M-01; M-02 needed by M-03)
  M-03  Monad DEX adapter (0x/1inch API + mock fallback)
  M-04  Monad executor (viem signer + mock)

Phase 2 — Wiring + strategy (after M-03, M-04)
  M-05  Realtime wiring (buildMonadAdapter/Executor + RealTimeAgentCore routing)
  M-06  Arb strategy generalization (N-chain pairwise)

Phase 3 — UX + docs (after M-05)
  M-07  Frontend (Monad pairs in dropdown + chain badge)
  M-08  Integration test + docs (e2e mock demo, README + MANUAL update)
```

Dependency graph:

```text
M-01 ─┬─> M-03 ─┐
      └─> M-04 ─┼─> M-05 ─┬─> M-07 ─┐
M-02 ──> M-03   │         │         ├─> M-08
               │         └─> M-06 ─┘
               └─────────────> M-08
```

## Status legend

- `not-started` — defined, not begun
- `in-progress` — assigned and being worked
- `review` — diff written, awaiting orchestrator/operator check
- `done` — verified, tests pass, build pass, diff clean
- `blocked` — waiting on an OP decision or a prior ticket

## OP decision gates

The roadmap can proceed through Phase 0 and Phase 1 **behind the
`ENABLE_MONAD=false` flag** without resolving open questions, because the
feature stays off by default. Turning the flag on in any non-demo environment
requires:

- Verified MON/USD Pyth feed id (or a documented oracle fallback for MON pairs).
- A paid Monad RPC endpoint (public `rpc.monad.xyz` is rate-limited).
- A 0x or 1inch API key for the real DEX adapter (or a decision to use the
  keyless Uniswap V3 Quoter path).

Until those are set, every ticket must default `ENABLE_MONAD=false` and keep
current behavior unchanged when it is off.
