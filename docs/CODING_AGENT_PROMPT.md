# Coding Agent Startup Prompt

将下面内容作为新 coding agent 的第一条消息：

```text
你正在接手以下代码库：

/Users/markkuang/Documents/work/trae_projects/sol_trade_agent

这是一个 near-real-time 跨链量化交易系统。Offline plane 负责研究和 advisory
signals；Online plane 负责确定性风控、报价、路由、执行和确认。LLM 只能生成研究
摘要，JEV/typed decision model 只能作为质量门，两者都没有交易执行权限。

开始任何修改前：

1. 完整阅读：
   - docs/HANDOFF.md
   - docs/AGENTS.md
   - docs/ARCHITECTURE.md
   - docs/CODE_WALKTHROUGH.md
   - docs/progress-tracker.md
   - docs/OP_Pending_Items.md
2. 运行 git status --short 和 git diff，理解当前未提交改动。
3. 当前 main 分支工作树包含大量 intentional、已测试但未提交的修改。不得 reset、
   checkout、restore、覆盖或重新实现这些改动。
4. 除非用户明确要求，不要 commit 或 push。

当前已完成：

- DeepSeek/OpenAI/Azure adapter architecture。
- JEV research quality gate，支持 disabled/shadow/enforce。
- 真实 DuneSQL token buy/sell volume 查询。
- CMC -> CoinGecko -> explicit mock fallback。
- CMC 10 分钟缓存。
- Dune 3 小时缓存及每进程每日 8 次预算。
- LLM 每次最大输出 512 tokens，并记录 provider usage。
- 最近 backend 完整测试为 13 suites / 41 tests passed，Nest build passed。

资源约束非常重要：

- 不要重复调用真实 CMC、Dune、DeepSeek 或 JEV 做验证。
- 默认使用 mocks/fixtures。需要真实调用时，先向用户说明预计 token/credit 消耗并取得同意。
- 不输出或提交 backend/.env 中的任何 key。
- backend/.env 已有本地 HTTPS_PROXY；不要把机器代理写死进源代码。

下一阶段主要缺口是 provider-neutral、跨重启、跨实例的持久化 UsageLedger，包括：

- PostgreSQL usage source of truth。
- Redis 原子预算检查。
- provider/date/model/query 维度。
- request reservation、actual usage、failure、cache hit。
- warning threshold 和 hard limit。

不要立即假设 schema 或开始大范围实现。先检查现有 Prisma schema、scheduler、provider
调用点和 OP pending items，给出最小实现边界；有产品/预算策略分歧时列入 OP Pending
Items 并向用户确认。

继续工作时遵守：

- read before write；
- 保留用户和前一 agent 的改动；
- 小步修改并补测试；
- 核心金融数值不用 float；
- LLM/JEV 不得绕过确定性风险控制；
- 非 demo 环境不得静默 mock；
- 完成后运行相关 tests、npm run build 和 git diff --check。

请先简短报告你读到的当前状态、工作树风险和建议的下一步，不要在第一步发起任何真实
付费 API 请求。
```

