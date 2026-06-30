# Manual — Solana Frontier Web3 LLM Trading Agent (+ Injective Nova)

This is the operational runbook: how to run the project locally and how to deploy a live **demo website to Azure** (so you can submit the Nova Program with a public URL).

The app has two pieces:

| Piece | Stack | Local URL | Serves |
|---|---|---|---|
| **Backend** | NestJS + Prisma + LangChain + Injective MCP | `http://localhost:3000` | REST `/api`, WS `/socket.io` |
| **Frontend** | Vite + React + Tailwind SPA | `http://localhost:5173` | Insights + Live Trading UI |

The frontend talks to the backend via `/api` (proxied in dev, nginx-reversed in prod).

---

## 1. Prerequisites

| Tool | Why | Min version |
|---|---|---|
| Node.js | backend + frontend | 20.x |
| npm | deps | 10.x |
| Docker Desktop | local Supabase / Redis / container deploy | latest |
| `supabase` CLI | local Postgres (`npx supabase start`) | latest (via npx) |
| Azure CLI (`az`) | only for Azure deploy | 2.50+ |
| Git | clone | any |

> No Phantom wallet, no real Solana DEX traffic, no real funds needed for the demo. Solana trades are mock-signed; Injective trades are simulated unless you set `INJECTIVE_MNEMONIC`.

---

## 2. Configure environment

### 2.1 Backend (`backend/.env`)

```bash
cd backend
cp .env.example .env
```

Minimal demo (no API keys) — **only `DATABASE_URL` is strictly required**:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
REDIS_URL="redis://localhost:6379"
ENABLE_INJECTIVE="true"
INJECTIVE_NETWORK="testnet"
```

With this, the LLM falls back to deterministic mock output and Injective trades are simulated by `MockInjectiveTradeExecutor` — the demo runs end-to-end with **zero paid keys**.

Full setup (recommended for the real submission):

```env
# --- LLM (pick one) ---
# Azure OpenAI — use the Nova Program's Microsoft Azure credits
LLM_PROVIDER="azure"
AZURE_OPENAI_API_KEY="<azure key>"
AZURE_OPENAI_API_INSTANCE_NAME="<your-resource>"
AZURE_OPENAI_API_DEPLOYMENT_NAME="gpt-4o-mini"
AZURE_OPENAI_API_VERSION="2024-08-01-preview"
# OR public OpenAI:
# OPENAI_API_KEY="sk-..."

# --- Data crawlers (optional) ---
CMC_API_KEY="<coinmarketcap>"
DUNE_API_KEY="<dune>"

# --- Injective real signing (optional; empty = simulated) ---
INJECTIVE_MNEMONIC="<testnet mnemonic>"
```

| Env var | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `REDIS_URL` | ⚠️ if using BullMQ queues | Local Supabase / Upstash / Azure Cache |
| `ENABLE_INJECTIVE` | optional | `true` → register Helix adapter + Injective executor |
| `INJECTIVE_MNEMONIC` | optional | Empty → simulated tx hashes; set → real testnet orders via MCP |
| `LLM_PROVIDER` | optional | Auto: Azure if `AZURE_OPENAI_API_KEY` set, else OpenAI |
| `AZURE_OPENAI_*` | optional | Azure OpenAI Service credentials |
| `OPENAI_API_KEY` | optional | Public OpenAI key |
| `CMC_API_KEY` / `DUNE_API_KEY` | optional | Enrich crawlers; mocks used if absent |

### 2.2 Frontend (`frontend/.env`)

```bash
cd frontend
cp .env.example .env
```

```env
# In dev the Vite proxy forwards /api -> http://localhost:3000
VITE_API_BASE_URL=/api
VITE_BACKEND_URL=http://localhost:3000
```

For production, set `VITE_API_BASE_URL` to the public backend URL (e.g. `https://api.yourapp.azurewebsites.net/api`) at **build time**.

---

## 3. Run locally

### 3.1 Start Postgres + Redis (one-time, requires Docker)

