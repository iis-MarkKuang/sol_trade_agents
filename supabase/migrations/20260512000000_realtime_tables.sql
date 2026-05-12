-- Realtime trade lifecycle persisted by the realtime agent.
CREATE TABLE IF NOT EXISTS "realtime_trade" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "intentId" TEXT,
    "userPubkey" TEXT,
    pair TEXT NOT NULL,
    side TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "maxSlippageBps" INTEGER NOT NULL,
    status TEXT NOT NULL,
    "selectedDex" TEXT,
    "oraclePrice" NUMERIC,
    "executionPrice" NUMERIC,
    "minOutAmount" TEXT,
    "txSignature" TEXT,
    "rejectionReason" TEXT,
    plan JSONB,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_trade_user_createdat
    ON "realtime_trade" ("userPubkey", "createdAt");
CREATE INDEX IF NOT EXISTS idx_realtime_trade_status_createdat
    ON "realtime_trade" (status, "createdAt");
CREATE INDEX IF NOT EXISTS idx_realtime_trade_pair_createdat
    ON "realtime_trade" (pair, "createdAt");

-- Structured agent log events; nullable tradeId so we can also record
-- system-level events that aren't bound to a specific trade.
CREATE TABLE IF NOT EXISTS "realtime_agent_log" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tradeId" UUID REFERENCES "realtime_trade"(id) ON DELETE SET NULL,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    message TEXT,
    metadata JSONB,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_agent_log_trade_createdat
    ON "realtime_agent_log" ("tradeId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_realtime_agent_log_level_createdat
    ON "realtime_agent_log" (level, "createdAt");
