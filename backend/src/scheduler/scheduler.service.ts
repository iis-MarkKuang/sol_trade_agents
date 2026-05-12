import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { CoinmarketcapCrawlerService } from '../crawlers/coinmarketcap-crawler.service';
import { TradingviewCrawlerService } from '../crawlers/tradingview-crawler.service';
import { DuneCrawlerService } from '../crawlers/dune-crawler.service';
import { DataCleanerService } from '../data/data-cleaner.service';
import { DataNormalizerService } from '../data/data-normalizer.service';
import { LlmAgentService } from '../agents/llm-agent.service';
import { StrategyEngineService } from '../strategy/strategy-engine.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private connection: IORedis;
  private dataCollectionQueue: Queue;
  private worker?: Worker;

  constructor(
    private coinmarketcapCrawler: CoinmarketcapCrawlerService,
    private tradingviewCrawler: TradingviewCrawlerService,
    private duneCrawler: DuneCrawlerService,
    private dataCleaner: DataCleanerService,
    private dataNormalizer: DataNormalizerService,
    private llmAgent: LlmAgentService,
    private strategyEngine: StrategyEngineService,
    private prisma: PrismaService
  ) {
    this.connection = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null,
    });

    this.dataCollectionQueue = new Queue('data-collection', {
      connection: this.connection,
    });
  }

  onModuleInit() {
    this.logger.log('Scheduler module initialized');
    this.startWorker();
    this.scheduleDataCollection();
  }

  onModuleDestroy() {
    this.logger.log('Scheduler module destroying');
    this.worker?.close();
    this.dataCollectionQueue.close();
    this.connection.disconnect();
  }

  private startWorker() {
    this.worker = new Worker(
      'data-collection',
      async (job: Job) => {
        this.logger.log(`Processing job ${job.id}`);
        await this.runDataPipeline();
      },
      { connection: this.connection }
    );
  }

  private async scheduleDataCollection() {
    await this.dataCollectionQueue.add('daily-collection', {}, {
      repeat: {
        every: 60 * 60 * 1000, // Every hour
      },
    });
    this.logger.log('Data collection scheduled');
    await this.runDataPipeline(); // Run once on start
  }

  private async runDataPipeline() {
    try {
      this.logger.log('Starting data pipeline');

      const [coinmarketcapData, tradingviewData, duneData] = await Promise.all([
        this.coinmarketcapCrawler.fetchAndSave(),
        this.tradingviewCrawler.fetchAndSave(),
        this.duneCrawler.fetchAndSave(),
      ]);

      const allData = [...coinmarketcapData, ...tradingviewData, ...duneData];
      const cleaned = this.dataCleaner.cleanData(allData);
      const normalized = this.dataNormalizer.normalizeData(cleaned);

      const analysis = await this.llmAgent.generateAnalysis(normalized);

      const analysisResult = await this.prisma.analysisResult.create({
        data: {
          analysis,
          timestamp: new Date(),
        },
      });

      const signals = await this.strategyEngine.runAllStrategies(normalized);
      for (const signal of signals) {
        await this.prisma.tradeSignal.create({
          data: signal,
        });
      }

      this.logger.log('Data pipeline completed');
    } catch (error) {
      this.logger.error('Data pipeline failed', error);
    }
  }
}
