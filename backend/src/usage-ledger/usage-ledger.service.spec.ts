import { Test, TestingModule } from '@nestjs/testing';
import { UsageLedgerService } from './usage-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '../config/config.service';

const TODAY = new Date('2026-10-14T12:00:00.000Z');

function makeMocks() {
  const redis = {
    client: {
      incr: jest.fn(),
      decr: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    },
  };
  const prisma = {
    usageEvent: {
      create: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const config = {
    usageLedger: {
      enabled: false,
      dune: { hardLimitPerDay: 8, warningPct: 80 },
      coinmarketcap: { hardLimitPerDay: 1000, warningPct: 80 },
      llm: { hardLimitPerDay: 50_000, warningPct: 80 },
      jev: { hardLimitPerDay: 50_000, warningPct: 80 },
    },
  };
  return { redis, prisma, config };
}

describe('UsageLedgerService', () => {
  let service: UsageLedgerService;
  let mocks: ReturnType<typeof makeMocks>;
  let module: TestingModule;

  beforeEach(async () => {
    mocks = makeMocks();
    module = await Test.createTestingModule({
      providers: [
        UsageLedgerService,
        { provide: PrismaService, useValue: mocks.prisma },
        { provide: RedisService, useValue: mocks.redis },
        { provide: ConfigService, useValue: mocks.config },
      ],
    }).compile();
    service = module.get(UsageLedgerService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('disabled (feature flag off)', () => {
    it('checkBudget returns permissive result and does not touch Redis/PG', async () => {
      const r = await service.checkBudget('dune', TODAY);
      expect(r.allowed).toBe(true);
      expect(r.warning).toBe(false);
      expect(mocks.redis.client.incr).not.toHaveBeenCalled();
      expect(mocks.prisma.usageEvent.create).not.toHaveBeenCalled();
    });

    it('reserve returns a reservationId and does not touch Redis/PG', async () => {
      const r = await service.reserve('dune', TODAY, 1, { unitKind: 'executions' });
      expect(r.allowed).toBe(true);
      expect(r.reservationId).toBeTruthy();
      expect(mocks.redis.client.incr).not.toHaveBeenCalled();
      expect(mocks.prisma.usageEvent.create).not.toHaveBeenCalled();
    });

    it('recordActual / recordFailed / recordCacheHit no-op', async () => {
      await service.recordActual('dune', TODAY, 'rid', 100, { unitKind: 'executions' });
      await service.recordFailed('dune', TODAY, 'rid', { unitKind: 'executions' });
      await service.recordCacheHit('dune', TODAY);
      await service.rebuildCounters(TODAY);
      expect(mocks.prisma.usageEvent.create).not.toHaveBeenCalled();
      expect(mocks.prisma.usageEvent.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('enabled', () => {
    beforeEach(() => {
      mocks.config.usageLedger.enabled = true;
    });

    describe('checkBudget', () => {
      it('returns allowed=true below the hard limit', async () => {
        mocks.redis.client.get.mockResolvedValue('3');
        const r = await service.checkBudget('dune', TODAY);
        expect(r).toMatchObject({ allowed: true, warning: false, current: 3, hardLimit: 8 });
      });

      it('returns warning=true at the warning threshold', async () => {
        // 80% of 8 = 6.4 -> ceil = 7
        mocks.redis.client.get.mockResolvedValue('7');
        const r = await service.checkBudget('dune', TODAY);
        expect(r.warning).toBe(true);
        expect(r.allowed).toBe(true);
      });

      it('returns allowed=false at the hard limit', async () => {
        mocks.redis.client.get.mockResolvedValue('8');
        const r = await service.checkBudget('dune', TODAY);
        expect(r.allowed).toBe(false);
      });

      it('treats missing Redis key as zero', async () => {
        mocks.redis.client.get.mockResolvedValue(null);
        const r = await service.checkBudget('dune', TODAY);
        expect(r.current).toBe(0);
        expect(r.allowed).toBe(true);
      });
    });

    describe('reserve', () => {
      it('INCRs Redis, writes a reserved PG event, returns reservationId', async () => {
        mocks.redis.client.incr.mockResolvedValue(2);
        mocks.prisma.usageEvent.create.mockResolvedValue({});

        const r = await service.reserve('dune', TODAY, 1, { unitKind: 'executions' });

        expect(r.allowed).toBe(true);
        expect(r.reservationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(mocks.redis.client.incr).toHaveBeenCalledWith('usage:dune:2026-10-14');
        expect(mocks.prisma.usageEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            provider: 'dune',
            status: 'reserved',
            units: 1,
            unitKind: 'executions',
            reservationId: r.reservationId,
          }),
        });
        expect(mocks.redis.client.decr).not.toHaveBeenCalled();
      });

      it('rejects and rolls back when over the hard limit', async () => {
        mocks.redis.client.incr.mockResolvedValue(9); // > 8

        const r = await service.reserve('dune', TODAY, 1, { unitKind: 'executions' });

        expect(r.allowed).toBe(false);
        expect(r.reservationId).toBe('');
        expect(mocks.redis.client.decr).toHaveBeenCalledWith('usage:dune:2026-10-14');
        expect(mocks.prisma.usageEvent.create).not.toHaveBeenCalled();
      });

      it('rolls back Redis and rethrows when the PG write fails', async () => {
        mocks.redis.client.incr.mockResolvedValue(3);
        mocks.prisma.usageEvent.create.mockRejectedValue(new Error('pg down'));

        await expect(
          service.reserve('dune', TODAY, 1, { unitKind: 'executions' }),
        ).rejects.toThrow('pg down');
        expect(mocks.redis.client.decr).toHaveBeenCalledWith('usage:dune:2026-10-14');
      });
    });

    describe('recordActual', () => {
      it('writes an actual PG event linked by reservationId', async () => {
        mocks.prisma.usageEvent.create.mockResolvedValue({});
        await service.recordActual('llm', TODAY, 'rid-1', 420, {
          unitKind: 'tokens',
          model: 'deepseek-chat',
        });
        expect(mocks.prisma.usageEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            provider: 'llm',
            status: 'actual',
            units: 420,
            unitKind: 'tokens',
            model: 'deepseek-chat',
            reservationId: 'rid-1',
          }),
        });
        // does not touch Redis
        expect(mocks.redis.client.incr).not.toHaveBeenCalled();
      });

      it('no-ops with an empty reservationId', async () => {
        await service.recordActual('llm', TODAY, '', 420, { unitKind: 'tokens' });
        expect(mocks.prisma.usageEvent.create).not.toHaveBeenCalled();
      });
    });

    describe('recordFailed', () => {
      it('writes a failed PG event with units=0 and does not release Redis', async () => {
        mocks.prisma.usageEvent.create.mockResolvedValue({});
        await service.recordFailed('dune', TODAY, 'rid-2', { unitKind: 'executions' });
        expect(mocks.prisma.usageEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            provider: 'dune',
            status: 'failed',
            units: 0,
            unitKind: 'executions',
            reservationId: 'rid-2',
          }),
        });
        expect(mocks.redis.client.decr).not.toHaveBeenCalled();
      });
    });

    describe('recordCacheHit', () => {
      it('writes a cache_hit event with units=0 and no Redis interaction', async () => {
        mocks.prisma.usageEvent.create.mockResolvedValue({});
        await service.recordCacheHit('coinmarketcap', TODAY, 'listings');
        expect(mocks.prisma.usageEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            provider: 'coinmarketcap',
            status: 'cache_hit',
            units: 0,
            unitKind: 'credits',
            reservationId: null,
          }),
        });
        expect(mocks.redis.client.incr).not.toHaveBeenCalled();
      });
    });

    describe('rebuildCounters', () => {
      it('sums reserved+actual from PG and SETs Redis (not INCR)', async () => {
        mocks.prisma.usageEvent.groupBy.mockResolvedValue([
          { provider: 'dune', _sum: { units: 5 } },
          { provider: 'llm', _sum: { units: 1200 } },
        ]);

        await service.rebuildCounters(TODAY);

        expect(mocks.prisma.usageEvent.groupBy).toHaveBeenCalledWith({
          by: ['provider'],
          where: { eventDate: TODAY, status: { in: ['reserved', 'actual'] } },
          _sum: { units: true },
        });
        expect(mocks.redis.client.set).toHaveBeenCalledWith('usage:dune:2026-10-14', '5');
        expect(mocks.redis.client.set).toHaveBeenCalledWith('usage:llm:2026-10-14', '1200');
        expect(mocks.redis.client.incr).not.toHaveBeenCalled();
      });

      it('no-ops when there are no rows', async () => {
        mocks.prisma.usageEvent.groupBy.mockResolvedValue([]);
        await service.rebuildCounters(TODAY);
        expect(mocks.redis.client.set).not.toHaveBeenCalled();
      });
    });
  });
});
