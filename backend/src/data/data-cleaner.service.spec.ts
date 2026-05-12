import { Test, TestingModule } from '@nestjs/testing';
import { DataCleanerService } from './data-cleaner.service';
import { CrawledMarketData } from '../crawlers/types/crawler.types';

describe('DataCleanerService', () => {
  let service: DataCleanerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataCleanerService],
    }).compile();

    service = module.get<DataCleanerService>(DataCleanerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should remove duplicate data points', () => {
    const timestamp = new Date();
    const data: CrawledMarketData[] = [
      { token: 'bitcoin', symbol: 'BTC', timestamp, source: 'coinmarketcap', price: 65000, rawData: {} },
      { token: 'bitcoin', symbol: 'BTC', timestamp, source: 'coinmarketcap', price: 65001, rawData: {} },
      { token: 'ethereum', symbol: 'ETH', timestamp, source: 'coinmarketcap', price: 3500, rawData: {} },
    ];

    const cleaned = service.removeDuplicates(data);
    expect(cleaned.length).toBe(2);
  });

  it('should remove invalid negative price data', () => {
    const timestamp = new Date();
    const data: CrawledMarketData[] = [
      { token: 'bitcoin', symbol: 'BTC', timestamp, source: 'coinmarketcap', price: -10, rawData: {} },
      { token: 'ethereum', symbol: 'ETH', timestamp, source: 'coinmarketcap', price: 3500, rawData: {} },
    ];

    const cleaned = service.removeInvalidData(data);
    expect(cleaned.length).toBe(1);
    expect(cleaned[0].token).toBe('ethereum');
  });
});
