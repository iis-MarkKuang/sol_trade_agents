import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageLedgerService } from '../usage-ledger/usage-ledger.service';
import { DuneCrawlerService, DuneTokenVolumeRow } from './dune-crawler.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const duneConfig = {
  apiKey: 'test-key',
  apiBaseUrl: 'https://api.dune.com/api',
  chains: ['solana', 'ethereum', 'robinhood'],
  lookbackHours: 24,
  resultLimit: 100,
  queryTimeoutMs: 5_000,
  performance: 'small' as const,
  cacheTtlMs: 3 * 60 * 60 * 1000,
  maxExecutionsPerDay: 8,
  useMock: false,
};

const usageLedgerDisabled = {
  enabled: false,
  dune: { hardLimitPerDay: 8, warningPct: 80 },
  coinmarketcap: { hardLimitPerDay: 1000, warningPct: 80 },
  llm: { hardLimitPerDay: 50_000, warningPct: 80 },
  jev: { hardLimitPerDay: 50_000, warningPct: 80 },
};

const volumeRow: DuneTokenVolumeRow = {
  blockchain: 'solana',
  platform: 'raydium',
  token_symbol: 'SOL',
  buy_volume_usd: 6_000_000,
  sell_volume_usd: 4_000_000,
  total_volume_usd: 10_000_000,
  token_bought_amount: 30_000,
  token_sold_amount: 20_000,
  trade_count: 5_000,
  latest_trade_at: '2026-10-14 03:00:00.000 UTC',
};

function makeUsageLedgerMock() {
  return {
    enabled: false,
    reserve: jest.fn(),
    recordActual: jest.fn(),
    recordFailed: jest.fn(),
    recordCacheHit: jest.fn(),
    checkBudget: jest.fn(),
    rebuildCounters: jest.fn(),
  };
}

