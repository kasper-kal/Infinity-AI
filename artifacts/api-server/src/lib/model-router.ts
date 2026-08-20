/**
 * MODEL ROUTER + EFFORT CHOOSER
 *
 * Intelligent model selection for Build Mode:
 * - Task classification → auto-select model tier (Lite/High/Max)
 * - Role-based routing: Planner→Max, Coder→High, Reviewer→Max, Fixer→High, Research→High
 * - Provider failover chain: OpenRouter → NVIDIA NIM → Local Ollama → Local vLLM
 * - Cost tracking per model (enforce $0 budget, prefer free tiers)
 * - Effort selector: user can override with --effort lite|high|max
 */

import { LLMAdapter, LLMCapabilities } from "./llm-adapter";
import { adapterFactory, createBestAdapter, createAdapterForKey, createManualAdapter, createAdapterFromEntry } from "./adapter-factory";
import { listKeys, LlmKeyEntry } from "./llm-client";
import { isLocalModelAvailable, LOCAL_MODEL_CAPABILITIES } from "./adapters/local-adapter";

/**
 * Model effort tiers
 */
export type EffortTier = "lite" | "high" | "max";

/**
 * Agent roles in the build pipeline
 */
export type AgentRole = "planner" | "coder" | "reviewer" | "fixer" | "researcher" | "summarizer" | "general";

/**
 * Task categories for classification
 */
export type TaskCategory =
  | "simple-edit"       // font change, remove component, config tweak
  | "standard-coding"   // implement feature, write component, fix bug
  | "complex-planning"  // architecture, multi-file refactor, design decisions
  | "research"          // web search, documentation lookup
  | "code-review"       // review code, find issues
  | "error-fix"         // fix compilation/runtime errors
  | "summarization"     // compress context, summarize steps
  | "visual-verification" // browser inspection, screenshot analysis
  | "deployment";       // deploy, CI config

/**
 * Model tier configuration
 */
export interface ModelTierConfig {
  tier: EffortTier;
  name: string;
  description: string;
  /** Preferred provider order for this tier */
  providerOrder: string[];
  /** Minimum capabilities required */
  minCapabilities: Partial<LLMCapabilities>;
  /** Max cost per 1k tokens (0 for free) */
  maxCostPer1kTokens: number;
  /** Estimated time budget */
  estimatedTimeMinutes: number;
  /** Typical use cases */
  useCases: string[];
}

/**
 * Model routing decision
 */
export interface RoutingDecision {
  tier: EffortTier;
  role: AgentRole;
  taskCategory: TaskCategory;
  selectedAdapter: LLMAdapter;
  selectedKey: LlmKeyEntry | null; // null when using local model
  reasoning: string;
  fallbackAdapters: LLMAdapter[];
  fallbackKeys: LlmKeyEntry[];
  estimatedCost: number;
  estimatedTimeMinutes: number;
  userOverride?: EffortTier;
}

/**
 * Cost tracking entry
 */
export interface CostEntry {
  timestamp: string;
  tier: EffortTier;
  role: AgentRole;
  taskCategory: TaskCategory;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  buildId?: string;
  projectId?: string;
}

/**
 * Model router configuration
 */
export interface ModelRouterConfig {
  /** Enable cost enforcement ($0 budget) */
  enforceZeroBudget: boolean;
  /** Default effort if not specified */
  defaultEffort: EffortTier;
  /** Allow user override via --effort flag */
  allowUserOverride: boolean;
  /** Provider failover chain */
  failoverChain: string[];
  /** Custom tier configs */
  tierConfigs?: Partial<Record<EffortTier, ModelTierConfig>>;
}

/**
 * Default tier configurations
 */
