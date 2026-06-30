# 本地启动 + Demo 录屏操作手册

> 目标：在本机把项目跑起来，录一段 ≤3 分钟的演示视频用于 Injective Nova 提交。
> 全程**零资金风险**：Injective 走 testnet + 模拟执行；Solana DEX 默认 mock。

---

## 0. .env 现状盘点（还要不要补？）

| 文件 | 状态 | 需要操作 |
|---|---|---|
| `backend/.env` | ✅ **已完整**（含真实 OpenRouter key、Injective testnet、mock 执行） | 无需改动，直接用 |
| `frontend/.env` | ⚪ 可有可无（Vite 全有默认值：API 走 `/api` 代理、WS 走同源） | 可选 `cp frontend/.env.example frontend/.env`，不建也能跑 |

**backend/.env 里为了 demo 故意留空的项（正常，别填）**：

- `INJECTIVE_MNEMONIC=""` → 留空 = 模拟下单（MockInjectiveTradeExecutor，不出真签名）。填了才会在 testnet 真下单，demo 不要填。
- `INJECTIVE_AGENT_ID=""` → 留空 = 显示**确定性模拟** Agent Identity 卡片。要显示真链上卡片需先在 Injective 注册拿到 agentId（注册需 `@injective/agent-sdk`，未上 npm，demo 阶段用模拟卡即可，不影响展示）。
- `ENABLE_REAL_DEX="false"` → Solana 侧用 mock DEX；Injective 侧（`ENABLE_INJECTIVE="true"`）拉的是**真实 Helix orderbook**。所以 demo 里 Injective 行情是真的，Solana 是 mock——这对演示跨链 nBBO 已经够用。想全真实再开 `ENABLE_REAL_DEX=true`（需公网 RPC，国内可能慢）。

**唯一真正依赖的外部服务**：OpenRouter（LLM）。你 `.env` 里已有 key，录屏时确保网络能访问 `openrouter.ai`（国内一般直连可通）。若临时不通，LLM 会自动降级到确定性 mock 输出，demo 仍能跑（UI 会显示 `deterministic fallback`）。

---

## 1. 前置依赖（一次性）

```bash
node -v          # 需要 >= 20（用到了 --env-file 原生支持）
docker -v        # 跑 Redis（可选，demo 不用队列也行）
npx supabase -v  # 本地 Postgres；没有就装：npm i -g supabase
```

---

## 2. 启动顺序（3 个终端）

### 终端 A — 基础设施（Postgres + Redis）

```bash
cd /Users/markkuang/Documents/work/trae_projects/sol_trade_agent
npx supabase start          # 拉起本地 Postgres（首次会下载镜像，慢一点）
docker compose up -d redis  # 可选；demo 不强依赖
```

`npx supabase start` 完成后会打印一堆 URL，确认 `API URL` 是 `http://127.0.0.1:54322`（和 `.env` 里 `DATABASE_URL` 一致）。

### 终端 B — 后端（NestJS，:3000）

```bash
cd /Users/markkuang/Documents/work/trae_projects/sol_trade_agent/backend
npm install                  # 已装过可跳过
npm run db:generate          # 生成 Prisma client
npm run db:push              # 建表（把 schema 推到本地 Postgres）
npm run start:dev            # 启动，热重载
```

看到 `Nest application successfully started` + `RealtimeGateway is listening` 即就绪。

快速自检：

```bash
curl http://localhost:3000/health            # {"status":"ok",...}
curl http://localhost:3000/agent/identity    # 我们的 Agent Identity 卡片（模拟）
curl http://localhost:3000/agent/registry    # registry 里的 agent 列表（模拟样本）
```

### 终端 C — 前端（Vite，:5173）

```bash
cd /Users/markkuang/Documents/work/trae_projects/sol_trade_agent/frontend
npm install                  # 已装过可跳过
npm run dev
```

浏览器打开 **http://localhost:5173** ，进入 **Live Trading** 页。

---

## 3. 录屏前 30 秒准备

1. 关掉通知（mac：聚焦→勿扰模式开）。
2. 浏览器开成全屏或合适窗口大小，字号调大（View → Zoom 125%），评委看得清。
3. 准备一个终端窗口放在旁边（后面要 `curl` 演示 MCP endpoint）。
4. mac 录屏快捷键：**Cmd + Shift + 5** → 选区域或整个屏幕 → 点录制。再按一次停止，文件存桌面。QuickTime 也行（File → New Screen Recording）。

---

## 4. ≤3 分钟 Demo 脚本（逐镜头 + 口播建议）

> 时间轴是建议节奏，自己先空跑一遍摸清网络延迟（OpenRouter 首 token 通常 2–5 秒）。

**[0:00–0:15] 开场 + 项目定位**
- 镜头：README 顶部或 Live Trading 页全貌。
- 口播：「这是 Solana × Injective 跨链量化 agent，Nova Program 参赛作品。两个核心：跨链 nBBO 套利 + Injective ERC-8004 agent 身份，并对外暴露 MCP endpoint。」

