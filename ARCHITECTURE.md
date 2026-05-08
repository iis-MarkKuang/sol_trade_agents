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

This workflow handles real-time trading with nBBO (National Best Bid/Offer) price optimization across multiple DEXs.

```mermaid
sequenceDiagram
    participant User as User
    participant Frontend as Frontend UI
    participant API as Backend API
    participant RTAgent as Real-time Agent
    participant Pyth as Pyth Price Feeds
    participant DEX1 as Jupiter Aggregator
    participant DEX2 as Raydium
    participant DEX3 as Orca
    participant nBBO as nBBO Engine
    participant Contract as Solana Program
    participant Wallet as User Wallet

    User->>Frontend: Initiate trade or auto-trade triggers
    Frontend->>API: Send trade request
    API->>RTAgent: Start real-time execution workflow
    RTAgent->>Pyth: Subscribe to real-time price feeds
    Pyth-->>RTAgent: Stream price updates
    par Query multiple DEXs
        RTAgent->>DEX1: Get order book (BID/ASK)
        DEX1-->>RTAgent: Return order book data
        RTAgent->>DEX2: Get order book (BID/ASK)
        DEX2-->>RTAgent: Return order book data
        RTAgent->>DEX3: Get order book (BID/ASK)
        DEX3-->>RTAgent: Return order book data
    end
    RTAgent->>nBBO: Aggregate BID/ASK from all sources
    nBBO->>nBBO: Calculate best BID & best ASK
    nBBO-->>RTAgent: Return nBBO prices + optimal route
    RTAgent->>RTAgent: Validate trade & risk checks
    RTAgent->>Contract: Send execute trade instruction with nBBO price
    Contract->>Contract: Verify price & trade parameters
    Contract->>Wallet: Request signature
    Wallet-->>Contract: Approve & sign
    Contract->>DEX1/DEX2/DEX3: Execute trade via best route
    DEX1/DEX2/DEX3-->>Contract: Return trade result
    Contract-->>RTAgent: Trade executed successfully
    RTAgent->>DB: Log trade history
    RTAgent->>Frontend: Notify trade completion via WebSocket
    Frontend->>User: Display trade confirmation
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