export const DEFAULT_TIER_CONFIGS: Record<EffortTier, ModelTierConfig> = {
  lite: {
    tier: "lite",
    name: "Lite",
    description: "Fast, cheap/local model for simple tasks (~3 min)",
    providerOrder: ["ollama", "openrouter-free", "nvidia-nim"],
    minCapabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: false,
      maxContextTokens: 32768,
      maxOutputTokens: 4096,
    },
    maxCostPer1kTokens: 0, // Free only
    estimatedTimeMinutes: 3,
    useCases: ["font changes", "config tweaks", "remove component", "simple edits", "error explanation"],
  },
  high: {
    tier: "high",
    name: "High",
    description: "Balanced model for standard coding tasks (~15 min)",
    providerOrder: ["openrouter", "nvidia-nim", "ollama"],
    minCapabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
    },
    maxCostPer1kTokens: 0.001, // Very cheap
    estimatedTimeMinutes: 15,
    useCases: ["implement feature", "write component", "fix bug", "standard coding", "research"],
  },
  max: {
    tier: "max",
    name: "Max",
    description: "Strongest model for complex planning/architectural tasks (~45 min)",
    providerOrder: ["openrouter", "nvidia-nim"],
    minCapabilities: {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 200000,
      maxOutputTokens: 16384,
    },
    maxCostPer1kTokens: 0.01, // Still prefer free but allow paid if needed
    estimatedTimeMinutes: 45,
    useCases: ["architecture", "multi-file refactor", "design decisions", "complex planning", "code review"],
  },
};

/**
 * Role to default tier mapping
 */
export const ROLE_DEFAULT_TIER: Record<AgentRole, EffortTier> = {
  planner: "max",
  coder: "high",
  reviewer: "max",
  fixer: "high",
  researcher: "high",
  summarizer: "lite",
  general: "high",
};

/**
 * Task category to default tier mapping
 */
export const TASK_CATEGORY_DEFAULT_TIER: Record<TaskCategory, EffortTier> = {
  "simple-edit": "lite",
  "standard-coding": "high",
  "complex-planning": "max",
  "research": "high",
  "code-review": "max",
  "error-fix": "high",
  "summarization": "lite",
  "visual-verification": "high",
  "deployment": "high",
};

/**
 * Model Router Engine
 */
export class ModelRouter {
  private config: ModelRouterConfig;
  private costHistory: CostEntry[] = [];
  private adapterCache: Map<string, LLMAdapter> = new Map();

  constructor(config: Partial<ModelRouterConfig> = {}) {
    this.config = {
      enforceZeroBudget: true,
      defaultEffort: "high",
      allowUserOverride: true,
      failoverChain: ["openrouter", "nvidia-nim", "ollama", "vllm"],
      tierConfigs: {},
      ...config,
    };
  }

  /**
   * Get tier configuration (with overrides)
   */
  getTierConfig(tier: EffortTier): ModelTierConfig {
    return { ...DEFAULT_TIER_CONFIGS[tier], ...this.config.tierConfigs?.[tier] };
  }

  /**
   * Classify task into category based on description/context
   */
  classifyTask(
    description: string,
    context?: { filesChanged?: string[]; errorOutput?: string; planStep?: string }
  ): TaskCategory {
    const desc = description.toLowerCase();
    const error = context?.errorOutput?.toLowerCase() || "";
    const files = context?.filesChanged?.join(" ").toLowerCase() || "";
    const plan = context?.planStep?.toLowerCase() || "";

    // Error fix detection
    if (error.includes("typescript") || error.includes("ts2") ||
        error.includes("compilation") || error.includes("build failed") ||
        desc.includes("fix error") || desc.includes("fix bug")) {
      return "error-fix";
    }

    // Simple edit detection
    if (desc.includes("font") || desc.includes("color") || desc.includes("spacing") ||
        desc.includes("remove") && (desc.includes("component") || desc.includes("file")) ||
        desc.includes("config") || desc.includes("constant") ||
        desc.includes("rename") || desc.includes("typos")) {
      return "simple-edit";
    }

    // Visual verification
    if (desc.includes("visual") || desc.includes("screenshot") ||
        desc.includes("browser") || desc.includes("inspect") ||
        desc.includes("layout") || desc.includes("overflow")) {
      return "visual-verification";
    }

    // Research
    if (desc.includes("research") || desc.includes("search") ||
        desc.includes("documentation") || desc.includes("lookup") ||
        desc.includes("find") && (desc.includes("how to") || desc.includes("example"))) {
      return "research";
    }

    // Code review
    if (desc.includes("review") || desc.includes("audit") ||
        desc.includes("security") || desc.includes("performance") ||
        desc.includes("best practice")) {
      return "code-review";
    }

    // Summarization
    if (desc.includes("summarize") || desc.includes("compress") ||
        desc.includes("compact") || desc.includes("condense")) {
      return "summarization";
    }

    // Deployment
    if (desc.includes("deploy") || desc.includes("ci") || desc.includes("cd") ||
        desc.includes("pipeline") || desc.includes("release")) {
      return "deployment";
    }

    // Complex planning
    if (desc.includes("architecture") || desc.includes("design") ||
        desc.includes("plan") && (desc.includes("multi") || desc.includes("system")) ||
        desc.includes("refactor") && (files.split(" ").length > 3) ||
        desc.includes("migrate") || desc.includes("restructure")) {
      return "complex-planning";
    }

    // Default to standard coding
    return "standard-coding";
  }

