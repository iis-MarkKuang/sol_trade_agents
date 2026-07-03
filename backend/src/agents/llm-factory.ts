import { ChatOpenAI } from "@langchain/openai";
import { ConfigService } from "../config/config.service.js";

export interface LlmFactoryOptions {
  temperature?: number;
  modelName?: string;
}

/**
 * OpenRouter models that support tool/function calling and are reachable from
 * mainland China (no OpenAI upstream ToS 403). Verified via OpenRouter + tools.
 */
export const OPENROUTER_CN_TOOL_MODELS = [
  "deepseek/deepseek-chat-v3-0324",
  "deepseek/deepseek-chat",
] as const;

/** OpenRouter routes `openai/*` and `anthropic/*` through providers that 403 CN IPs. */
const OPENROUTER_BLOCKED_PREFIXES = ["openai/", "anthropic/"] as const;

function isOpenRouterGateway(baseUrl?: string): boolean {
  return Boolean(baseUrl?.includes("openrouter"));
}

function isBlockedOnOpenRouter(model: string, baseUrl?: string): boolean {
  if (!isOpenRouterGateway(baseUrl)) return false;
  const lower = model.toLowerCase();
  return OPENROUTER_BLOCKED_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Model try-order for tool-calling flows (Ask Agent). Skips blocked OpenRouter
 * models so we don't waste 6–30s on a doomed OpenAI request before fallback.
 */
export function resolveToolModelCandidates(
  configService: ConfigService,
  preferred?: string,
): string[] {
  const cfg = configService.llm;
  const primary = preferred ?? cfg.model;
  const pool = [
    ...(primary && !isBlockedOnOpenRouter(primary, cfg.openAIBaseUrl) ? [primary] : []),
    ...OPENROUTER_CN_TOOL_MODELS,
  ];
  const seen = new Set<string>();
  return pool.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

/**
 * Builds a LangChain ChatOpenAI instance from the active LLM provider config.
 *
 * Supports two backends so the project can use the Nova Program's Microsoft
 * Azure OpenAI credits without code changes:
 *
 *  - `azure`  -> Azure OpenAI Service (AZURE_OPENAI_* env vars). The deployment
 *                name maps to a specific model deployed in your Azure resource.
 *  - `openai` -> public OpenAI API or OpenRouter-compatible gateway (OPENAI_API_KEY).
 *
 * The provider is auto-detected: Azure wins when `AZURE_OPENAI_API_KEY` is set,
 * unless `LLM_PROVIDER` explicitly says otherwise.
 *
 * Returns `undefined` when no credentials are configured so callers can fall
 * back to deterministic/mock behaviour.
 */
export function buildChatModel(
  configService: ConfigService,
  options: LlmFactoryOptions = {},
): ChatOpenAI | undefined {
  const cfg = configService.llm;
  const modelName = options.modelName ?? cfg.model;

  if (cfg.provider === "azure") {
    if (!cfg.azureOpenAIApiKey || !cfg.azureOpenAIApiInstanceName || !cfg.azureOpenAIApiDeploymentName) {
      return undefined;
    }
    return new ChatOpenAI({
      temperature: options.temperature ?? cfg.temperature,
      azureOpenAIApiKey: cfg.azureOpenAIApiKey,
      azureOpenAIApiInstanceName: cfg.azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName: cfg.azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion: cfg.azureOpenAIApiVersion,
      azureOpenAIBasePath: cfg.azureOpenAIBasePath,
      modelName: options.modelName ?? cfg.azureOpenAIApiDeploymentName,
      maxRetries: 0,
      timeout: 30_000,
    });
  }

  if (!cfg.openAIApiKey) {
    return undefined;
  }

  return new ChatOpenAI({
    openAIApiKey: cfg.openAIApiKey,
    temperature: options.temperature ?? cfg.temperature,
    modelName,
    configuration: cfg.openAIBaseUrl ? { baseURL: cfg.openAIBaseUrl } : undefined,
    maxRetries: 0,
    timeout: 30_000,
  });
}
