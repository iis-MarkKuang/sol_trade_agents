import { ConfigService } from './config.service';

const LLM_ENV_KEYS = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_MAX_OUTPUT_TOKENS',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'AZURE_OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DECISION_PROVIDER',
  'TYPESAFE_API_KEY',
  'JEV_MODEL',
  'JEV_QUALITY_GATE_MODE',
  'JEV_QUALITY_GATE_MIN_CONFIDENCE',
  'COINMARKETCAP_CACHE_TTL_MS',
  'DUNE_CACHE_TTL_MS',
  'DUNE_MAX_EXECUTIONS_PER_DAY',
  'USAGE_LEDGER_ENABLED',
  'USAGE_LEDGER_DUNE_HARD_LIMIT_PER_DAY',
  'USAGE_LEDGER_DUNE_WARNING_PCT',
  'USAGE_LEDGER_CMC_HARD_LIMIT_PER_DAY',
  'USAGE_LEDGER_CMC_WARNING_PCT',
  'USAGE_LEDGER_LLM_HARD_LIMIT_PER_DAY',
  'USAGE_LEDGER_LLM_WARNING_PCT',
  'USAGE_LEDGER_JEV_HARD_LIMIT_PER_DAY',
  'USAGE_LEDGER_JEV_WARNING_PCT',
  'ENABLE_MONAD',
  'MONAD_NETWORK',
  'MONAD_RPC_URL',
  'MONAD_PRIVATE_KEY',
  'MONAD_DEX_MODE',
  'ZEROX_API_KEY',
  'ONEINCH_API_KEY',
  'MONAD_MOCK_PREMIUM_BPS',
] as const;

describe('ConfigService LLM providers', () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of LLM_ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of LLM_ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();
  });

  it('auto-selects DeepSeek when its key is configured', () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';

    const config = new ConfigService().llm;

    expect(config.provider).toBe('deepseek');
    expect(config.model).toBe('deepseek-chat');
  });

  it('keeps OpenAI credentials and model provider-specific', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_MODEL = 'gpt-4.1-mini';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';

    const config = new ConfigService().llm;

    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4.1-mini');
    expect(config.openAIApiKey).toBe('openai-key');
  });

  it('allows LLM_MODEL to override the provider default', () => {
    process.env.LLM_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    process.env.LLM_MODEL = 'deepseek-reasoner';

    expect(new ConfigService().llm.model).toBe('deepseek-reasoner');
  });

  it('applies bounded provider usage controls', () => {
    process.env.LLM_MAX_OUTPUT_TOKENS = '256';
    process.env.COINMARKETCAP_CACHE_TTL_MS = '300000';
    process.env.DUNE_CACHE_TTL_MS = '7200000';
    process.env.DUNE_MAX_EXECUTIONS_PER_DAY = '4';

    const config = new ConfigService();

    expect(config.llm.maxOutputTokens).toBe(256);
    expect(config.coinmarketcap.cacheTtlMs).toBe(300_000);
    expect(config.dune.cacheTtlMs).toBe(7_200_000);
    expect(config.dune.maxExecutionsPerDay).toBe(4);
  });

  it('configures JEV independently from the generative LLM', () => {
    process.env.DECISION_PROVIDER = 'jev';
    process.env.TYPESAFE_API_KEY = 'typesafe-key';
    process.env.JEV_MODEL = 'jev-1.13.0';
    process.env.JEV_QUALITY_GATE_MODE = 'enforce';

    const decision = new ConfigService().decision;

    expect(decision.provider).toBe('jev');
    expect(decision.jevApiKey).toBe('typesafe-key');
    expect(decision.qualityGateMode).toBe('enforce');
  });

  it('usageLedger defaults to disabled with placeholder limits', () => {
    const config = new ConfigService().usageLedger;

    expect(config.enabled).toBe(false);
    expect(config.dune.hardLimitPerDay).toBe(8);
    expect(config.dune.warningPct).toBe(80);
    expect(config.coinmarketcap.hardLimitPerDay).toBe(1000);
    expect(config.llm.hardLimitPerDay).toBe(50_000);
    expect(config.jev.hardLimitPerDay).toBe(50_000);
  });

  it('usageLedger can be enabled and parses bounded limits', () => {
    process.env.USAGE_LEDGER_ENABLED = 'true';
    process.env.USAGE_LEDGER_DUNE_HARD_LIMIT_PER_DAY = '20';
    process.env.USAGE_LEDGER_DUNE_WARNING_PCT = '90';
    process.env.USAGE_LEDGER_LLM_HARD_LIMIT_PER_DAY = '100000';

    const config = new ConfigService().usageLedger;

    expect(config.enabled).toBe(true);
    expect(config.dune.hardLimitPerDay).toBe(20);
    expect(config.dune.warningPct).toBe(90);
    expect(config.llm.hardLimitPerDay).toBe(100_000);
  });

  it('usageLedger clamps out-of-range values', () => {
    process.env.USAGE_LEDGER_ENABLED = 'true';
    process.env.USAGE_LEDGER_DUNE_WARNING_PCT = '150'; // clamps to 100
    process.env.USAGE_LEDGER_CMC_HARD_LIMIT_PER_DAY = '0'; // clamps to 1
    process.env.USAGE_LEDGER_LLM_HARD_LIMIT_PER_DAY = '-5'; // clamps to 1

    const config = new ConfigService().usageLedger;

    expect(config.dune.warningPct).toBe(100);
    expect(config.coinmarketcap.hardLimitPerDay).toBe(1);
    expect(config.llm.hardLimitPerDay).toBe(1);
  });

  it('monad defaults to disabled with mainnet RPC and 0x dex mode', () => {
    const config = new ConfigService().monad;

    expect(config.enabled).toBe(false);
    expect(config.network).toBe('mainnet');
    expect(config.rpcUrl).toBe('https://rpc.monad.xyz');
    expect(config.dexMode).toBe('0x');
    expect(config.mockPremiumBps).toBe(30);
    expect(config.privateKey).toBeUndefined();
  });

  it('monad can be enabled and parses a non-default dex mode', () => {
    process.env.ENABLE_MONAD = 'true';
    process.env.MONAD_NETWORK = 'testnet';
    process.env.MONAD_DEX_MODE = '1inch';
    process.env.MONAD_MOCK_PREMIUM_BPS = '45';

    const config = new ConfigService().monad;

    expect(config.enabled).toBe(true);
    expect(config.network).toBe('testnet');
    expect(config.dexMode).toBe('1inch');
    expect(config.mockPremiumBps).toBe(45);
  });
});