  /**
   * Determine effort tier for a task/role
   */
  determineTier(
    role: AgentRole,
    taskCategory: TaskCategory,
    userOverride?: EffortTier
  ): EffortTier {
    // User override takes precedence
    if (userOverride && this.config.allowUserOverride) {
      return userOverride;
    }

    // Role-based default
    const roleTier = ROLE_DEFAULT_TIER[role];

    // Task category default
    const taskTier = TASK_CATEGORY_DEFAULT_TIER[taskCategory];

    // Use the higher tier (more capable)
    const tierOrder: EffortTier[] = ["lite", "high", "max"];
    const roleIndex = tierOrder.indexOf(roleTier);
    const taskIndex = tierOrder.indexOf(taskTier);

    return tierOrder[Math.max(roleIndex, taskIndex)];
  }

  /**
   * Route to best available model for a tier
   */
  async routeToTier(
    tier: EffortTier,
    role: AgentRole,
    taskCategory: TaskCategory,
    buildId?: string,
    projectId?: string
  ): Promise<RoutingDecision> {
    const tierConfig = this.getTierConfig(tier);
    const allKeys = await listKeys();

    // Filter enabled, healthy keys
    const healthyKeys = allKeys.filter(k => {
      if (!k.enabled) return false;
      if (k.coolDownUntil && Date.now() < k.coolDownUntil) return false;
      return true;
    });

    // Score and sort keys by provider preference and capabilities
    const scoredKeys = healthyKeys.map(key => {
      const capabilities = this.getCapabilitiesForKey(key);
      const providerScore = this.getProviderScore(key, tierConfig.providerOrder);
      const capabilityScore = this.scoreCapabilities(capabilities, tierConfig.minCapabilities);
      const costScore = this.scoreCost(key, tierConfig.maxCostPer1kTokens);

      return {
        key,
        capabilities,
        totalScore: providerScore * 0.5 + capabilityScore * 0.3 + costScore * 0.2,
        providerScore,
        capabilityScore,
        costScore,
      };
    }).filter(s => s.capabilityScore > 0) // Must meet minimum capabilities
    .sort((a, b) => b.totalScore - a.totalScore);

    // Try to add local model as fallback for lite tier (or when no keys available)
    let localAdapter: LLMAdapter | null = null;
    let localCapabilities: LLMCapabilities | null = null;
    if (tier === "lite" || scoredKeys.length === 0) {
      localCapabilities = await this.getLocalModelCapabilities();
      if (localCapabilities) {
        // Check if local model meets minimum capabilities
        const localCapScore = this.scoreCapabilities(localCapabilities, tierConfig.minCapabilities);
        if (localCapScore > 0) {
          localAdapter = await import("./adapters/local-adapter").then(m => m.createLocalAdapter());
        }
      }
    }

    // If no scored keys and no local model, throw error
    if (scoredKeys.length === 0 && !localAdapter) {
      throw new Error(`No available models meet requirements for tier: ${tier}`);
    }

    let best: typeof scoredKeys[0];
    let selectedAdapter: LLMAdapter;
    let selectedKey: LlmKeyEntry | null = null;
    let reasoning: string;
    let estimatedCost: number;

    if (scoredKeys.length > 0) {
      best = scoredKeys[0];
      selectedAdapter = await this.createAdapterFromKey(best.key);
      selectedKey = best.key;
      reasoning = `Selected ${best.key.provider}/${best.key.model} (${tierConfig.name} tier) for ${role} role, ${taskCategory} task. Provider score: ${best.providerScore.toFixed(2)}, Capability score: ${best.capabilityScore.toFixed(2)}, Cost score: ${best.costScore.toFixed(2)}`;
      estimatedCost = this.estimateCost(best.key, tierConfig.estimatedTimeMinutes);
    } else {
      // Use local model as primary
      selectedAdapter = localAdapter!;
      selectedKey = null;
      reasoning = `Using local model (${tierConfig.name} tier) for ${role} role, ${taskCategory} task - no cloud keys available`;
      estimatedCost = 0;
    }

    // Build fallbacks: remaining scored keys + local model if not already used
    const fallbacks = scoredKeys.slice(1, 4);
    const fallbackAdapters = await Promise.all(
      fallbacks.map(f => this.createAdapterFromKey(f.key))
    );

    // Add local model as fallback if available and not already primary
    if (localAdapter && !selectedKey) {
      // Already using local as primary
    } else if (localAdapter) {
      fallbackAdapters.push(localAdapter);
    }

    return {
      tier,
      role,
      taskCategory,
      selectedAdapter,
      selectedKey,
      reasoning,
      fallbackAdapters,
      fallbackKeys: fallbacks.map(f => f.key),
      estimatedCost,
      estimatedTimeMinutes: tierConfig.estimatedTimeMinutes,
    };
  }

