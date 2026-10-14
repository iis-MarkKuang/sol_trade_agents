import { ChatOpenAI } from '@langchain/openai';
import type {
  LlmModelOptions,
  LlmProviderAdapter,
  LlmProviderConfig,
} from './llm-provider.adapter.js';

export class AzureOpenAiAdapter implements LlmProviderAdapter {
  readonly name = 'azure' as const;

  isConfigured(config: LlmProviderConfig): boolean {
    return Boolean(
      config.azureOpenAIApiKey &&
      config.azureOpenAIApiInstanceName &&
      config.azureOpenAIApiDeploymentName,
    );
  }

  createModel(config: LlmProviderConfig, options: LlmModelOptions = {}): ChatOpenAI {
    return new ChatOpenAI({
      temperature: options.temperature ?? config.temperature,
      azureOpenAIApiKey: config.azureOpenAIApiKey,
      azureOpenAIApiInstanceName: config.azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName: config.azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion: config.azureOpenAIApiVersion,
      azureOpenAIBasePath: config.azureOpenAIBasePath,
      modelName: options.modelName ?? config.azureOpenAIApiDeploymentName ?? config.model,
      maxTokens: options.maxOutputTokens ?? config.maxOutputTokens,
      maxRetries: 0,
      timeout: 30_000,
    });
  }
}
