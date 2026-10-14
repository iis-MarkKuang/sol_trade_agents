-- UsageLedger: provider-neutral usage event log. PG is the source of truth;
-- Redis only caches daily aggregates for the hot-path budget check.
-- See docs/usage-ledger-design.md and docs/usage-ledger-roadmap.md.
CREATE TABLE IF NOT EXISTS "usage_event" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    provider TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    model TEXT,
    "queryKey" TEXT,
    status TEXT NOT NULL,
    units INTEGER NOT NULL,
    "unitKind" TEXT NOT NULL,
    "reservationId" TEXT,
    metadata JSONB,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_event_provider_eventdate
    ON "usage_event" (provider, "eventDate");
CREATE INDEX IF NOT EXISTS idx_usage_event_provider_eventdate_model
    ON "usage_event" (provider, "eventDate", model);
CREATE INDEX IF NOT EXISTS idx_usage_event_provider_eventdate_querykey
    ON "usage_event" (provider, "eventDate", "queryKey");
CREATE INDEX IF NOT EXISTS idx_usage_event_reservationid
    ON "usage_event" ("reservationId");
