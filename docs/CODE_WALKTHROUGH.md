# Code Walkthrough: Solana Frontier Web3 LLM Trading Agent

## 1. 概述 (Overview)

本项目是一个全栈的 Web3 LLM 交易 Agent 平台，支持 Solana 与 Injective 跨链套利，核心包括两个主要子系统：
- **Offline Agent (离线分析代理)**：负责每日/定期的数据抓取、LLM分析和策略信号生成。
- **Realtime Agent (实时交易代理)**：负责监听预言机（Pyth）、进行跨 DEX (Jupiter, Raydium, Orca, Helix) 的 nBBO 聚合比价，并执行链上交易（含跨链套利）。

本项目采用前后端分离架构，配合 Supabase 数据库和可选的智能合约层。

## 2. 目录结构导览 (Directory Structure)

```text
sol_trade_agent/
├── backend/            # 后端核心逻辑 (NestJS)
├── frontend/           # 前端用户界面 (React + Vite)
├── contracts/          # 智能合约 (Solana Anchor)
├── supabase/           # 数据库配置与迁移文件
└── docs/               # 文档库
```

### 2.1 后端服务 (`backend/`)
后端采用 **NestJS** 框架构建，按模块化划分。入口文件为 `backend/src/main.ts`。
主要目录及模块：

- **`src/agents/` (LLM 代理引擎)**:
  - 包含 `llm-factory.ts`：支持 OpenAI 与 Azure OpenAI 的大语言模型工厂，用于生成市场洞察和策略建议。
- **`src/crawlers/` (数据抓取与爬虫)**:
  - 抓取 CoinMarketCap, Dune, TradingView 等数据，通过 BullMQ 调度 (`scheduler/`)。
- **`src/data/` (数据处理层)**:
  - 对抓取的数据进行清洗 (DataCleaner) 和标准化 (DataNormalizer)。
- **`src/dex/` & `src/oracle/` (DEX 与预言机接入)**:
  - `jupiter-adapter.ts`, `raydium-adapter.ts`, `injective-helix-adapter.ts`：跨链 DEX 适配器。
  - `injective-pyth-adapter.ts`：Pyth 预言机喂价服务接入。
- **`src/nbbo/` (最优比价引擎)**:
  - `engine.ts`：聚合各 DEX 深度，计算 nBBO（National Best Bid/Offer）最优报价。
- **`src/realtime/` (实时代理核心)**:
  - `realtime-agent-core.ts`：处理实时交易准备与风险控制（Risk Engine）。
  - 包含 `agent-mcp-server.service.ts`：暴露 Injective MCP Server 供其他 Agent 调用。
  - `cross-chain-agent.service.ts`：基于 LangChain 提供的跨链套利分析助手。
- **`src/agent/` (Agent 身份认证)**:
  - `injective-agent-identity.service.ts`：处理 ERC-8004 代理身份认证和注册，与 Injective 身份系统交互。
- **`src/strategy/` (交易策略层)**:
  - 实现具体的量化策略（如 `simple-momentum.strategy.ts`, `cross-chain-arb.strategy.ts`）。
- **`src/prisma/`**:
  - `schema.prisma`：定义 Postgres 数据库模型，并提供 Prisma 客户端服务。

### 2.2 前端界面 (`frontend/`)
基于 **React 18 + Vite + TailwindCSS**。入口文件为 `frontend/src/main.tsx`。
- **`src/pages/InsightsPage.tsx`**：离线 Agent 面板，展示数据爬取结果、LLM分析和策略信号。
- **`src/pages/LiveTradingPage.tsx`**：实时交易面板，连接 WebSocket 显示实时价格，允许用户配置交易并展示 nBBO 计算过程和跨链执行流。
- **`src/lib/`**：包含 API 请求与 WebSocket 通信工具。

### 2.3 数据库 (`supabase/`)
基于 **Supabase** 提供的 PostgreSQL：
- **`migrations/`**：存放数据库初始建表 SQL（如 `00000000000000_init.sql`）。
- 后端主要通过 Prisma 的 `db:push` 直接映射表结构，migration 为手动备用。

## 3. 核心执行流分析 (Core Workflows)

### 3.1 离线数据分析管线 (Offline Pipeline)
1. **触发**: 由 `SchedulerService` 定时触发或在前端 Insights 页面手动点击 "Run pipeline now" 触发 (`POST /agent/run-pipeline`)。
2. **抓取**: 爬虫并发抓取 (CMC, TV, Dune)。
3. **清洗**: `DataCleanerService` 与 `DataNormalizerService` 整理数据。
4. **分析**: 调用 `LlmAgentService` 进行市场分析，并调用 `StrategyEngineService` 生成买卖信号 (Trade Signals)。

### 3.2 实时跨链交易执行 (Realtime & Cross-chain)
1. **询价准备**: 前端发起交易意图 (`POST /realtime/trade/prepare`)。
2. **nBBO 聚合**: `NbboEngine` 获取 Pyth 价格，并发查询 Solana DEX 适配器与 Injective Helix 适配器。
3. **风控与打包**: 通过 `RiskEngine` 验证滑点和仓位后，若路由在 Solana 则生成 `JupiterTransactionBuilder` (未签名 tx)，若在 Injective 则生成 `InjectiveExecutionPlan`。
4. **执行 (Injective)**: 若为跨链路由，系统将调用官方 Injective MCP Server (`InjectiveMcpClient`) 完成最终的签名和链上广播。

## 4. 关联文档阅读顺序 (Linked Documentation)

为了更好地理解项目设计，建议按以下顺序阅读：

1. **[README.md](../README.md)**: 项目快速启动指南及整体架构介绍。
2. **[AI 智能体行为规范 (AGENTS.md)](AGENTS.md)**: 规范 AI Agent 在本仓库中的开发准则。
3. **[架构总览 (ARCHITECTURE.md)](ARCHITECTURE.md)**: 高层系统架构图和组件流转图。
4. **[离线 Agent 设计 (offline-agent-design.md)](offline-agent-design.md)**: 离线抓取、数据清洗及大模型分析工作流详解。
5. **[实时 Agent 设计 (realtime-agent-design.md)](realtime-agent-design.md)**: nBBO 比价引擎、实时执行流及跨链套利扩展细节。
5. **[操作手册 (MANUAL.md)](MANUAL.md)**: 部署、环境配置与测试用例指南。
6. **[项目进度 (progress-tracker.md)](progress-tracker.md)**: 任务 Packet 切分与 OP 阻塞点管理追踪。

---
*本文档为代码级导览，请结合上述关联文档进行具体模块的深入开发。*
