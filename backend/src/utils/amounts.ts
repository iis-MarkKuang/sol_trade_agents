import { Decimal } from "decimal.js";
import type { DexQuoteRequest, QuoteSide, TokenPair } from "../types.js";

const TEN = new Decimal(10);

export function amountToDecimal(amount: bigint | string | number, decimals: number): Decimal {
  return new Decimal(amount.toString()).div(TEN.pow(decimals));
}

export function toNativeAmount(amount: Decimal.Value, decimals: number): bigint {
  return BigInt(new Decimal(amount).mul(TEN.pow(decimals)).floor().toFixed(0));
}

export function inputOutputForSide(pair: TokenPair, side: QuoteSide): {
  inputMint: string;
  outputMint: string;
  inputDecimals: number;
  outputDecimals: number;
} {
  if (side === "bid") {
    return {
      inputMint: pair.base.mint,
      outputMint: pair.quote.mint,
      inputDecimals: pair.base.decimals,
      outputDecimals: pair.quote.decimals
    };
  }

  return {
    inputMint: pair.quote.mint,
    outputMint: pair.base.mint,
    inputDecimals: pair.quote.decimals,
    outputDecimals: pair.base.decimals
  };
}

export function calculatePairPrice(request: DexQuoteRequest, outAmount: bigint): number {
  const { inputDecimals, outputDecimals } = inputOutputForSide(request.pair, request.side);
  const inputUi = amountToDecimal(request.amountIn, inputDecimals);
  const outputUi = amountToDecimal(outAmount, outputDecimals);

  if (inputUi.lte(0) || outputUi.lte(0)) {
    return 0;
  }

  if (request.side === "bid") {
    return outputUi.div(inputUi).toNumber();
  }

  return inputUi.div(outputUi).toNumber();
}

export function outputAmountFromPrice(request: DexQuoteRequest, price: number): bigint {
  if (price <= 0) {
    return 0n;
  }

  if (request.side === "bid") {
    const baseIn = amountToDecimal(request.amountIn, request.pair.base.decimals);
    return toNativeAmount(baseIn.mul(price), request.pair.quote.decimals);
  }

  const quoteIn = amountToDecimal(request.amountIn, request.pair.quote.decimals);
  return toNativeAmount(quoteIn.div(price), request.pair.base.decimals);
}

export function applyBps(value: bigint, bps: number): bigint {
  return (value * BigInt(Math.max(0, 10_000 - bps))) / 10_000n;
}

export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
