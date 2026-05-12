import { Test, TestingModule } from '@nestjs/testing';
import { TradingviewCrawlerService } from './tradingview-crawler.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrawledMarketData } from './types/crawler.types';

const mockConfigService = {};
const mockPrismaService = {
  marketData: { create: jest.fn() },
};

describe('TradingviewCrawlerService', () => {
  let service: TradingviewCrawlerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingviewCrawlerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<TradingviewCrawlerService>(TradingviewCrawlerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('transformToCrawledData', () => {
    it('should transform mock data to CrawledMarketData', () => {
      const mockData = [
        { token: 'bitcoin', symbol: 'BTC', price: 65000, rsi: 55 },
      ];
      const result = service.transformToCrawledData(mockData);
      expect(result[0].token).toBe('bitcoin');
      expect(result[0].source).toBe('tradingview');
      expect(result[0].rsi).toBe(55);
    });
  });
});