  /**
   * High-level routing: classify task and route
   */
  async route(
    role: AgentRole,
    taskDescription: string,
    context?: { filesChanged?: string[]; errorOutput?: string; planStep?: string },
    userOverride?: EffortTier,
    buildId?: string,
    projectId?: string
  ): Promise<RoutingDecision> {
    const taskCategory = this.classifyTask(taskDescription, context);
    const tier = this.determineTier(role, taskCategory, userOverride);
    return this.routeToTier(tier, role, taskCategory, buildId, projectId);
  }

  /**
   * Execute with automatic failover
   */
  async executeWithFailover<T>(
    decision: RoutingDecision,
    operation: (adapter: LLMAdapter) => Promise<T>
  ): Promise<{ result: T; usedFallback: boolean; fallbackIndex?: number }> {
    // Try primary
    try {
      const result = await operation(decision.selectedAdapter);
      return { result, usedFallback: false };
    } catch (primaryError) {
      // Try fallbacks
      for (let i = 0; i < decision.fallbackAdapters.length; i++) {
        try {
          const result = await operation(decision.fallbackAdapters[i]);
          return { result, usedFallback: true, fallbackIndex: i };
        } catch (fallbackError) {
          // Continue to next fallback
          console.warn(`Fallback ${i + 1} failed:`, fallbackError);
        }
      }
      // All failed
      throw primaryError;
    }
  }

  /**
   * Record cost for tracking
   */
  recordCost(entry: Omit<CostEntry, "timestamp">): void {
    const fullEntry: CostEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.costHistory.push(fullEntry);

    // Keep history bounded
    if (this.costHistory.length > 10000) {
      this.costHistory = this.costHistory.slice(-10000);
    }
  }

  /**
   * Get cost summary
   */
  getCostSummary(projectId?: string, buildId?: string): {
    totalCost: number;
    totalTokens: { input: number; output: number };
    byTier: Record<EffortTier, { cost: number; calls: number }>;
    byRole: Record<AgentRole, { cost: number; calls: number }>;
    byProvider: Record<string, { cost: number; calls: number }>;
    recentEntries: CostEntry[];
  } {
    let entries = this.costHistory;
    if (projectId) {
      entries = entries.filter(e => e.projectId === projectId);
    }
    if (buildId) {
      entries = entries.filter(e => e.buildId === buildId);
    }

    const byTier: Record<EffortTier, { cost: number; calls: number }> = {
      lite: { cost: 0, calls: 0 },
      high: { cost: 0, calls: 0 },
      max: { cost: 0, calls: 0 },
    };

    const byRole: Record<AgentRole, { cost: number; calls: number }> = {
      planner: { cost: 0, calls: 0 },
      coder: { cost: 0, calls: 0 },
      reviewer: { cost: 0, calls: 0 },
      fixer: { cost: 0, calls: 0 },
      researcher: { cost: 0, calls: 0 },
      summarizer: { cost: 0, calls: 0 },
      general: { cost: 0, calls: 0 },
    };

    const byProvider: Record<string, { cost: number; calls: number }> = {};

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const entry of entries) {
      totalCost += entry.costUsd;
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;

      byTier[entry.tier].cost += entry.costUsd;
      byTier[entry.tier].calls += 1;

      byRole[entry.role].cost += entry.costUsd;
      byRole[entry.role].calls += 1;

      if (!byProvider[entry.provider]) {
        byProvider[entry.provider] = { cost: 0, calls: 0 };
      }
      byProvider[entry.provider].cost += entry.costUsd;
      byProvider[entry.provider].calls += 1;
    }

