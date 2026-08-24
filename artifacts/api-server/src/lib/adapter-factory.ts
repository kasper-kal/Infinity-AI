/**
 * Adapter Factory — Bridges Key Pool to LLMAdapter
 *
 * This is the ONLY place that knows about specific providers.
 * The rest of the codebase uses only the LLMAdapter interface.
 */

import { LLMAdapter, OpenAICompatibleAdapter, AdapterConfig, AdapterFactory, LLMAdapterError, LLMCapabilities } from "./llm-adapter";
import { getHealthyKeys, listKeys, LlmKeyEntry, resolveManualKey } from "./llm-client";
import { LocalModelAdapter, createLocalAdapter, LOCAL_MODEL_CAPABILITIES } from "./adapters/local-adapter";

/**
 * Default capabilities for OpenRouter auto-router model
 */
const OPENROUTER_CAPABILITIES: LLMCapabilities = {
  streaming: true,
  jsonMode: true,
  toolCalling: true,
  vision: true,
  maxContextTokens: 128000,
  maxOutputTokens: 8192,
};

/**
 * Default capabilities for NVIDIA NIM models
 */
const NVIDIA_CAPABILITIES: LLMCapabilities = {
  streaming: true,
  jsonMode: true,
  toolCalling: true,
  vision: true,
  maxContextTokens: 128000,
  maxOutputTokens: 8192,
};

/**
 * Default capabilities for generic OpenAI-compatible
 */
const GENERIC_CAPABILITIES: LLMCapabilities = {
  streaming: true,
  jsonMode: true,
  toolCalling: true,
  vision: false,
  maxContextTokens: 128000,
  maxOutputTokens: 8192,
};

/**
 * Design Model Configurations - Specific models for design generation
 */
export const DESIGN_MODEL_CONFIGS: Record<string, {
  adapterType: 'openrouter' | 'nvidia' | 'openai-compatible' | 'ollama' | 'local';
  model: string;
  baseUrl?: string;
  capabilities: LLMCapabilities;
  displayName: string;
  description: string;
}> = {
  // Free/OpenRouter models (available via OPENROUTER_API_KEY)
  'claude-3.5-sonnet': {
    adapterType: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
    },
    displayName: 'Claude 3.5 Sonnet',
    description: 'Anthropic\'s best model for design reasoning and code generation',
  },
  'claude-3-opus': {
    adapterType: 'openrouter',
    model: 'anthropic/claude-3-opus',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 200000,
      maxOutputTokens: 4096,
    },
    displayName: 'Claude 3 Opus',
    description: 'Most capable for complex design tasks (paid tier)',
  },
  'gpt-4o': {
    adapterType: 'openrouter',
    model: 'openai/gpt-4o',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 128000,
      maxOutputTokens: 16384,
    },
    displayName: 'GPT-4o',
    description: 'OpenAI\'s flagship multimodal model',
  },
  'gpt-4o-mini': {
    adapterType: 'openrouter',
    model: 'openai/gpt-4o-mini',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 128000,
      maxOutputTokens: 16384,
    },
    displayName: 'GPT-4o Mini',
    description: 'Fast, cost-effective for iterative design',
  },
  'gemini-2.5-pro': {
    adapterType: 'openrouter',
    model: 'google/gemini-2.5-pro',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
    },
    displayName: 'Gemini 2.5 Pro',
    description: 'Google\'s latest with massive context for complex designs',
  },
  'gemini-2.0-flash': {
    adapterType: 'openrouter',
    model: 'google/gemini-2.0-flash-exp',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
    },
    displayName: 'Gemini 2.0 Flash',
    description: 'Fast, free tier with large context',
  },
  'kimi-k2': {
    adapterType: 'openrouter',
    model: 'moonshotai/kimi-k2',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 16384,
    },
    displayName: 'Kimi K2',
    description: 'Moonshot AI\'s advanced reasoning model',
  },
  'glm-4.5': {
    adapterType: 'openrouter',
    model: 'zai/glm-4.5',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
    },
    displayName: 'GLM 4.5',
    description: 'Z.ai\'s latest general language model',
  },
  // NVIDIA NIM models (free via NVIDIA_API_KEY)
  'nemotron-3-ultra': {
    adapterType: 'nvidia',
    model: 'nvidia/nemotron-3-ultra',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    displayName: 'Nemotron 3 Ultra',
    description: 'NVIDIA\'s top reasoning model (free via NIM)',
  },
  'llama-3.1-405b': {
    adapterType: 'nvidia',
    model: 'meta/llama-3.1-405b-instruct',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
    },
    displayName: 'Llama 3.1 405B',
    description: 'Meta\'s largest open model (free via NIM)',
  },
  'llama-3.1-70b': {
    adapterType: 'nvidia',
    model: 'meta/llama-3.1-70b-instruct',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
    },
    displayName: 'Llama 3.1 70B',
    description: 'Balanced performance/cost for design tasks',
  },
  // Local models (via Ollama)
  'qwen2.5-coder-32b': {
    adapterType: 'ollama',
    model: 'qwen2.5-coder:32b',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
    },
    displayName: 'Qwen2.5-Coder 32B',
    description: 'Best open coding model, runs locally',
  },
  'deepseek-coder-v2': {
    adapterType: 'ollama',
    model: 'deepseek-coder-v2:236b',
    capabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
    },
    displayName: 'DeepSeek-Coder-V2',
    description: 'Strong reasoning for complex design logic',
  },
};

