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