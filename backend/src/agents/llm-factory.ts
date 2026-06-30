import { ChatOpenAI } from "@langchain/openai";
import { ConfigService } from "../config/config.service.js";

export interface LlmFactoryOptions {
  temperature?: number;
  modelName?: string;
}

/**
 * Builds a LangChain ChatOpenAI instance from the active LLM provider config.
 *
 * Supports two backends so the project can use the Nova Program's Microsoft
 * Azure OpenAI credits without code changes:
 *
 *  - `azure`  -> Azure OpenAI Service (AZURE_OPENAI_* env vars). The deployment
 *                name maps to a specific model deployed in your Azure resource.
 *  - `openai` -> public OpenAI API (OPENAI_API_KEY).
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
      // On Azure the model is pinned by the deployment; modelName is ignored
      // for routing but kept for logging clarity.
      modelName: options.modelName ?? cfg.azureOpenAIApiDeploymentName,
    });
  }

  if (!cfg.openAIApiKey) {
    return undefined;
  }

  return new ChatOpenAI({
    openAIApiKey: cfg.openAIApiKey,
    temperature: options.temperature ?? cfg.temperature,
    modelName: options.modelName ?? cfg.model,
    configuration: cfg.openAIBaseUrl ? { baseURL: cfg.openAIBaseUrl } : undefined,
  });
}
