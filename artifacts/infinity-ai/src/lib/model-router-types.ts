import { z } from "zod";

/**
 * Model Router Types - Frontend type definitions mirroring backend types
 * Part of Phase 39: Enhanced LLM API Key System
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

// Build mode configuration
export interface BuildModeConfig {
  name: BuildMode;
  description: string;
  parallelAgents: number;
  verificationDepth: "minimal" | "standard" | "thorough" | "adversarial";
  contextBudget: number;
  preferLocal: boolean;
  preferSpeed: boolean;
  preferCost: boolean;
  preferQuality: boolean;
  maxCostPerRequest: number;
  maxLatencyMs: number;
  temperature: number;
}

// Model selection result
export interface ModelSelectionResult {
  model: ModelConfig;
  fallbackModels: ModelConfig[];
  reasoning: string;
  estimatedCost: number;
  estimatedLatency: number;
}

// Cost estimate
export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  modelId: string;
  breakdown?: {
    inputCost: number;
    outputCost: number;
  };
}

// Cost tracking
export interface CostSummary {
  projectId: string;
  periodDays: number;
  totalCost: number;
  costByModel: Record<string, number>;
  costByCategory: Record<string, number>;
  costByDay: Array<{ date: string; cost: number }>;
  budgetUtilization: number;
}

export type { ModelConfig, ModelProvider, BuildMode, TaskCategory, BuildModeConfig, ModelSelectionResult, CostEstimate, ModelBenchmark, CostSummary };