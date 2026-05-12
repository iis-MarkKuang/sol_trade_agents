import { Injectable, Logger } from '@nestjs/common';
import { TradingStrategy, TradeSignal } from './strategy.interface';
import { CrawledMarketData } from '../crawlers/types/crawler.types';
import { SimpleMomentumStrategy } from './strategies/simple-momentum.strategy';

@Injectable()
export class StrategyEngineService {
  private readonly logger = new Logger(StrategyEngineService.name);
  private strategies: TradingStrategy[] = [];

  constructor(private simpleMomentumStrategy: SimpleMomentumStrategy) {
    this.strategies.push(simpleMomentumStrategy);
  }

  registerStrategy(strategy: TradingStrategy) {
    this.strategies.push(strategy);
    this.logger.log(`Registered strategy: ${strategy.name}`);
  }

  async runAllStrategies(data: CrawledMarketData[]): Promise<TradeSignal[]> {
    const allSignals: TradeSignal[] = [];

    for (const strategy of this.strategies) {
      try {
        const signals = await strategy.generateSignals(data);
        allSignals.push(...signals);
      } catch (error) {
        this.logger.error(`Strategy ${strategy.name} failed:`, error);
      }
    }

    return allSignals;
  }
}
