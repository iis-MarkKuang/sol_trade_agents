import { Injectable, Logger } from '@nestjs/common';
import { CrawledMarketData } from '../crawlers/types/crawler.types';

@Injectable()
export class DataCleanerService {
  private readonly logger = new Logger(DataCleanerService.name);

  removeDuplicates(data: CrawledMarketData[]): CrawledMarketData[] {
    const seen = new Set<string>();
    return data.filter((item) => {
      const key = `${item.token}-${item.timestamp.getTime()}-${item.source}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  removeInvalidData(data: CrawledMarketData[]): CrawledMarketData[] {
    return data.filter((item) => {
      if (!item.token || !item.symbol) {
        return false;
      }
      if (item.price !== undefined && item.price < 0) {
        return false;
      }
      if (item.volume24h !== undefined && item.volume24h < 0) {
        return false;
      }
      if (item.marketCap !== undefined && item.marketCap < 0) {
        return false;
      }
      return true;
    });
  }

  cleanData(data: CrawledMarketData[]): CrawledMarketData[] {
    let cleaned = this.removeDuplicates(data);
    cleaned = this.removeInvalidData(cleaned);
    this.logger.log(`Cleaned ${data.length - cleaned.length} invalid/duplicate items`);
    return cleaned;
  }
}
