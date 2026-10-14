import { Test, TestingModule } from '@nestjs/testing';
import { UsageController } from './usage.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';

const usageLedgerConfig = {
  enabled: false,
  dune: { hardLimitPerDay: 8, warningPct: 80 },
  coinmarketcap: { hardLimitPerDay: 1000, warningPct: 80 },
  llm: { hardLimitPerDay: 50_000, warningPct: 80 },
  jev: { hardLimitPerDay: 50_000, warningPct: 80 },
};

describe('UsageController', () => {
  let controller: UsageController;
  let prisma: { usageEvent: { groupBy: jest.Mock } };
  let config: any;

  beforeEach(async () => {
    prisma = { usageEvent: { groupBy: jest.fn() } };
    config = { usageLedger: { ...usageLedgerConfig } };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsageController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    controller = module.get(UsageController);
  });

  it('returns enabled:false and does not query PG when the ledger is disabled', async () => {
    const result = await controller.usage();
    expect(result).toEqual({ enabled: false });
    expect(prisma.usageEvent.groupBy).not.toHaveBeenCalled();
  });

  describe('with the ledger enabled', () => {
    beforeEach(() => {
      config.usageLedger.enabled = true;
    });

    it('returns per-provider counts and limits for the given date', async () => {
      prisma.usageEvent.groupBy.mockResolvedValue([
        { provider: 'dune', status: 'reserved', _sum: { units: 5 } },
        { provider: 'dune', status: 'actual', _sum: { units: 4 } },
        { provider: 'dune', status: 'failed', _sum: { units: 1 } },
        { provider: 'dune', status: 'cache_hit', _sum: { units: 0 } },
        { provider: 'llm', status: 'actual', _sum: { units: 1200 } },
      ]);

      const result = await controller.usage('2026-10-14');

      expect(result).toMatchObject({
        enabled: true,
        date: '2026-10-14',
        providers: {
          dune: { reserved: 5, actual: 4, failed: 1, cache_hit: 0, hardLimitPerDay: 8, warningPct: 80 },
          coinmarketcap: { reserved: 0, actual: 0, failed: 0, cache_hit: 0, hardLimitPerDay: 1000, warningPct: 80 },
          llm: { reserved: 0, actual: 1200, failed: 0, cache_hit: 0, hardLimitPerDay: 50_000, warningPct: 80 },
          jev: { reserved: 0, actual: 0, failed: 0, cache_hit: 0, hardLimitPerDay: 50_000, warningPct: 80 },
        },
      });
      expect(prisma.usageEvent.groupBy).toHaveBeenCalledWith({
        by: ['provider', 'status'],
        where: { eventDate: new Date('2026-10-14T00:00:00.000Z') },
        _sum: { units: true },
      });
    });

    it('returns zeros for every provider when there is no data', async () => {
      prisma.usageEvent.groupBy.mockResolvedValue([]);
      const result = await controller.usage();
      expect(result.enabled).toBe(true);
      expect((result.providers as any).dune.actual).toBe(0);
      expect((result.providers as any).llm.reserved).toBe(0);
    });

    it('rejects an invalid date with 400', async () => {
      await expect(controller.usage('not-a-date')).rejects.toThrow();
      expect(prisma.usageEvent.groupBy).not.toHaveBeenCalled();
    });
  });
});
