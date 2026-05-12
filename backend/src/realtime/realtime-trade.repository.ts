import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TradeExecutionPlan } from '../types.js';
import { jsonReplacer } from '../utils/amounts.js';

export type RealtimeTradeStatus =
  | 'PENDING'
  | 'READY'
  | 'REJECTED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export type RealtimeLogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface CreateRealtimeTradeInput {
  intentId?: string;
  userPubkey?: string;
  pair: string;
  side: 'buy' | 'sell';
  amountIn: bigint | string;
  maxSlippageBps: number;
}

export interface AttachPlanInput {
  tradeId: string;
  plan: TradeExecutionPlan;
}

export interface MarkRejectedInput {
  tradeId: string;
  reason: string;
}

export interface MarkExecutionInput {
  tradeId: string;
  status: Extract<RealtimeTradeStatus, 'SUBMITTED' | 'CONFIRMED' | 'FAILED'>;
  txSignature?: string;
  executionPrice?: number;
  rejectionReason?: string;
}

@Injectable()
export class RealtimeTradeRepository {
  private readonly logger = new Logger(RealtimeTradeRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createTrade(input: CreateRealtimeTradeInput) {
    return this.prisma.realtimeTrade.create({
      data: {
        intentId: input.intentId,
        userPubkey: input.userPubkey,
        pair: input.pair,
        side: input.side,
        amountIn: input.amountIn.toString(),
        maxSlippageBps: input.maxSlippageBps,
        status: 'PENDING',
      },
    });
  }

  async attachPlan(input: AttachPlanInput) {
    const { plan, tradeId } = input;
    const planJson = JSON.parse(JSON.stringify(plan, jsonReplacer)) as Prisma.InputJsonValue;

    return this.prisma.realtimeTrade.update({
      where: { id: tradeId },
      data: {
        status: plan.status === 'ready' ? 'READY' : 'REJECTED',
        selectedDex: plan.selectedRoute?.quote.source,
        oraclePrice: plan.oraclePrice?.price,
        executionPrice: plan.selectedRoute?.quote.price,
        minOutAmount: plan.minOutAmount?.toString(),
        rejectionReason: plan.rejectionReason,
        plan: planJson,
      },
    });
  }

  async markRejected(input: MarkRejectedInput) {
    return this.prisma.realtimeTrade.update({
      where: { id: input.tradeId },
      data: {
        status: 'REJECTED',
        rejectionReason: input.reason,
      },
    });
  }

  async markExecution(input: MarkExecutionInput) {
    return this.prisma.realtimeTrade.update({
      where: { id: input.tradeId },
      data: {
        status: input.status,
        txSignature: input.txSignature,
        executionPrice: input.executionPrice,
        rejectionReason: input.rejectionReason,
      },
    });
  }

  async listRecent(limit = 50) {
    return this.prisma.realtimeTrade.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.realtimeTrade.findUnique({
      where: { id },
      include: {
        logs: {
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });
  }

  async log(
    tradeId: string | undefined,
    level: RealtimeLogLevel,
    event: string,
    message?: string,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.realtimeAgentLog.create({
        data: {
          tradeId,
          level,
          event,
          message,
          metadata: metadata
            ? (JSON.parse(JSON.stringify(metadata, jsonReplacer)) as Prisma.InputJsonValue)
            : undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist realtime agent log event=${event}: ${(error as Error).message}`,
      );
    }
  }
}
