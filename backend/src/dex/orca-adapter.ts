import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { DexAdapter } from "./adapter.js";
import type { DexQuote, DexQuoteRequest } from "../types.js";
import { calculatePairPrice, inputOutputForSide } from "../utils/amounts.js";

export interface OrcaWhirlpoolOrderBookAdapterConfig {
  connection: Connection;
  walletPublicKey?: string;
  poolsByPair: Record<string, string>;
}

export class OrcaWhirlpoolOrderBookAdapter implements DexAdapter {
  readonly source = "orca" as const;
  private contextPromise?: Promise<any>;

  constructor(private readonly config: OrcaWhirlpoolOrderBookAdapterConfig) {}

  async quote(request: DexQuoteRequest): Promise<DexQuote[]> {
    const poolAddress = this.config.poolsByPair[request.pair.symbol];
    if (!poolAddress) {
      return [];
    }

    const started = Date.now();
    const context = await this.getContext();
    const whirlpoolSdk = await import("@orca-so/whirlpools-sdk");
    const commonSdk = await import("@orca-so/common-sdk");
    const client = whirlpoolSdk.buildWhirlpoolClient(context);
    const pool = await client.getPool(new PublicKey(poolAddress));
    const { inputMint, outputMint } = inputOutputForSide(request.pair, request.side);
    const quote = await whirlpoolSdk.swapQuoteByInputToken(
      pool,
      new PublicKey(inputMint),
      new BN(request.amountIn.toString()),
      commonSdk.Percentage.fromFraction(request.slippageBps, 10_000),
      context.program.programId,
      context.fetcher,
      undefined,
      whirlpoolSdk.UseFallbackTickArray.Always
    );
    const outAmount = BigInt(quote.estimatedAmountOut.toString());
    const feeBps = Number(quote.estimatedFeeAmount.toString()) / Number(request.amountIn) * 10_000;

    return [
      {
        source: this.source,
        chain: "solana",
        side: request.side,
        pair: request.pair.symbol,
        inputMint,
        outputMint,
        inAmount: request.amountIn,
        outAmount,
        price: calculatePairPrice(request, outAmount),
        feeBps: Number.isFinite(feeBps) ? feeBps : Number(pool.getData().feeRate ?? 0) / 100,
        liquidityUsd: Number(pool.getData().liquidity?.toString?.() ?? 0),
        priceImpactBps: 0,
        latencyMs: Date.now() - started,
        routeId: `orca:${poolAddress}`,
        receivedAt: Date.now(),
        raw: quote
      }
    ];
  }

  private async getContext(): Promise<any> {
    if (!this.contextPromise) {
      this.contextPromise = import("@orca-so/whirlpools-sdk").then((sdk) => {
        const walletPublicKey = new PublicKey(this.config.walletPublicKey ?? PublicKey.default.toBase58());
        const provider = new AnchorProvider(
          this.config.connection,
          {
            publicKey: walletPublicKey,
            signTransaction: async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> =>
              transaction,
            signAllTransactions: async <T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> =>
              transactions
          },
          { commitment: "confirmed" }
        );
        return sdk.WhirlpoolContext.withProvider(provider);
      });
    }

    return this.contextPromise;
  }
}
