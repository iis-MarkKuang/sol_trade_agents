import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service';

/**
 * Shared ioredis client for the UsageLedger hot-path budget checks.
 *
 * The client connects lazily (ioredis default) so app startup does not fail
 * when Redis is unavailable. Only the UsageLedger hot path (gated behind
 * USAGE_LEDGER_ENABLED) depends on this client; when the flag is off the
 * client is never commanded. BullMQ owns its own connection and is unaffected.
 *
 * PG remains the source of truth; Redis only caches daily aggregates.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis(this.configService.redisUrl, {
      // Fail fast on commands when Redis is down rather than hanging the
      // budget check; the UsageLedgerService handles the error per OP-12.
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Returns true when Redis responds to PING. Does not throw on failure. */
  async health(): Promise<boolean> {
    try {
      const reply = await this.client.ping();
      return reply === 'PONG';
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${(error as Error).message}`);
      return false;
    }
  }
}
