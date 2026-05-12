import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrawledMarketData } from './types/crawler.types';

@Injectable()
export class TradingviewCrawlerService {
  private readonly logger = new Logger(TradingviewCrawlerService.name);

  constructor(private readonly prismaService: PrismaService) {}

  transformToCrawledData(data: any[]): CrawledMarketData[] {
    const timestamp = new Date();
    return data.map((item) => ({
      token: item.token,
      symbol: item.symbol,
      timestamp,
      source: 'tradingview',
      price: item.price,
      rsi: item.rsi,
      macd: item.macd,
      rawData: item,
    }));
  }

  async saveToDatabase(data: CrawledMarketData[]): Promise<void> {
    for (const item of data) {
      try {
        await this.prismaService.marketData.create({
          data: {
            token: item.token,
            symbol: item.symbol,
            timestamp: item.timestamp,
            source: item.source,
            price: item.price,
            rsi14: item.rsi,
            macdLine: item.macd,
            rawData: item.rawData,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to save TradingView data for ${item.symbol}`, error);
      }
    }
  }

  async fetchData(): Promise<any[]> {
    // For demo, we'll use mock data since Playwright/real scraping requires more setup
    return [
      { token: 'bitcoin', symbol: 'BTC', price: 65000, rsi: 55, macd: -120 },
      { token: 'ethereum', symbol: 'ETH', price: 3500, rsi: 48, macd: 80 },
    ];
  }

  async run(): Promise<CrawledMarketData[]> {
    this.logger.log('Starting TradingView crawler...');
    const data = await this.fetchData();
    const transformed = this.transformToCrawledData(data);
    await this.saveToDatabase(transformed);
    this.logger.log(`Successfully processed ${transformed.length} items`);
    return transformed;
  }
}
