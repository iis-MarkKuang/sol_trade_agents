import { z } from 'zod';

export const PrepareTradeDtoSchema = z.object({
  id: z.string().optional(),
  user: z.string().optional(),
  pair: z.string().min(3),
  side: z.enum(['buy', 'sell']),
  amountIn: z.union([z.string(), z.number(), z.bigint()]),
  maxSlippageBps: z.number().int().min(1).max(5_000).optional(),
  stopLossPrice: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  delegatedExecution: z.boolean().optional(),
});

export type PrepareTradeDto = z.infer<typeof PrepareTradeDtoSchema>;

export const ConfirmTradeDtoSchema = z.object({
  tradeId: z.string().min(1),
  txSignature: z.string().min(1).optional(),
  status: z.enum(['SUBMITTED', 'CONFIRMED', 'FAILED']),
  executionPrice: z.number().positive().optional(),
  message: z.string().optional(),
});

export type ConfirmTradeDto = z.infer<typeof ConfirmTradeDtoSchema>;
