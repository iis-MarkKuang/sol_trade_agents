# Monad Chain Integration — Research & Design

> Branch: `feat/monad-integration-research`
> Status: **Research / design phase** — no code changes yet.
> Date: 2026-10-15

This document researches how to add **Monad** as a third execution chain alongside
Solana and Injective, following the same chain-agnostic architecture already used for
the Injective integration.

---

## 1. Why Monad

| Dimension | Monad | Implication for us |
|---|---|---|
| **Type** | EVM-compatible L1 (Fusaka fork) | We can reuse `viem`/`ethers.js` — same tooling as the Injective registry client. No new SDK family. |
| **Performance** | ~10,000 TPS, 300 ms blocks, 600 ms finality | Fast enough for near-real-time nBBO; finality is ~1000× faster than Ethereum L1. |
| **Mainnet** | Launched **2025-11-24**, chain ID **143**, RPC `https://rpc.monad.xyz` | Live and stable; not testnet-only. |
| **Native token** | **MON** (wrapped: wMON) | New base asset + stablecoin quotes (USDC/USDT bridged). |
| **DEX ecosystem** | Uniswap V3/V4, PancakeSwap, Kuru (orderbook), Clober (orderbook), aggregators (1inch, 0x, Monorail, Dirol) | Multiple quote sources — both AMM quoter and orderbook models available. |
| **Bridges** | deBridge, LayerZero, Wormhole, Across, CCIP, Circle CCTP | Cross-chain arb path to Solana/Injective is feasible (deBridge already used in our arb model). |
| **MCP** | Community `monad-mcp` (pareen) + `monad-bridge-mcp-server` (rawakinode) exist; deBridge MCP is chain-agnostic | Execution + bridge via MCP is possible, mirroring the Injective MCP pattern. |

**Bottom line:** Monad is the lowest-friction third chain because it is EVM-compatible
(we already have `viem` in the tree for the Injective registry) and has a mature DEX +
bridge ecosystem. The Injective integration is the template.

---

## 2. Existing integration pattern (the template)

The Injective integration added five pieces. Monad should mirror each:

| Concern | Injective file | Monad equivalent (proposed) |
|---|---|---|
| Chain abstraction | `types.ts` (`ChainId`, `DexSource`, `DexQuote.chain`) | Add `"monad"` to `ChainId` + a `monad_*` `DexSource` |
| Token registry | `config/tokens.ts` (`INJECTIVE_TOKENS`, `INJECTIVE_PAIRS`) | `MONAD_TOKENS`, `MONAD_PAIRS` |
| Market-data adapter | `dex/injective-helix-adapter.ts` (REST orderbook → `DexAdapter`) | `dex/monad-dex-adapter.ts` (Uniswap V3 Quoter / 0x API → `DexAdapter`) |
| Shared oracle | `oracle/injective-pyth-adapter.ts` (Pyth Hermes reuse) | Monad pairs reuse Pyth Hermes (same feed ids) — likely no new file |
| Execution | `transactions/injective-mcp-client.ts` (stdio JSON-RPC MCP) | `transactions/monad-executor.ts` (viem signer OR community MCP) |
| Wiring | `realtime/realtime.service.ts` (`buildInjectiveAdapter`, `buildInjectiveExecutor`) | `buildMonadAdapter`, `buildMonadExecutor` |
| Config | `config/config.service.ts` `injective` block + `.env.example` | `monad` block + `.env.example` |
| Arb strategy | `strategy/strategies/cross-chain-arb.strategy.ts` (hardcoded solana/injective) | Generalize to N chains (see §5) |
| Frontend | `LiveTradingPage.tsx` pair dropdown | Add Monad pairs with a chain badge |

---

## 3. Monad technical specifics that affect design

### 3.1 RPC & chain params

- Chain ID: **143** (mainnet) / **10143** (testnet)
- Public RPC: `https://rpc.monad.xyz` (rate-limited; QuickNode/Alchemy/Goldsky/Ankr also available)
- Full **Ethereum RPC API** compatibility — `eth_call`, `eth_blockNumber`, `eth_getLogs`, etc.
- **Caveat:** Monad's RPC does **not** support `eth_call` with view overrides for non-view
  functions. Uniswap V3/V4 Quoter calls must use `simulateContract` (viem
  `simulateFunction` / `eth_call` with state override) rather than a plain `readContract`.
  This matters for the DEX adapter implementation.

### 3.2 DEX quote strategy — two viable options

