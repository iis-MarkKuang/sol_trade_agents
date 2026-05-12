import { Injectable, Logger } from '@nestjs/common';
import { TradingStrategy, TradeSignal } from '../strategy.interface';
import { CrawledMarketData } from '../../crawlers/types/crawler.types';

@Injectable()
export class SimpleMomentumStrategy implements TradingStrategy {
  name = 'SimpleMomentum';
  description = 'A simple strategy that looks for price momentum with RSI indicators';
  private readonly logger = new Logger(SimpleMomentumStrategy.name);

  async generateSignals(data: CrawledMarketData[]): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];

    for (const item of data) {
      const rsiValue = item.rsi14 ?? item.rsi;
      if (rsiValue !== undefined && item.price !== undefined) {
        if (rsiValue < 30) {
          signals.push({
            token: item.token,
            symbol: item.symbol,
            action: 'buy',
            confidence: 0.7,
            reason: `RSI is ${rsiValue} indicating oversold conditions`,
            price: item.price,
            strategy: this.name,
            status: 'pending',
            timestamp: item.timestamp,
          });
        } else if (rsiValue > 70) {
          signals.push({
            token: item.token,
            symbol: item.symbol,
            action: 'sell',
            confidence: 0.7,
            reason: `RSI is ${rsiValue} indicating overbought conditions`,
            price: item.price,
            strategy: this.name,
            status: 'pending',
            timestamp: item.timestamp,
          });
        }
      }
    }

    this.logger.log(`Generated ${signals.length} signals with SimpleMomentum`);
    return signals;
  }
}