/**
 * Determine capabilities based on key entry
 */
function getCapabilitiesForEntry(entry: LlmKeyEntry): LLMCapabilities {
  const baseUrl = entry.baseUrl.toLowerCase();
  const model = entry.model.toLowerCase();

  if (baseUrl.includes("openrouter")) {
    return OPENROUTER_CAPABILITIES;
  }
  if (baseUrl.includes("nvidia")) {
    return NVIDIA_CAPABILITIES;
  }
  // Generic OpenAI-compatible
  const caps = { ...GENERIC_CAPABILITIES };
  // Some models have larger context
  if (model.includes("gpt-4") || model.includes("gpt-4o") || model.includes("claude")) {
    caps.maxContextTokens = 200000;
  }
  if (model.includes("gemini")) {
    caps.maxContextTokens = 1000000;
  }
  return caps;
}

/**
 * Create an adapter from a key pool entry
 */
export async function createAdapterFromEntry(entry: LlmKeyEntry): Promise<LLMAdapter> {
  const capabilities = getCapabilitiesForEntry(entry);
  return new OpenAICompatibleAdapter(entry.baseUrl, entry.apiKey, entry.model, capabilities);
}

/**
 * Create the best available adapter (automatic failover mode)
 * Uses the highest-priority healthy key from the pool.
 */
export async function createBestAdapter(): Promise<LLMAdapter> {
  const keys = await getHealthyKeys();
  if (keys.length === 0) {
    throw new LLMAdapterError("No healthy LLM keys available", "NO_KEYS_AVAILABLE", true);
  }
  // Keys are already sorted by priority (highest first) from getHealthyKeys
  const bestKey = keys[0];
  return createAdapterFromEntry(bestKey);
}

/**
 * Create an adapter for a specific key ID (manual mode for chat/voice)
 */
export async function createAdapterForKey(keyId: string): Promise<LLMAdapter> {
  const allKeys = await listKeys();
  const key = allKeys.find(k => k.id === keyId);
  if (!key) {
    throw new LLMAdapterError(`Key "${keyId}" not found`, "KEY_NOT_FOUND", false);
  }
  return createAdapterFromEntry(key);
}

/**
 * Create an adapter for manual mode (uses resolveManualKey logic)
 */
export async function createManualAdapter(keyId?: string): Promise<LLMAdapter> {
  const key = await resolveManualKey(keyId);
  return createAdapterFromEntry(key);
}

/**
 * Adapter Factory Implementation
 */
