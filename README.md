# Solana Frontier Web3 LLM Trading Agent

A Web3 LLM agent platform for autonomous Solana trading, similar to b.ai, combining AI-driven insights, real-time market data, and on-chain execution.

---

## 📁 Project Structure
```
sol_trade_agent/
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md        # High-level system architecture
│   ├── offline-agent-design.md  # Detailed offline agent design
│   ├── realtime-agent-design.md # Detailed realtime agent design
│   └── progress-tracker.md    # Project progress tracking
├── backend/                   # NestJS backend
│   ├── src/
│   │   ├── prisma/            # Prisma ORM module
│   │   ├── main.ts            # NestJS entry point
│   │   └── app.module.ts      # Main app module
│   ├── prisma/
│   │   └── schema.prisma      # Database schema
│   └── ...config files
├── frontend/                  # React frontend (to be implemented)
├── supabase/                  # Supabase local development & migrations
│   ├── migrations/            # Database migrations
│   └── config.toml            # Supabase config
└── docker-compose.yml         # (Optional) Local Redis if not using Supabase Edge Functions
```

---

## 🚀 Quickstart - Supabase Only

### Step 1: Install Docker (if you haven't already)
Supabase local dev requires Docker

### Step 2: Start the local Supabase stack
```bash
# From project root
npx supabase start
```

This will start:
- Postgres database
- Supabase Studio (UI at http://localhost:54323)
- And more!

### Step 3: Configure your .env
Update `/backend/.env` with the local database URL printed by `supabase start`:
```env
# Database (Local Supabase - provided by "supabase start")
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Redis (local or use Upstash)
REDIS_URL="redis://localhost:6379"

# APIs
CMC_API_KEY="your_coinmarketcap_api_key"
DUNE_API_KEY="your_dune_api_key"
OPENAI_API_KEY="your_openai_api_key"
ANTHROPIC_API_KEY="your_anthropic_api_key"

# LLM Config
LLM_PROVIDER="openai"
LLM_MODEL="gpt-4o"
LLM_TEMPERATURE="0.7"
```

### Step 4: Set Up the Backend
```bash
cd backend

# 1. Install all dependencies
npm install

# 2. Generate Prisma Client
npm run db:generate

# 3. Run migrations
npm run db:migrate

# 4. Start NestJS dev server
npm run start:dev
```

### Step 5: Verify Setup
- Check Supabase Studio: http://localhost:54323
- Check health endpoint: http://localhost:3000/health

---

## 🔧 Key Scripts (Backend)

From the `backend/` directory:
```bash
npm run db:generate       # Generate Prisma Client
npm run db:migrate        # Apply new migrations
npm run db:reset          # Reset database and re-run all migrations
npm run db:status         # Check Supabase status
npm run supabase:start    # Start Supabase local stack
npm run supabase:stop     # Stop Supabase local stack
npm run start:dev         # Start NestJS dev server with hot-reload
```

---

## 📚 Documentation

- [High-level System Architecture](/docs/ARCHITECTURE.md)
- [Offline Agent Detailed Design](/docs/offline-agent-design.md)
- [Realtime Agent Detailed Design](/docs/realtime-agent-design.md)
- [Project Progress Tracker](/docs/progress-tracker.md)

---

## 🛠️ Tech Stack

| Component | Technologies |
|-----------|--------------|
| **Backend Framework** | NestJS 10 + TypeScript |
| **Database** | Supabase (PostgreSQL) with optional TimescaleDB |
| **ORM** | Prisma |
| **LLM Integration** | LangChain (OpenAI, Anthropic, local models) |
| **Job Queues** | BullMQ + Redis (local or Upstash) |
| **Workflow Orchestration** | Temporal (optional, production-grade) |
| **Real-time** | Socket.IO |
| **Frontend** | React 18 + TypeScript + Tailwind CSS (coming soon) |
| **Smart Contracts** | Anchor Framework + Jupiter (Solana) |
