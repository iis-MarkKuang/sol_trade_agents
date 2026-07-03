# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **路演简报** — `docs/Solana_Injective_跨链量化Agent_路演简报.pdf` and source `docs/roadshow.html` (4-page pitch deck: team, product, tech highlights, market, roadmap) for Injective Nova submission.
- **CN-safe LLM model routing** — `resolveToolModelCandidates()` in `llm-factory.ts` skips `openai/*` and `anthropic/*` on OpenRouter (upstream ToS 403 from mainland China) and falls back to verified DeepSeek models with tool-calling support.
- **Ask Agent model label** — Live Trading UI shows which model handled the request (e.g. `LLM · deepseek-chat-v3-0324 · 1 tool call(s)`).

### Changed

- **Default LLM model** — `LLM_MODEL` default is now `deepseek/deepseek-chat-v3-0324` (was `gpt-4o-mini` / `openai/gpt-4o-mini`). `.env.example` documents CN-friendly OpenRouter alternatives.
- **LLM timeout** — Increased from 6s to 30s to reduce false timeouts on tool-calling round-trips.
- **Offline LLM agent** — Removed hardcoded `gpt-4o-mini` override in `llm-agent.service.ts`; respects `LLM_MODEL` from config.
- **Agent Registry `view ↗` links** — Point to per-agent detail pages at `https://agents.injective.com/registry/{tokenId}` (was `/agent/{id}`, which 404s).
- **Simulated registry samples** — `view ↗` only shown for on-chain agents; sample cards show a hint to enable `INJECTIVE_AGENT_REGISTRY_ENABLED=true`.

### Fixed

- **Agent names showing as `Agent #1`, `Agent #2`, …** — Live registry scan now fetches ERC-8004 Agent Cards from IPFS via multi-gateway fallback (`ipfs.io` → `dweb.link` → `w3s.link` → Pinata). Parses real card schema (`agentType`, `services[].name`, `x402Support`) instead of falling back to generic placeholders.
- **Ask Agent always returning deterministic fallback** — Root cause was OpenRouter routing `openai/gpt-4o-mini` through OpenAI upstream, which returns **403 ToS** from CN IPs (not an invalid API key). Backend now auto-skips blocked models and retries `deepseek/deepseek-chat-v3-0324` → `deepseek/deepseek-chat`.
- **Misleading `Request timed out` errors** — LangChain requests to blocked OpenRouter models could hang before the old 6s cutoff; failures are now logged per-model with explicit fallback attempts.

### Documented

- **Double API calls on Live Trading tab (dev only)** — `nbbo`, `trades`, `arb`, `identity`, and `registry` each fire twice because `React.StrictMode` double-invokes `useEffect` in development. Production builds are unaffected.
- **Mainnet registry scan** — `.env.example` notes `INJECTIVE_AGENT_SCAN_CHUNK_SIZE=10000` (mainnet sentry RPC rejects 20k-block `eth_getLogs` ranges).

---

## [2026-07-03] — Agent registry & LLM reliability

Commit: `f955220` — *Fix agent registry display and use CN-safe LLM fallbacks for Ask Agent.*

| Area | What changed |
|------|----------------|
| `injective-registry.viem.ts` | `scanUrl()` → `/registry/{id}` |
| `injective-agent-identity.service.ts` | Multi-gateway IPFS fetch + `normalizeAgentCard()` |
| `llm-factory.ts` | CN tool-model list, blocked-prefix skip, 30s timeout |
| `cross-chain-agent.service.ts` | Per-model retry loop; returns `model` in response |
| `config.service.ts` | Default `LLM_MODEL` = DeepSeek |
| `LiveTradingPage.tsx` | Model badge; conditional registry `view ↗` |

---

## Prior work (reference)

Earlier commits on `main` before this session:

- `447b3a0` — **prepareTrade demo reliability**: Pyth TLS mock fallback, Injective mock executor, decimal amount handling.
- `647f357` / `b6f36b5` — **Injective Nova integration**: cross-chain nBBO, ERC-8004 agent identity, exposed MCP server, LangChain quant assistant.
