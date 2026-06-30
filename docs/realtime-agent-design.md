# Realtime Agent System Design

## Overview
The Realtime Agent System is responsible for handling real-time trading with nBBO (National Best Bid/Offer) price optimization across multiple Solana DEXs.

## Core Components

### 1. Backend API & WebSocket Setup
- Add new API endpoints for trade initiation
- Add WebSocket server for real-time trade status notifications
- Integrate with existing NestJS module structure

### 2. Pyth Price Feeds Integration
- Connect to Pyth Network real-time price feeds
- Add subscription logic for multiple token pairs
- Parse and validate incoming price updates

### 3. DEX Order Book Aggregation
- Integrate with Jupiter Aggregator SDK
- Add Raydium SDK integration for order book
- Add Orca SDK integration for order book
- Implement parallel DEX querying for best performance

### 4. nBBO Engine Implementation
- Logic to aggregate BID/ASK prices from all DEX sources
- Calculate National Best Bid (highest bid) and Best Ask (lowest ask)
- Select optimal route based on best price and liquidity
- Integrate with backend services

### 5. Real-time Agent Core
- Orchestration service to manage workflow
- Trade validation and risk checks (position size, stop loss, etc.)
- Error handling and retry logic

### 6. Smart Contracts (Anchor)
- Create Solana program for trade execution
- Implement price verification
- Add secure multi-sign wallet integration
- Add Jupiter/Raydium/Orca integration from program
- Log all trade history to on-chain state

### 7. Frontend Integration
- Add trade initiation UI
- Connect to backend WebSocket
- Display real-time trade status and confirmation
- Connect to Solana Wallet Adapter for signing

### 8. Database & Logging
- Extend Prisma schema for trade history (if needed)
- Add logging for all real-time agent actions
- Add Prometheus metrics for latency, DEX performance, etc.

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
