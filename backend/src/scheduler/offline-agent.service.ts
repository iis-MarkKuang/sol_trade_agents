import { Injectable, Logger } from '@nestjs/common';
import { CoinmarketcapCrawlerService } from '../crawlers/coinmarketcap-crawler.service';
import { TradingviewCrawlerService } from '../crawlers/tradingview-crawler.service';
import { DuneCrawlerService } from '../crawlers/dune-crawler.service';
import { DataCleanerService } from '../data/data-cleaner.service';
import { DataNormalizerService } from '../data/data-normalizer.service';
import { LlmAgentService } from '../agents/llm-agent.service';
import { StrategyEngineService } from '../strategy/strategy-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { TradeSignal } from '../strategy/strategy.interface';
import { OfflineAgentGateway } from './offline-agent.gateway';

export interface PipelineSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  crawled: {
    coinmarketcap: number;
    tradingview: number;
    dune: number;
  };
  cleaned: number;
  normalized: number;
  signalsGenerated: number;
  analysisId?: string;
  analysisPreview: string;
}

/**
 * Encapsulates the end-to-end offline pipeline so it can be triggered both by
 * the BullMQ scheduler and on demand via REST (handy for demo / debugging).
 */
@Injectable()
export class OfflineAgentService {
  private readonly logger = new Logger(OfflineAgentService.name);

  constructor(
    private readonly coinmarketcapCrawler: CoinmarketcapCrawlerService,
    private readonly tradingviewCrawler: TradingviewCrawlerService,
    private readonly duneCrawler: DuneCrawlerService,
    private readonly dataCleaner: DataCleanerService,
    private readonly dataNormalizer: DataNormalizerService,
    private readonly llmAgent: LlmAgentService,
    private readonly strategyEngine: StrategyEngineService,
    private readonly prisma: PrismaService,
    private readonly gateway: OfflineAgentGateway,
  ) {}

  async runPipeline(): Promise<PipelineSummary> {
    const startedAt = new Date();
    this.logger.log('Offline pipeline started');
    this.gateway.emit({ type: 'pipeline.started', timestamp: startedAt.getTime() });

    try {
      return await this.runPipelineInternal(startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.gateway.emit({ type: 'pipeline.failed', timestamp: Date.now(), message });
      throw error;
    }
  }

  private async runPipelineInternal(startedAt: Date): Promise<PipelineSummary> {

    const [coinmarketcapData, tradingviewData, duneData] = await Promise.all([
      this.coinmarketcapCrawler.run(20).catch((err) => {
        this.logger.warn(`CoinMarketCap crawler failed: ${err.message}`);
        return [];
      }),
      this.tradingviewCrawler.run().catch((err) => {
        this.logger.warn(`TradingView crawler failed: ${err.message}`);
        return [];
      }),
      this.duneCrawler.run().catch((err) => {
        this.logger.warn(`Dune crawler failed: ${err.message}`);
        return [];
      }),
    ]);

    const allData = [...coinmarketcapData, ...tradingviewData, ...duneData];
    const cleaned = this.dataCleaner.cleanData(allData);
    const normalized = this.dataNormalizer.normalizeData(cleaned);

    const analysisContent = await this.llmAgent.generateAnalysis(normalized);
    const analysisRow = await this.prisma.analysisResult.create({
      data: {
        timestamp: new Date(),
        type: 'MARKET_OVERVIEW',
        content: analysisContent,
      },
    });

    const signals = await this.strategyEngine.runAllStrategies(normalized);
    await this.persistSignals(signals);

    const finishedAt = new Date();
    const summary: PipelineSummary = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      crawled: {
        coinmarketcap: coinmarketcapData.length,
        tradingview: tradingviewData.length,
        dune: duneData.length,
      },
      cleaned: cleaned.length,
      normalized: normalized.length,
      signalsGenerated: signals.length,
      analysisId: analysisRow.id,
      analysisPreview:
        analysisContent.length > 240
          ? `${analysisContent.slice(0, 240)}…`
          : analysisContent,
    };
    this.logger.log(
      `Offline pipeline completed in ${summary.durationMs}ms: ${JSON.stringify(summary.crawled)} signals=${summary.signalsGenerated}`,
    );
    this.gateway.emit({
      type: 'pipeline.completed',
      timestamp: finishedAt.getTime(),
      summary,
    });
    return summary;
  }

  async getLatestAnalysis(limit = 5) {
    return this.prisma.analysisResult.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
    });
  }

  async getRecentSignals(limit = 50) {
    return this.prisma.tradeSignal.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
    });
  }

  async getRecentMarketData(limit = 50) {
    return this.prisma.marketData.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
    });
  }

  private async persistSignals(signals: TradeSignal[]): Promise<void> {
    for (const signal of signals) {
      try {
        await this.prisma.tradeSignal.create({
          data: {
            token: signal.token,
            symbol: signal.symbol,
            timestamp: signal.timestamp,
            action: signal.action,
            reason: signal.reason,
            price: signal.price,
            strategy: signal.strategy,
            status: signal.status,
          },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to persist signal for ${signal.symbol}: ${(error as Error).message}`,
        );
      }
    }
  }
}
