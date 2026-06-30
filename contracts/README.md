# Sol Trade Agent Anchor Program

This Anchor program is the on-chain guardrail layer for routes prepared by the backend nBBO engine.

It stores multisig policy, trade proposals, approvals, DEX route identity, oracle/execution price checks, and immutable trade history records. Jupiter, Raydium, and Orca are represented as allowed executable program IDs because the backend builds the concrete route instructions and passes the selected DEX program account through the execution transaction.

Main instructions:

- `initialize_multisig`: creates owner/threshold policy and default DEX allowlist.
- `update_policy`: sets max slippage, max oracle deviation, and allowed DEX mask.
- `open_trade`: records the route hash, mint pair, amount, min output, and oracle price.
- `approve_trade`: collects multisig approvals.
- `execute_trade`: verifies route hash, output amount, DEX program, and execution price before logging final history.
- `cancel_trade`: closes out pending/approved records without execution.