describe('DuneCrawlerService', () => {
  let service: DuneCrawlerService;
  let usageLedger: ReturnType<typeof makeUsageLedgerMock>;
  const configService: any = {
    duneApiKey: 'test-key',
    dune: duneConfig,
    usageLedger: usageLedgerDisabled,
  };
  const prismaService = {
    marketData: { create: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    usageLedger = makeUsageLedgerMock();
    configService.usageLedger = { ...usageLedgerDisabled };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuneCrawlerService,
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prismaService },
        { provide: UsageLedgerService, useValue: usageLedger },
      ],
    }).compile();
    service = module.get<DuneCrawlerService>(DuneCrawlerService);
  });

  it('maps live Dune volume rows into market observations', () => {
    const result = service.transformToCrawledData([volumeRow]);

    expect(result[0]).toMatchObject({
      token: 'solana:sol',
      symbol: 'SOL',
      source: 'dune:solana:raydium',
      chain: 'solana',
      platform: 'raydium',
      volume24h: 10_000_000,
      buyVolumeUsd24h: 6_000_000,
      sellVolumeUsd24h: 4_000_000,
      netFlowUsd24h: 2_000_000,
      tradeCount24h: 5_000,
    });
  });

  it('builds partition-filtered SQL for Solana and configured EVM chains', () => {
    const sql = service.buildTokenVolumeSql();

    expect(sql).toContain('FROM dex_solana.trades');
    expect(sql).toContain('FROM dex.trades');
    expect(sql).toContain("blockchain IN ('ethereum', 'robinhood')");
    expect(sql).toContain("block_date >= current_date - INTERVAL '1' DAY");
    expect(sql).toContain("block_time >= now() - INTERVAL '24' HOUR");
    expect(sql).toContain('LIMIT 100');
  });

  it('executes SQL and returns live API rows', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        execution_id: 'execution-1',
        state: 'QUERY_STATE_COMPLETED',
      },
    });
    mockedAxios.get.mockResolvedValue({
      data: { result: { rows: [volumeRow] } },
    });

    await expect(service.fetchOnChainData()).resolves.toEqual([volumeRow]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.dune.com/api/v1/sql/execute',
      expect.objectContaining({ performance: 'small' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Dune-Api-Key': 'test-key',
        }),
      }),
    );
  });

  it('reuses cached rows without consuming another query execution', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        execution_id: 'execution-1',
        state: 'QUERY_STATE_COMPLETED',
      },
    });
    mockedAxios.get.mockResolvedValue({
      data: { result: { rows: [volumeRow] } },
    });

    await service.fetchOnChainData();
    await service.fetchOnChainData();

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('does not silently use mock data when the live query fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Dune unavailable'));

    await expect(service.fetchOnChainData()).rejects.toThrow('Dune unavailable');
  });

  describe('with UsageLedger enabled', () => {
    beforeEach(() => {
      (configService.usageLedger as any).enabled = true;
      usageLedger.enabled = true;
    });

    it('reserves, calls Dune, then records actual on success', async () => {
      usageLedger.reserve.mockResolvedValue({
        allowed: true,
        warning: false,
        current: 1,
        hardLimit: 8,
        warningPct: 80,
        reservationId: 'rid-1',
      });
      usageLedger.recordActual.mockResolvedValue(undefined);
      mockedAxios.post.mockResolvedValue({
        data: { execution_id: 'exec-1', state: 'QUERY_STATE_COMPLETED' },
      });
      mockedAxios.get.mockResolvedValue({ data: { result: { rows: [volumeRow] } } });

      const rows = await service.fetchOnChainData();

      expect(rows).toEqual([volumeRow]);
      expect(usageLedger.reserve).toHaveBeenCalledWith(
        'dune',
        expect.any(Date),
        1,
        expect.objectContaining({ unitKind: 'executions' }),
      );
      expect(usageLedger.recordActual).toHaveBeenCalledWith(
        'dune',
        expect.any(Date),
        'rid-1',
        1,
        expect.objectContaining({ unitKind: 'executions' }),
      );
      expect(usageLedger.recordFailed).not.toHaveBeenCalled();
    });

    it('records failed and rethrows when the Dune call fails', async () => {
      usageLedger.reserve.mockResolvedValue({
        allowed: true,
        warning: false,
        current: 1,
        hardLimit: 8,
        warningPct: 80,
        reservationId: 'rid-2',
      });
      usageLedger.recordFailed.mockResolvedValue(undefined);
      mockedAxios.post.mockRejectedValue(new Error('Dune unavailable'));

      await expect(service.fetchOnChainData()).rejects.toThrow('Dune unavailable');
      expect(usageLedger.recordFailed).toHaveBeenCalledWith(
        'dune',
        expect.any(Date),
        'rid-2',
        expect.objectContaining({ unitKind: 'executions' }),
      );
      expect(usageLedger.recordActual).not.toHaveBeenCalled();
    });

    it('throws budget exhausted without calling Dune when reserve is denied', async () => {
      usageLedger.reserve.mockResolvedValue({
        allowed: false,
        warning: false,
        current: 8,
        hardLimit: 8,
        warningPct: 80,
        reservationId: '',
      });

      await expect(service.fetchOnChainData()).rejects.toThrow(/budget exhausted/);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(usageLedger.recordActual).not.toHaveBeenCalled();
    });

    it('records a cache_hit and does not reserve on a cache hit', async () => {
      usageLedger.recordCacheHit.mockResolvedValue(undefined);
      // Prime the cache with a prior successful fetch.
      usageLedger.reserve.mockResolvedValue({
        allowed: true,
        warning: false,
        current: 1,
        hardLimit: 8,
        warningPct: 80,
        reservationId: 'rid-3',
      });
      usageLedger.recordActual.mockResolvedValue(undefined);
      mockedAxios.post.mockResolvedValue({
        data: { execution_id: 'exec-1', state: 'QUERY_STATE_COMPLETED' },
      });
      mockedAxios.get.mockResolvedValue({ data: { result: { rows: [volumeRow] } } });

      await service.fetchOnChainData(); // fresh
      usageLedger.reserve.mockClear();
      usageLedger.recordCacheHit.mockClear();
      await service.fetchOnChainData(); // cache hit

      expect(usageLedger.reserve).not.toHaveBeenCalled();
      expect(usageLedger.recordCacheHit).toHaveBeenCalledWith(
        'dune',
        expect.any(Date),
        expect.any(String),
      );
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // only the fresh call
    });
  });
});
