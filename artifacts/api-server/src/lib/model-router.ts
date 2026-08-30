import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Model Router - Per-project/user model preferences, fallback chains, BYOM
 */

export enum ModelCapability {
  CHAT = "chat",
  COMPOSER = "composer",
  AGENT = "agent",
  TAB_AUTOCOMPLETE = "tab-autocomplete",
  CMD_K_EDIT = "cmd-k-edit",
  CODEBASE_SEARCH = "codebase-search",
  DEEP_RESEARCH = "deep-research",
  VISUAL_EDITING = "visual-editing",
  EMBEDDINGS = "embeddings"
}

export enum ModelProvider {
  OPENROUTER = "openrouter",
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
  NVIDIA_NIM = "nvidia-nim",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  CUSTOM = "custom"
}

// Model configuration
export const ModelConfigSchema = z.object({
  id: z.string(),                    // Unique identifier
  name: z.string(),                  // Display name
  provider: z.nativeEnum(ModelProvider),
  modelId: z.string(),               // Provider's model ID (e.g., "anthropic/claude-3.5-sonnet")
  capabilities: z.array(z.nativeEnum(ModelCapability)).default([]),
  contextWindow: z.number().default(128000),
  maxOutputTokens: z.number().default(4096),
  supportsStreaming: z.boolean().default(true),
  supportsTools: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  supportsJsonMode: z.boolean().default(false),
  costPer1kInputTokens: z.number().default(0),    // USD
  costPer1kOutputTokens: z.number().default(0),   // USD
  latencyMs: z.number().default(1000),            // Estimated latency
  qualityScore: z.number().min(1).max(10).default(5), // Subjective quality 1-10
  enabled: z.boolean().default(true),
  apiKeyRef: z.string().optional(),               // Reference to stored API key
  baseUrl: z.string().optional(),                 // Custom endpoint (BYOM)
  headers: z.record(z.string()).default({}),      // Custom headers
  metadata: z.record(z.unknown()).default({})
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// Fallback chain entry
export const FallbackEntrySchema = z.object({
  modelId: z.string(),
  reason: z.enum(["primary", "rate-limit", "error", "cost", "latency", "capability"]).default("primary"),
  maxRetries: z.number().default(1),
  timeoutMs: z.number().default(30000)
});

export type FallbackEntry = z.infer<typeof FallbackEntrySchema>;

// Model preference per capability
export const CapabilityPreferenceSchema = z.object({
  capability: z.nativeEnum(ModelCapability),
  primaryModelId: z.string(),
  fallbackChain: z.array(FallbackEntrySchema).default([]),
  preferences: z.object({
    preferSpeed: z.boolean().default(false),
    preferQuality: z.boolean().default(false),
    preferCost: z.boolean().default(false),
    preferLocal: z.boolean().default(false),
    maxCostPerRequest: z.number().optional(),
    maxLatencyMs: z.number().optional()
  }).default({})
});

export type CapabilityPreference = z.infer<typeof CapabilityPreferenceSchema>;

// Project model preferences
export const ProjectModelPreferencesSchema = z.object({
  projectId: z.string(),
  capabilities: z.array(CapabilityPreferenceSchema).default([]),
  defaultModelId: z.string().optional(),
  globalFallbackChain: z.array(FallbackEntrySchema).default([]),
  updatedAt: z.number().default(() => Date.now()),
  updatedBy: z.string().optional()
});

export type ProjectModelPreferences = z.infer<typeof ProjectModelPreferencesSchema>;

// User model preferences
export const UserModelPreferencesSchema = z.object({
  userId: z.string(),
  capabilities: z.array(CapabilityPreferenceSchema).default([]),
  defaultModelId: z.string().optional(),
  globalFallbackChain: z.array(FallbackEntrySchema).default([]),
  updatedAt: z.number().default(() => Date.now())
});

export type UserModelPreferences = z.infer<typeof UserModelPreferencesSchema>;

// Resolved model for a capability
export const ResolvedModelSchema = z.object({
  capability: z.nativeEnum(ModelCapability),
  model: ModelConfigSchema,
  fallbackModels: z.array(ModelConfigSchema).default([]),
  selectionReason: z.string()
});

export type ResolvedModel = z.infer<typeof ResolvedModelSchema>;

// Built-in model catalog (free tier friendly)
export const BUILTIN_MODELS: ModelConfig[] = [
  // OpenRouter free models
  {
    id: "openrouter:meta-llama/llama-3.1-8b-instruct:free",
    name: "Llama 3.1 8B (Free)",
    provider: ModelProvider.OPENROUTER,
    modelId: "meta-llama/llama-3.1-8b-instruct:free",
    capabilities: [ModelCapability.CHAT, ModelCapability.COMPOSER, ModelCapability.CODEBASE_SEARCH],
    contextWindow: 128000,
    maxOutputTokens: 4096,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 6,
    latencyMs: 800
  },
  {
    id: "openrouter:microsoft/phi-3-mini-128k-instruct:free",
    name: "Phi-3 Mini 128K (Free)",
    provider: ModelProvider.OPENROUTER,
    modelId: "microsoft/phi-3-mini-128k-instruct:free",
    capabilities: [ModelCapability.CHAT, ModelCapability.TAB_AUTOCOMPLETE, ModelCapability.CMD_K_EDIT],
    contextWindow: 128000,
    maxOutputTokens: 4096,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 5,
    latencyMs: 600
  },
  {
    id: "openrouter:google/gemma-2-9b-it:free",
    name: "Gemma 2 9B (Free)",
    provider: ModelProvider.OPENROUTER,
    modelId: "google/gemma-2-9b-it:free",
    capabilities: [ModelCapability.CHAT, ModelCapability.COMPOSER, ModelCapability.AGENT],
    contextWindow: 8192,
    maxOutputTokens: 4096,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 6,
    latencyMs: 700
  },
  {
    id: "openrouter:qwen/qwen-2.5-coder-32b-instruct:free",
    name: "Qwen 2.5 Coder 32B (Free)",
    provider: ModelProvider.OPENROUTER,
    modelId: "qwen/qwen-2.5-coder-32b-instruct:free",
    capabilities: [
      ModelCapability.CHAT, ModelCapability.COMPOSER, ModelCapability.AGENT,
      ModelCapability.TAB_AUTOCOMPLETE, ModelCapability.CMD_K_EDIT, ModelCapability.CODEBASE_SEARCH
    ],
    contextWindow: 32768,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 8,
    latencyMs: 1000
  },
  // OpenRouter paid but cheap
  {
    id: "openrouter:anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: ModelProvider.OPENROUTER,
    modelId: "anthropic/claude-3.5-sonnet",
    capabilities: Object.values(ModelCapability),
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    costPer1kInputTokens: 3.00,
    costPer1kOutputTokens: 15.00,
    qualityScore: 10,
    latencyMs: 1500
  },
  {
    id: "openrouter:anthropic/claude-3.5-haiku",
    name: "Claude 3.5 Haiku",
    provider: ModelProvider.OPENROUTER,
    modelId: "anthropic/claude-3.5-haiku",
    capabilities: Object.values(ModelCapability),
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0.25,
    costPer1kOutputTokens: 1.25,
    qualityScore: 8,
    latencyMs: 800
  },
  {
    id: "openrouter:openai/gpt-4o",
    name: "GPT-4o",
    provider: ModelProvider.OPENROUTER,
    modelId: "openai/gpt-4o",
    capabilities: Object.values(ModelCapability),
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    costPer1kInputTokens: 2.50,
    costPer1kOutputTokens: 10.00,
    qualityScore: 9,
    latencyMs: 1200
  },
  {
    id: "openrouter:openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: ModelProvider.OPENROUTER,
    modelId: "openai/gpt-4o-mini",
    capabilities: Object.values(ModelCapability),
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    costPer1kInputTokens: 0.15,
    costPer1kOutputTokens: 0.60,
    qualityScore: 7,
    latencyMs: 600
  },
  // Local models (Ollama)
  {
    id: "ollama:qwen2.5-coder:7b",
    name: "Qwen 2.5 Coder 7B (Local)",
    provider: ModelProvider.OLLAMA,
    modelId: "qwen2.5-coder:7b",
    capabilities: [
      ModelCapability.CHAT, ModelCapability.COMPOSER, ModelCapability.AGENT,
      ModelCapability.TAB_AUTOCOMPLETE, ModelCapability.CMD_K_EDIT, ModelCapability.CODEBASE_SEARCH
    ],
    contextWindow: 32768,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 7,
    latencyMs: 2000,
    baseUrl: "http://localhost:11434"
  },
  {
    id: "ollama:deepseek-coder:6.7b",
    name: "DeepSeek Coder 6.7B (Local)",
    provider: ModelProvider.OLLAMA,
    modelId: "deepseek-coder:6.7b",
    capabilities: [
      ModelCapability.CHAT, ModelCapability.COMPOSER, ModelCapability.TAB_AUTOCOMPLETE,
      ModelCapability.CMD_K_EDIT, ModelCapability.CODEBASE_SEARCH
    ],
    contextWindow: 16384,
    maxOutputTokens: 4096,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 7,
    latencyMs: 1500,
    baseUrl: "http://localhost:11434"
  },
  {
    id: "ollama:codellama:13b",
    name: "CodeLlama 13B (Local)",
    provider: ModelProvider.OLLAMA,
    modelId: "codellama:13b",
    capabilities: [
      ModelCapability.CHAT, ModelCapability.TAB_AUTOCOMPLETE, ModelCapability.CMD_K_EDIT,
      ModelCapability.CODEBASE_SEARCH
    ],
    contextWindow: 16384,
    maxOutputTokens: 4096,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 6,
    latencyMs: 2500,
    baseUrl: "http://localhost:11434"
  },
  // Embeddings
  {
    id: "openrouter: Voyage AI (via OpenRouter)",
    name: "voyage-3",
    provider: ModelProvider.OPENROUTER,
    modelId: "voyage/voyage-3",
    capabilities: [ModelCapability.EMBEDDINGS],
    contextWindow: 32768,
    maxOutputTokens: 1024,
    costPer1kInputTokens: 0.10,
    costPer1kOutputTokens: 0,
    qualityScore: 8,
    latencyMs: 500
  },
  {
    id: "ollama:nomic-embed-text",
    name: "Nomic Embed Text (Local)",
    provider: ModelProvider.OLLAMA,
    modelId: "nomic-embed-text",
    capabilities: [ModelCapability.EMBEDDINGS],
    contextWindow: 8192,
    maxOutputTokens: 1024,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    qualityScore: 6,
    latencyMs: 300,
    baseUrl: "http://localhost:11434"
  }
];

/**
 * Model Router - Resolves models for capabilities with fallbacks
 */
export class ModelRouter {
  private models: Map<string, ModelConfig> = new Map();
  private projectPreferences: Map<string, ProjectModelPreferences> = new Map();
  private userPreferences: Map<string, UserModelPreferences> = new Map();
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.registerBuiltinModels();
  }

  private registerBuiltinModels(): void {
    for (const model of BUILTIN_MODELS) {
      this.models.set(model.id, model);
    }
  }

  /**
   * Register a custom model (BYOM)
   */
  registerModel(model: ModelConfig): void {
    this.models.set(model.id, model);
  }

  /**
   * Get all available models
   */
  getModels(filters?: { capability?: ModelCapability; provider?: ModelProvider; enabled?: boolean }): ModelConfig[] {
    let models = Array.from(this.models.values());

    if (filters?.enabled !== undefined) {
      models = models.filter(m => m.enabled === filters.enabled);
    }
    if (filters?.capability) {
      models = models.filter(m => m.capabilities.includes(filters.capability!));
    }
    if (filters?.provider) {
      models = models.filter(m => m.provider === filters.provider);
    }

    return models.sort((a, b) => b.qualityScore - a.qualityScore);
  }

  /**
   * Get model by ID
   */
  getModel(id: string): ModelConfig | undefined {
    return this.models.get(id);
  }

  /**
   * Load project preferences from .infinity/model-preferences.json
   */
  async loadProjectPreferences(projectId: string): Promise<ProjectModelPreferences | null> {
    const cacheKey = `project:${projectId}`;
    if (this.projectPreferences.has(cacheKey)) {
      return this.projectPreferences.get(cacheKey)!;
    }

    const prefsPath = join(this.projectRoot, ".infinity", "model-preferences.json");
    try {
      const content = await readFile(prefsPath, "utf-8");
      const parsed = JSON.parse(content);
      const validated = ProjectModelPreferencesSchema.parse(parsed);
      this.projectPreferences.set(cacheKey, validated);
      return validated;
    } catch {
      return null;
    }
  }

  /**
   * Save project preferences
   */
  async saveProjectPreferences(prefs: ProjectModelPreferences): Promise<void> {
    const prefsPath = join(this.projectRoot, ".infinity", "model-preferences.json");
    await mkdir(dirname(prefsPath), { recursive: true });
    await writeFile(prefsPath, JSON.stringify(prefs, null, 2), "utf-8");
    this.projectPreferences.set(`project:${prefs.projectId}`, prefs);
  }

  /**
   * Load user preferences from ~/.infinity/model-preferences.json
   */
  async loadUserPreferences(userId: string): Promise<UserModelPreferences | null> {
    const cacheKey = `user:${userId}`;
    if (this.userPreferences.has(cacheKey)) {
      return this.userPreferences.get(cacheKey)!;
    }

    const homeDir = process.env.HOME || "";
    const prefsPath = join(homeDir, ".infinity", "model-preferences.json");
    try {
      const content = await readFile(prefsPath, "utf-8");
      const parsed = JSON.parse(content);
      const validated = UserModelPreferencesSchema.parse(parsed);
      this.userPreferences.set(cacheKey, validated);
      return validated;
    } catch {
      return null;
    }
  }

  /**
   * Save user preferences
   */
  async saveUserPreferences(prefs: UserModelPreferences): Promise<void> {
    const homeDir = process.env.HOME || "";
    const prefsPath = join(homeDir, ".infinity", "model-preferences.json");
    await mkdir(dirname(prefsPath), { recursive: true });
    await writeFile(prefsPath, JSON.stringify(prefs, null, 2), "utf-8");
    this.userPreferences.set(`user:${prefs.userId}`, prefs);
  }

  /**
   * Resolve the best model for a capability
   */
  async resolveModel(
    capability: ModelCapability,
    context: { projectId?: string; userId?: string; preferences?: Partial<CapabilityPreference["preferences"]> } = {}
  ): Promise<ResolvedModel> {
    // 1. Check project preferences
    let capabilityPref: CapabilityPreference | undefined;
    let globalFallback: FallbackEntry[] = [];

    if (context.projectId) {
      const projectPrefs = await this.loadProjectPreferences(context.projectId);
      if (projectPrefs) {
        capabilityPref = projectPrefs.capabilities.find(c => c.capability === capability);
        globalFallback = projectPrefs.globalFallbackChain;
      }
    }

    // 2. Fall back to user preferences
    if (!capabilityPref && context.userId) {
      const userPrefs = await this.loadUserPreferences(context.userId);
      if (userPrefs) {
        capabilityPref = userPrefs.capabilities.find(c => c.capability === capability);
        globalFallback = userPrefs.globalFallbackChain;
      }
    }

    // 3. Use defaults if no preferences
    if (!capabilityPref) {
      capabilityPref = this.getDefaultPreference(capability);
    }

    // 4. Merge context preferences
    const mergedPrefs = { ...capabilityPref.preferences, ...context.preferences };

    // 5. Find primary model
    const primaryModel = this.models.get(capabilityPref.primaryModelId);
    if (!primaryModel || !primaryModel.enabled) {
      // Fall back to best available model for capability
      const available = this.getModels({ capability, enabled: true });
      if (available.length === 0) {
        throw new Error(`No models available for capability: ${capability}`);
      }
      return {
        capability,
        model: available[0],
        fallbackModels: available.slice(1, 3),
        selectionReason: "default-best-available"
      };
    }

    // 6. Build fallback chain
    const fallbackModels: ModelConfig[] = [];

    // Add capability-specific fallbacks
    for (const fallback of capabilityPref.fallbackChain) {
      const model = this.models.get(fallback.modelId);
      if (model && model.enabled) {
        fallbackModels.push(model);
      }
    }

    // Add global fallbacks
    for (const fallback of globalFallback) {
      const model = this.models.get(fallback.modelId);
      if (model && model.enabled && !fallbackModels.includes(model)) {
        fallbackModels.push(model);
      }
    }

    // Add best available as last resort
    const available = this.getModels({ capability, enabled: true });
    for (const model of available) {
      if (!fallbackModels.includes(model) && model.id !== primaryModel.id) {
        fallbackModels.push(model);
      }
    }

    // 7. Apply preference filters
    let filteredFallbacks = fallbackModels;

    if (mergedPrefs.preferLocal) {
      filteredFallbacks = filteredFallbacks.sort((a, b) => {
        const aLocal = a.provider === ModelProvider.OLLAMA || a.provider === ModelProvider.LM_STUDIO;
        const bLocal = b.provider === ModelProvider.OLLAMA || b.provider === ModelProvider.LM_STUDIO;
        return (aLocal === bLocal) ? 0 : aLocal ? -1 : 1;
      });
    }

    if (mergedPrefs.preferSpeed) {
      filteredFallbacks = filteredFallbacks.sort((a, b) => a.latencyMs - b.latencyMs);
    }

    if (mergedPrefs.preferCost) {
      filteredFallbacks = filteredFallbacks.sort((a, b) => {
        const aCost = a.costPer1kInputTokens + a.costPer1kOutputTokens;
        const bCost = b.costPer1kInputTokens + b.costPer1kOutputTokens;
        return aCost - bCost;
      });
    }

    if (mergedPrefs.preferQuality) {
      filteredFallbacks = filteredFallbacks.sort((a, b) => b.qualityScore - a.qualityScore);
    }

    if (mergedPrefs.maxCostPerRequest !== undefined) {
      filteredFallbacks = filteredFallbacks.filter(m => {
        const cost = (m.costPer1kInputTokens + m.costPer1kOutputTokens) * (m.maxOutputTokens / 1000);
        return cost <= mergedPrefs.maxCostPerRequest!;
      });
    }

    if (mergedPrefs.maxLatencyMs !== undefined) {
      filteredFallbacks = filteredFallbacks.filter(m => m.latencyMs <= mergedPrefs.maxLatencyMs!);
    }

    return {
      capability,
      model: primaryModel,
      fallbackModels: filteredFallbacks.slice(0, 5),
      selectionReason: capabilityPref.primaryModelId === primaryModel.id ? "explicit-preference" : "best-available"
    };
  }

  /**
   * Get default preference for a capability
   */
  private getDefaultPreference(capability: ModelCapability): CapabilityPreference {
    // Default to best free model for each capability
    const freeModels = this.getModels({ capability, enabled: true }).filter(m => m.costPer1kInputTokens === 0);
    const bestFree = freeModels[0] || this.getModels({ capability, enabled: true })[0];

    const primaryId = bestFree?.id || "openrouter:qwen/qwen-2.5-coder-32b-instruct:free";

    return {
      capability,
      primaryModelId: primaryId,
      fallbackChain: [],
      preferences: {
        preferSpeed: capability === ModelCapability.TAB_AUTOCOMPLETE,
        preferQuality: capability === ModelCapability.AGENT || capability === ModelCapability.DEEP_RESEARCH,
        preferCost: true
      }
    };
  }

  /**
   * Set capability preference for project
   */
  async setProjectCapabilityPreference(
    projectId: string,
    pref: CapabilityPreference
  ): Promise<void> {
    let prefs = await this.loadProjectPreferences(projectId);
    if (!prefs) {
      prefs = { projectId, capabilities: [], globalFallbackChain: [] };
    }

    const idx = prefs.capabilities.findIndex(c => c.capability === pref.capability);
    if (idx >= 0) {
      prefs.capabilities[idx] = pref;
    } else {
      prefs.capabilities.push(pref);
    }
    prefs.updatedAt = Date.now();
    await this.saveProjectPreferences(prefs);
  }

  /**
   * Set global fallback chain for project
   */
  async setProjectGlobalFallback(projectId: string, chain: FallbackEntry[]): Promise<void> {
    let prefs = await this.loadProjectPreferences(projectId);
    if (!prefs) {
      prefs = { projectId, capabilities: [], globalFallbackChain: chain };
    } else {
      prefs.globalFallbackChain = chain;
    }
    prefs.updatedAt = Date.now();
    await this.saveProjectPreferences(prefs);
  }

  /**
   * Set capability preference for user
   */
  async setUserCapabilityPreference(
    userId: string,
    pref: CapabilityPreference
  ): Promise<void> {
    let prefs = await this.loadUserPreferences(userId);
    if (!prefs) {
      prefs = { userId, capabilities: [], globalFallbackChain: [] };
    }

    const idx = prefs.capabilities.findIndex(c => c.capability === pref.capability);
    if (idx >= 0) {
      prefs.capabilities[idx] = pref;
    } else {
      prefs.capabilities.push(pref);
    }
    prefs.updatedAt = Date.now();
    await this.saveUserPreferences(prefs);
  }

  /**
   * Get default preferences template
   */
  static getDefaultPreferences(): CapabilityPreference[] {
    return [
      {
        capability: ModelCapability.CHAT,
        primaryModelId: "openrouter:anthropic/claude-3.5-sonnet",
        fallbackChain: [
          { modelId: "openrouter:openai/gpt-4o", reason: "error" },
          { modelId: "openrouter:qwen/qwen-2.5-coder-32b-instruct:free", reason: "rate-limit" }
        ],
        preferences: { preferQuality: true }
      },
      {
        capability: ModelCapability.COMPOSER,
        primaryModelId: "openrouter:anthropic/claude-3.5-sonnet",
        fallbackChain: [
          { modelId: "openrouter:openai/gpt-4o", reason: "error" },
          { modelId: "openrouter:qwen/qwen-2.5-coder-32b-instruct:free", reason: "rate-limit" }
        ],
        preferences: { preferQuality: true }
      },
      {
        capability: ModelCapability.AGENT,
        primaryModelId: "openrouter:anthropic/claude-3.5-sonnet",
        fallbackChain: [
          { modelId: "openrouter:openai/gpt-4o", reason: "error" },
          { modelId: "openrouter:qwen/qwen-2.5-coder-32b-instruct:free", reason: "rate-limit" }
        ],
        preferences: { preferQuality: true }
      },
      {
        capability: ModelCapability.TAB_AUTOCOMPLETE,
        primaryModelId: "openrouter:qwen/qwen-2.5-coder-32b-instruct:free",
        fallbackChain: [
          { modelId: "ollama:qwen2.5-coder:7b", reason: "error" },
          { modelId: "openrouter:microsoft/phi-3-mini-128k-instruct:free", reason: "latency" }
        ],
        preferences: { preferSpeed: true, preferLocal: true }
      },
      {
        capability: ModelCapability.CMD_K_EDIT,
        primaryModelId: "openrouter:qwen/qwen-2.5-coder-32b-instruct:free",
        fallbackChain: [
          { modelId: "ollama:qwen2.5-coder:7b", reason: "error" },
          { modelId: "openrouter:anthropic/claude-3.5-haiku", reason: "rate-limit" }
        ],
        preferences: { preferSpeed: true }
      },
      {
        capability: ModelCapability.CODEBASE_SEARCH,
        primaryModelId: "openrouter:qwen/qwen-2.5-coder-32b-instruct:free",
        fallbackChain: [
          { modelId: "ollama:qwen2.5-coder:7b", reason: "error" }
        ],
        preferences: { preferQuality: true }
      },
      {
        capability: ModelCapability.DEEP_RESEARCH,
        primaryModelId: "openrouter:anthropic/claude-3.5-sonnet",
        fallbackChain: [
          { modelId: "openrouter:openai/gpt-4o", reason: "error" }
        ],
        preferences: { preferQuality: true }
      },
      {
        capability: ModelCapability.VISUAL_EDITING,
        primaryModelId: "openrouter:anthropic/claude-3.5-sonnet",
        fallbackChain: [
          { modelId: "openrouter:openai/gpt-4o", reason: "error" }
        ],
        preferences: { preferQuality: true }
      },
      {
        capability: ModelCapability.EMBEDDINGS,
        primaryModelId: "ollama:nomic-embed-text",
        fallbackChain: [
          { modelId: "openrouter:voyage/voyage-3", reason: "error" }
        ],
        preferences: { preferLocal: true, preferSpeed: true }
      }
    ];
  }
}

/**
 * Singleton
 */
let modelRouterInstance: ModelRouter | null = null;

export function getModelRouter(projectRoot?: string): ModelRouter {
  if (!modelRouterInstance) {
    modelRouterInstance = new ModelRouter(projectRoot);
  }
  return modelRouterInstance;
}

export function resetModelRouter(): void {
  modelRouterInstance = null;
}