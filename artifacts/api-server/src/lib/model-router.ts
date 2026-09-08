import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getLLMAdapter, type LLMAdapter } from "./llm-adapter.js";

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
  EMBEDDINGS = "embeddings",
  // Extended task categories
  PLANNING = "planning",
  REVIEW = "review",
  VISION = "vision",
  CLASSIFICATION = "classification",
  EXTRACTION = "extraction",
  REASONING = "reasoning"
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

export enum BuildMode {
  SPEED = "speed",
  BALANCED = "balanced",
  QUALITY = "quality",
  MAX = "max",
  CUSTOM = "custom"
}

export enum TaskCategory {
  CHAT = "chat",
  CODING = "coding",
  RESEARCH = "research",
  PLANNING = "planning",
  REVIEW = "review",
  VISION = "vision",
  EMBEDDING = "embedding",
  CLASSIFICATION = "classification",
  EXTRACTION = "extraction",
  REASONING = "reasoning"
}

export interface ModelBenchmark {
  coding: number;
  reasoning: number;
  chat: number;
  speed: number;
  cost: number; // higher = cheaper (100 = free)
}

export interface CostSummary {
  projectId: string;
  periodDays: number;
  totalCost: number;
  costByModel: Record<string, number>;
  costByCategory: Record<string, number>;
  costByDay: Array<{ date: string; cost: number }>;
  budgetUtilization: number;
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

export interface BuildModeConfig {
  name: string;
  description: string;
  parallelAgents: number;
  verificationDepth: "minimal" | "standard" | "thorough" | "adversarial";
  contextBudget: number; // multiplier
  preferLocal: boolean;
  preferSpeed: boolean;
  preferCost: boolean;
  preferQuality: boolean;
  maxCostPerRequest: number;
  maxLatencyMs: number;
  temperature: number;
}

export interface ModelSelectionResult {
  provider: ModelProvider;
  model: ModelConfig;
  keyId?: string; // Reference to secret-manager key
  params: {
    temperature: number;
    maxTokens: number;
    topP?: number;
  };
  buildMode: BuildMode;
  taskCategory: TaskCategory;
  estimatedCost: number;
  fallbackModels: ModelConfig[];
}

export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  modelId: string;
  breakdown: {
    inputCost: number;
    outputCost: number;
  };
}

/**
 * Model Router - Resolves models for capabilities with fallbacks
 */
export class ModelRouter {
  private models: Map<string, ModelConfig> = new Map();
  private projectPreferences: Map<string, ProjectModelPreferences> = new Map();
  private userPreferences: Map<string, UserModelPreferences> = new Map();
  private projectRoot: string;

  // Build mode configurations
  private buildModeConfigs: Record<BuildMode, BuildModeConfig> = {
    [BuildMode.SPEED]: {
      name: "Speed",
      description: "Fastest responses, minimal verification",
      parallelAgents: 3,
      verificationDepth: "minimal",
      contextBudget: 0.5,
      preferLocal: true,
      preferSpeed: true,
      preferCost: true,
      maxCostPerRequest: 0.01,
      maxLatencyMs: 2000,
      temperature: 0.3,
    },
    [BuildMode.BALANCED]: {
      name: "Balanced",
      description: "Good balance of speed and quality",
      parallelAgents: 2,
      verificationDepth: "standard",
      contextBudget: 0.75,
      preferLocal: false,
      preferSpeed: false,
      preferCost: false,
      preferQuality: false,
      maxCostPerRequest: 0.10,
      maxLatencyMs: 10000,
      temperature: 0.5,
    },
    [BuildMode.QUALITY]: {
      name: "Quality",
      description: "High quality, more verification",
      parallelAgents: 1,
      verificationDepth: "thorough",
      contextBudget: 1.0,
      preferLocal: false,
      preferSpeed: false,
      preferCost: false,
      preferQuality: true,
      maxCostPerRequest: 0.50,
      maxLatencyMs: 30000,
      temperature: 0.7,
    },
    [BuildMode.MAX]: {
      name: "Maximum",
      description: "Best quality, all quality gates, adversarial verify",
      parallelAgents: 1,
      verificationDepth: "adversarial",
      contextBudget: 1.5,
      preferLocal: false,
      preferSpeed: false,
      preferCost: false,
      preferQuality: true,
      maxCostPerRequest: 2.00,
      maxLatencyMs: 60000,
      temperature: 0.8,
    },
    [BuildMode.CUSTOM]: {
      name: "Custom",
      description: "User-defined profile",
      parallelAgents: 2,
      verificationDepth: "standard",
      contextBudget: 1.0,
      preferLocal: false,
      preferSpeed: false,
      preferCost: false,
      preferQuality: false,
      maxCostPerRequest: 0.50,
      maxLatencyMs: 15000,
      temperature: 0.5,
    },
  };

