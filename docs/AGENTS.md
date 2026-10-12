# AI 智能体行为规范 (AI Agent Rules & Guidelines)

本文档定义了所有在 `sol_trade_agent` 仓库中工作的 AI 编码智能体（AI Agents / LLM Assistants）必须严格遵守的核心原则、工作流和行为规范。

## 1. 核心原则 (Core Principles)

### 🚫 Don't Assume, Do Tests (禁止臆测，必须验证)
- **严禁假设**：永远不要假设某个函数、变量、或模块是存在的。在修改前，必须使用搜索（Search）或读取（Read）工具查看真实的上下文。
- **验证驱动**：完成代码修改后，不要急于汇报。必须通过运行相关的测试（如 `npm run test` 或 `npm run test:vitest`）、构建检查（如 `npm run build`）或相应的脚本来验证代码确实能正常工作，且未引入新的错误。
- **测试覆盖**：添加新功能时，应主动评估并添加相应的单元测试或集成测试。

### 📖 Read Before Write (先读后写)
- 在对任何文件进行编辑（尤其是使用替换工具修改文件）之前，必须先读取文件的当前内容，确保修改的是最新状态，避免产生代码冲突或缩进错误。
- 在进行架构级或跨模块的改动前，必须先查阅 [`CODE_WALKTHROUGH.md`](CODE_WALKTHROUGH.md) 和 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

### 🛑 No Hallucinations (严禁幻觉)
- **不要发明不存在的东西**：严禁随意捏造依赖包、API 路由、环境变量或数据库字段。
- 引入新依赖前，检查 `package.json`；使用数据库前，核对 `backend/prisma/schema.prisma`；使用环境变量前，参考 `.env.example`。

## 2. 工作流与协作规范 (Workflow & Collaboration)

### 📦 严格遵循 Packet / Roadmap 机制
- **遵守流程**：项目开发严格按照里程碑（如 Packet 0-6）切分和推进，Agent 必须聚焦于当前指派的 Packet 任务，不应过度工程化或越界修改当前任务范围之外的代码。
- **OP 确认项 (OP Pending Items)**：遇到无法由技术层面独立决定的产品逻辑、运营策略或存在歧义的业务需求时，**必须停止自行猜测**。Agent 应当将这些问题提取并记录到 `docs/OP_Pending_Items.md` 中，等待人类（产品/运营）确认解除阻塞后再继续。

### 📝 结构化与任务追踪 (Step-by-step)
- 复杂的开发任务必须拆解为多个明确的子步骤，并在内部维护 Todo 列表。
- 保持原子化提交与修改：一次只解决一个逻辑闭环，避免一次性大范围重构导致难以排查的 Bug。

### 💬 代码规范与日志
- **注释原则**：不要写“流水账”式的注释（如 `// 定义变量`, `// 调用函数`）。注释只应该用于解释“为什么这样做（Why）”、“核心权衡（Trade-offs）”和“复杂业务逻辑约束”。
- **遵循现有风格**：在修改现有代码时，严格遵循当前文件的命名约定、代码风格和架构模式。

## 3. 领域特定规则 (Domain-Specific Rules)

### ⛓️ 跨链与抽象上下文 (Cross-Chain Context)
- 本项目不仅支持 Solana，还深度集成了 Injective (Nova Program)。
- 在修改交易路由、DEX 适配器、资产表示时，务必保持链无关的抽象（Chain-agnostic）。不可破坏 `DexQuote`, `TokenPair` 中现有的 `chain` 标识设计。

### 💰 资金与风控安全 (Risk & Security)
- 涉及交易执行、资金精度转换（Amounts）、私钥（Mnemonic）或签名逻辑的模块修改时，必须极为谨慎。
- 默认在测试网（Testnet）或模拟执行环境（Mock Executor）下进行逻辑验证，严禁默认向主网发起真实资金交互。

## 4. 区块链与量化开发最佳实践 (Blockchain & Quant Best Practices)

作为基于 Solana 等底层区块链的量化项目，Agent 必须遵循以下 Rust/Go 生态沉淀的工程最佳实践：

### ⚙️ 底层交互与 RPC 弹性 (RPC & Network Resilience)
- **精度与计算安全 (Precision & Safe Math)**：在处理代币余额、价格和交易量时，严禁直接使用浮点数（Float）进行核心金额计算。必须使用 `BigInt` (TS) 或 `u64/u128` (Rust) 进行整型运算，并严格对齐代币精度（Decimals，如 SOL 为 9，USDC 为 6）。务必防范溢出（Overflow/Underflow）。
- **RPC 弹性与重试 (Retry & Fallback)**：公链 RPC 节点极易出现超时或限流（Rate Limit）。在发起 RPC 请求时，必须实现指数退避重试（Exponential Backoff Retry）、多节点 Fallback 机制，并妥善处理 WebSocket 断连与心跳保活。
- **交易确认与幂等性 (Tx Confirmation)**：永远不要在“广播（Broadcast）”后直接假设交易成功。必须轮询或订阅区块状态，等待交易达到 `Confirmed` 或 `Finalized` 状态。在重试逻辑中必须保证操作的幂等性，严防重复发送交易（Double Spend）。

### 🦀 Solana 智能合约 (Rust/Anchor) 规范
- **严格的账户校验 (Account Validation)**：在编写或审查 Rust 合约代码时，必须确保所有传入账户都经过了严格的安全校验（如 `Signer`, `Mut`, `has_one`, `seeds` PDA 校验，以及 Owner 归属检查），严防账户注入攻击（Account Injection）。
- **计算单元与费用 (Compute Units & Priority Fees)**：Solana 交易对 CU 极其敏感。需主动优化合约的计算开销；在构建客户端交易时，务必合理配置计算预算（Compute Budget）和优先费（Priority Fees），以防交易在网络拥堵时被直接丢弃。

### 📈 量化交易特定约束 (Quant Trading Rules)
- **滑点与 MEV 防护 (Slippage & MEV)**：在构建任何 Swap 或跨链路由（如 Jupiter, Helix）的执行计划时，**必须**强制包含严格的滑点保护（Slippage Tolerance）参数。应当考虑潜在的 MEV 夹击风险，避免大额市价单毫无保护地暴露在内存池中。
- **状态一致性 (State Consistency)**：量化引擎在做决策前，必须确保本地缓存的 Orderbook/Tick 状态与链上最新状态的延迟在容忍范围内（如校验 slot 差异或时间戳过时），禁止基于过期的陈旧数据发出交易指令。

---
*所有被唤醒的 AI 智能体在执行任务前，均被视为已阅读并接受本规范的约束。*