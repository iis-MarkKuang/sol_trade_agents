import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const numberFromString = (defaultValue: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') {
        return defaultValue;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    });

const booleanFromString = (defaultValue: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (value === undefined || value === '') {
        return defaultValue;
      }
      return value === 'true' || value === '1';
    });

const ConfigSchema = z.object({
  COINMARKETCAP_API_KEY: z.string().optional(),
  DUNE_API_KEY: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SOLANA_RPC_URL: z
    .string()
    .default('https://api.mainnet-beta.solana.com'),
  ENABLE_REAL_DEX: booleanFromString(false),
  JUPITER_API_KEY: z.string().optional(),
  ORCA_WALLET_PUBLIC_KEY: z.string().optional(),
  ORCA_POOLS_BY_PAIR: z.string().optional(),
  PYTH_HERMES_ENDPOINT: z.string().optional(),
  PYTH_STALE_MS: numberFromString(15_000),
  PYTH_MAX_CONFIDENCE_BPS: numberFromString(75),

  MAX_SLIPPAGE_BPS: numberFromString(100),
  MAX_POSITION_NOTIONAL_USD: numberFromString(25_000),
  MIN_LIQUIDITY_USD: numberFromString(1_000),
  MAX_ORACLE_DEVIATION_BPS: numberFromString(150),
  MAX_PRICE_IMPACT_BPS: numberFromString(100),
  MAX_QUOTE_AGE_MS: numberFromString(5_000),
  DEX_QUOTE_TIMEOUT_MS: numberFromString(2_500),
  REALTIME_RETRIES: numberFromString(2),
});

@Injectable()
export class ConfigService {
  private config: z.infer<typeof ConfigSchema>;

  constructor() {
    this.config = ConfigSchema.parse(process.env);
  }

  get coinmarketcapApiKey() {
    return this.config.COINMARKETCAP_API_KEY;
  }

  get duneApiKey() {
    return this.config.DUNE_API_KEY;
  }

  get redisUrl() {
    return this.config.REDIS_URL;
  }

  get isProduction() {
    return this.config.NODE_ENV === 'production';
  }

  get realtime() {
    return {
      solanaRpcUrl: this.config.SOLANA_RPC_URL,
      enableRealDex: this.config.ENABLE_REAL_DEX,
      jupiterApiKey: this.config.JUPITER_API_KEY,
      orcaWalletPublicKey: this.config.ORCA_WALLET_PUBLIC_KEY,
      orcaPoolsByPair: this.config.ORCA_POOLS_BY_PAIR,
      pythHermesEndpoint: this.config.PYTH_HERMES_ENDPOINT,
      pythStaleMs: this.config.PYTH_STALE_MS,
      pythMaxConfidenceBps: this.config.PYTH_MAX_CONFIDENCE_BPS,
      maxSlippageBps: this.config.MAX_SLIPPAGE_BPS,
      maxPositionNotionalUsd: this.config.MAX_POSITION_NOTIONAL_USD,
      minLiquidityUsd: this.config.MIN_LIQUIDITY_USD,
      maxOracleDeviationBps: this.config.MAX_ORACLE_DEVIATION_BPS,
      maxPriceImpactBps: this.config.MAX_PRICE_IMPACT_BPS,
      maxQuoteAgeMs: this.config.MAX_QUOTE_AGE_MS,
      dexQuoteTimeoutMs: this.config.DEX_QUOTE_TIMEOUT_MS,
      retries: this.config.REALTIME_RETRIES,
    };
  }
}
