import { Test, TestingModule } from '@nestjs/testing';
import { LlmAgentService } from './llm-agent.service';
import { ConfigService } from '../config/config.service';

describe('LlmAgentService', () => {
  let service: LlmAgentService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmAgentService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LlmAgentService>(LlmAgentService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return mock analysis when no API key is set', async () => {
    const analysis = await service.generateAnalysis([]);
    expect(typeof analysis).toBe('string');
    expect(analysis).toContain('mock');
  });
});