  // Task category to capability mapping
  private taskCategoryToCapability: Record<TaskCategory, ModelCapability> = {
    [TaskCategory.CHAT]: ModelCapability.CHAT,
    [TaskCategory.CODING]: ModelCapability.COMPOSER,
    [TaskCategory.RESEARCH]: ModelCapability.DEEP_RESEARCH,
    [TaskCategory.PLANNING]: ModelCapability.PLANNING,
    [TaskCategory.REVIEW]: ModelCapability.REVIEW,
    [TaskCategory.VISION]: ModelCapability.VISION,
    [TaskCategory.EMBEDDING]: ModelCapability.EMBEDDINGS,
    [TaskCategory.CLASSIFICATION]: ModelCapability.CLASSIFICATION,
    [TaskCategory.EXTRACTION]: ModelCapability.EXTRACTION,
    [TaskCategory.REASONING]: ModelCapability.REASONING,
  };

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
   * Get build mode configuration
   */
  getBuildModeConfig(mode: BuildMode): BuildModeConfig {
    return this.buildModeConfigs[mode] || this.buildModeConfigs[BuildMode.BALANCED];
  }

  /**
   * Get all build mode configurations
   */
  getAllBuildModes(): Record<BuildMode, BuildModeConfig> {
    return { ...this.buildModeConfigs };
  }

  /**
   * Update build mode configuration (custom mode)
   */
  updateBuildModeConfig(mode: BuildMode, config: Partial<BuildModeConfig>): void {
    if (mode === BuildMode.CUSTOM) {
      this.buildModeConfigs[mode] = { ...this.buildModeConfigs[mode], ...config };
    }
  }

  /**
   * Map task category to capability
   */
  getCapabilityForTaskCategory(category: TaskCategory): ModelCapability {
    return this.taskCategoryToCapability[category] || ModelCapability.CHAT;
  }

  /**
   * Select model based on task category and build mode
   */
  async selectModel(
    taskCategory: TaskCategory,
    buildMode: BuildMode = BuildMode.BALANCED,
    context: { projectId?: string; userId?: string; constraints?: Partial<BuildModeConfig> } = {}
  ): Promise<ModelSelectionResult> {
    const capability = this.getCapabilityForTaskCategory(taskCategory);
    const modeConfig = this.getBuildModeConfig(buildMode);

    // Merge mode config with context constraints
    const mergedPrefs = {
      preferLocal: context.constraints?.preferLocal ?? modeConfig.preferLocal,
      preferSpeed: context.constraints?.preferSpeed ?? modeConfig.preferSpeed,
      preferCost: context.constraints?.preferCost ?? modeConfig.preferCost,
      preferQuality: context.constraints?.preferQuality ?? modeConfig.preferQuality,
      maxCostPerRequest: context.constraints?.maxCostPerRequest ?? modeConfig.maxCostPerRequest,
      maxLatencyMs: context.constraints?.maxLatencyMs ?? modeConfig.maxLatencyMs,
    };

    const resolved = await this.resolveModel(capability, {
      projectId: context.projectId,
      userId: context.userId,
      preferences: mergedPrefs,
    });

    // Estimate cost for typical request
    const estimatedCost = this.estimateRequestCost(resolved.model, 2000, 1000);

    return {
      provider: resolved.model.provider,
      model: resolved.model,
      params: {
        temperature: modeConfig.temperature,
        maxTokens: Math.min(resolved.model.maxOutputTokens, 4096),
      },
      buildMode,
      taskCategory,
      estimatedCost,
      fallbackModels: resolved.fallbackModels,
    };
  }