```bash
# From repo root — local Supabase (Postgres + Studio at :54323)
npx supabase start

# Local Redis (BullMQ) — separate terminal
docker compose up -d redis
```

### 3.2 Backend

```bash
cd backend
npm install
npm run db:generate      # generate Prisma client
npm run db:push          # sync schema to Postgres (creates tables)
npm run start:dev        # http://localhost:3000
```

Verify:
```bash
curl http://localhost:3000/health
curl 'http://localhost:3000/realtime/market/nbbo?pair=SOL/USDC'
```

### 3.3 Frontend

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

Open <http://localhost:5173>. The top-right **Realtime WS** + **Offline WS** indicators should turn green.

### 3.4 Run the demo flow

**Insights page (offline agent):**
1. Click **Run pipeline now** → triggers `POST /agent/run-pipeline` (crawl → clean → LLM analysis → signals).
2. Watch the **Pipeline Live Feed** card stream `pipeline.started` / `pipeline.completed` WS events.
3. Cards populate: Last Run Summary, Latest LLM Analysis, Trade Signals, Recent Market Data, plus the new **Cross-Chain Arbitrage (Solana ↔ Injective)** panel.

**Live Trading page (realtime agent):**
1. Pick a pair from the dropdown — Solana pairs (SOL/USDC, BTC/USDT…) and Injective pairs (INJ/USDC, BTC/USDT perp…) are tagged with a chain badge.
2. The **nBBO panel** shows the cross-chain best bid/ask with the source DEX + chain.
3. Click **Prepare trade** → review the `TradeExecutionPlan` (Solana Jupiter tx or `injectiveExecutionPlan`).
4. For Injective routes, click **Execute on Injective (MCP)**.
5. The **Cross-Chain Arbitrage Scanner** lists live BTC/ETH spreads across chains.
6. The **Natural-Language Quant Assistant** box: type e.g. *"find me an arb between Solana and Injective for BTC"* → returns a plan via LangChain tools.

### 3.5 Key REST endpoints (for the demo script / video)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/agent/run-pipeline` | Run offline pipeline |
| `GET`  | `/realtime/market/nbbo?pair=SOL/USDC` | nBBO snapshot |
| `POST` | `/realtime/trade/prepare` | Build a trade plan |
| `POST` | `/realtime/trade/confirm` | Confirm/mock-execute Solana trade |
| `GET`  | `/realtime/cross-chain/arb` | Cross-chain arb scan |
| `POST` | `/realtime/cross-chain/plan` | Natural-language plan |
| `POST` | `/realtime/trade/injective-execute` | Execute Injective plan via MCP |
| `GET`  | `/agent/identity` | Our ERC-8004 agent identity card |
| `GET`  | `/agent/registry` | Browse the Injective Agent Registry |
| `POST` | `/mcp` | MCP server we expose (tools/list, tools/call) |

### 3.6 (Optional) Run everything in Docker locally

```bash
# Build images
docker build -t sol-trade-backend  ./backend
docker build -t sol-trade-frontend ./frontend \
  --build-arg VITE_API_BASE_URL=/api

# Run with the host network so nginx can reach the backend on localhost
docker run -d --name backend -p 3000:3000 \
  -e DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -e ENABLE_INJECTIVE=true \
  -e AZURE_OPENAI_API_KEY="<optional>" \
  --add-host=host.docker.internal:host-gateway \
  sol-trade-backend

docker run -d --name frontend -p 8080:80 sol-trade-frontend
# open http://localhost:8080
```

> The `nginx.conf` proxies `/api` and `/socket.io` to `http://backend:3000` — adjust if your container network name differs.

---

## 4. Deploy the demo website to Azure

Recommended, lowest-friction topology — and it spends the **Nova Program's Azure credits**:

```
Azure Static Web Apps  ── frontend SPA (free tier, HTTPS + global CDN)
        │  /api  /socket.io
        ▼
Azure App Service (Linux, container) ── backend NestJS
        │
        ├── Azure Database for PostgreSQL (Flexible Server)  OR  Supabase cloud
        ├── Upstash Redis  OR  Azure Cache for Redis
        ├── Azure OpenAI Service  (gpt-4o-mini deployment)
        └── Injective MCP server spawned in-container (testnet)
```

