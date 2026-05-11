# Solana Frontier Web3 LLM Agent Architecture

## Overview

This project is a Web3 LLM agent platform for autonomous Solana trading, similar to b.ai. It combines AI-driven insights, real-time market data, and on-chain execution.

## Tech Stack

### Frontend (`/frontend`)

- **Framework**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Wallet Integration**: Solana Wallet Adapter
- **State Management**: Zustand
- **Charts**: TradingView Lightweight Charts
- **API Client**: Axios

### Backend (`/backend`)

- **Runtime**: Node.js 20 + TypeScript
- **API Framework**: NestJS (modular, scalable)
- **LLM Integration**: LangChain (supports OpenAI, Anthropic, local models)
- **Workflow Orchestration**: Temporal (OpenClaw alternative - production-grade workflow engine)
- **Task Scheduling**: BullMQ + Redis
- **Database**: PostgreSQL + TimescaleDB (time-series optimization)
- **ORM**: Prisma
- **Real-time Communication**: WebSockets (Socket.IO)
- **Message Queue**: Redis
- **Data Validation**: Zod

### Smart Contracts (`/contracts`)

- **Framework**: Anchor (Solana)
- **DEX Integrations**: Jupiter, Raydium, Orca
- **Price Aggregation**: Pyth Network

### DevOps

- **Containerization**: Docker + Docker Compose
- **Monitoring**: Prometheus + Grafana
- **Logging**: Winston + ELK Stack (optional)

## High-Level Components

### 1. Frontend (`/frontend`)

- **Agent LLM UI**: Configure LLM vendors, API keys
- **Dashboard**: Monitor trading performance, market insights
- **Strategy Configuration**: Customize trading rules and parameters
- **Real-time Charts**: Display market data and trade history

### 2. Backend (`/backend`)

#### `/backend/api`

- REST API for frontend interactions
- Authentication and authorization
- Agent configuration management

#### `/backend/agents`

- LLM Agent orchestration (LangChain)
- Temporal workflow automation
- Daily strategy updates

#### `/backend/data`

- Market data ingestion layer
- Real-time data streaming from Dune, TradingView, CoinMarketCap, etc.
- Data processing and normalization

#### `/backend/crawlers`

- Web crawlers for collecting data from 3rd-party trade sites
- Scheduled scraping jobs (BullMQ)

#### `/backend/strategies`

- Trading strategy implementations
- nBBO (National Best Bid/Offer) price optimization
- Risk management logic

#### `/backend/db`

- Database models and connections (Prisma)
- Time-series data storage (TimescaleDB)
- Historical data querying

### 3. Smart Contracts (`/contracts`)

- Solana programs for on-chain execution
- Best price execution logic
- Secure trading interactions with DEXs via Jupiter

## Daily Offline Agents Workflow

This workflow runs periodically (daily/hourly) to gather market data, analyze it, and generate investment insights.

```mermaid
sequenceDiagram
    participant Scheduler as BullMQ Scheduler
    participant Crawlers as Crawlers Service
    participant CMC as CoinMarketCap
    participant TV as TradingView
    participant Dune as Dune Analytics
    participant DB as PostgreSQL/TimescaleDB
    participant DataProc as Data Processing Service
    participant LLM as LLM Agent (LangChain)
    participant Strategy as Strategy Engine
    participant Frontend as Frontend UI

    Scheduler->>Crawlers: Trigger daily data collection
    par Collect from multiple sources
        Crawlers->>CMC: Fetch market cap, volume, price data
        CMC-->>Crawlers: Return aggregated market data
        Crawlers->>TV: Fetch chart patterns, indicators
        TV-->>Crawlers: Return technical analysis data
        Crawlers->>Dune: Fetch on-chain analytics
        Dune-->>Crawlers: Return on-chain metrics
    end
    Crawlers->>DB: Store raw market data
    Crawlers->>DataProc: Notify data collection complete
    DataProc->>DB: Query raw data
    DataProc->>DataProc: Clean, normalize, and aggregate data
    DataProc->>DB: Store processed time-series data
    DataProc->>LLM: Send processed data for analysis
    LLM->>DB: Query historical data for context
    LLM->>LLM: Generate market insights & risk analysis
    LLM->>Strategy: Provide AI-driven recommendations
    Strategy->>Strategy: Evaluate against trading rules
    Strategy->>DB: Store investment advice & trade signals
    Strategy->>Frontend: Notify via WebSocket
    Frontend->>Frontend: Display insights to user
```

