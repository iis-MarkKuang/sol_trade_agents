# UsageLedger Roadmap & Ticket Harness

This file is the harness for the UsageLedger work stream. It defines the
ticket template, global red lines, delegation policy, and the ordered roadmap.
Individual atomic tickets live in `docs/tickets/usage-ledger/T-NN.md`.

Design reference: [usage-ledger-design.md](usage-ledger-design.md).
Operator decisions blocking this work: OP-11..OP-15 in
[OP_Pending_Items.md](OP_Pending_Items.md).

## Ticket template

Every ticket file uses this structure:

```markdown
# T-NN: <short title>

Status: not-started | in-progress | review | done | blocked
Delegation: high | medium | low      # recommended executor model tier
Depends on: T-NN, T-nn                 # ticket ids that must land first
Blocks: T-nn                           # tickets waiting on this one

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

1. **No real paid API calls.** Dune, CMC, DeepSeek, OpenAI, Azure, and JEV
   must stay mocked/fixture in all tests. Any ticket that needs a live call
   must state the expected credit/token cost and get operator approval first.
2. **No secrets in source, logs, prompts, or commits.** Keys stay in
   `backend/.env` (gitignored). Never print them.
3. **No machine proxy hardcoded.** `HTTPS_PROXY` is a local env concern; do
   not write `127.0.0.1:7897` or any proxy into source.
4. **No float for cost-critical counts.** Token counts, credit counts, and
   execution counts are integers. Decimal money uses `Decimal` (decimal.js),
   not `number`.
5. **Do not reset, checkout, restore, or rewrite existing uncommitted
   work.** Read before write; extend, do not replace, existing tested code.
6. **Do not commit or push** unless the operator explicitly asks.
7. **LLM/JEV must not gain execution authority.** This stream is cost
   accounting only; it never touches the trade execution path.
8. **No silent mock in non-demo environments.** Any mock/fallback must be
   explicitly labeled and env-gated, matching AGENTS.md.

## Delegation policy

Tickets are classified by the model tier recommended to execute them. The
operator makes the final call; these are defaults.

| Tier | Use when | Tickets |
|---|---|---|
| **low** | Bounded, follows an existing pattern, no cross-module judgment, testable in isolation | T-01, T-02, T-03 |
| **medium** | Touches one or two modules, needs some design judgment but scope is clear | T-06, T-07, T-08, T-09 |
| **high** | Touches the hot path, spans PG+Redis, or modifies live budget logic where a regression could silently over-spend | T-04, T-05 |

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
  T-01  Prisma UsageEvent model + migration
  T-02  Redis client module (shared ioredis instance)
  T-03  ConfigService usageLedger config block + tests
  T-04  UsageLedgerService core (reserve / record / rebuild / budget check)

Phase 1 — Provider integration (after T-04; T-05 first, rest parallelizable)
  T-05  Dune: migrate in-process budget to UsageLedger      [high, first]
  T-06  CMC: add daily credit budget via UsageLedger        [parallel after T-05 lands]
  T-07  LLM: persist usage_metadata via UsageLedger        [parallel]
  T-08  JEV: persist usage via UsageLedger (optional)       [parallel, lowest priority]

Phase 2 — Observability (after at least T-05)
  T-09  Usage summary read API endpoint
```

Dependency graph:

```text
T-01 ─┐
T-02 ─┼─> T-04 ─┬─> T-05 ─┬─> T-06
T-03 ─┘         │         ├─> T-07
                │         └─> T-08
                └─────────────> T-09
```

## Status legend

- `not-started` — defined, not begun
- `in-progress` — assigned and being worked
- `review` — diff written, awaiting orchestrator/operator check
- `done` — verified, tests pass, build pass, diff clean
- `blocked` — waiting on an OP decision or a prior ticket

## OP decision gates

The roadmap can proceed through Phase 0 and T-05 wiring **behind the
`USAGE_LEDGER_ENABLED=false` flag** without resolving OP-11..OP-15, because
the feature stays off by default. Turning the flag on in any non-demo
environment requires:

- OP-11 (over-limit policy)
- OP-12 (Redis-down fallback)
- OP-13 (CMC metering unit)
- OP-14 (concrete hard limits and warning thresholds)
- OP-15 (whether caps roll up under OP-05)

Until those are set, every ticket must default the feature flag to `false`
and keep current behavior unchanged when it is off.
