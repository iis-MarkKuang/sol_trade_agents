import { ChatOpenAI } from '@langchain/openai';
import type {
  LlmModelOptions,
  LlmProviderAdapter,
  LlmProviderConfig,
} from './llm-provider.adapter.js';

/**
 * DeepSeek exposes an OpenAI-compatible chat API, so the LangChain transport
 * can be reused while credentials and model defaults remain provider-specific.
 */
export class DeepSeekAdapter implements LlmProviderAdapter {
  readonly name = 'deepseek' as const;

  isConfigured(config: LlmProviderConfig): boolean {
    return Boolean(config.deepSeekApiKey);
  }

  createModel(config: LlmProviderConfig, options: LlmModelOptions = {}): ChatOpenAI {
    return new ChatOpenAI({
      openAIApiKey: config.deepSeekApiKey,
      temperature: options.temperature ?? config.temperature,
      modelName: options.modelName ?? config.model,
      maxTokens: options.maxOutputTokens ?? config.maxOutputTokens,
      configuration: { baseURL: config.deepSeekBaseUrl },
      maxRetries: 0,
      timeout: 30_000,
    });
  }
}
