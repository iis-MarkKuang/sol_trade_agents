import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { jsonReplacer } from '../utils/amounts.js';
import {
  ConfirmTradeDto,
  ConfirmTradeDtoSchema,
} from './dto/prepare-trade.dto';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(private readonly realtime: RealtimeService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      policy: this.realtime.getPolicy(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('market/nbbo')
  async getNbbo(
    @Query('pair') pair = 'SOL/USDC',
    @Query('mockMid') mockMid?: string,
    @Query('bidBaseAmount') bidBaseAmount?: string,
    @Query('askQuoteAmount') askQuoteAmount?: string,
    @Query('slippageBps') slippageBps?: string,
  ) {
    const snapshot = await this.realtime.getMarketNbbo({
      pair,
      mockMid: mockMid ? Number(mockMid) : undefined,
      bidBaseAmount,
      askQuoteAmount,
      slippageBps: slippageBps ? Number(slippageBps) : undefined,
    });
    return safe(snapshot);
  }

  @Post('trade/prepare')
  async prepareTrade(@Body() body: unknown) {
    try {
      const { tradeId, plan } = await this.realtime.prepareTrade(body);
      return safe({ tradeId, plan });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`prepareTrade failed: ${message}`);
      throw new BadRequestException(message);
    }
  }

  @Post('trade/confirm')
  async confirmTrade(@Body() body: unknown) {
    let dto: ConfirmTradeDto;
    try {
      dto = ConfirmTradeDtoSchema.parse(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid confirmation payload',
      );
    }
    await this.realtime.confirmExecution({
      tradeId: dto.tradeId,
      status: dto.status,
      txSignature: dto.txSignature,
      executionPrice: dto.executionPrice,
      message: dto.message,
    });
    return { ok: true };
  }

  @Get('trades')
  async listTrades(@Query('limit') limit?: string) {
    const numericLimit = limit ? Math.min(Math.max(Number(limit) || 50, 1), 200) : 50;
    return safe(await this.realtime.listTrades(numericLimit));
  }

  @Get('trades/:id')
  async getTrade(@Param('id') id: string) {
    const trade = await this.realtime.getTrade(id);
    if (!trade) {
      throw new NotFoundException(`Trade ${id} not found`);
    }
    return safe(trade);
  }
}

function safe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, jsonReplacer)) as T;
}
