import type { ChatOpenAI } from '@langchain/openai';

export type LlmProviderName = 'openai' | 'deepseek' | 'azure';

export interface LlmProviderConfig {
  provider: LlmProviderName;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  openAIApiKey?: string;
  openAIBaseUrl?: string;
  deepSeekApiKey?: string;
  deepSeekBaseUrl: string;
  azureOpenAIApiKey?: string;
  azureOpenAIApiInstanceName?: string;
  azureOpenAIApiDeploymentName?: string;
  azureOpenAIApiVersion: string;
  azureOpenAIBasePath?: string;
}

export interface LlmModelOptions {
  temperature?: number;
  modelName?: string;
  maxOutputTokens?: number;
}

/**
 * Provider boundary for LangChain chat models. Callers depend on this contract
 * rather than provider credentials or endpoint conventions.
 */
export interface LlmProviderAdapter {
  readonly name: LlmProviderName;
  isConfigured(config: LlmProviderConfig): boolean;
  createModel(config: LlmProviderConfig, options?: LlmModelOptions): ChatOpenAI;
}