### 4.1 Provision cloud deps

```bash
az login
az group create --name rg-sol-trade --location eastus

# 1) Postgres
az postgres flexible-server create \
  --name soltrade-pg --resource-group rg-sol-trade \
  --admin-user pgadmin --admin-password "<strong-pw>" \
  --sku-name Standard_B1ms --version 15 --yes

# 2) Redis (cheapest: Upstash free is easier; Azure Cache Basic is fine too)
az redis create --name soltrade-redis --resource-group rg-sol-trade \
  --sku Basic --vm-size c0

# 3) Azure OpenAI — create resource + deploy gpt-4o-mini in Azure Portal
#    (AI Foundry / Azure OpenAI → Create → Deploy model gpt-4o-mini)
#    Note the: resource name, deployment name, key, API version.
```

Grab the connection strings:

```bash
PG_HOST=$(az postgres flexible-server show -g rg-sol-trade -n soltrade-pg --query "fullyQualifiedDomainName" -o tsv)
# DATABASE_URL="postgresql://pgadmin:<pw>@${PG_HOST}:5432/postgres"
REDIS_KEY=$(az redis list-keys -g rg-sol-trade -n soltrade-redis --query primaryKey -o tsv)
REDIS_HOST=$(az redis show -g rg-sol-trade -n soltrade-redis --query hostName -o tsv)
# REDIS_URL="rediss://:${REDIS_KEY}@${REDIS_HOST}:6380"
```

### 4.2 Deploy backend → Azure App Service (container)

```bash
# Container registry
az acr create --name soltradeacr --resource-group rg-sol-trade --sku Basic --admin-enabled true
az acr login --name soltradeacr

# Build & push backend image
docker build -t soltradeacr.azurecr.io/sol-trade-backend:latest ./backend
docker push soltradeacr.azurecr.io/sol-trade-backend:latest

# App Service plan + webapp
az appservice plan create --name plan-sol-trade --resource-group rg-sol-trade --is-linux --sku B1
az webapp create --name sol-trade-api --resource-group rg-sol-trade \
  --plan plan-sol-trade --deployment-container-image-name soltradeacr.azurecr.io/sol-trade-backend:latest

az webapp config appsettings set --name sol-trade-api --resource-group rg-sol-trade \
  --settings \
    NODE_ENV=production \
    PORT=80 \
    DATABASE_URL="postgresql://pgadmin:<pw>@${PG_HOST}:5432/postgres" \
    REDIS_URL="rediss://:${REDIS_KEY}@${REDIS_HOST}:6380" \
    ENABLE_INJECTIVE=true \
    INJECTIVE_NETWORK=testnet \
    LLM_PROVIDER=azure \
    AZURE_OPENAI_API_KEY="<azure key>" \
    AZURE_OPENAI_API_INSTANCE_NAME="<your-resource>" \
    AZURE_OPENAI_API_DEPLOYMENT_NAME="gpt-4o-mini" \
    AZURE_OPENAI_API_VERSION="2024-08-01-preview" \
    FRONTEND_URL="https://<your-frontend>.azurestaticapps.net"

# Turn on managed identity / ACR pull if needed, then restart
az webapp restart --name sol-trade-api --resource-group rg-sol-trade
```

Backend will be live at `https://sol-trade-api.azurewebsites.net` (the `entrypoint.sh` runs `prisma db push` then `node dist/main`).

> **Note on the Injective MCP server:** the backend spawns `npx -y @injectivelabs/mcp-server` as a child process inside the container. The App Service Linux container has `npx` available via the Node 20 base image, so this works without extra setup. If your App Service plan blocks outbound stdio-spawned subprocesses, leave `INJECTIVE_MNEMONIC` empty to use the mock executor for the demo.

### 4.3 Deploy frontend → Azure Static Web Apps