    return {
      totalCost,
      totalTokens: { input: totalInputTokens, output: totalOutputTokens },
      byTier,
      byRole,
      byProvider,
      recentEntries: entries.slice(-50),
    };
  }

  /**
   * Check if budget allows another call
   */
  checkBudget(estimatedCost: number, projectId?: string): { allowed: boolean; reason?: string } {
    if (!this.config.enforceZeroBudget) {
      return { allowed: true };
    }

    const summary = this.getCostSummary(projectId);
    if (summary.totalCost + estimatedCost > 0.01) { // $0.01 threshold for "effectively zero"
      return {
        allowed: false,
        reason: `Budget exceeded: $${summary.totalCost.toFixed(4)} used, $${estimatedCost.toFixed(4)} estimated`,
      };
    }

    return { allowed: true };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private getCapabilitiesForKey(key: LlmKeyEntry): LLMCapabilities {
    const baseUrl = key.baseUrl.toLowerCase();
    const model = key.model.toLowerCase();

    if (baseUrl.includes("openrouter")) {
      return {
        streaming: true,
        jsonMode: true,
        toolCalling: true,
        vision: true,
        maxContextTokens: model.includes("gemini") ? 1000000 : 128000,
        maxOutputTokens: 8192,
      };
    }
    if (baseUrl.includes("nvidia")) {
      return {
        streaming: true,
        jsonMode: true,
        toolCalling: true,
        vision: true,
        maxContextTokens: 128000,
        maxOutputTokens: 8192,
      };
    }
    if (baseUrl.includes("ollama") || baseUrl.includes("localhost")) {
      return {
        streaming: true,
        jsonMode: true,
        toolCalling: false,
        vision: false,
        maxContextTokens: 32768,
        maxOutputTokens: 4096,
      };
    }
    if (baseUrl.includes("vllm")) {
      return {
        streaming: true,
        jsonMode: true,
        toolCalling: true,
        vision: false,
        maxContextTokens: 128000,
        maxOutputTokens: 8192,
      };
    }

    // Generic
    return {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: false,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
    };
  }

  /**
   * Get capabilities for local model (not from key pool)
   */
  private async getLocalModelCapabilities(): Promise<LLMCapabilities | null> {
    const available = await isLocalModelAvailable();
    if (!available) return null;
    return { ...LOCAL_MODEL_CAPABILITIES };
  }

  private getProviderScore(key: LlmKeyEntry, providerOrder: string[]): number {
    const baseUrl = key.baseUrl.toLowerCase();
    let provider = "unknown";

    if (baseUrl.includes("openrouter")) provider = "openrouter";
    else if (baseUrl.includes("nvidia")) provider = "nvidia-nim";
    else if (baseUrl.includes("ollama") || baseUrl.includes("localhost")) provider = "ollama";
    else if (baseUrl.includes("vllm")) provider = "vllm";

    const index = providerOrder.indexOf(provider);
    if (index >= 0) {
      return 1 - (index / providerOrder.length) * 0.5; // 1.0 for first, 0.5 for last
    }
    return 0.3; // Unknown provider gets low score
  }

  private scoreCapabilities(actual: LLMCapabilities, required: Partial<LLMCapabilities>): number {
    let score = 0;
    let checks = 0;

    for (const [cap, requiredValue] of Object.entries(required)) {
      checks++;
      const actualValue = actual[cap as keyof LLMCapabilities];
      if (actualValue === requiredValue) {
        score += 1;
      } else if (typeof actualValue === "number" && typeof requiredValue === "number") {
        // For numeric capabilities, score based on ratio
        score += Math.min(1, actualValue / requiredValue);
      } else if (actualValue === true && requiredValue === false) {
        score += 1; // Exceeds requirement
      }
      // actualValue false when required true = 0
    }

    return checks > 0 ? score / checks : 1;
  }

  private scoreCost(key: LlmKeyEntry, maxCostPer1k: number): number {
    // Free models get max score
    if (key.costPer1kTokens === 0 || key.costPer1kTokens === undefined) {
      return 1;
    }
    if (key.costPer1kTokens <= maxCostPer1k) {
      return 1 - (key.costPer1kTokens / maxCostPer1k) * 0.5;
    }
    return 0; // Exceeds max cost
  }

  private estimateCost(key: LlmKeyEntry, minutes: number): number {
    // Very rough estimate based on typical usage
    if (key.costPer1kTokens === 0 || key.costPer1kTokens === undefined) {
      return 0;
    }
    // Estimate ~10k tokens per minute of work
    const estimatedTokens = minutes * 10000;
    return (estimatedTokens / 1000) * key.costPer1kTokens;
  }

  private async createAdapterFromKey(key: LlmKeyEntry): Promise<LLMAdapter> {
    const cacheKey = `${key.id}:${key.model}`;
    const cached = this.adapterCache.get(cacheKey);
    if (cached) return cached;

    const adapter = await createAdapterFromEntry(key);
    this.adapterCache.set(cacheKey, adapter);
    return adapter;
  }
}

