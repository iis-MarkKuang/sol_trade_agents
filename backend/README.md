# Sol Trade Agent Backend

Backend modules for real-time Solana trade preparation:

- Pyth Hermes price feed reader with REST latest-price fetch and SSE subscriptions.
- Parallel DEX quote aggregation with Jupiter, Raydium, Orca, and deterministic mock adapters.
- nBBO engine for best bid/highest sell route and best ask/lowest buy route selection.
- Risk validation for pair allowlist, position notional, slippage, liquidity, quote age, price impact, and oracle deviation.
- Real-time agent core that orchestrates oracle -> DEX quotes -> nBBO -> risk -> optional Jupiter transaction build.

## Commands

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

## Runtime

The backend starts on `http://localhost:3001` by default.

Useful endpoints:

- `GET /health`
- `GET /market/nbbo?pair=SOL/USDC`
- `POST /trade/prepare`

Example trade body:

```json
{
  "pair": "SOL/USDC",
  "side": "buy",
  "amountIn": "100000000",
  "maxSlippageBps": 100
}
```

Set `ENABLE_REAL_DEX=true` and `SOLANA_RPC_URL` to use the real Jupiter, Raydium, and Orca adapters. Orca also needs `ORCA_POOLS_BY_PAIR`, for example `SOL/USDC=<whirlpool-address>`, because Whirlpool quoting is pool-specific.
