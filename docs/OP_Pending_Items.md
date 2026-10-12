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

## Acceptance Gate for Limited Live Trading

All of the following require explicit operator approval:

- selected pair, venue, network, and wallet;
- capital and loss limits;
- strategy version and evaluation evidence;
- minimum paper-trading duration and success metrics;
- alerting contacts and kill-switch procedure;
- confirmation/finality policy;
- rollback and incident response runbook.
