import { Injectable, Logger } from '@nestjs/common';
import { CrawledMarketData } from '../crawlers/types/crawler.types';

@Injectable()
export class DataNormalizerService {
  private readonly logger = new Logger(DataNormalizerService.name);

  calculatePriceMomentum(data: CrawledMarketData[]): CrawledMarketData[] {
    // In real scenario, we'd compare with previous data points
    // For now, just mock some momentum
    return data.map((item) => ({
      ...item,
    }));
  }

  normalizeData(data: CrawledMarketData[]): CrawledMarketData[] {
    const normalized = data.map((item) => {
      return {
        ...item,
      };
    });
    return this.calculatePriceMomentum(normalized);
  }
}