export const adapterFactory: AdapterFactory = {
  async createAdapter(config: AdapterConfig): Promise<LLMAdapter> {
    // If explicit adapter type requested
    if (config.adapterType) {
      switch (config.adapterType) {
        case "openrouter":
          if (!config.apiKey || !config.baseUrl) {
            throw new LLMAdapterError("OpenRouter requires apiKey and baseUrl", "INVALID_CONFIG", false);
          }
          return new OpenAICompatibleAdapter(config.baseUrl, config.apiKey, config.modelHint ?? "openrouter/free", OPENROUTER_CAPABILITIES);

        case "nvidia":
          if (!config.apiKey || !config.baseUrl) {
            throw new LLMAdapterError("NVIDIA requires apiKey and baseUrl", "INVALID_CONFIG", false);
          }
          return new OpenAICompatibleAdapter(config.baseUrl, config.apiKey, config.modelHint ?? "meta/llama-3.2-11b-vision-instruct", NVIDIA_CAPABILITIES);

        case "openai-compatible":
          if (!config.apiKey || !config.baseUrl || !config.modelHint) {
            throw new LLMAdapterError("OpenAI-compatible requires apiKey, baseUrl, and modelHint", "INVALID_CONFIG", false);
          }
          return new OpenAICompatibleAdapter(config.baseUrl, config.apiKey, config.modelHint, GENERIC_CAPABILITIES);

        case "ollama":
        case "local":
          return await createLocalAdapter(config.baseUrl, config.modelHint);

        default:
          throw new LLMAdapterError(`Unknown adapter type: ${config.adapterType}`, "UNKNOWN_ADAPTER_TYPE", false);
      }
    }

    // Auto mode: use the key pool
    if (config.preferredCapabilities) {
      // TODO: Could filter keys by capabilities in the future
    }
    return createBestAdapter();
  },

  getAvailableTypes(): string[] {
    return ["openrouter", "nvidia", "openai-compatible", "ollama", "local", "auto"];
  },
};

/**
 * Create an adapter for a specific design model
 */
export async function createDesignModelAdapter(modelKey: keyof typeof DESIGN_MODEL_CONFIGS): Promise<LLMAdapter> {
  const config = DESIGN_MODEL_CONFIGS[modelKey];
  if (!config) {
    throw new LLMAdapterError(`Unknown design model: ${modelKey}`, "UNKNOWN_DESIGN_MODEL", false);
  }

  // For openrouter/nvidia/openai-compatible, we need the key from the pool
  if (config.adapterType === 'openrouter' || config.adapterType === 'nvidia' || config.adapterType === 'openai-compatible') {
    const allKeys = await listKeys();
    // Find a matching key for the provider
    let providerFilter = '';
    if (config.adapterType === 'openrouter') providerFilter = 'openrouter';
    else if (config.adapterType === 'nvidia') providerFilter = 'nvidia';

    const matchingKey = allKeys.find(k => k.provider === providerFilter && isHealthy(k));
    if (!matchingKey) {
      throw new LLMAdapterError(
        `No healthy ${config.adapterType} key available for ${config.displayName}`,
        "NO_KEY_FOR_PROVIDER",
        true
      );
    }
    return new OpenAICompatibleAdapter(
      matchingKey.baseUrl,
      matchingKey.apiKey,
      config.model,
      config.capabilities
    );
  }

  // For local/Ollama
  if (config.adapterType === 'ollama' || config.adapterType === 'local') {
    return await createLocalAdapter(config.baseUrl ?? 'http://localhost:11434', config.model);
  }

  throw new LLMAdapterError(`Unsupported adapter type: ${config.adapterType}`, "UNSUPPORTED_ADAPTER", false);
}

/**
 * Get available design models with their configs
 */
export function getDesignModels() {
  return Object.entries(DESIGN_MODEL_CONFIGS).map(([key, config]) => ({
    id: key,
    ...config,
  }));
}

/**
 * Get adapter info for debugging/status (doesn't expose sensitive data)
 */
export async function getAdapterStatus(): Promise<{
  healthyKeys: number;
  totalKeys: number;
  adapterType: string;
  capabilities: LLMCapabilities;
}> {
  const allKeys = await listKeys();
  const healthyKeys = allKeys.filter(k => {
    // Reuse the health check logic
    if (!k.enabled) return false;
    if (k.coolDownUntil && Date.now() < k.coolDownUntil) return false;
    return true;
  });

  const bestAdapter = await createBestAdapter().catch(() => null);

  return {
    healthyKeys: healthyKeys.length,
    totalKeys: allKeys.length,
    adapterType: "openai-compatible",
    capabilities: bestAdapter?.getCapabilities() ?? GENERIC_CAPABILITIES,
  };
}