import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { InjectiveExecutionPlan, TradeIntent } from "../types.js";

/**
 * Request payload used by RealTimeAgentCore to hand an Injective route to the
 * execution layer. Mirrors JupiterTransactionBuilder's role for Solana.
 */
export interface InjectiveTradeRequest {
  plan: InjectiveExecutionPlan;
  intent: TradeIntent;
  /** Optional subaccount/margin overrides passed through to the MCP tool. */
  options?: Record<string, unknown>;
}

export interface InjectiveTradeResult {
  txHash?: string;
  orderHash?: string;
  status: "submitted" | "confirmed" | "failed" | "simulated";
  message: string;
  raw?: unknown;
}

/**
 * Chain-agnostic execution surface for Injective. RealTimeAgentCore holds an
 * optional instance and the realtime controller exposes an explicit execute
 * endpoint that delegates to it (signing is NOT automatic in prepareTrade).
 */
export interface InjectiveTradeExecutor {
  isAvailable(): Promise<boolean>;
  executeTrade(request: InjectiveTradeRequest): Promise<InjectiveTradeResult>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Spawns the official Injective MCP server (https://github.com/InjectiveLabs/mcp-server)
 * as a stdio child process and talks JSON-RPC 2.0 to it. Trades are placed via
 * the `trade_open` / `trade_close` MCP tools; cross-chain bridges via `bridge`.
 *
 * The MCP server handles oracle fetch, size/margin quantization, tx building,
 * signing (using INJECTIVE_MNEMONIC) and broadcast. We only forward the
 * execution plan produced by RealTimeAgentCore and relay the result.
 */
@Injectable()
export class InjectiveMcpClient implements InjectiveTradeExecutor, OnModuleDestroy {
  private readonly logger = new Logger(InjectiveMcpClient.name);
  private readonly bin: string;
  private readonly binArgs: string[];
  private readonly env: Record<string, string>;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private initialized = false;
  private initPromise?: Promise<void>;
  private buffer = "";

  constructor(options: {
    bin: string;
    network: "testnet" | "mainnet";
    mnemonic?: string;
    env?: Record<string, string>;
  }) {
    const parts = options.bin.split(/\s+/).filter(Boolean);
    this.bin = parts[0] ?? "npx";
    this.binArgs = parts.slice(1);
    this.env = {
      ...process.env,
      INJECTIVE_NETWORK: options.network,
      ...(options.mnemonic ? { INJECTIVE_MNEMONIC: options.mnemonic } : {}),
      ...(options.env ?? {}),
    } as Record<string, string>;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return true;
    } catch (error) {
      this.logger.warn(`Injective MCP server unavailable: ${(error as Error).message}`);
      return false;
    }
  }

  async executeTrade(request: InjectiveTradeRequest): Promise<InjectiveTradeResult> {
    await this.ensureInitialized();
    const plan = request.plan;
    const toolName = plan.marketType === "derivative" ? "trade_open" : "trade_open";
    const side = plan.side === "buy" ? "buy" : "sell";

    const args = {
      market_id: plan.marketId,
      market_type: plan.marketType,
      side,
      amount: plan.amount,
      price: plan.price,
      ...request.options,
    };

    try {
      const result = await this.callTool(toolName, args) as Record<string, unknown>;
      return {
        txHash: typeof result.txHash === "string" ? result.txHash : undefined,
        orderHash: typeof result.orderHash === "string" ? result.orderHash : undefined,
        status: "submitted",
        message: `Injective ${plan.marketType} ${plan.side} on ${plan.marketId} submitted via MCP`,
        raw: result,
      };
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Call an arbitrary MCP tool by name (e.g. `bridge`, `account_balances`). */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized();
    const response = await this.rpc("tools/call", { name, arguments: args });
    return unwrapToolResult(response);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.start();
    }
    await this.initPromise;
  }

  private async start(): Promise<void> {
    const child = spawn(this.bin, this.binArgs, {
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      this.logger.debug(`injective-mcp stderr: ${chunk.trim()}`);
    });
    child.on("exit", (code) => {
      this.logger.warn(`Injective MCP server exited with code ${code}`);
      this.initialized = false;
      this.child = undefined;
      this.initPromise = undefined;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Injective MCP server exited unexpectedly"));
      }
      this.pending.clear();
    });

    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sol-trade-agent", version: "0.1.0" },
    });
    this.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    this.initialized = true;
    this.logger.log(`Injective MCP server started (${this.bin} ${this.binArgs.join(" ")})`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message} (code ${message.error.code})`));
    } else {
      pending.resolve(message.result);
    }
  }

  private rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error("Injective MCP server is not running"));
    }
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(request);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 30_000);
    });
  }

  private send(message: JsonRpcRequest | { jsonrpc: "2.0"; method: string; params: Record<string, unknown> }): void {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  async onModuleDestroy(): Promise<void> {
    this.initialized = false;
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }
}

/**
 * Demo executor used when the official MCP server is not configured (no
 * mnemonic / bin unavailable). Produces a simulated tx hash so the full
 * lifecycle can be exercised end-to-end without real signing.
 */
@Injectable()
export class MockInjectiveTradeExecutor implements InjectiveTradeExecutor {
  private readonly logger = new Logger(MockInjectiveTradeExecutor.name);

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async executeTrade(request: InjectiveTradeRequest): Promise<InjectiveTradeResult> {
    const plan = request.plan;
    const txHash = `mock_inj_${plan.marketId.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}`;
    this.logger.log(`[mock] Injective ${plan.side} ${plan.amount} ${plan.marketId} @ ${plan.price} -> ${txHash}`);
    return {
      txHash,
      status: "simulated",
      message: `Simulated Injective ${plan.marketType} ${plan.side} on ${plan.marketId}`,
      raw: { plan },
    };
  }
}

function unwrapToolResult(result: unknown): unknown {
  if (result && typeof result === "object") {
    const r = result as { content?: Array<{ type?: string; text?: string }> };
    if (Array.isArray(r.content)) {
      for (const item of r.content) {
        if (item.type === "text" && item.text) {
          try {
            return JSON.parse(item.text);
          } catch {
            return item.text;
          }
        }
      }
    }
  }
  return result;
}
