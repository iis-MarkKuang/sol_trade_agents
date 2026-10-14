import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { UsageProvider, UsageStatus } from './usage-ledger.service';

/**
 * Read-only usage summary endpoint.
 *
 * NOTE: this endpoint is unauthenticated. OP-10 (public API access) is
 * unresolved; it must be gated behind authentication before any non-local
 * deployment.
 */
@Controller('agent')
export class UsageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('usage')
  async usage(@Query('date') date?: string) {
    if (!this.config.usageLedger.enabled) {
      return { enabled: false };
    }

    const eventDate = this.parseDate(date);
    const rows = await this.prisma.usageEvent.groupBy({
      by: ['provider', 'status'],
      where: { eventDate },
      _sum: { units: true },
    });

    const providers = this.buildProviderSummary(rows, eventDate);
    return {
      enabled: true,
      date: eventDate.toISOString().slice(0, 10),
      providers,
    };
  }

  private parseDate(date: string | undefined): Date {
    if (!date) {
      // Today, truncated to UTC midnight so the bucket matches the ledger.
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date; expected YYYY-MM-DD');
    }
    // Normalize to UTC midnight to match the @db.Date bucket.
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  private buildProviderSummary(
    rows: { provider: string; status: string; _sum: { units: number | null } }[],
    _eventDate: Date,
  ): Record<string, unknown> {
    const cfg = this.config.usageLedger;
    const summary: Record<string, unknown> = {};
    const knownProviders: UsageProvider[] = ['dune', 'coinmarketcap', 'llm', 'jev'];

    for (const provider of knownProviders) {
      const counts = this.emptyCounts();
      for (const row of rows) {
        if (row.provider === provider && this.isValidStatus(row.status)) {
          counts[row.status] += row._sum.units ?? 0;
        }
      }
      const limits = this.providerLimits(provider);
      summary[provider] = {
        ...counts,
        hardLimitPerDay: limits.hardLimitPerDay,
        warningPct: limits.warningPct,
      };
    }

    return summary;
  }

  private emptyCounts(): Record<UsageStatus, number> {
    return { reserved: 0, actual: 0, failed: 0, cache_hit: 0 };
  }

  private isValidStatus(status: string): status is UsageStatus {
    return status === 'reserved' || status === 'actual' || status === 'failed' || status === 'cache_hit';
  }

  private providerLimits(provider: UsageProvider) {
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
}
