import { Test, TestingModule } from '@nestjs/testing';
import { CoinmarketcapCrawlerService } from './coinmarketcap-crawler.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageLedgerService } from '../usage-ledger/usage-ledger.service';
import { CrawledMarketData } from './types/crawler.types';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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

const mockConfigService: any = {
  coinmarketcapApiKey: 'test-key',
  coinmarketcap: {
    apiKey: 'test-key',
    cacheTtlMs: 10 * 60 * 1000,
  },
  usageLedger: {
    enabled: false,
    coinmarketcap: { hardLimitPerDay: 1000, warningPct: 80 },
  },
};

const mockPrismaService = {
  marketData: {
    create: jest.fn(),
  },
};

describe('CoinmarketcapCrawlerService', () => {
  let service: CoinmarketcapCrawlerService;
  let prisma: PrismaService;
  let usageLedger: ReturnType<typeof makeUsageLedgerMock>;

  beforeEach(async () => {
    usageLedger = makeUsageLedgerMock();
    mockConfigService.usageLedger.enabled = false;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinmarketcapCrawlerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: UsageLedgerService, useValue: usageLedger },
      ],
    }).compile();

    service = module.get<CoinmarketcapCrawlerService>(CoinmarketcapCrawlerService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('transformToCrawledData', () => {
    it('should transform API response to CrawledMarketData correctly', () => {
      const mockResponse = {
        data: [
          {
            id: 1,
            name: 'Bitcoin',
            symbol: 'BTC',
            slug: 'bitcoin',
            cmc_rank: 1,
            quote: {
              USD: {
                price: 65000,
                volume_24h: 40000000000,
                market_cap: 1280000000000,
              },
            },
          },
        ],
      };

      const result = service.transformToCrawledData(mockResponse);
      expect(result).toHaveLength(1);
      const firstData = result[0];
      expect(firstData.token).toBe('bitcoin');
      expect(firstData.symbol).toBe('BTC');
      expect(firstData.source).toBe('coinmarketcap');
      expect(firstData.price).toBe(65000);
      expect(firstData.volume24h).toBe(40000000000);
      expect(firstData.marketCap).toBe(1280000000000);
      expect(firstData.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('saveToDatabase', () => {
    it('should save multiple crawled data points', async () => {
      const mockData: CrawledMarketData[] = [
        {
          token: 'bitcoin',
          symbol: 'BTC',
          timestamp: new Date(),
          source: 'coinmarketcap',
          price: 65000,
          rawData: {},
        },
      ];

      await service.saveToDatabase(mockData);

      expect(prisma.marketData.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchListings', () => {
    it('reuses cached listings without consuming another API credit', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { data: [] },
      });

      await service.fetchListings(20);
      await service.fetchListings(20);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    // Legacy path (ledger disabled): cache hit must not touch the ledger.
    it('does not call the ledger on cache hit when disabled', async () => {
      mockedAxios.get.mockResolvedValue({ data: { data: [] } });

      await service.fetchListings(20);
      usageLedger.recordCacheHit.mockClear();
      await service.fetchListings(20);

      expect(usageLedger.recordCacheHit).not.toHaveBeenCalled();
    });
  });

  describe('with UsageLedger enabled', () => {
    beforeEach(() => {
      mockConfigService.usageLedger.enabled = true;
      usageLedger.enabled = true;
    });

    it('records a cache_hit and does not reserve on a cache hit', async () => {
      usageLedger.recordCacheHit.mockResolvedValue(undefined);
      // Prime the cache with a fresh fetch.
      usageLedger.reserve.mockResolvedValue({
        allowed: true,
        warning: false,
        current: 1,
        hardLimit: 1000,
        warningPct: 80,
        reservationId: 'rid-1',
      });
      usageLedger.recordActual.mockResolvedValue(undefined);
      mockedAxios.get.mockResolvedValue({ data: { data: [] } });

      await service.fetchListings(20);
      usageLedger.reserve.mockClear();
      usageLedger.recordCacheHit.mockClear();
      await service.fetchListings(20); // cache hit

      expect(usageLedger.reserve).not.toHaveBeenCalled();
      expect(usageLedger.recordCacheHit).toHaveBeenCalledWith(
        'coinmarketcap',
        expect.any(Date),
        'listings',
      );
    });

    it('reserves, calls CMC, then records actual on success', async () => {
      usageLedger.reserve.mockResolvedValue({
        allowed: true,
        warning: false,
        current: 1,
        hardLimit: 1000,
        warningPct: 80,
        reservationId: 'rid-2',
      });
      usageLedger.recordActual.mockResolvedValue(undefined);
      mockedAxios.get.mockResolvedValue({ data: { data: [{ id: 1 }] } });

      const result = await service.fetchListings(20);

      expect(result.source).toBe('coinmarketcap');
      expect(usageLedger.reserve).toHaveBeenCalledWith(
        'coinmarketcap',
        expect.any(Date),
        1,
        expect.objectContaining({ unitKind: 'credits', queryKey: 'listings' }),
      );
      expect(usageLedger.recordActual).toHaveBeenCalledWith(
        'coinmarketcap',
        expect.any(Date),
        'rid-2',
        1,
        expect.objectContaining({ unitKind: 'credits', queryKey: 'listings' }),
      );
      expect(usageLedger.recordFailed).not.toHaveBeenCalled();
    });

    it('records failed and falls through to CoinGecko when CMC throws', async () => {
      usageLedger.reserve.mockResolvedValue({
        allowed: true,
        warning: false,
        current: 1,
        hardLimit: 1000,
        warningPct: 80,
        reservationId: 'rid-3',
      });
      usageLedger.recordFailed.mockResolvedValue(undefined);
      // First axios.get (CMC) throws, second (CoinGecko) succeeds.
      mockedAxios.get
        .mockRejectedValueOnce(new Error('CMC down'))
        .mockResolvedValueOnce({ data: [{ id: 1, symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, current_price: 100, total_volume: 1, market_cap: 1 }] });

      const result = await service.fetchListings(20);

      expect(result.source).toBe('coingecko');
      expect(usageLedger.recordFailed).toHaveBeenCalledWith(
        'coinmarketcap',
        expect.any(Date),
        'rid-3',
        expect.objectContaining({ unitKind: 'credits', queryKey: 'listings' }),
      );
    });

    it('skips CMC and falls through to CoinGecko when budget is exhausted', async () => {
      usageLedger.reserve.mockResolvedValue({
        allowed: false,
        warning: false,
        current: 1000,
        hardLimit: 1000,
        warningPct: 80,
        reservationId: '',
      });
      mockedAxios.get.mockResolvedValue({
        data: [{ id: 1, symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, current_price: 100, total_volume: 1, market_cap: 1 }],
      });

      const result = await service.fetchListings(20);

      // CMC axios call never happens; CoinGecko is used.
      expect(result.source).toBe('coingecko');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(usageLedger.recordActual).not.toHaveBeenCalled();
    });
  });
});