```bash
# Build the SPA pointing at the live backend
cd frontend
npm install
VITE_API_BASE_URL="https://sol-trade-api.azurewebsites.net/api" npm run build
# dist/ is the artifact

# Create the Static Web App (GitHub-connected or manual)
az staticwebapp create --name sol-trade-web --resource-group rg-sol-trade \
  --sku Free \
  --source "https://github.com/<you>/sol_trade_agent" \
  --branch main \
  --app-location "/frontend" \
  --output-location "dist" \
  --login-with-github
```

If you prefer manual (no GitHub Actions), build `dist/` locally and deploy with the [Azure Static Web Apps CLI](https://github.com/Azure/static-web-apps-cli):

```bash
npm i -g @azure/static-web-apps-cli
swa deploy ./dist \
  --app-name sol-trade-web \
  --env production
```

You'll get a public URL like `https://sol-trade-web.azurestaticapps.net`. Set that back as `FRONTEND_URL` on the backend (CORS) and rebuild/redeploy the frontend if you change the backend URL.

### 4.4 CORS note for the split deployment

Because the frontend (Static Web Apps) and backend (App Service) are on different origins, the backend already enables CORS via `FRONTEND_URL`. The frontend must call the backend with the full URL — that's why `VITE_API_BASE_URL` is set at build time. WebSocket (`/socket.io`) also crosses origins; `app.enableCors({ credentials: true })` + the socket.io adapter handle this.

If you'd rather avoid cross-origin entirely, serve the built `frontend/dist` **from the backend** by adding a static controller — then a single App Service hosts both. (Not wired by default; ask if you want it.)

---

## 5. Smoke-test the deployed site

```bash
API=https://sol-trade-api.azurewebsites.net
curl $API/health
curl "$API/realtime/market/nbbo?pair=SOL/USDC"
curl "$API/realtime/cross-chain/arb"
curl "$API/agent/identity"
curl "$API/agent/registry?limit=10"
# MCP tools/list (JSON-RPC over Streamable HTTP)
curl -X POST $API/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Then open the Static Web Apps URL in a browser and run the same demo flow from §3.4 — that's exactly what you record for the ≤3 min Nova demo video.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `prisma generate` / `db:push` fails locally | Ensure `npx supabase start` finished; `DATABASE_URL` matches the printed local URL |
| Frontend WS indicators stay red | Backend not up, or `VITE_BACKEND_URL` wrong; check browser console — `/socket.io` must 200 |
| No Injective quotes | `ENABLE_INJECTIVE=true`? The Helix adapter hits `https://api.injective.exchange`; outbound HTTPS must be allowed |
| LLM returns "mock" text | No Azure/OpenAI key configured — expected; set one for real insights |
| `TS2589` / type errors in `cross-chain-agent.service.ts` | Known LangChain+zod inference issue, suppressed with `@ts-ignore`; runtime unaffected |
| App Service container can't pull from ACR | Enable managed identity + `az webapp config set ... --generic-configurations '{"acrUseManagedIdentityCreds":true}'` |
| Azure OpenAI 404 deployment not found | `AZURE_OPENAI_API_DEPLOYMENT_NAME` must match the **deployment name** (not model name) you created in Azure |
| Injective MCP `trade_open` errors in container | Leave `INJECTIVE_MNEMONIC` empty for the demo (mock executor) or ensure testnet mnemonic + outbound HTTPS |

---

## 7. Recording the ≤3 min Nova demo (suggested script)

1. *(10s)* One-liner: "AI cross-chain quant agent — Solana + Injective, natural-language trading via MCP."
2. *(30s)* Open Insights → **Run pipeline** → show crawl counts + LLM analysis + signals.
3. *(40s)* Live Trading → pick **BTC/USDT**, show nBBO with Solana + Injective side-by-side, chain badges.
4. *(40s)* **Cross-Chain Arbitrage Scanner** → highlight a detected spread.
5. *(40s)* Natural-Language box → "find me an arb between Solana and Injective for BTC" → show returned plan.
6. *(20s)* Prepare an Injective trade → **Execute on Injective (MCP)** → show submitted order.

Keep it under 3 minutes, mention "deployed on Azure using Nova Program credits + Injective MCP server."
