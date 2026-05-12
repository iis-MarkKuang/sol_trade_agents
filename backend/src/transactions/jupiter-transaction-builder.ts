import { createJupiterApiClient } from "@jup-ag/api";
import type { DexQuote } from "../types.js";

export interface JupiterSwapBuildRequest {
  quote: DexQuote;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number | "auto";
}

export class JupiterTransactionBuilder {
  private readonly api: ReturnType<typeof createJupiterApiClient>;

  constructor(config: Parameters<typeof createJupiterApiClient>[0] = {}) {
    this.api = createJupiterApiClient(config);
  }

  async buildSwapTransaction(request: JupiterSwapBuildRequest): Promise<string> {
    if (request.quote.source !== "jupiter" || !request.quote.raw) {
      throw new Error("Jupiter transaction builder requires a raw Jupiter quote");
    }

    const prioritizationFeeLamports =
      typeof request.prioritizationFeeLamports === "number"
        ? {
            priorityLevelWithMaxLamports: {
              priorityLevel: "veryHigh" as const,
              maxLamports: request.prioritizationFeeLamports
            }
          }
        : undefined;

    const response = await this.api.swapPost({
      swapRequest: {
        quoteResponse: request.quote.raw as any,
        userPublicKey: request.userPublicKey,
        wrapAndUnwrapSol: request.wrapAndUnwrapSol ?? true,
        dynamicComputeUnitLimit: request.dynamicComputeUnitLimit ?? true,
        prioritizationFeeLamports
      }
    });

    if (!response.swapTransaction) {
      throw new Error("Jupiter swap API did not return a transaction");
    }

    return response.swapTransaction;
  }
}
