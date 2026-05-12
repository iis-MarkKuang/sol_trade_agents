import { Test, TestingModule } from '@nestjs/testing';
import { StrategyEngineService } from './strategy-engine.service';
import { SimpleMomentumStrategy } from './strategies/simple-momentum.strategy';
import { CrawledMarketData } from '../crawlers/types/crawler.types';

describe('StrategyEngineService', () => {
  let service: StrategyEngineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StrategyEngineService, SimpleMomentumStrategy],
    }).compile();

    service = module.get<StrategyEngineService>(StrategyEngineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('SimpleMomentumStrategy', () => {
  let strategy: SimpleMomentumStrategy;

  beforeEach(() => {
    strategy = new SimpleMomentumStrategy();
  });

  it('should generate buy signal when RSI < 30', async () => {
    const data: CrawledMarketData[] = [
      { token: 'bitcoin', symbol: 'BTC', timestamp: new Date(), source: 'coinmarketcap', price: 65000, rsi14: 25, rawData: {} },
    ];

    const signals = await strategy.generateSignals(data);
    expect(signals.length).toBe(1);
    expect(signals[0].action).toBe('buy');
  });

  it('should generate sell signal when RSI > 70', async () => {
    const data: CrawledMarketData[] = [
      { token: 'bitcoin', symbol: 'BTC', timestamp: new Date(), source: 'coinmarketcap', price: 65000, rsi14: 75, rawData: {} },
    ];

    const signals = await strategy.generateSignals(data);
    expect(signals.length).toBe(1);
    expect(signals[0].action).toBe('sell');
  });
});