/**
 * ============================================================
 * HIGH-LEVEL API
 * ============================================================
 */

// Global router instance
let modelRouter: ModelRouter | null = null;

/**
 * Get or create global model router
 */
export function getModelRouter(config?: Partial<ModelRouterConfig>): ModelRouter {
  if (!modelRouter) {
    modelRouter = new ModelRouter(config);
  }
  return modelRouter;
}

/**
 * Route and execute with automatic failover
 */
export async function routeAndExecute<T>(
  role: AgentRole,
  taskDescription: string,
  operation: (adapter: LLMAdapter) => Promise<T>,
  context?: { filesChanged?: string[]; errorOutput?: string; planStep?: string },
  userOverride?: EffortTier,
  buildId?: string,
  projectId?: string
): Promise<{ result: T; decision: RoutingDecision; usedFallback: boolean }> {
  const router = getModelRouter();
  const decision = await router.route(role, taskDescription, context, userOverride, buildId, projectId);

  // Check budget
  const budgetCheck = router.checkBudget(decision.estimatedCost, projectId);
  if (!budgetCheck.allowed) {
    throw new Error(`Budget check failed: ${budgetCheck.reason}`);
  }

  const { result, usedFallback } = await router.executeWithFailover(decision, operation);

  // Record cost (would be updated with actual tokens from operation)
  router.recordCost({
    tier: decision.tier,
    role,
    taskCategory: decision.taskCategory,
    model: decision.selectedKey?.model ?? "local",
    provider: decision.selectedKey?.provider ?? "ollama",
    inputTokens: 0, // Would be filled by adapter
    outputTokens: 0,
    costUsd: decision.estimatedCost,
    buildId,
    projectId,
  });

  return { result, decision, usedFallback };
}

/**
 * Parse effort flag from command line
 */
export function parseEffortFlag(args: string[]): EffortTier | undefined {
  const effortArg = args.find(arg => arg.startsWith("--effort=")) || args[args.indexOf("--effort") + 1];
  if (effortArg) {
    const value = effortArg.replace("--effort=", "") as EffortTier;
    if (["lite", "high", "max"].includes(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: EffortTier): string {
  return DEFAULT_TIER_CONFIGS[tier].name;
}

/**
 * Get tier description
 */
export function getTierDescription(tier: EffortTier): string {
  return DEFAULT_TIER_CONFIGS[tier].description;
}

export default ModelRouter;