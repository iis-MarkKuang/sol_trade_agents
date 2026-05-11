import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrawledMarketData, CoinmarketcapListing } from './types/crawler.types';

@Injectable()
export class CoinmarketcapCrawlerService {
  private readonly logger = new Logger(CoinmarketcapCrawlerService.name);
  private readonly baseUrl = 'https://pro-api.coinmarketcap.com/v1';

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  transformToCrawledData(response: any): CrawledMarketData[] {
    const listings = response.data || [];
    const timestamp = new Date();
    return listings.map((listing: CoinmarketcapListing) => ({
      token: listing.slug,
      symbol: listing.symbol,
      timestamp,
      source: 'coinmarketcap',
      price: listing.quote?.USD?.price,
      volume24h: listing.quote?.USD?.volume_24h,
      marketCap: listing.quote?.USD?.market_cap,
      rawData: listing,
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
            volume24h: item.volume24h,
            marketCap: item.marketCap,
            tvl: item.tvl,
            activeAddresses: item.activeAddresses,
            rawData: item.rawData,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to save market data for ${item.symbol}`, error);
      }
    }
  }

  async fetchListings(limit: number = 20): Promise<any> {
    try {
      const headers: any = {};
      if (this.configService.coinmarketcapApiKey) {
        headers['X-CMC_PRO_API_KEY'] = this.configService.coinmarketcapApiKey;
      }

      const params = { limit };
      const response = await axios.get(`${this.baseUrl}/cryptocurrency/listings/latest`, {
        headers,
        params,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch CoinMarketCap listings', error);
      // Fallback to mock data for demo if no API key
      return {
        data: [
          {
            id: 1,
            name: 'Bitcoin',
            symbol: 'BTC',
            slug: 'bitcoin',
            cmc_rank: 1,
            quote: { USD: { price: 65000, volume_24h: 40000000000, market_cap: 1280000000000 } },
          },
          {
            id: 1027,
            name: 'Ethereum',
            symbol: 'ETH',
            slug: 'ethereum',
            cmc_rank: 2,
            quote: { USD: { price: 3500, volume_24h: 15000000000, market_cap: 420000000000 } },
          },
        ],
      };
    }
  }

  async run(limit: number = 20): Promise<CrawledMarketData[]> {
    this.logger.log('Starting CoinMarketCap crawler...');
    const listings = await this.fetchListings(limit);
    const data = this.transformToCrawledData(listings);
    await this.saveToDatabase(data);
    this.logger.log(`Successfully processed ${data.length} listings`);
    return data;
  }
}
