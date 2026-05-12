import { Test, TestingModule } from '@nestjs/testing';
import { DataNormalizerService } from './data-normalizer.service';
import { CrawledMarketData } from '../crawlers/types/crawler.types';

describe('DataNormalizerService', () => {
  let service: DataNormalizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataNormalizerService],
    }).compile();

    service = module.get<DataNormalizerService>(DataNormalizerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should normalize data without losing information', () => {
    const timestamp = new Date();
    const data: CrawledMarketData[] = [
      { token: 'bitcoin', symbol: 'BTC', timestamp, source: 'coinmarketcap', price: 65000, rawData: {} },
    ];

    const normalized = service.normalizeData(data);
    expect(normalized.length).toBe(1);
    expect(normalized[0].token).toBe('bitcoin');
  });
});