  /**
   * Estimate cost for a request
   */
  estimateRequestCost(model: ModelConfig, estimatedInputTokens: number, estimatedOutputTokens: number): CostEstimate {
    const inputCost = (estimatedInputTokens / 1000) * model.costPer1kInputTokens;
    const outputCost = (estimatedOutputTokens / 1000) * model.costPer1kOutputTokens;

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd: inputCost + outputCost,
      modelId: model.id,
      breakdown: { inputCost, outputCost },
    };
  }

  /**
   * Estimate cost for deep research (multi-step)
   */
  estimateDeepResearchCost(model: ModelConfig, steps: number = 5): CostEstimate {
    // Deep research typically: search (2k in, 1k out) × steps + synthesis (5k in, 3k out)
    const searchInputPerStep = 2000;
    const searchOutputPerStep = 1000;
    const synthesisInput = 5000;
    const synthesisOutput = 3000;

    const totalInput = (searchInputPerStep * steps) + synthesisInput;
    const totalOutput = (searchOutputPerStep * steps) + synthesisOutput;

    return this.estimateRequestCost(model, totalInput, totalOutput);
  }

  /**
   * Get recommended models for a task category
   */
  getRecommendedModels(taskCategory: TaskCategory, buildMode: BuildMode = BuildMode.BALANCED): ModelConfig[] {
    const capability = this.getCapabilityForTaskCategory(taskCategory);
    const modeConfig = this.getBuildModeConfig(buildMode);

    let models = this.getModels({ capability, enabled: true });

    // Sort by mode preferences
    if (modeConfig.preferLocal) {
      models = models.sort((a, b) => {
        const aLocal = a.provider === ModelProvider.OLLAMA || a.provider === ModelProvider.LM_STUDIO;
        const bLocal = b.provider === ModelProvider.OLLAMA || b.provider === ModelProvider.LM_STUDIO;
        return (aLocal === bLocal) ? 0 : aLocal ? -1 : 1;
      });
    }

    if (modeConfig.preferSpeed) {
      models = models.sort((a, b) => a.latencyMs - b.latencyMs);
    }

    if (modeConfig.preferCost) {
      models = models.sort((a, b) => {
        const aCost = a.costPer1kInputTokens + a.costPer1kOutputTokens;
        const bCost = b.costPer1kInputTokens + b.costPer1kOutputTokens;
        return aCost - bCost;
      });
    }

    if (modeConfig.preferQuality) {
      models = models.sort((a, b) => b.qualityScore - a.qualityScore);
    }

    return models.slice(0, 10);
  }

  /**
   * Get model benchmarks (static data, could be replaced with actual benchmark results)
   */
  getModelBenchmarks(): Record<string, ModelBenchmark> {
    return {
      "openrouter:anthropic/claude-3.5-sonnet": { coding: 95, reasoning: 98, chat: 97, speed: 60, cost: 20 },
      "openrouter:anthropic/claude-3.5-haiku": { coding: 85, reasoning: 90, chat: 92, speed: 85, cost: 70 },
      "openrouter:openai/gpt-4o": { coding: 93, reasoning: 95, chat: 96, speed: 70, cost: 30 },
      "openrouter:openai/gpt-4o-mini": { coding: 80, reasoning: 85, chat: 88, speed: 90, cost: 85 },
      "openrouter:qwen/qwen-2.5-coder-32b-instruct:free": { coding: 92, reasoning: 88, chat: 85, speed: 75, cost: 100 },
      "ollama:qwen2.5-coder:7b": { coding: 88, reasoning: 82, chat: 80, speed: 60, cost: 100 },
      "ollama:deepseek-coder:6.7b": { coding: 90, reasoning: 85, chat: 82, speed: 70, cost: 100 },
      "openrouter:google/gemma-2-9b-it:free": { coding: 75, reasoning: 80, chat: 85, speed: 85, cost: 100 },
      "openrouter:meta-llama/llama-3.1-8b-instruct:free": { coding: 70, reasoning: 75, chat: 82, speed: 80, cost: 100 },
    };
  }

  /**
   * Get cost tracking summary for a project
   */
  async getCostSummary(projectId: string, days: number = 30): Promise<CostSummary> {
    // This would integrate with secret-manager's spend tracking
    // For now, return placeholder structure
    return {
      projectId,
      periodDays: days,
      totalCost: 0,
      costByModel: {},
      costByCategory: {},
      costByDay: [],
      budgetUtilization: 0,
    };
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

/** Agent roles that can be routed to a model. */
export type AgentRole = "planner" | "coder" | "reviewer" | "fixer";

const ROLE_TO_CATEGORY: Record<AgentRole, TaskCategory> = {
  planner: TaskCategory.PLANNING,
  coder: TaskCategory.CODING,
  reviewer: TaskCategory.REVIEW,
  fixer: TaskCategory.CODING,
};

/**
 * Route a task to an appropriate model adapter and run the executor against it.
 * Returns the routing decision (selected adapter/model) alongside the result.
 */
export async function routeAndExecute<TContext, TResult>(
  role: AgentRole,
  _prompt: string,
  executor: (adapter: LLMAdapter) => Promise<TResult>,
  _context: TContext,
  _modelPreference?: string,
  projectId?: string
): Promise<{ decision: { selectedAdapter: LLMAdapter; role: AgentRole; modelId: string }; result: TResult }> {
  const router = getModelRouter(projectId);
  const category = ROLE_TO_CATEGORY[role];
  const recommended = router.getRecommendedModels(category, BuildMode.BALANCED);
  const selectedAdapter = await getLLMAdapter();
  const result = await executor(selectedAdapter);
  return {
    decision: {
      selectedAdapter,
      role,
      modelId: recommended[0]?.id ?? "default",
    },
    result,
  };
}