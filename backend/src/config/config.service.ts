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
  PYTH_USE_MOCK: booleanFromString(false),

  ENABLE_INJECTIVE: booleanFromString(false),
  INJECTIVE_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  INJECTIVE_EXCHANGE_API: z
    .string()
    .default('https://api.injective.exchange'),
  INJECTIVE_MCP_BIN: z
    .string()
    .default('npx -y @injectivelabs/mcp-server'),
  INJECTIVE_MNEMONIC: z.string().optional(),
  INJECTIVE_HELI_MARKETS: z.string().optional(),

  // Injective Agent Identity (ERC-8004). Read-only registry browse uses viem
  // directly. Real on-chain registration requires the @injective/agent-sdk
  // (not yet on npm) + Pinata JWT; the mock path covers the demo otherwise.
  INJECTIVE_AGENT_NAME: z.string().default('Solana<->Injective Cross-Chain Quant Agent'),
  INJECTIVE_AGENT_TYPE: z.enum(['trading', 'liquidation', 'data', 'portfolio', 'other']).default('trading'),
  INJECTIVE_AGENT_BUILDER_CODE: z.string().default('nova-sol-trade-agent'),
  INJECTIVE_AGENT_DESCRIPTION: z
    .string()
    .default('Autonomous cross-chain arbitrage agent between Solana DEXs and Injective Helix, exposing an MCP endpoint for natural-language quant assistance.'),
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

  // LLM provider selection: "azure" uses Azure OpenAI Service (Nova Program
  // Azure credits), "openai" uses the public OpenAI API. Auto-detected when
  // LLM_PROVIDER is unset: Azure wins if AZURE_OPENAI_API_KEY is present.
  LLM_PROVIDER: z.enum(['azure', 'openai']).optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_INSTANCE_NAME: z.string().optional(),
  AZURE_OPENAI_API_DEPLOYMENT_NAME: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-08-01-preview'),
  AZURE_OPENAI_BASE_PATH: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TEMPERATURE: numberFromString(0.3),

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
      (this.config.AZURE_OPENAI_API_KEY ? 'azure' : 'openai');
    return {
      provider: provider as 'azure' | 'openai',
      azureOpenAIApiKey: this.config.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName: this.config.AZURE_OPENAI_API_INSTANCE_NAME,
      azureOpenAIApiDeploymentName: this.config.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: this.config.AZURE_OPENAI_API_VERSION,
      azureOpenAIBasePath: this.config.AZURE_OPENAI_BASE_PATH,
      openAIApiKey: this.config.OPENAI_API_KEY,
      openAIBaseUrl: this.config.OPENAI_BASE_URL,
      model: this.config.LLM_MODEL,
      temperature: this.config.LLM_TEMPERATURE,
    };
  }
}
