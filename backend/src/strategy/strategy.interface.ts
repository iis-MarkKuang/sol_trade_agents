import { CrawledMarketData } from '../crawlers/types/crawler.types';

export interface TradeSignal {
  id?: string;
  token: string;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence?: number;
  reason: string;
  price: number;
  strategy: string;
  status: string;
  timestamp: Date;
  source?: string;
}

export interface TradingStrategy {
  name: string;
  description: string;
  generateSignals(data: CrawledMarketData[]): Promise<TradeSignal[]>;
}
