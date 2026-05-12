import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ConfigService } from '../config/config.service';
import { OfflineAgentService } from './offline-agent.service';

const QUEUE_NAME = 'offline-agent';
const JOB_NAME = 'offline-pipeline';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;
  private enabled = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly offlineAgent: OfflineAgentService,
  ) {}

  async onModuleInit(): Promise<void> {
    const flag = (process.env.ENABLE_SCHEDULER || '').toLowerCase();
    this.enabled = flag === 'true' || flag === '1';

    if (!this.enabled) {
      this.logger.log(
        'Scheduler disabled (set ENABLE_SCHEDULER=true to enable). ' +
          'Use POST /agent/run-pipeline to trigger manually.',
      );
      return;
    }

    try {
      this.connection = new IORedis(this.configService.redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: false,
      });
      this.connection.on('error', (error: Error) => {
        this.logger.warn(`Redis connection error: ${error.message}`);
      });

      this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
      this.worker = new Worker(
        QUEUE_NAME,
        async (job: Job) => {
          this.logger.log(`Processing scheduled job ${job.id}`);
          return this.offlineAgent.runPipeline();
        },
        { connection: this.connection },
      );

      const intervalMs = Number(
        process.env.SCHEDULER_INTERVAL_MS ?? 60 * 60 * 1000,
      );
      await this.queue.add(
        JOB_NAME,
        {},
        {
          repeat: { every: intervalMs },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
      this.logger.log(
        `BullMQ scheduler started (interval=${intervalMs}ms). Running an initial pass…`,
      );
      this.offlineAgent
        .runPipeline()
        .catch((error) =>
          this.logger.error(
            `Initial offline pipeline run failed: ${(error as Error).message}`,
          ),
        );
    } catch (error) {
      this.logger.warn(
        `Failed to start BullMQ scheduler: ${(error as Error).message}. ` +
          `Falling back to manual trigger only.`,
      );
      await this.shutdown();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  isEnabled(): boolean {
    return this.enabled && Boolean(this.queue);
  }

  /**
   * Trigger the pipeline immediately. When BullMQ is up we enqueue a job,
   * otherwise we run inline so the demo always works.
   */
  async triggerPipelineNow(): Promise<{ mode: 'queued' | 'inline'; jobId?: string }> {
    if (this.queue) {
      const job = await this.queue.add(JOB_NAME, { triggeredAt: Date.now() });
      return { mode: 'queued', jobId: job.id };
    }

    await this.offlineAgent.runPipeline();
    return { mode: 'inline' };
  }

  private async shutdown(): Promise<void> {
    try {
      await this.worker?.close();
    } catch (error) {
      this.logger.debug(`Worker close error: ${(error as Error).message}`);
    }
    try {
      await this.queue?.close();
    } catch (error) {
      this.logger.debug(`Queue close error: ${(error as Error).message}`);
    }
    try {
      this.connection?.disconnect();
    } catch (error) {
      this.logger.debug(`Redis disconnect error: ${(error as Error).message}`);
    }
    this.worker = undefined;
    this.queue = undefined;
    this.connection = undefined;
  }
}
