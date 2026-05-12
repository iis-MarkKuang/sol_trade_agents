import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { OfflineAgentService } from './offline-agent.service';
import { SchedulerService } from './scheduler.service';

@Controller('agent')
export class OfflineAgentController {
  private readonly logger = new Logger(OfflineAgentController.name);

  constructor(
    private readonly offlineAgent: OfflineAgentService,
    private readonly scheduler: SchedulerService,
  ) {}

  @Get('status')
  status() {
    return {
      schedulerEnabled: this.scheduler.isEnabled(),
      timestamp: new Date().toISOString(),
    };
  }

  @Post('run-pipeline')
  async run() {
    try {
      const summary = await this.offlineAgent.runPipeline();
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`run-pipeline failed: ${message}`);
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('schedule-pipeline')
  async schedule() {
    return this.scheduler.triggerPipelineNow();
  }

  @Get('market-data')
  marketData(@Query('limit') limit?: string) {
    const numericLimit = clampLimit(limit, 50, 1, 500);
    return this.offlineAgent.getRecentMarketData(numericLimit);
  }

  @Get('analysis')
  analysis(@Query('limit') limit?: string) {
    const numericLimit = clampLimit(limit, 5, 1, 50);
    return this.offlineAgent.getLatestAnalysis(numericLimit);
  }

  @Get('signals')
  signals(@Query('limit') limit?: string) {
    const numericLimit = clampLimit(limit, 50, 1, 200);
    return this.offlineAgent.getRecentSignals(numericLimit);
  }
}

function clampLimit(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}
