import { Test, TestingModule } from '@nestjs/testing';
import { LlmAgentService } from './llm-agent.service';
import { ConfigService } from '../config/config.service';
import { UsageLedgerService } from '../usage-ledger/usage-ledger.service';

function makeUsageLedgerMock() {
  return {
    enabled: false,
    reserve: jest.fn(),
    recordActual: jest.fn(),
    recordFailed: jest.fn(),
    recordCacheHit: jest.fn(),
    checkBudget: jest.fn(),
    rebuildCounters: jest.fn(),
  };
}

describe('LlmAgentService', () => {
  let service: LlmAgentService;
  let usageLedger: ReturnType<typeof makeUsageLedgerMock>;

  const baseConfig: any = {
    get: jest.fn(),
    llm: {
      provider: 'openai',
      azureOpenAIApiKey: undefined,
      azureOpenAIApiInstanceName: undefined,
      azureOpenAIApiDeploymentName: undefined,
      azureOpenAIApiVersion: '2024-08-01-preview',
      azureOpenAIBasePath: undefined,
      openAIApiKey: undefined,
      openAIBaseUrl: undefined,
      model: 'gpt-4o-mini',
      temperature: 0.7,
    },
    usageLedger: {
      enabled: false,
      llm: { hardLimitPerDay: 50_000, warningPct: 80 },
    },
  };

  beforeEach(async () => {
    usageLedger = makeUsageLedgerMock();
    baseConfig.usageLedger.enabled = false;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmAgentService,
        { provide: ConfigService, useValue: baseConfig },
        { provide: UsageLedgerService, useValue: usageLedger },
      ],
    }).compile();

    service = module.get<LlmAgentService>(LlmAgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return mock analysis when no API key is set', async () => {
    const analysis = await service.generateAnalysis([]);
    expect(typeof analysis).toBe('string');
    expect(analysis).toContain('mock');
    // No LLM call happened, so no usage is recorded.
    expect(usageLedger.recordActual).not.toHaveBeenCalled();
  });

  describe('with UsageLedger enabled', () => {
    // To exercise the usage-recording path we need a live llm instance. We
    // construct a service with a stubbed llm by overriding the private field
    // after instantiation, then invoke generateAnalysis with a mocked response.
    beforeEach(() => {
      baseConfig.usageLedger.enabled = true;
      usageLedger.enabled = true;
    });

    it('persists token usage via recordActual after a successful LLM call', async () => {
      // Stub the private llm so invoke returns a response with usage_metadata.
      (service as unknown as { llm: { invoke: jest.Mock } }).llm = {
        invoke: jest.fn().mockResolvedValue({
          content: 'Market looks bullish.',
          usage_metadata: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        }),
      };
      usageLedger.recordActual.mockResolvedValue(undefined);

      const analysis = await service.generateAnalysis([
        { token: 'bitcoin', symbol: 'BTC', timestamp: new Date(), source: 'coinmarketcap', price: 65000, rawData: {} },
      ]);

      expect(analysis).toBe('Market looks bullish.');
      expect(usageLedger.recordActual).toHaveBeenCalledWith(
        'llm',
        expect.any(Date),
        expect.any(String),
        150,
        expect.objectContaining({ unitKind: 'tokens', model: 'gpt-4o-mini' }),
      );
    });

    it('records zero tokens and does not throw when usage_metadata is missing', async () => {
      (service as unknown as { llm: { invoke: jest.Mock } }).llm = {
        invoke: jest.fn().mockResolvedValue({
          content: 'No usage info.',
          usage_metadata: undefined,
        }),
      };
      usageLedger.recordActual.mockResolvedValue(undefined);

      const analysis = await service.generateAnalysis([
        { token: 'bitcoin', symbol: 'BTC', timestamp: new Date(), source: 'coinmarketcap', price: 65000, rawData: {} },
      ]);

      expect(analysis).toBe('No usage info.');
      expect(usageLedger.recordActual).toHaveBeenCalledWith(
        'llm',
        expect.any(Date),
        expect.any(String),
        0,
        expect.objectContaining({ unitKind: 'tokens', model: 'gpt-4o-mini' }),
      );
    });

    it('does not call recordActual when the ledger is disabled', async () => {
      baseConfig.usageLedger.enabled = false;
      usageLedger.enabled = false;
      (service as unknown as { llm: { invoke: jest.Mock } }).llm = {
        invoke: jest.fn().mockResolvedValue({
          content: 'ok',
          usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
      };

      await service.generateAnalysis([
        { token: 'bitcoin', symbol: 'BTC', timestamp: new Date(), source: 'coinmarketcap', price: 65000, rawData: {} },
      ]);

      expect(usageLedger.recordActual).not.toHaveBeenCalled();
    });
  });
});
