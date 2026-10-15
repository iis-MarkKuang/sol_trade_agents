import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { MonadExecutionPlan, TradeIntent } from "../types.js";

/**
 * Request payload used by RealTimeAgentCore to hand a Monad route to the
 * execution layer. Mirrors InjectiveTradeRequest's role for Injective.
 */
export interface MonadTradeRequest {
  plan: MonadExecutionPlan;
  intent: TradeIntent;
  /** Optional tx overrides passed through to the signer. */
  options?: Record<string, unknown>;
}

export interface MonadTradeResult {
  txHash?: string;
  status: "submitted" | "confirmed" | "failed" | "simulated";
  message: string;
  raw?: unknown;
}

/**
 * Chain-agnostic execution surface for Monad. RealTimeAgentCore holds an
 * optional instance and the realtime controller exposes an explicit execute
 * endpoint that delegates to it (signing is NOT automatic in prepareTrade).
 */
export interface MonadTradeExecutor {
  isAvailable(): Promise<boolean>;
  executeTrade(request: MonadTradeRequest): Promise<MonadTradeResult>;
}

export interface MonadExecutorOptions {
  /** Monad RPC URL (chain id 143 mainnet / 10143 testnet). */
  rpcUrl: string;
  /** Network tag (informational; the chain id on the plan is authoritative). */
  network: "mainnet" | "testnet";
  /** EVM private key. Empty/undefined -> caller should use MockMonadTradeExecutor. */
  privateKey?: string;
}

/**
 * Executes Monad (EVM) swap transactions via viem direct signing. Unlike the
 * Injective MCP client (a stdio child process), EVM signing is an in-process
 * library call: build the calldata (from the aggregator's `data` field or a
 * Uniswap Router call), sign with a LocalAccount, and broadcast via the RPC
 * transport. No child process is spawned.
 *
 * The actual swap calldata is expected to be supplied on the execution plan's
 * `options.data` + `options.to` (the aggregator/router address); this class
 * only signs and broadcasts. If no calldata is supplied it falls back to a
 * simulated result so the lifecycle can be exercised.
 */
@Injectable()
export class MonadViemExecutor implements MonadTradeExecutor, OnModuleDestroy {
  private readonly logger = new Logger(MonadViemExecutor.name);
  private readonly rpcUrl: string;
  private readonly network: "mainnet" | "testnet";
  // NOTE: typed as `any` intentionally — viem 2.5x's sendTransaction generics
  // produce spurious `kzg`/`authorizationList` type errors against custom
  // chains. Runtime behaviour is unaffected. Same pattern as
  // injective-registry.viem.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly account?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client?: any;

  constructor(options: MonadExecutorOptions) {
    this.rpcUrl = options.rpcUrl;
    this.network = options.network;
    if (options.privateKey) {
      try {
        this.account = privateKeyToAccount(options.privateKey as `0x${string}`);
        this.client = createWalletClient({
          account: this.account,
          transport: http(this.rpcUrl),
        });
      } catch (error) {
        this.logger.warn(
          `Failed to construct Monad account from private key: ${(error as Error).message}`,
        );
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.account && this.client);
  }

  async executeTrade(request: MonadTradeRequest): Promise<MonadTradeResult> {
    if (!this.account || !this.client) {
      return {
        status: "failed",
        message: "Monad executor not configured (no private key)",
      };
    }

    const plan = request.plan;
    const opts = request.options ?? {};
    const to = (opts.to as string) ?? plan.to;
    const data = (opts.data as string) ?? undefined;
    const value = opts.value !== undefined ? BigInt(opts.value as string | number) : 0n;

    try {
      if (!data) {
        // No calldata supplied -> simulate so the lifecycle can be exercised
        // without a real on-chain swap. This is the demo path.
        const txHash = `sim_monad_${plan.dex}_${Date.now()}`;
        this.logger.log(
          `[simulated] Monad ${plan.side} ${plan.amountIn} ${plan.tokenIn}->${plan.tokenOut} via ${plan.dex} -> ${txHash}`,
        );
        return {
          txHash,
          status: "simulated",
          message: `Simulated Monad ${plan.dex} ${plan.side} on chain ${plan.chainId}`,
          raw: { plan, simulated: true },
        };
      }

      const txHash = await this.client.sendTransaction({
        account: this.account,
        to: to as `0x${string}`,
        data: data as `0x${string}`,
        value,
        chain: undefined, // RPC transport handles chain id
      });

      return {
        txHash: typeof txHash === "string" ? txHash : String(txHash),
        status: "submitted",
        message: `Monad ${plan.dex} ${plan.side} on chain ${plan.chainId} submitted`,
        raw: { txHash, plan },
      };
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    // viem WalletClient holds no long-lived resources to dispose.
  }
}

/**
 * Demo executor used when no private key is configured. Produces a simulated
 * tx hash so the full lifecycle can be exercised end-to-end without real
 * signing — mirrors MockInjectiveTradeExecutor.
 */
@Injectable()
export class MockMonadTradeExecutor implements MonadTradeExecutor {
  private readonly logger = new Logger(MockMonadTradeExecutor.name);

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async executeTrade(request: MonadTradeRequest): Promise<MonadTradeResult> {
    const plan = request.plan;
    const txHash = `mock_monad_${plan.dex}_${plan.chainId}_${Date.now()}`;
    this.logger.log(
      `[mock] Monad ${plan.side} ${plan.amountIn} ${plan.tokenIn}->${plan.tokenOut} via ${plan.dex} -> ${txHash}`,
    );
    return {
      txHash,
      status: "simulated",
      message: `Simulated Monad ${plan.dex} ${plan.side} on chain ${plan.chainId}`,
      raw: { plan },
    };
  }
}
