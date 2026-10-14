# UsageLedger Design Sketch

Status: **design only**. No Prisma migration, no implementation. Awaits
operator decisions in [OP_Pending_Items.md](OP_Pending_Items.md) OP-11..OP-15.

## Goal

A provider-neutral, restart-safe, multi-instance usage ledger so that paid
API budgets (Dune executions, CMC credits, LLM/JEV tokens) survive process
restarts and are shared across backend instances. Today every budget is
in-process and resets on restart; LLM usage is only logged.

## Non-goals

- Not a trade ledger, not a position ledger, not an audit trail for orders.
- Not a replacement for the existing in-memory caches; caches stay, the
  ledger records what actually happened and drives budget checks.
- Not a billing system; it is an internal cost-control record.

## Source of truth split

- **PostgreSQL**: append-only event log. The only durable record. Every
  reserved, actual, failed, and cache-hit event is written here.
- **Redis**: fast atomic daily counters for the hot path (budget check before
  a paid call). Redis is *not* the source of truth; it is a cache of the PG
  aggregates. On cold start, counters are rebuilt from PG by summing the
  current UTC day.

This mirrors the architecture rule: "Use PostgreSQL as the source of truth.
Redis/BullMQ may schedule work but must not be the only record."

## Schema sketch (Prisma, not yet added to schema.prisma)

```prisma
model UsageEvent {
  id           String   @id @default(dbgenerated("uuid_generate_v4()"))
  provider     String   // "dune" | "coinmarketcap" | "llm" | "jev"
  eventDate    DateTime @db.Date   // UTC date bucket for daily aggregation
  model        String?  // LLM/JEV model name; null for dune/cmc
  queryKey     String?  // Dune SQL hash or CMC endpoint tag; null for llm
  status       String   // "reserved" | "actual" | "failed" | "cache_hit"
  units        Int      // executions | credits | tokens (provider-specific)
  unitKind     String   // "executions" | "credits" | "tokens"
  reservationId String? // links reserved -> actual/failed; null for cache_hit
  metadata     Json?
  createdAt    DateTime @default(now())

  @@map("usage_event")
  @@index([provider, eventDate])
  @@index([provider, eventDate, model])
  @@index([provider, eventDate, queryKey])
  @@index([reservationId])
}
```

Notes:

- `eventDate` is a `Date` (date-only) so daily sums are cheap and timezone
  stable (UTC).
- `units` is an integer; token counts and credit counts are integers already.
  No float for cost-critical numbers.
- `reservationId` lets a `reserved` row be matched to its `actual` or
  `failed` follow-up so over-counted reservations can be reconciled.
- `cache_hit` rows have `units = 0` and exist only for observability; they do
  not consume budget.

## Budget config sketch (extends ConfigService, not yet added)

```ts
get usageLedger() {
  return {
    enabled: booleanFromString(false),       // feature flag; off = current behavior
    dune: {
      hardLimitPerDay: numberFromString(8),    // executions
      warningPct: numberFromString(80),        // percent of hard limit
    },
    coinmarketcap: {
      hardLimitPerDay: numberFromString(1000), // credits (OP-13: unit TBD)
      warningPct: numberFromString(80),
    },
    llm: {
      hardLimitPerDay: numberFromString(50_000), // tokens
      warningPct: numberFromString(80),
    },
    jev: {
      hardLimitPerDay: numberFromString(50_000),  // tokens
      warningPct: numberFromString(80),
    },
  };
}
```

All values are operator decisions (OP-14). Defaults here are placeholders.

## Call flow (per paid provider)

```text
1. before paid call:
   - check Redis atomic INCR for (provider, date) -> current count
   - if count > hardLimit: reject (OP-11: fail closed vs cache-only)
   - if count >= hardLimit * warningPct/100: log warning
   - write a `reserved` UsageEvent (units = estimated or 1)
   - get reservationId

2. paid call happens (existing code unchanged)

3. after call:
   - success: write `actual` UsageEvent with real units + reservationId
   - failure: write `failed` UsageEvent (units = 0 or partial) + reservationId

4. cache hit (no paid call):
   - write `cache_hit` UsageEvent (units = 0) for observability only
```

Step 1's Redis INCR and the `reserved` PG write are not atomic together. The
ledger tolerates orphan `reserved` rows; a reconciliation job (future) can
expire stale reservations older than a TTL. This is acceptable because the
hard limit is enforced by Redis, and PG is the audit record, not the gate.

## Redis unavailable (OP-12)

Two options, pending operator decision:

- **Degrade to PG-only**: budget check becomes a `SELECT sum(units)` on
  `usage_event` for `(provider, eventDate)`. Slower and non-atomic under
  concurrency, but never loses the budget. Recommended default.
- **Refuse paid calls**: fail closed until Redis returns. Safest for cost,
  worst for availability.

## Integration order (smallest first)

1. **Dune**: replace `assertExecutionBudget`'s in-memory `executionsToday`
   with Redis counter + PG `reserved`/`actual`/`failed` writes. This is the
   only provider with a live in-process budget today, so it is the cleanest
   first cut and the one that most clearly benefits from persistence.
2. **CMC**: add a daily credit/request budget (currently only TTL caching).
   Metering unit decided by OP-13.
3. **LLM**: persist `usage_metadata` (already logged in
   `llm-agent.service.ts`) as `actual` events instead of log-only.
4. **JEV**: optional; same shape as LLM.

Each step is independently shippable behind the `usageLedger.enabled` flag,
so the feature can land without changing behavior until the operator turns it
on.

## What this sketch deliberately does not do

- Does not add the model to `schema.prisma`.
- Does not write a Prisma or Supabase migration.
- Does not modify `ConfigService`, `DuneCrawlerService`, `LlmAgentService`,
  or any crawler.
- Does not pick a Redis client library; `ioredis` vs `redis` is an
  implementation decision for the step that actually wires Dune.
- Does not define the reconciliation job for orphan reservations.

## Open questions for operator (tracked as OP items)

- OP-11: over-limit policy (fail closed vs cache-only continue)
- OP-12: Redis-down fallback (PG-only vs refuse paid calls)
- OP-13: CMC metering unit (credits vs requests)
- OP-14: concrete per-provider hard limits and warning thresholds
- OP-15: whether UsageLedger caps roll up under OP-05 risk budget approval
