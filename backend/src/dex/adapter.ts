import type { DexQuote, DexQuoteRequest, DexSource } from "../types.js";

export interface DexAdapter {
  readonly source: DexSource;
  quote(request: DexQuoteRequest): Promise<DexQuote[]>;
}