**Option A — Uniswap V3 Quoter (direct on-chain read):**
- Pro: no third-party API key, deterministic, full depth control.
- Con: must use `simulateContract` for the QuoterV2 call (Monad RPC quirk); only returns
  a single best pool, not multi-hop routed quotes.
- Best for: a self-contained, keyless adapter like the Helix one.

**Option B — Aggregator API (0x / 1inch / Monorail):**
- Pro: routed multi-hop quotes across all Monad DEXes, best price, includes price impact
  and gas estimate.
- Con: requires an API key for 0x/1inch; external dependency + latency; rate limits.
- Best for: production-quality quotes; mirrors how Jupiter aggregates Solana.

**Recommendation:** Start with **Option B using 0x/1inch Swap API** (already Monad-supported)
for the real adapter, with a **mock fallback** (same pattern as Helix) that tracks the
Pyth oracle mid + a small Monad premium. This keeps the demo keyless and the real path
high-quality. If we want zero external deps, fall back to Option A (Uniswap V3 Quoter).

### 3.3 Tokens & pairs

| Token | Monad representation | Decimals | Pyth feed |
|---|---|---|---|
| **MON** (native) | native gas token; wMON is the ERC-20 wrap | 18 | needs a Pyth MON/USD feed id (verify availability) |
| **WMON** | ERC-20 wrap of native MON | 18 | same as MON |
| **USDC** | bridged ERC-20 (CCTP or deBridge) | 6 | reuse existing USDC Pyth id |
| **USDT** | bridged ERC-20 | 6 | reuse existing USDT Pyth id |
| **WBTC** | bridged ERC-20 | 8 | reuse BTC Pyth id |
| **WETH** | bridged ERC-20 | 18 | reuse ETH Pyth id |

Proposed default Monad pairs (chain tag `"monad"`):
- `MON/USDC` (native spot)
- `WBTC/USDC` (overlapping with Solana BTC → enables cross-chain arb)
- `WETH/USDC` (overlapping with Solana ETH → enables cross-chain arb)

> **Note:** MON/USD Pyth feed availability must be verified. If absent, the oracle check
> for MON pairs can fall back to a wMON/USDC Uni V3 twap or skip the oracle-deviation gate
> for MON-only pairs. BTC/ETH pairs reuse the existing Pyth ids and need no new feed.

### 3.4 Execution — viem signer vs MCP

| Path | Signing | Fits existing pattern? |
|---|---|---|
| **viem LocalAccount** (private key in env) | Direct EVM signing | Yes — same as a generic EVM executor; no child process |
| **Community `monad-mcp` (pareen)** | Privy embedded wallet + approval URLs | Mirrors Injective MCP, but adds a browser approval hop |
| **deBridge MCP** | deBridge-hosted | Only for cross-chain swaps/bridges, not same-chain DEX |

**Recommendation:** Implement a `MonadViemExecutor` (private key → `viem` `LocalAccount`
→ `sendTransaction`) as the primary executor, plus a `MockMonadTradeExecutor` when no
key is set. This is simpler than the Injective MCP stdio child process because EVM
signing is a library call, not a subprocess. Optionally support the community `monad-mcp`
later as an alternate executor.

### 3.5 Cross-chain bridges (for arb settlement)

Our `CrossChainArbStrategy` already models a `bridgeCostBps` + `bridgePath`. Monad is
reachable via **deBridge** (already named in our arb path strings), LayerZero, and
Wormhole. The arb strategy just needs the bridge cost estimate per chain pair; no bridge
execution is wired today (research-only signals), so adding Monad is a config/constant
change, not new code.

---

## 4. Proposed code changes (file-by-file)

### 4.1 `backend/src/types.ts`

```ts
// Extend
export type DexSource = "jupiter" | "raydium" | "orca" | "injective_helix" | "monad_dex" | "mock";
export type ChainId = "solana" | "injective" | "monad";

// Add (new execution plan, parallel to InjectiveExecutionPlan)
export interface MonadExecutionPlan {
  chainId: 143 | 10143;
  dex: "uniswap_v3" | "0x" | "1inch" | "monorail";
  tokenIn: string;   // ERC-20 address
  tokenOut: string;  // ERC-20 address
  side: TradeSide;
  amountIn: string;  // human-readable
  minAmountOut: string;
  to: string;        // recipient address
  deadline: number;
  notionalUsd: number;
  reason: string;
}

// Extend TradeExecutionPlan
export interface TradeExecutionPlan {
  // ...existing...
  monadExecutionPlan?: MonadExecutionPlan;
}
```

### 4.2 `backend/src/config/tokens.ts`

