# OP Pending Items

These product and operating decisions block production architecture. Technical
work can continue in paper mode while they are unresolved.

| ID | Decision | Recommended default | Why it matters | Status |
|---|---|---|---|---|
| OP-01 | Initial live scope | Solana `SOL/USDC` through Jupiter | Minimizes execution and accounting variables | Pending |
| OP-02 | Latency objective | p95 signal-to-submit under 3 seconds; p95 quote under 750 ms | Determines feed, hosting, and queue design | Pending |
| OP-03 | Custody model | Operator-controlled isolated hot wallet with strict cap | Defines signing service and authorization | Pending |
| OP-04 | Autonomy level | Human approval in testnet; capped auto-execution only after paper acceptance | Controls UI and state-machine authority | Pending |
| OP-05 | Initial risk budget | Per-trade, daily-loss, and total-position caps set before testnet | Required for deterministic sizing and kill switches | Pending |
| OP-06 | Strategy promotion gate | Backtest plus walk-forward plus 30-day paper run | Prevents research signals from becoming live prematurely | Pending |
| OP-07 | Cross-chain priority | Defer until single-chain reconciliation is reliable | Avoids bridge, inventory, and two-leg risk in v1 | Pending |
| OP-08 | Data-source policy | No silent mocks outside local/demo mode | Prevents synthetic data from appearing live | Pending |
| OP-09 | Contract role | Keep Anchor program optional until tested and integrated | Avoids treating an audit prototype as execution security | Pending |
| OP-10 | Public API access | Private operator API with authentication and network restriction | Current write endpoints are unauthenticated | Pending |
| OP-11 | UsageLedger over-limit policy | Fail closed for paid calls when hard limit hit; cache-only may continue | Decides whether pipeline stalls or degrades when budget exhausted | Pending |
| OP-12 | Redis unavailable fallback | Degrade to PostgreSQL-only counting (slower, non-atomic) | Prevents total outage when Redis is down; trades safety for availability | Pending |
| OP-13 | CMC metering unit | Count API credits (CMC plan meter), not raw requests | CMC bills by credit; request count misrepresents cost | Pending |
| OP-14 | UsageLedger warning/hard-limit defaults | Dune 8/day hard, CMC 1000 credits/day hard, LLM 50k tokens/day hard, warning at 80% | Concrete per-provider caps before persistence goes live | Pending |
| OP-15 | UsageLedger budget ownership | Fold into OP-05 risk budget as a single operator-approved cap set | Keeps cost limits and capital limits under one approval gate | Pending |

## Acceptance Gate for Limited Live Trading

All of the following require explicit operator approval:

- selected pair, venue, network, and wallet;
- capital and loss limits;
- strategy version and evaluation evidence;
- minimum paper-trading duration and success metrics;
- alerting contacts and kill-switch procedure;
- confirmation/finality policy;
- rollback and incident response runbook.
