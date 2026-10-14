import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '../config/config.service';

export type UsageProvider = 'dune' | 'coinmarketcap' | 'llm' | 'jev';
export type UsageStatus = 'reserved' | 'actual' | 'failed' | 'cache_hit';
export type UsageUnitKind = 'executions' | 'credits' | 'tokens';

export interface BudgetCheckResult {
  allowed: boolean;
  warning: boolean;
  current: number;
  hardLimit: number;
  warningPct: number;
}

export interface ReservationResult extends BudgetCheckResult {
  reservationId: string;
}

export interface ReserveOptions {
  model?: string | null;
  queryKey?: string | null;
  unitKind: UsageUnitKind;
}

export interface FollowUpOptions {
  model?: string | null;
  queryKey?: string | null;
  unitKind: UsageUnitKind;
}

/**
 * Provider-neutral usage ledger primitives.
 *
 * PG (usage_event) is the only durable record. Redis holds atomic daily
 * counters for the hot-path budget check and is rebuilt from PG on cold
 * start via rebuildCounters().
 *
 * Safety gate: when ConfigService.usageLedger.enabled is false, every method
 * no-ops or returns a permissive result so current behavior is unchanged.
 *
 * Redis-down policy (OP-12 unresolved): fail closed — throw and log. Do not
 * silently fall back to a non-atomic PG count until the operator decides.
 *
 * Failure accounting: recordFailed does NOT release the Redis reservation.
 * A failed paid call may still have consumed a credit/execution slot on the
 * provider side, so the conservative default is to count the attempt. This
 * is a candidate for an OP decision; a future reconciliation job can expire
 * orphan reservations.
 */
@Injectable()
export class UsageLedgerService {
  private readonly logger = new Logger(UsageLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.usageLedger.enabled;
  }

  /** Redis key for a (provider, date) daily counter. date is a UTC Date. */
  private counterKey(provider: UsageProvider, date: Date): string {
    return `usage:${provider}:${this.dateKey(date)}`;
  }

  /** YYYY-MM-DD in UTC, used both for the Redis key and the PG eventDate. */
  private dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private providerConfig(provider: UsageProvider) {
    const cfg = this.config.usageLedger;
    switch (provider) {
      case 'dune':
        return cfg.dune;
      case 'coinmarketcap':
        return cfg.coinmarketcap;
      case 'llm':
        return cfg.llm;
      case 'jev':
        return cfg.jev;
    }
  }

  private unitKindForProvider(provider: UsageProvider): UsageUnitKind {
    switch (provider) {
      case 'dune':
        return 'executions';
      case 'coinmarketcap':
        return 'credits';
      case 'llm':
      case 'jev':
        return 'tokens';
    }
  }

  /**
   * Read-only peek at the current daily count vs the hard limit. Does not
   * consume budget. When the ledger is disabled, returns a permissive result.
   */
  async checkBudget(provider: UsageProvider, date: Date): Promise<BudgetCheckResult> {
    const { hardLimitPerDay, warningPct } = this.providerConfig(provider);
    if (!this.enabled) {
      return { allowed: true, warning: false, current: 0, hardLimit: hardLimitPerDay, warningPct };
    }
    const current = await this.getCurrentCount(provider, date);
    return {
      allowed: current < hardLimitPerDay,
      warning: current >= Math.ceil((hardLimitPerDay * warningPct) / 100),
      current,
      hardLimit: hardLimitPerDay,
      warningPct,
    };
  }