**[0:15–0:40] Agent Identity 卡片（ERC-8004 卖点）**
- 镜头：页面顶部 `Injective Agent Identity (ERC-8004)` 面板。
- 操作：让它显示我们的 agent 卡片（name / builderCode / services 里声明的 MCP endpoint）。
- 口播：「我们的 agent 在 Injective Agent Registry 上有 ERC-8004 身份卡，services 字段声明了 MCP endpoint，别的 Injective agent 能据此发现并调用我们。」
- 可选切到终端：`curl -s http://localhost:3000/agent/identity | jq .`

**[0:40–1:20] 跨链 nBBO（Injective 真行情 + Solana mock）**
- 镜头：`nBBO Snapshot` 区。
- 操作：选一个跨链共有的交易对（如 BTC 或 INJ/USDC），点 **Prepare nBBO Trade**。
- 口播：「后端 fan-out 到 Solana 多 DEX 和 Injective Helix，聚合出单一跨链 nBBO。这里 Injective 侧是真实 testnet orderbook，Solana 侧是 mock。选中路由在 Injective 时走 Injective 执行层。」
- 指出 Best Bid / Best Ask / Spread / 选中的 route source。

**[1:20–1:55] 跨链套利扫描**
- 镜头：`Cross-Chain Arbitrage` 区。
- 操作：点 **Rescan**。
- 口播：「扫描 BTC/ETH 等共有资产在两条链的中间价，扣掉桥成本后给出净 edge（bps）。有信号时会标出在哪条链买、哪条链卖。」

**[1:55–2:35] 自然语言量化助手（LLM + MCP 协议）**
- 镜头：`Natural-Language Quant Assistant` 输入框。
- 操作：输入框已预填 `Find BTC and ETH arbitrage between Solana and Injective`，点 **Ask Agent**。
- 口播：「用自然语言下指令，LLM（OpenRouter gpt-4o-mini）调用 LangChain tools——查 nBBO、扫套利、查 agent 身份——生成跨链计划。」
- 等 LLM 返回，指 `Agent plan` 框，右上角 `LLM · N tool call(s)` 证明真的调了工具，不是纯文本。

**[2:35–2:55] 暴露的 MCP endpoint（agent 互调叙事）**
- 切到终端，跑一条 MCP `tools/call` 演示别的 agent 调我们：
```bash
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_identity","arguments":{}}}'
```
- 口播：「我们自己在 `/mcp` 暴露了标准 MCP server（Streamable HTTP），四个工具：query_cross_chain_nbbo / propose_arb_plan / execute_injective_trade / get_agent_identity。任何 Injective agent 都能这样调用我们。」

**[2:55–3:00] 收尾**
- 口播：「技术栈：NestJS + LangChain + viem + Injective MCP server + Prisma。Demo 安全：testnet + 模拟执行，零资金风险。」
- 停止录制。

---

## 5. 录完后的处理

- 文件在桌面 `Screen Recording ....mov`。
- 体积太大可压缩：`ffmpeg -i input.mov -c:v libx264 -crf 28 -preset fast -c:a aac demo.mp4`（没 ffmpeg 就 `brew install ffmpeg`）。
- 提交时：要么把视频传 YouTube unlisted 把链接贴到 README，要么直接放 repo 根目录 `demo.mp4`（注意别太大，GitHub 单文件 100MB 限制）。

---

## 6. 常见翻车 & 救场

| 症状 | 原因 | 救场 |
|---|---|---|
| 后端启动报 `DATABASE_URL` 相关错 | supabase 没起或 URL 不一致 | `npx supabase status` 确认 54322 在跑；重跑 `npm run db:push` |
| `prisma generate` 拉到 v7 不兼容 | 本地 prisma 版本污染 | `npx prisma@5 generate` 钉版本 |
| 前端 WebSocket 指标一直红 | 后端没起或 3000 端口被占 | `lsof -i:3000` 看占用；后端日志确认 gateway listening |
| LLM 返回 `deterministic fallback` | OpenRouter 不通 / key 失效 | 换网络或换 key；demo 照样能演示（只是没真 LLM） |
| Injective 行情区空白 | `api.injective.exchange` 没通 | Helix adapter 会降级，nBBO 仍用 Solana mock 出值；不影响流程 |
| `npx -y @injectivelabs/mcp-server` 下载慢 | demo 不需要它（mnemonic 空=mock 执行） | 忽略，不会阻塞启动 |

---

## 7. 想加分的话（可选，录屏前做）

- 把 `ENABLE_REAL_DEX=true` + 填 `SOLANA_RPC_URL`（Helius/QuickNode），Solana 侧也变真行情，nBBO 更有说服力（但国内 RPC 可能慢，先测）。
- 去 Injective testnet 真注册一个 agent 拿 `INJECTIVE_AGENT_ID`，填进 `.env`，`/agent/identity` 显示真链上卡片（注册工具目前不在 npm，可能要手动合约交互，时间紧就跳过）。
