import { Test, TestingModule } from '@nestjs/testing';
import { CoinmarketcapCrawlerService } from './coinmarketcap-crawler.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrawledMarketData } from './types/crawler.types';

// We won't mock crucial logic
const mockConfigService = {
  coinmarketcapApiKey: 'test-key',
};

const mockPrismaService = {
  marketData: {
    create: jest.fn(),
  },
};

describe('CoinmarketcapCrawlerService', () => {
  let service: CoinmarketcapCrawlerService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinmarketcapCrawlerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
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
});