Add `MONAD_TOKENS` (ERC-20 addresses — to be filled from the Monad ecosystem contracts
list), `MONAD_PAIRS`, and merge into `ALL_PAIRS`. Update `chainOfPair` to recognize
Monad pairs (by an `address` field or explicit `chain: "monad"`).

### 4.3 `backend/src/dex/monad-dex-adapter.ts` (new)

Implements `DexAdapter`. Strategy:
1. Call 0x/1inch Swap API (or Uniswap V3 Quoter via `simulateContract`) for the pair.
2. Parse `price`, `outAmount`, `gas`, `priceImpactBps`.
3. Tag `chain: "monad"`, `source: "monad_dex"`.
4. On failure / no key → `mockQuote` fallback tracking Pyth mid + configurable Monad premium
   (same shape as `InjectiveHelixAdapter.mockQuote`).

### 4.4 `backend/src/transactions/monad-executor.ts` (new)

- `MonadViemExecutor` — takes a private key + RPC URL, builds and signs the swap tx
  (via the aggregator's `data` field or a Uniswap Router call), broadcasts it.
- `MockMonadTradeExecutor` — returns a simulated tx hash (same shape as
  `MockInjectiveTradeExecutor`).
- `MonadTradeExecutor` interface (parallel to `InjectiveTradeExecutor`).

### 4.5 `backend/src/realtime/realtime.service.ts`

- Add `buildMonadAdapter()` + `buildMonadExecutor()` (mirror the Injective builders).
- Gate behind `cfg.monad.enabled` (default `false`).
- Push `'monad_dex'` into `allowedDexes` when enabled.
- In `RealTimeAgentCore`, route `chain === "monad"` routes to the Monad executor.

### 4.6 `backend/src/strategy/strategies/cross-chain-arb.strategy.ts`

Generalize the hardcoded `['solana', 'injective']` loop to iterate over a configurable
chain list (e.g. `['solana', 'injective', 'monad']`). The signal type already has
`buyChain`/`sellChain` as a union — extend it to include `"monad"`. Each chain pair gets
its own `bridgeCostBps` estimate.

### 4.7 `backend/src/config/config.service.ts` + `.env.example`

```env
# ---------------------------- Monad integration (💡 optional, demo-safe) ----------------------------
ENABLE_MONAD="false"
MONAD_NETWORK="mainnet"                     # mainnet (143) | testnet (10143)
MONAD_RPC_URL="https://rpc.monad.xyz"
MONAD_PRIVATE_KEY=""                        # empty -> MockMonadTradeExecutor
MONAD_DEX_MODE="0x"                          # 0x | 1inch | uniswap_v3 | mock
ZEROX_API_KEY=""
ONEINCH_API_KEY=""
MONAD_MOCK_PREMIUM_BPS="30"
```

### 4.8 Frontend (`LiveTradingPage.tsx`, `lib/api.ts`)

- Add Monad pairs to the pair dropdown with a `Monad` chain badge.
- The `Prepare Trade` flow already handles arbitrary chains via `DexQuote.chain`; just
  ensure the lifecycle buttons + event feed render Monad routes.

---

## 5. Cross-chain arb generalization

Current `CrossChainArbStrategy.detectArb` loops over `['solana', 'injective']` and emits
one signal per asset comparing exactly two chains. With three chains we want pairwise
signals: (Solana↔Injective), (Solana↔Monad), (Injective↔Monad).

Proposed refactor:
- Input: a `chains: ChainId[]` list + per-pair `bridgeCostBps: Record<string, number>`.
- For each shared asset, compute the mid on every chain, then emit a signal for every
  chain pair whose `netEdgeBps ≥ minNetEdgeBps`.
- Signal's `buyChain`/`sellChain` becomes `ChainId` (not a two-value union).
- `bridgePath` string generalized, e.g. `"deBridge: Solana -> Monad"`.

This is a backward-compatible generalization — the 2-chain case is just a 2-element list.

---

## 6. Risks & open questions

| Risk / question | Mitigation |
|---|---|
| **MON/USD Pyth feed may not exist** | Verify on Pyth Hermes; if absent, skip oracle-deviation gate for MON pairs or use a Uni V3 TWAP. |
| **Monad RPC `eth_call` view-override quirk** | Use `simulateContract` for Quoter; or use 0x/1inch which handles this server-side. |
| **Public RPC rate limits (25 rps QuickNode)** | Use a paid provider endpoint in prod; cache quotes (already have a TTL pattern). |
| **Bridged BTC/ETH liquidity depth on Monad** | TVL estimates are low ($1–10M per venue); cap `notionalUsd` in arb scan accordingly. |
| **No official Monad MCP server** | Use viem direct signing (simpler) rather than the community MCP; revisit if an official one ships. |
| **ERC-20 token addresses not yet filled** | Pull from the Monad ecosystem contracts repo / MonadVision explorer during implementation. |
| **Bridge cost estimates are guesses** | deBridge/LayerZero have quote APIs; wire them later for real settlement (out of scope for v1). |

---

## 7. Suggested work breakdown (tickets)

These would follow the same harness used for the UsageLedger work
(`docs/usage-ledger-roadmap.md` ticket template):

| # | Ticket | Scope | Depends on |
|---|---|---|---|
| M-01 | Chain abstraction + config | Extend `types.ts`, `config.service.ts`, `.env.example` with Monad | — |
| M-02 | Token registry | `MONAD_TOKENS`, `MONAD_PAIRS`, `chainOfPair` update | M-01 |
| M-03 | Monad DEX adapter | `monad-dex-adapter.ts` (0x/1inch + mock fallback) + unit tests | M-01, M-02 |
| M-04 | Monad executor | `monad-executor.ts` (viem + mock) + unit tests | M-01 |
| M-05 | Realtime wiring | `buildMonadAdapter/Executor` in `realtime.service.ts`; route in `RealTimeAgentCore` | M-03, M-04 |
| M-06 | Arb strategy generalization | N-chain pairwise `CrossChainArbStrategy` + tests | M-02 |
| M-07 | Frontend | Monad pairs in dropdown + chain badge; verify lifecycle rendering | M-05 |
| M-08 | Integration test + docs | End-to-end mock demo (zero keys); update README + MANUAL | M-05, M-07 |

**Estimated effort:** ~1.5–2× the Injective integration, mostly because of the arb
generalization (M-06) and the DEX adapter having two modes (aggregator API + mock).

## 8. Key references

- **Monad docs (intro):** https://docs.monad.xyz/ — EVM-compatible L1, 10k TPS, 300 ms blocks, 600 ms finality, mainnet since 2025-11-24.
- **Monad for developers:** https://docs.monad.xyz/introduction/monad-for-developers — MonadBFT, async/parallel execution, MonadDb, Fusaka fork, RPC differences.
- **Network information (mainnet):** https://docs.monad.xyz/developer-essentials/network-information — chain ID 143, RPC endpoints + rate limits, ecosystem contract addresses (wMON, Permit2, Multicall3, etc.).
- **DEX aggregators:** https://docs.monad.xyz/tooling-and-infra/dex-aggregators — 1inch, 0x, Monorail, Dirol, Moose live on Monad.
- **Cross-chain bridges:** https://docs.monad.xyz/tooling-and-infra/cross-chain — deBridge, LayerZero, Wormhole, Across, CCIP, Circle CCTP contract addresses.
- **Rampart DEX overview (14 venues + TVL):** https://rampartlabs.mintlify.app/sdk/dex/overview — Uniswap V3/V4, PancakeSwap, Kuru, Clober, iZiSwap, etc., with the `simulateContract` quirk note.
- **Community `monad-mcp` (pareen):** https://github.com/pareen/monad-mcp — MCP server for balances/transfers/swaps/bridging on Monad mainnet 143 / testnet 10143, Privy signing.
- **Community `monad-bridge-mcp-server` (rawakinode):** https://github.com/rawakinode/monad-bridge-mcp-server — Wormhole bridge MCP (Sepolia ↔ Monad testnet, MON/wMON).
- **deBridge MCP server:** https://agents.debridge.com/ — chain-agnostic MCP for cross-chain swaps/transfers (usable for arb settlement).

---

## 9. Conclusion

Monad is a strong third-chain candidate because:

1. **EVM compatibility** lets us reuse `viem` (already a dependency for the Injective
   registry) — no new SDK family, unlike adding a non-EVM chain.
2. **Mature DEX + bridge ecosystem** means real quotes and a real arb path to Solana/
   Injective exist today (deBridge/LayerZero/Wormhole).
3. **The Injective integration is a clean template** — each Monad piece maps 1:1 to an
   existing Injective file, so the work is mostly mechanical plus the one genuine
   generalization (N-chain arb in M-06).
4. **Demo-safe by default** — `ENABLE_MONAD=false` keeps current behavior unchanged;
   the mock fallback lets the full pipeline run with zero paid keys, exactly like the
   Injective mock executor.

**Recommended next step:** create tickets M-01..M-08 under
`docs/tickets/monad-integration/` using the existing harness, then implement M-01 + M-02
(chain abstraction + token registry) first since everything else depends on them.
