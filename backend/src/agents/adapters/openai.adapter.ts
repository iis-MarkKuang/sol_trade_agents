import { ChatOpenAI } from '@langchain/openai';
import type {
  LlmModelOptions,
  LlmProviderAdapter,
  LlmProviderConfig,
} from './llm-provider.adapter.js';

export class OpenAiAdapter implements LlmProviderAdapter {
  readonly name = 'openai' as const;

  isConfigured(config: LlmProviderConfig): boolean {
    return Boolean(config.openAIApiKey);
  }

  createModel(config: LlmProviderConfig, options: LlmModelOptions = {}): ChatOpenAI {
    return new ChatOpenAI({
      openAIApiKey: config.openAIApiKey,
      temperature: options.temperature ?? config.temperature,
      modelName: options.modelName ?? config.model,
      maxTokens: options.maxOutputTokens ?? config.maxOutputTokens,
      configuration: config.openAIBaseUrl ? { baseURL: config.openAIBaseUrl } : undefined,
      maxRetries: 0,
      timeout: 30_000,
    });
  }
}
