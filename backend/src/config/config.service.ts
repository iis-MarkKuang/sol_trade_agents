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
  COINMARKETCAP_CACHE_TTL_MS: numberFromString(10 * 60 * 1000),
  DUNE_API_KEY: z.string().optional(),
  DUNE_API_BASE_URL: z.string().default('https://api.dune.com/api'),
  DUNE_CHAINS: z.string().default('solana,ethereum,base,arbitrum,optimism,polygon,bnb,robinhood'),
  DUNE_LOOKBACK_HOURS: numberFromString(24),
  DUNE_RESULT_LIMIT: numberFromString(100),
  DUNE_QUERY_TIMEOUT_MS: numberFromString(120_000),
  DUNE_PERFORMANCE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['small', 'medium', 'large']).optional(),
  ),
  DUNE_CACHE_TTL_MS: numberFromString(3 * 60 * 60 * 1000),
  DUNE_MAX_EXECUTIONS_PER_DAY: numberFromString(8),
  DUNE_USE_MOCK: booleanFromString(false),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SOLANA_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  ENABLE_REAL_DEX: booleanFromString(false),
  JUPITER_API_KEY: z.string().optional(),
  ORCA_WALLET_PUBLIC_KEY: z.string().optional(),
  ORCA_POOLS_BY_PAIR: z.string().optional(),
  PYTH_HERMES_ENDPOINT: z.string().optional(),
  PYTH_STALE_MS: numberFromString(15_000),
  PYTH_MAX_CONFIDENCE_BPS: numberFromString(75),
  PYTH_USE_MOCK: booleanFromString(false),

  ENABLE_INJECTIVE: booleanFromString(false),
  INJECTIVE_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  INJECTIVE_EXCHANGE_API: z.string().default('https://api.injective.exchange'),
  INJECTIVE_MCP_BIN: z.string().default('npx -y @injectivelabs/mcp-server'),
  INJECTIVE_MNEMONIC: z.string().optional(),
  INJECTIVE_HELI_MARKETS: z.string().optional(),

  // Injective Agent Identity (ERC-8004). Read-only registry browse uses viem
  // directly. Real on-chain registration requires the @injective/agent-sdk
  // (not yet on npm) + Pinata JWT; the mock path covers the demo otherwise.
  INJECTIVE_AGENT_NAME: z.string().default('Solana<->Injective Cross-Chain Quant Agent'),
  INJECTIVE_AGENT_TYPE: z
    .enum(['trading', 'liquidation', 'data', 'portfolio', 'other'])
    .default('trading'),
  INJECTIVE_AGENT_BUILDER_CODE: z.string().default('nova-sol-trade-agent'),
  INJECTIVE_AGENT_DESCRIPTION: z
    .string()
    .default(
      'Autonomous cross-chain arbitrage agent between Solana DEXs and Injective Helix, exposing an MCP endpoint for natural-language quant assistance.',
    ),
  INJECTIVE_AGENT_ID: z.string().optional(), // a real registered agentId (bigint-as-string)
  INJECTIVE_AGENT_PRIVATE_KEY: z.string().optional(), // EVM key for the agent identity wallet
  INJECTIVE_AGENT_REGISTRY_ENABLED: booleanFromString(false), // live read from ERC-8004 registry
  INJECTIVE_AGENT_SCAN_FROM_BLOCK: z.string().optional(), // override scan start block
  INJECTIVE_AGENT_SCAN_MAX_CHUNKS: numberFromString(6), // bounded event scan chunks
  INJECTIVE_AGENT_SCAN_CHUNK_SIZE: numberFromString(20_000),
  PINATA_JWT: z.string().optional(),

  // Public URL of THIS backend's MCP endpoint (declared in the Agent Card services).
  MCP_PUBLIC_URL: z.string().default('http://localhost:3000/mcp'),
  A2A_PUBLIC_URL: z.string().optional(),

  // Provider-specific credentials are kept separate even when providers share
  // the OpenAI-compatible wire protocol.
  LLM_PROVIDER: z.enum(['azure', 'openai', 'deepseek']).optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_INSTANCE_NAME: z.string().optional(),
  AZURE_OPENAI_API_DEPLOYMENT_NAME: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-08-01-preview'),
  AZURE_OPENAI_BASE_PATH: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com/v1'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  LLM_MODEL: z.string().optional(),
  LLM_TEMPERATURE: numberFromString(0.3),
  LLM_MAX_OUTPUT_TOKENS: numberFromString(512),

  DECISION_PROVIDER: z.enum(['none', 'jev']).default('none'),
  TYPESAFE_API_KEY: z.string().optional(),
  JEV_API_BASE_URL: z.string().default('https://api.typesafe.ai'),
  JEV_MODEL: z.string().default('jev-1.13.0'),
  JEV_TIMEOUT_MS: numberFromString(1_500),
  JEV_QUALITY_GATE_MODE: z.enum(['disabled', 'shadow', 'enforce']).default('shadow'),
  JEV_QUALITY_GATE_MIN_CONFIDENCE: numberFromString(0.75),

  // UsageLedger cost controls. Defaults are placeholders pending OP-14.
  // The feature flag defaults to false so current behavior is unchanged.
  USAGE_LEDGER_ENABLED: booleanFromString(false),
  USAGE_LEDGER_DUNE_HARD_LIMIT_PER_DAY: numberFromString(8),
  USAGE_LEDGER_DUNE_WARNING_PCT: numberFromString(80),
  USAGE_LEDGER_CMC_HARD_LIMIT_PER_DAY: numberFromString(1000),
  USAGE_LEDGER_CMC_WARNING_PCT: numberFromString(80),
  USAGE_LEDGER_LLM_HARD_LIMIT_PER_DAY: numberFromString(50_000),
  USAGE_LEDGER_LLM_WARNING_PCT: numberFromString(80),
  USAGE_LEDGER_JEV_HARD_LIMIT_PER_DAY: numberFromString(50_000),
  USAGE_LEDGER_JEV_WARNING_PCT: numberFromString(80),

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

  get coinmarketcap() {
    return {
      apiKey: this.config.COINMARKETCAP_API_KEY,
      cacheTtlMs: Math.max(60_000, this.config.COINMARKETCAP_CACHE_TTL_MS),
    };
  }

  get duneApiKey() {
    return this.config.DUNE_API_KEY;
  }

  get dune() {
    const chains = this.config.DUNE_CHAINS.split(',')
      .map((chain) => chain.trim().toLowerCase())
      .filter((chain) => /^[a-z0-9_]+$/.test(chain));

    return {
      apiKey: this.config.DUNE_API_KEY,
      apiBaseUrl: this.config.DUNE_API_BASE_URL.replace(/\/+$/, ''),
      chains: [...new Set(chains)],
      lookbackHours: Math.min(168, Math.max(1, this.config.DUNE_LOOKBACK_HOURS)),
      resultLimit: Math.min(500, Math.max(1, this.config.DUNE_RESULT_LIMIT)),
      queryTimeoutMs: Math.max(5_000, this.config.DUNE_QUERY_TIMEOUT_MS),
      performance: this.config.DUNE_PERFORMANCE,
      cacheTtlMs: Math.max(60_000, this.config.DUNE_CACHE_TTL_MS),
      maxExecutionsPerDay: Math.max(1, Math.floor(this.config.DUNE_MAX_EXECUTIONS_PER_DAY)),
      useMock: this.config.DUNE_USE_MOCK,
    };
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
      pythUseMock: this.config.PYTH_USE_MOCK,
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

  get injective() {
    return {
      enabled: this.config.ENABLE_INJECTIVE,
      network: this.config.INJECTIVE_NETWORK,
      exchangeApi: this.config.INJECTIVE_EXCHANGE_API,
      mcpBin: this.config.INJECTIVE_MCP_BIN,
      mnemonic: this.config.INJECTIVE_MNEMONIC,
      helixMarkets: this.config.INJECTIVE_HELI_MARKETS,
    };
  }

  get agentIdentity() {
    return {
      name: this.config.INJECTIVE_AGENT_NAME,
      type: this.config.INJECTIVE_AGENT_TYPE,
      builderCode: this.config.INJECTIVE_AGENT_BUILDER_CODE,
      description: this.config.INJECTIVE_AGENT_DESCRIPTION,
      agentId: this.config.INJECTIVE_AGENT_ID, // string | undefined
      privateKey: this.config.INJECTIVE_AGENT_PRIVATE_KEY,
      registryEnabled: this.config.INJECTIVE_AGENT_REGISTRY_ENABLED,
      scanFromBlock: this.config.INJECTIVE_AGENT_SCAN_FROM_BLOCK,
      scanMaxChunks: this.config.INJECTIVE_AGENT_SCAN_MAX_CHUNKS,
      scanChunkSize: this.config.INJECTIVE_AGENT_SCAN_CHUNK_SIZE,
      pinataJwt: this.config.PINATA_JWT,
      mcpPublicUrl: this.config.MCP_PUBLIC_URL,
      a2aPublicUrl: this.config.A2A_PUBLIC_URL,
      network: this.config.INJECTIVE_NETWORK,
    };
  }

  get llm() {
    const provider =
      this.config.LLM_PROVIDER ??
      (this.config.AZURE_OPENAI_API_KEY
        ? 'azure'
        : this.config.DEEPSEEK_API_KEY
          ? 'deepseek'
          : 'openai');
    const model =
      this.config.LLM_MODEL ??
      (provider === 'deepseek'
        ? this.config.DEEPSEEK_MODEL
        : provider === 'azure'
          ? (this.config.AZURE_OPENAI_API_DEPLOYMENT_NAME ?? this.config.OPENAI_MODEL)
          : this.config.OPENAI_MODEL);

    return {
      provider,
      azureOpenAIApiKey: this.config.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName: this.config.AZURE_OPENAI_API_INSTANCE_NAME,
      azureOpenAIApiDeploymentName: this.config.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: this.config.AZURE_OPENAI_API_VERSION,
      azureOpenAIBasePath: this.config.AZURE_OPENAI_BASE_PATH,
      openAIApiKey: this.config.OPENAI_API_KEY,
      openAIBaseUrl: this.config.OPENAI_BASE_URL,
      deepSeekApiKey: this.config.DEEPSEEK_API_KEY,
      deepSeekBaseUrl: this.config.DEEPSEEK_BASE_URL,
      model,
      temperature: this.config.LLM_TEMPERATURE,
      maxOutputTokens: Math.min(8_192, Math.max(64, Math.floor(this.config.LLM_MAX_OUTPUT_TOKENS))),
    };
  }

  get decision() {
    return {
      provider: this.config.DECISION_PROVIDER,
      jevApiKey: this.config.TYPESAFE_API_KEY,
      jevApiBaseUrl: this.config.JEV_API_BASE_URL.replace(/\/+$/, ''),
      jevModel: this.config.JEV_MODEL,
      jevTimeoutMs: Math.max(100, this.config.JEV_TIMEOUT_MS),
      qualityGateMode: this.config.JEV_QUALITY_GATE_MODE,
      qualityGateMinConfidence: Math.min(
        1,
        Math.max(0, this.config.JEV_QUALITY_GATE_MIN_CONFIDENCE),
      ),
    };
  }

  get usageLedger() {
    const clampPct = (v: number) => Math.min(100, Math.max(0, Math.floor(v)));
    const clampLimit = (v: number) => Math.max(1, Math.floor(v));
    return {
      enabled: this.config.USAGE_LEDGER_ENABLED,
      dune: {
        hardLimitPerDay: clampLimit(this.config.USAGE_LEDGER_DUNE_HARD_LIMIT_PER_DAY),
        warningPct: clampPct(this.config.USAGE_LEDGER_DUNE_WARNING_PCT),
      },
      coinmarketcap: {
        hardLimitPerDay: clampLimit(this.config.USAGE_LEDGER_CMC_HARD_LIMIT_PER_DAY),
        warningPct: clampPct(this.config.USAGE_LEDGER_CMC_WARNING_PCT),
      },
      llm: {
        hardLimitPerDay: clampLimit(this.config.USAGE_LEDGER_LLM_HARD_LIMIT_PER_DAY),
        warningPct: clampPct(this.config.USAGE_LEDGER_LLM_WARNING_PCT),
      },
      jev: {
        hardLimitPerDay: clampLimit(this.config.USAGE_LEDGER_JEV_HARD_LIMIT_PER_DAY),
        warningPct: clampPct(this.config.USAGE_LEDGER_JEV_WARNING_PCT),
      },
    };
  }
}
