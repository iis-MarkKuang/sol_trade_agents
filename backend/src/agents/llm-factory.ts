import type { ChatOpenAI } from '@langchain/openai';
import type { ConfigService } from '../config/config.service.js';
import { AzureOpenAiAdapter } from './adapters/azure-openai.adapter.js';
import { DeepSeekAdapter } from './adapters/deepseek.adapter.js';
import type {
  LlmModelOptions,
  LlmProviderAdapter,
  LlmProviderName,
} from './adapters/llm-provider.adapter.js';
import { OpenAiAdapter } from './adapters/openai.adapter.js';

export type LlmFactoryOptions = LlmModelOptions;

export const OPENROUTER_CN_TOOL_MODELS = [
  'deepseek/deepseek-chat-v3-0324',
  'deepseek/deepseek-chat',
] as const;

const OPENROUTER_BLOCKED_PREFIXES = ['openai/', 'anthropic/'] as const;

const providerAdapters: Record<LlmProviderName, LlmProviderAdapter> = {
  openai: new OpenAiAdapter(),
  deepseek: new DeepSeekAdapter(),
  azure: new AzureOpenAiAdapter(),
};

export function getLlmProviderAdapter(provider: LlmProviderName): LlmProviderAdapter {
  return providerAdapters[provider];
}

export function isLlmConfigured(configService: ConfigService): boolean {
  const config = configService.llm;
  return getLlmProviderAdapter(config.provider).isConfigured(config);
}

function isOpenRouterGateway(baseUrl?: string): boolean {
  return Boolean(baseUrl?.includes('openrouter'));
}

function isBlockedOnOpenRouter(model: string, baseUrl?: string): boolean {
  if (!isOpenRouterGateway(baseUrl)) return false;
  const lower = model.toLowerCase();
  return OPENROUTER_BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Resolves model fallback order without leaking provider rules into callers.
 * Direct OpenAI and DeepSeek APIs use their configured model. OpenRouter keeps
 * the existing China-reachable DeepSeek fallback list.
 */
export function resolveToolModelCandidates(
  configService: ConfigService,
  preferred?: string,
): string[] {
  const config = configService.llm;
  const primary = preferred ?? config.model;
  const candidates =
    config.provider === 'openai' && isOpenRouterGateway(config.openAIBaseUrl)
      ? [
          ...(primary && !isBlockedOnOpenRouter(primary, config.openAIBaseUrl) ? [primary] : []),
          ...OPENROUTER_CN_TOOL_MODELS,
        ]
      : [primary];

  return candidates.filter((model, index) => Boolean(model) && candidates.indexOf(model) === index);
}

/**
 * Creates the selected provider model. Undefined means that the selected
 * adapter lacks credentials, allowing callers to use deterministic fallback.
 */
export function buildChatModel(
  configService: ConfigService,
  options: LlmFactoryOptions = {},
): ChatOpenAI | undefined {
  const config = configService.llm;
  const adapter = getLlmProviderAdapter(config.provider);
  if (!adapter.isConfigured(config)) {
    return undefined;
  }
  return adapter.createModel(config, options);
}
