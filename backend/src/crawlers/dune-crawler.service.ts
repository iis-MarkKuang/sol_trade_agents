import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrawledMarketData } from './types/crawler.types';

@Injectable()
export class DuneCrawlerService {
  private readonly logger = new Logger(DuneCrawlerService.name);

  constructor(private readonly prismaService: PrismaService) {}

  transformToCrawledData(data: any[]): CrawledMarketData[] {
    const timestamp = new Date();
    return data.map((item) => ({
      token: item.token,
      symbol: item.symbol,
      timestamp,
      source: 'dune',
      tvl: item.tvl,
      activeAddresses: item.activeAddresses,
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
            tvl: item.tvl,
            activeAddresses: item.activeAddresses,
            rawData: item.rawData,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to save Dune data for ${item.symbol}`, error);
      }
    }
  }

  async fetchOnChainData(): Promise<any[]> {
    // For demo, we'll use mock data since Dune API requires queries and keys
    return [
      { token: 'solana', symbol: 'SOL', tvl: 2000000000, activeAddresses: 450000 },
      { token: 'ethereum', symbol: 'ETH', tvl: 35000000000, activeAddresses: 1200000 },
    ];
  }

  async run(): Promise<CrawledMarketData[]> {
    this.logger.log('Starting Dune crawler...');
    const data = await this.fetchOnChainData();
    const transformed = this.transformToCrawledData(data);
    await this.saveToDatabase(transformed);
    this.logger.log(`Successfully processed ${transformed.length} items`);
    return transformed;
  }
}
