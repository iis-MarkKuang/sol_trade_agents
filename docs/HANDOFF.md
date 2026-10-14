# Coding Agent Handoff

更新时间：2026-10-14  
工作目录：`/Users/markkuang/Documents/work/trae_projects/sol_trade_agent`  
当前分支：`main`  
当前 HEAD：`84ff8fe refactor: clarify architecture and remove duplicate runtime`

## 1. 项目目标

构建一个 near-real-time 跨链量化交易系统：

- Offline research plane：采集市场和链上数据、分析趋势、生成 advisory signals。
- Online execution plane：确定性风控、报价、路由、签名、广播和独立确认。
- LLM 仅负责研究摘要；JEV/typed decision model 仅作为质量门。
- LLM/JEV 不得拥有交易执行权限，也不得绕过确定性风控。

开始工作前必须完整阅读：

1. `docs/AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/CODE_WALKTHROUGH.md`
4. `docs/progress-tracker.md`
5. `docs/OP_Pending_Items.md`

## 2. 当前工作树

工作树包含大量尚未提交但已验证的改动。不要 reset、checkout、restore、覆盖或重新实现它们。

主要改动范围：

- DeepSeek/OpenAI/Azure LLM adapter 与 factory。
- JEV typed decision adapter 和 research quality gate。
- Dune 真实 DuneSQL 查询、轮询和结果映射。
- CoinMarketCap/CoinGecko/mock 数据源降级。
- Offline pipeline、调度器、前端 Insights 和文档更新。
- CMC/Dune 缓存、Dune 日执行预算、LLM 输出 token 上限。

先运行 `git status --short` 和 `git diff` 理解现状。除非用户明确要求，不要提交或推送。

## 3. 已完成并验证

### LLM

- Adapter pattern 支持 `deepseek`、`openai`、`azure`。
- 使用 `LLM_PROVIDER` 和 provider-specific key/model。
- `LLM_MAX_OUTPUT_TOKENS` 默认 `512`，应用到所有 provider。
- Offline analysis 会记录 provider 返回的 token usage。
- 输入只抽样 8 条价格快照和 12 条高 volume 链上记录，避免 prompt 膨胀。

### Decision quality gate

- JEV 与生成式 LLM 使用独立 provider contract。
- 支持 `disabled`、`shadow`、`enforce`。
- TypeSafe/JEV 在当前区域 live 请求曾返回 HTTP 451；mock 和 contract tests 已通过。

### Market data

- CMC：宽覆盖聚合行情主源。
- CoinGecko：CMC 失败时的 fallback。
- Dune：自定义链上 token 买卖量、总量、trade count、chain/platform。
- Dune SQL 使用 `block_date` 分区过滤和 `block_time` rolling window。
- Dune 不静默 fallback；仅 `DUNE_USE_MOCK=true` 时使用 fixture。
- TradingView 仍是 hard-coded/mock source。

### Usage controls

- `COINMARKETCAP_CACHE_TTL_MS=600000`，默认缓存 10 分钟。
- `DUNE_CACHE_TTL_MS=10800000`，默认缓存 3 小时。
- `DUNE_MAX_EXECUTIONS_PER_DAY=8`，当前为单进程、UTC 日预算。
- 同一进程内相同并发请求会合并，缓存命中不调用上游。
- `LLM_MAX_OUTPUT_TOKENS=512`。
- 这些配置在 `backend/.env.example`，规则在 `docs/AGENTS.md`。

## 4. 外部服务状态

- DeepSeek：此前已使用真实 key 验证成功。
- Dune：CLI `~/.local/bin/dune` 已安装并认证；backend live Dune 查询已验证。
- CoinMarketCap：真实 key 返回 HTTP 200、API status 0、3 rows，消耗 1 credit。
- CMC 之前超时的根因是 Node 未继承 macOS 系统代理，不是 key 错误。
- 本地忽略文件 `backend/.env` 已添加：
  `HTTPS_PROXY=http://127.0.0.1:7897`
- 不要输出、复制或提交任何真实 key。不要为了“再确认”重复调用付费 API。

## 5. 最近验证结果

在 `backend/` 下：

```bash
npm test -- --runInBand
npm run build
```

最近结果：

- Jest：13 suites passed，41 tests passed。
- Nest build：passed。
- `git diff --check`：passed。
- 最后一次完整回归未调用真实 CMC、Dune、DeepSeek 或 JEV。

## 6. 尚未完成

优先级从高到低：

1. 持久化 usage ledger：当前 Dune 日预算在进程重启后清零，多实例之间不共享。
2. Usage observability：尚无统一 dashboard/API 展示 CMC credits、Dune executions、LLM/JEV tokens。
3. CMC budget：已有 TTL，但没有持久化日请求预算。
4. JEV live verification：受区域 HTTP 451 限制。
5. TradingView：仍是静态数据。
6. PostgreSQL/Supabase 全流程持久化验证需要本地服务运行。
7. Solana 签名、提交和独立确认仍未完成；当前执行路径含 mock/simulation。
8. Anchor program 虽可编译，但尚未与 backend 完整连接和端到端测试。

建议下一阶段先设计一个 provider-neutral `UsageLedger`：

- PostgreSQL 为 source of truth，按 provider/date/model/query 记录。
- Redis 只用于快速预算检查和原子计数。
- 调用前 reservation，调用后写入实际 usage，失败时记录状态。
- 支持 hard limit、warning threshold、cache hit 和 estimated/actual usage。
- 不要在未确认 schema 和迁移策略前直接实现。

## 7. 安全与工程约束

- 核心金融数值使用 `bigint`、`u64/u128` 或明确 decimal，不用 float 执行交易。
- 所有订单必须有滑点、价格影响、流动性、敞口和 freshness 检查。
- 广播必须幂等，并由独立观察器确认 `confirmed/finalized`。
- 不允许 LLM/JEV 直接执行交易。
- 不允许静默 mock 冒充 live 数据。
- 不允许在日志、测试输出、prompt、模板或 git 中暴露 secrets。
- 外部 API 测试优先 mock；真实调用前先说明预计 credit/token 消耗并取得用户同意。

