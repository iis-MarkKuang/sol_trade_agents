import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageLedgerService } from '../usage-ledger/usage-ledger.service';
import { CrawledMarketData, CoinmarketcapListing } from './types/crawler.types';

interface CoingeckoMarketEntry {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
}

@Injectable()
export class CoinmarketcapCrawlerService {
  private readonly logger = new Logger(CoinmarketcapCrawlerService.name);
  private readonly baseUrl = 'https://pro-api.coinmarketcap.com/v1';
  private readonly coingeckoBaseUrl = 'https://api.coingecko.com/api/v3';
  private readonly externalTimeoutMs = 5_000;
  private readonly cachedListings = new Map<number, { expiresAt: number; value: any }>();
  private readonly listingsRequests = new Map<number, Promise<any>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly usageLedger: UsageLedgerService,
  ) {}

  transformToCrawledData(response: any): CrawledMarketData[] {
    const listings = response.data || [];
    const sourceLabel = typeof response?.source === 'string' ? response.source : 'coinmarketcap';
    const timestamp = new Date();
    return listings.map((listing: CoinmarketcapListing) => ({
      token: listing.slug,
      symbol: listing.symbol,
      timestamp,
      source: sourceLabel,
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
    const cached = this.cachedListings.get(limit);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug('Using cached market listings (no external credits consumed)');
      if (this.usageLedger.enabled) {
        // Observability only; a cache_hit must never block the cache return.
        try {
          await this.usageLedger.recordCacheHit('coinmarketcap', new Date(), 'listings');
        } catch (error) {
          this.logger.debug(`cache_hit recording failed: ${(error as Error).message}`);
        }
      }
      return cached.value;
    }
    const pending = this.listingsRequests.get(limit);
    if (pending) {
      return pending;
    }

    const request = this.fetchFreshListings(limit);
    this.listingsRequests.set(limit, request);
    try {
      const value = await request;
      this.cachedListings.set(limit, {
        expiresAt: Date.now() + this.configService.coinmarketcap.cacheTtlMs,
        value,
      });
      return value;
    } finally {
      this.listingsRequests.delete(limit);
    }
  }

  private async fetchFreshListings(limit: number): Promise<any> {
    const cmcResponse = await this.tryFetchFromCoinmarketcap(limit);
    if (cmcResponse) {
      this.logger.log(`Fetched ${cmcResponse.data.length} listings from CoinMarketCap`);
      return { ...cmcResponse, source: 'coinmarketcap' };
    }

    const geckoResponse = await this.tryFetchFromCoingecko(limit);
    if (geckoResponse) {
      this.logger.log(
        `Fetched ${geckoResponse.data.length} listings from CoinGecko (CMC unavailable)`,
      );
      return { ...geckoResponse, source: 'coingecko' };
    }

    this.logger.warn('All external price sources unavailable, using static mock fallback');
    return { data: this.buildMockListings(), source: 'mock' };
  }

  private async tryFetchFromCoinmarketcap(
    limit: number,
  ): Promise<{ data: CoinmarketcapListing[] } | null> {
    const apiKey = this.configService.coinmarketcapApiKey;
    if (!apiKey) {
      this.logger.debug('Skipping CoinMarketCap (no COINMARKETCAP_API_KEY configured)');
      return null;
    }

    if (this.usageLedger.enabled) {
      // Budget gate: when the daily credit budget is exhausted (or the
      // budget check itself fails), skip CMC and fall through to the free
      // CoinGecko fallback rather than crashing the pipeline.
      let reservation;
      try {
        reservation = await this.usageLedger.reserve('coinmarketcap', new Date(), 1, {
          unitKind: 'credits',
          queryKey: 'listings',
        });
      } catch (error) {
        this.logger.warn(
          `CMC budget check failed, skipping to fallback: ${(error as Error).message}`,
        );
        return null;
      }
      if (!reservation.allowed) {
        this.logger.warn(
          `CoinMarketCap daily budget exhausted (${reservation.hardLimit} credits); using fallback`,
        );
        return null;
      }
      try {
        const data = await this.callCoinmarketcap(limit, apiKey);
        await this.usageLedger.recordActual(
          'coinmarketcap',
          new Date(),
          reservation.reservationId,
          1,
          { unitKind: 'credits', queryKey: 'listings' },
        );
        return data;
      } catch (error: any) {
        await this.usageLedger.recordFailed('coinmarketcap', new Date(), reservation.reservationId, {
          unitKind: 'credits',
          queryKey: 'listings',
        });
        const status = error?.response?.status;
        this.logger.warn(
          `CoinMarketCap fetch failed${status ? ` (HTTP ${status})` : ''}: ${error?.message ?? error}`,
        );
        return null;
      }
    }

    // Legacy path (USAGE_LEDGER_ENABLED=false) — unchanged behavior.
    try {
      return await this.callCoinmarketcap(limit, apiKey);
    } catch (error: any) {
      const status = error?.response?.status;
      this.logger.warn(
        `CoinMarketCap fetch failed${status ? ` (HTTP ${status})` : ''}: ${error?.message ?? error}`,
      );
      return null;
    }
  }

  private async callCoinmarketcap(
    limit: number,
    apiKey: string,
  ): Promise<{ data: CoinmarketcapListing[] }> {
    const response = await axios.get(`${this.baseUrl}/cryptocurrency/listings/latest`, {
      headers: { 'X-CMC_PRO_API_KEY': apiKey },
      params: { limit },
      timeout: this.externalTimeoutMs,
    });
    return response.data;
  }

  private async tryFetchFromCoingecko(
    limit: number,
  ): Promise<{ data: CoinmarketcapListing[] } | null> {
    try {
      const response = await axios.get<CoingeckoMarketEntry[]>(
        `${this.coingeckoBaseUrl}/coins/markets`,
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: limit,
            page: 1,
            sparkline: false,
          },
          timeout: this.externalTimeoutMs,
        },
      );

      const listings = (response.data ?? []).map<CoinmarketcapListing>((entry, idx) => ({
        id: idx + 1,
        name: entry.name,
        symbol: entry.symbol?.toUpperCase() ?? '',
        slug: entry.id,
        cmc_rank: entry.market_cap_rank ?? idx + 1,
        quote: {
          USD: {
            price: entry.current_price,
            volume_24h: entry.total_volume,
            market_cap: entry.market_cap,
          },
        },
      }));

      return { data: listings };
    } catch (error: any) {
      const status = error?.response?.status;
      this.logger.warn(
        `CoinGecko fetch failed${status ? ` (HTTP ${status})` : ''}: ${error?.message ?? error}`,
      );
      return null;
    }
  }

  // Approximate snapshot used only when both CMC and CoinGecko are unreachable.
  // Refresh occasionally so the demo doesn't drift too far from reality.
  private buildMockListings(): CoinmarketcapListing[] {
    return [
      {
        id: 1,
        name: 'Bitcoin',
        symbol: 'BTC',
        slug: 'bitcoin',
        cmc_rank: 1,
        quote: { USD: { price: 81000, volume_24h: 38_000_000_000, market_cap: 1_600_000_000_000 } },
      },
      {
        id: 1027,
        name: 'Ethereum',
        symbol: 'ETH',
        slug: 'ethereum',
        cmc_rank: 2,
        quote: { USD: { price: 3200, volume_24h: 18_000_000_000, market_cap: 385_000_000_000 } },
      },
      {
        id: 5426,
        name: 'Solana',
        symbol: 'SOL',
        slug: 'solana',
        cmc_rank: 5,
        quote: { USD: { price: 190, volume_24h: 4_500_000_000, market_cap: 90_000_000_000 } },
      },
    ];
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
