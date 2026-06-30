-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create market_data table
CREATE TABLE IF NOT EXISTS "market_data" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    token VARCHAR NOT NULL,
    symbol VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    source VARCHAR NOT NULL,
    price NUMERIC,
    volume24h NUMERIC,
    market_cap NUMERIC,
    rsi14 NUMERIC,
    macd_line NUMERIC,
    macd_signal NUMERIC,
    macd_histogram NUMERIC,
    bb_upper NUMERIC,
    bb_middle NUMERIC,
    bb_lower NUMERIC,
    tvl NUMERIC,
    active_addresses INTEGER,
    tx_volume NUMERIC,
    gas_used NUMERIC,
    raw_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_market_data_token_timestamp ON market_data(token, timestamp);
CREATE INDEX IF NOT EXISTS idx_market_data_source_timestamp ON market_data(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timestamp ON market_data(symbol, timestamp);

-- Create analysis_result table
CREATE TABLE IF NOT EXISTS "analysis_result" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    token VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    type VARCHAR NOT NULL,
    content TEXT NOT NULL,
    score NUMERIC,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_analysis_result_token_timestamp ON analysis_result(token, timestamp);
CREATE INDEX IF NOT EXISTS idx_analysis_result_type_timestamp ON analysis_result(type, timestamp);

-- Create trade_signal table
CREATE TABLE IF NOT EXISTS "trade_signal" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    token VARCHAR NOT NULL,
    symbol VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    action VARCHAR NOT NULL,
    reason TEXT NOT NULL,
    price NUMERIC NOT NULL,
    strategy VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    executed_price NUMERIC,
    executed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_trade_signal_token_timestamp ON trade_signal(token, timestamp);
CREATE INDEX IF NOT EXISTS idx_trade_signal_status_timestamp ON trade_signal(status, timestamp);

-- Create backtest_result table
CREATE TABLE IF NOT EXISTS "backtest_result" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    strategy VARCHAR NOT NULL,
    parameters JSONB,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    total_return NUMERIC NOT NULL,
    win_rate NUMERIC NOT NULL,
    max_drawdown NUMERIC NOT NULL,
    trades INTEGER NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create crawler_job table
CREATE TABLE IF NOT EXISTS "crawler_job" (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    source VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    error TEXT,
    data_count INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Enable TimescaleDB if available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        -- Convert market_data to a hypertable
        PERFORM create_hypertable('market_data', 'timestamp', if_not_exists => TRUE);
    END IF;
END
$$;
