export interface CrawledMarketData {
  token: string;
  symbol: string;
  timestamp: Date;
  source: string;
  price?: number;
  volume24h?: number;
  marketCap?: number;
  rsi?: number;
  macd?: number;
  tvl?: number;
  activeAddresses?: number;
  rawData: any;
}

export interface CoinmarketcapListing {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  cmc_rank: number;
  quote: {
    USD: {
      price: number;
      volume_24h: number;
      market_cap: number;
    };
  };
}
