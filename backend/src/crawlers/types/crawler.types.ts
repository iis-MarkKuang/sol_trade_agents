export interface CrawledMarketData {
  token: string;
  symbol: string;
  timestamp: Date;
  source: string;
  price?: number;
  volume24h?: number;
  buyVolumeUsd24h?: number;
  sellVolumeUsd24h?: number;
  netFlowUsd24h?: number;
  tokenBoughtAmount24h?: number;
  tokenSoldAmount24h?: number;
  tradeCount24h?: number;
  chain?: string;
  platform?: string;
  marketCap?: number;
  rsi?: number;
  rsi14?: number;
  macd?: number;
  macdLine?: number;
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