  /**
   * Atomically reserve budget for a paid call: INCR the Redis daily counter,
   * reject (and roll back) if over the hard limit, then write a `reserved`
   * PG event. Returns the reservationId linking the later actual/failed
   * event. Returns allowed=false (no throw) when over limit; throws when
   * Redis/PG is unavailable.
   */
  async reserve(
    provider: UsageProvider,
    date: Date,
    estimatedUnits: number,
    opts: ReserveOptions,
  ): Promise<ReservationResult> {
    const { hardLimitPerDay, warningPct } = this.providerConfig(provider);
    if (!this.enabled) {
      return {
        allowed: true,
        warning: false,
        current: 0,
        hardLimit: hardLimitPerDay,
        warningPct,
        reservationId: randomUUID(),
      };
    }

    const key = this.counterKey(provider, date);
    // Atomic increment; if it overflows the hard limit, roll back with DECR
    // so the slot is not consumed by a rejected request.
    const next = await this.redis.client.incr(key);
    if (next > hardLimitPerDay) {
      await this.redis.client.decr(key);
      return {
        allowed: false,
        warning: false,
        current: hardLimitPerDay,
        hardLimit: hardLimitPerDay,
        warningPct,
        reservationId: '',
      };
    }

    const reservationId = randomUUID();
    try {
      await this.prisma.usageEvent.create({
        data: {
          provider,
          eventDate: date,
          model: opts.model ?? null,
          queryKey: opts.queryKey ?? null,
          status: 'reserved',
          units: Math.max(0, Math.floor(estimatedUnits)),
          unitKind: opts.unitKind,
          reservationId,
        },
      });
    } catch (error) {
      // PG write failed: roll back the Redis counter so budget stays
      // consistent. Fail closed — the caller should not proceed.
      await this.redis.client.decr(key);
      this.logger.error(`reserve PG write failed, rolled back Redis: ${(error as Error).message}`);
      throw error;
    }

    const warningThreshold = Math.ceil((hardLimitPerDay * warningPct) / 100);
    if (next >= warningThreshold) {
      this.logger.warn(
        `Usage for ${provider} on ${this.dateKey(date)} at ${next}/${hardLimitPerDay} (warning ${warningPct}%)`,
      );
    }

    return {
      allowed: true,
      warning: next >= warningThreshold,
      current: next,
      hardLimit: hardLimitPerDay,
      warningPct,
      reservationId,
    };
  }

  /**
   * Record the actual usage after a successful paid call. Does not touch
   * Redis — the reservation already incremented the counter. Writes an
   * `actual` PG event linked by reservationId. Pass the same date used for
   * reserve() so the event lands in the correct daily bucket.
   */
  async recordActual(
    provider: UsageProvider,
    date: Date,
    reservationId: string,
    actualUnits: number,
    opts: FollowUpOptions,
  ): Promise<void> {
    if (!this.enabled || !reservationId) {
      return;
    }
    await this.prisma.usageEvent.create({
      data: {
        provider,
        eventDate: date,
        model: opts.model ?? null,
        queryKey: opts.queryKey ?? null,
        status: 'actual',
        units: Math.max(0, Math.floor(actualUnits)),
        unitKind: opts.unitKind,
        reservationId,
      },
    });
  }

  /**
   * Record a failed paid call. Writes a `failed` PG event. Does NOT release
   * the Redis reservation (see class doc — conservative default, candidate
   * for OP decision).
   */
  async recordFailed(
    provider: UsageProvider,
    date: Date,
    reservationId: string,
    opts: FollowUpOptions,
  ): Promise<void> {
    if (!this.enabled || !reservationId) {
      return;
    }
    await this.prisma.usageEvent.create({
      data: {
        provider,
        eventDate: date,
        model: opts.model ?? null,
        queryKey: opts.queryKey ?? null,
        status: 'failed',
        units: 0,
        unitKind: opts.unitKind,
        reservationId,
      },
    });
  }

  /**
   * Record a cache hit for observability. units=0 and does not consume budget
   * (no Redis interaction).
   */
  async recordCacheHit(
    provider: UsageProvider,
    date: Date,
    queryKey?: string | null,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.prisma.usageEvent.create({
      data: {
        provider,
        eventDate: date,
        queryKey: queryKey ?? null,
        status: 'cache_hit',
        units: 0,
        unitKind: this.unitKindForProvider(provider),
        reservationId: null,
      },
    });
  }

  /**
   * Rebuild Redis daily counters from PG for a given UTC date. Sums
   * `reserved` + `actual` events per provider and SETs the Redis key (not
   * INCR) so the counter matches the durable record. Call on cold start.
   */
  async rebuildCounters(date: Date): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const rows = await this.prisma.usageEvent.groupBy({
      by: ['provider'],
      where: {
        eventDate: date,
        status: { in: ['reserved', 'actual'] },
      },
      _sum: { units: true },
    });
    for (const row of rows) {
      const sum = row._sum.units ?? 0;
      const key = this.counterKey(row.provider as UsageProvider, date);
      await this.redis.client.set(key, String(sum));
    }
  }

  private async getCurrentCount(provider: UsageProvider, date: Date): Promise<number> {
    const raw = await this.redis.client.get(this.counterKey(provider, date));
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  }
}
