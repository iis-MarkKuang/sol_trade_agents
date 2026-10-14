import type { ConfigService } from '../config/config.service';
import {
  buildChatModel,
  getLlmProviderAdapter,
  isLlmConfigured,
  resolveToolModelCandidates,
} from './llm-factory';
import type { LlmProviderConfig, LlmProviderName } from './adapters/llm-provider.adapter';

const baseConfig: LlmProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxOutputTokens: 512,
  openAIApiKey: undefined,
  openAIBaseUrl: undefined,
  deepSeekApiKey: undefined,
  deepSeekBaseUrl: 'https://api.deepseek.com/v1',
  azureOpenAIApiKey: undefined,
  azureOpenAIApiInstanceName: undefined,
  azureOpenAIApiDeploymentName: undefined,
  azureOpenAIApiVersion: '2024-08-01-preview',
  azureOpenAIBasePath: undefined,
};

function configService(
  provider: LlmProviderName,
  overrides: Partial<LlmProviderConfig> = {},
): ConfigService {
  return {
    llm: { ...baseConfig, provider, ...overrides },
  } as ConfigService;
}

describe('LLM provider adapters', () => {
  it('registers OpenAI and DeepSeek as separate providers', () => {
    expect(getLlmProviderAdapter('openai').name).toBe('openai');
    expect(getLlmProviderAdapter('deepseek').name).toBe('deepseek');
  });

  it('requires the selected provider credential', () => {
    const deepSeek = configService('deepseek', {
      openAIApiKey: 'openai-key',
    });
    expect(isLlmConfigured(deepSeek)).toBe(false);
    expect(buildChatModel(deepSeek)).toBeUndefined();
  });

  it('builds a DeepSeek model from DeepSeek configuration', () => {
    const deepSeek = configService('deepseek', {
      deepSeekApiKey: 'deepseek-key',
      model: 'deepseek-chat',
    });
    const model = buildChatModel(deepSeek);

    expect(model).toBeDefined();
    expect(model?.modelName).toBe('deepseek-chat');
    expect(model?.maxTokens).toBe(512);
  });

  it('builds an OpenAI model from OpenAI configuration', () => {
    const openAi = configService('openai', {
      openAIApiKey: 'openai-key',
      model: 'gpt-4o-mini',
    });
    const model = buildChatModel(openAi);

    expect(model).toBeDefined();
    expect(model?.modelName).toBe('gpt-4o-mini');
  });

  it('keeps OpenRouter DeepSeek fallbacks only for OpenRouter', () => {
    const openRouter = configService('openai', {
      openAIApiKey: 'openrouter-key',
      openAIBaseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
    });
    expect(resolveToolModelCandidates(openRouter)).toEqual([
      'deepseek/deepseek-chat-v3-0324',
      'deepseek/deepseek-chat',
    ]);

    const deepSeek = configService('deepseek', {
      deepSeekApiKey: 'deepseek-key',
      model: 'deepseek-chat',
    });
    expect(resolveToolModelCandidates(deepSeek)).toEqual(['deepseek-chat']);
  });
});
