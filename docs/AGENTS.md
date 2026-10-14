# Repository Agent Rules

本文件是 `sol_trade_agent` 的精简执行约束。详细现状与路线图以
[ARCHITECTURE.md](ARCHITECTURE.md)、[CODE_WALKTHROUGH.md](CODE_WALKTHROUGH.md)
和 [progress-tracker.md](progress-tracker.md) 为准。

## 工作方式

- 修改前先读取目标文件并搜索真实调用关系；跨模块改动先读架构与代码导览。
- 不臆造依赖、接口、环境变量或数据库字段。分别核对 `package.json`、
  `backend/.env.example` 和 `backend/prisma/schema.prisma`。
- 遵循当前 Packet/Roadmap，只完成当前逻辑闭环，避免无关重构。
- 产品、运营、资金或风险决策不自行假设；记录到
  [OP_Pending_Items.md](OP_Pending_Items.md) 等待确认。
- 新功能补充对应测试；交付前运行相关测试和构建，并如实说明未验证项。
- 不覆盖或回退用户已有改动，不主动提交代码或操作真实资金。

## 架构边界

- 离线平面负责数据采集、特征、回测、分析和 advisory signal。
- 在线平面负责实时行情、报价、确定性风控、路由、执行和独立确认。
- LLM 只负责研究摘要；JEV/decision adapter 只负责质量门或辅助决策。
  两者都不能绕过策略、仓位、风控、签名或确认。
- 保持 Solana/Injective 的链无关抽象，不破坏 `chain`、`DexQuote` 和
  `TokenPair` 等领域边界。

## 市场数据分工

| 数据源 | 职责 | 调度原则 |
|---|---|---|
| CoinMarketCap | 全市场价格、市值、24h volume、涨跌幅、排名和交易对 | 主聚合源；建议 5–15 分钟抓取并缓存 |
| Dune | 自定义链上指标、DEX 买卖量、协议/池子和钱包资金流 | 研究源；保存版本化 query，建议 1–6 小时执行 |
| Pyth / DEX API | 可执行价格、spread、深度和路由 | 在线路径；必须检查时间戳、slot 和过期时间 |
| Robinhood 等中心化平台 | 平台报价、账户和订单 | 使用独立官方 API，不得用链上数据冒充 |

- CMC 用于宽覆盖聚合数据；不要用 Dune 重复计算 CMC 已稳定提供的指标。
- Dune 只运行产生独特研究特征的自定义查询。必须使用分区过滤、结果上限、
  本地持久化和缓存；禁止在每次交易决策时重新执行以消耗 credits。
- 付费 API/模型调用必须配置 TTL、单次上限或日预算，并记录可用的
  token/credit usage；缓存命中不得再次调用上游。
- Dune 的 `blockchain=robinhood` 表示 Robinhood Chain，不代表 Robinhood
  App 的中心化客户成交流。
- 所有数据必须携带来源、环境、观测时间和 live/simulated/fallback 标记。
  非 demo 环境禁止静默 mock；上游失败时应降级、跳过或 fail closed。

## 交易与安全

- 秘钥、助记词和 API key 只能放在被忽略的本地环境或密钥系统中，不得写入
  示例、日志、提示词或提交记录。
- 默认使用 fixture、mock、paper 或 testnet；主网资金操作必须获得明确授权。
- 核心金额使用 `bigint`、`u64/u128` 和明确 decimals；浮点数只允许用于非执行
  的统计展示，不得用于签名金额、余额、仓位或风控比较。
- 每个执行计划必须校验数据新鲜度、滑点、价格影响、流动性、敞口和风险限额。
- 广播必须幂等；不得假定成功，必须由独立观察器确认 `confirmed/finalized`。
- Anchor 改动必须校验 signer、owner、PDA seeds、`has_one`、溢出和计算预算。

## 代码质量

- 遵循现有命名与模块边界；注释解释约束和权衡，不复述代码。
- 外部调用必须设置 timeout，并按场景实现有限重试、退避和可观察错误。
- 模拟数据必须显式命名和标记，不能作为回测、paper 或 live 成果证据。
- 报告以实际测试、构建和运行结果为准，文件存在不等于功能完成。