## Real-time Agents Workflow (nBBO Price Execution)

This workflow handles real-time trading using an nBBO-style execution engine for best-price discovery across multiple Solana liquidity sources.  
The nBBO engine runs off-chain to compare executable quotes, route quality, slippage, liquidity depth, fees, and latency before preparing a transaction for user approval or delegated execution.

```mermaid
sequenceDiagram
    participant User as User
    participant Frontend as Frontend UI
    participant API as Backend API
    participant RTAgent as Real-time Agent
    participant Risk as Risk & Policy Engine
    participant Pyth as Pyth/Switchboard Price Feeds
    participant Quote as Quote Aggregator
    participant Jupiter as Jupiter Aggregator
    participant Raydium as Raydium / OpenBook Pools
    participant Orca as Orca Whirlpools
    participant nBBO as nBBO Execution Engine
    participant TxBuilder as Transaction Builder
    participant Wallet as User Wallet / Agent Wallet
    participant Solana as Solana Network
    participant Program as Optional Guardrail Program
    participant DB as PostgreSQL/TimescaleDB
    participant WS as WebSocket Gateway

    User->>Frontend: Initiate trade / enable auto-trade rule
    Frontend->>API: Submit trade intent
    API->>RTAgent: Start real-time execution workflow

    RTAgent->>Risk: Validate user settings, max size, slippage, token allowlist
    Risk-->>RTAgent: Approved / rejected

    RTAgent->>Pyth: Read reference price & freshness
    Pyth-->>RTAgent: Return oracle price + confidence interval

    par Fetch executable quotes
        RTAgent->>Jupiter: Request route quote
        Jupiter-->>RTAgent: Return swap route, expected out, price impact
        RTAgent->>Raydium: Request pool/orderbook quote
        Raydium-->>RTAgent: Return executable quote
        RTAgent->>Orca: Request Whirlpool quote
        Orca-->>RTAgent: Return executable quote
    end

    RTAgent->>Quote: Normalize quotes
    Quote->>Quote: Convert to common format: price, fees, depth, route, latency
    Quote-->>nBBO: Send normalized executable quotes

    nBBO->>nBBO: Select best executable bid/offer
    nBBO->>nBBO: Check oracle deviation, slippage, route risk, liquidity depth
    nBBO-->>RTAgent: Return best route + execution constraints

    RTAgent->>TxBuilder: Build versioned transaction
    TxBuilder->>TxBuilder: Add compute budget, priority fee, slippage limit, route instructions

    alt User-approved trade
        TxBuilder-->>Frontend: Return unsigned transaction
        Frontend->>Wallet: Request user signature
        Wallet-->>Frontend: Signed transaction
        Frontend->>API: Submit signed transaction
    else Delegated agent execution
        TxBuilder->>Wallet: Sign using delegated agent wallet / session key
        Wallet-->>TxBuilder: Signed transaction
    end

    API->>Solana: Send signed transaction
    Solana->>Program: Optional guardrail verification
    Program->>Program: Verify max slippage, allowed route, user policy
    Program-->>Solana: Allow / reject execution
    Solana->>Solana: Execute swap route
    Solana-->>API: Return transaction signature + status

    API->>DB: Store trade intent, quote snapshot, route, tx signature, result
    API->>WS: Publish execution update
    WS->>Frontend: Notify pending / confirmed / failed
    Frontend->>User: Display trade result
```

## Data Flow

1. Crawlers and real-time data links fetch market data from various sources
2. Data is ingested and stored in the database
3. LLM agents analyze the data and generate investment insights
4. Trading strategies execute trades using nBBO for best pricing
5. Results are displayed in the frontend UI

## Key Features

### Offline Analysis

- Scheduled data collection from CoinMarketCap, TradingView, Dune
- Historical data aggregation and normalization
- LLM-powered market analysis and insight generation
- Strategy backtesting

### Real-time Trading

- Multi-DEX order book aggregation
- nBBO price calculation and route optimization
- Low-latency trade execution via Solana programs
- Real-time price feeds from Pyth Network
