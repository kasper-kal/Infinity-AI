import { useState, useCallback, useEffect } from "react";
import type { ModelConfig, ModelProvider, BuildMode, TaskCategory, BuildModeConfig, ModelSelectionResult, CostEstimate, ModelBenchmark, CostSummary } from "@/lib/model-router-types";

interface UseModelRouterOptions {
  projectId?: string;
  userId?: string;
}

interface UseModelRouterReturn {
  // Model selection
  selectModel: (taskCategory: TaskCategory, buildMode?: BuildMode, constraints?: Partial<BuildModeConfig>) => Promise<ModelSelectionResult | null>;
  getRecommendedModels: (taskCategory: TaskCategory, buildMode?: BuildMode) => Promise<ModelConfig[]>;
  getAllModels: (filters?: { capability?: string; provider?: ModelProvider; enabled?: boolean }) => Promise<ModelConfig[]>;

  // Build modes
  getBuildModeConfig: (mode: BuildMode) => BuildModeConfig;
  getAllBuildModes: () => Record<BuildMode, BuildModeConfig>;
  updateBuildModeConfig: (mode: BuildMode, config: Partial<BuildModeConfig>) => void;

  // Cost estimation
  estimateRequestCost: (model: ModelConfig, inputTokens: number, outputTokens: number) => CostEstimate;
  estimateDeepResearchCost: (model: ModelConfig, steps?: number) => CostEstimate;

  // Benchmarks
  getModelBenchmarks: () => Record<string, ModelBenchmark>;

  // Cost summary
  getCostSummary: (projectId: string, days?: number) => Promise<CostSummary>;

  // State
  isLoading: boolean;
  error: string | null;
}

const API_BASE = "/api/infinity/model-router";

export function useModelRouter(options: UseModelRouterOptions = {}): UseModelRouterReturn {
  const { projectId, userId } = options;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildModesCache, setBuildModesCache] = useState<Record<BuildMode, BuildModeConfig> | null>(null);
  const [benchmarksCache, setBenchmarksCache] = useState<Record<string, ModelBenchmark> | null>(null);

  const request = useCallback(async <T>(endpoint: string, init?: RequestInit): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (userId) params.set("userId", userId);

      const url = `${API_BASE}${endpoint}?${params.toString()}`;
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [projectId, userId]);

  // Load build modes on mount
  useEffect(() => {
    request<Record<BuildMode, BuildModeConfig>>("/build-modes")
      .then(setBuildModesCache)
      .catch(() => {});
  }, [request]);

  // Load benchmarks on mount
  useEffect(() => {
    request<Record<string, ModelBenchmark>>("/benchmarks")
      .then(setBenchmarksCache)
      .catch(() => {});
  }, [request]);

  // Model selection
  const selectModel = useCallback(async (
    taskCategory: TaskCategory,
    buildMode: BuildMode = "balanced",
    constraints?: Partial<BuildModeConfig>
  ): Promise<ModelSelectionResult | null> => {
    try {
      return await request<ModelSelectionResult>("/select-model", {
        method: "POST",
        body: JSON.stringify({ taskCategory, buildMode, constraints }),
      });
    } catch {
      return null;
    }
  }, [request]);

  const getRecommendedModels = useCallback(async (
    taskCategory: TaskCategory,
    buildMode: BuildMode = "balanced"
  ): Promise<ModelConfig[]> => {
    try {
      return await request<ModelConfig[]>(`/recommended?taskCategory=${taskCategory}&buildMode=${buildMode}`);
    } catch {
      return [];
    }
  }, [request]);

  const getAllModels = useCallback(async (filters?: { capability?: string; provider?: ModelProvider; enabled?: boolean }): Promise<ModelConfig[]> => {
    try {
      const params = new URLSearchParams();
      if (filters?.capability) params.set("capability", filters.capability);
      if (filters?.provider) params.set("provider", filters.provider);
      if (filters?.enabled !== undefined) params.set("enabled", filters.enabled.toString());

      return await request<ModelConfig[]>(`/models?${params.toString()}`);
    } catch {
      return [];
    }
  }, [request]);

  // Build modes
  const getBuildModeConfig = useCallback((mode: BuildMode): BuildModeConfig => {
    return buildModesCache?.[mode] || {
      name: mode,
      description: "",
      parallelAgents: 2,
      verificationDepth: "standard",
      contextBudget: 1,
      preferLocal: false,
      preferSpeed: false,
      preferCost: false,
      preferQuality: false,
      maxCostPerRequest: 0.5,
      maxLatencyMs: 15000,
      temperature: 0.5,
    };
  }, [buildModesCache]);

  const getAllBuildModes = useCallback((): Record<BuildMode, BuildModeConfig> => {
    return buildModesCache || {} as Record<BuildMode, BuildModeConfig>;
  }, [buildModesCache]);

  const updateBuildModeConfig = useCallback((mode: BuildMode, config: Partial<BuildModeConfig>) => {
    if (mode === "custom") {
      setBuildModesCache(prev => prev ? { ...prev, [mode]: { ...prev[mode], ...config } } : null);
    }
  }, []);

  // Cost estimation (client-side using model config)
  const estimateRequestCost = useCallback((
    model: ModelConfig,
    estimatedInputTokens: number,
    estimatedOutputTokens: number
  ): CostEstimate => {
    const inputCost = (estimatedInputTokens / 1000) * (model.costPer1kInputTokens || 0);
    const outputCost = (estimatedOutputTokens / 1000) * (model.costPer1kOutputTokens || 0);
    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd: inputCost + outputCost,
      modelId: model.id,
      breakdown: { inputCost, outputCost },
    };
  }, []);

  const estimateDeepResearchCost = useCallback((
    model: ModelConfig,
    steps: number = 5
  ): CostEstimate => {
    const searchInputPerStep = 2000;
    const searchOutputPerStep = 1000;
    const synthesisInput = 5000;
    const synthesisOutput = 3000;
    const totalInput = (searchInputPerStep * steps) + synthesisInput;
    const totalOutput = (searchOutputPerStep * steps) + synthesisOutput;
    return estimateRequestCost(model, totalInput, totalOutput);
  }, [estimateRequestCost]);

  // Benchmarks
  const getModelBenchmarks = useCallback((): Record<string, ModelBenchmark> => {
    return benchmarksCache || {};
  }, [benchmarksCache]);

  // Cost summary
  const getCostSummary = useCallback(async (pid: string, days: number = 30): Promise<CostSummary> => {
    try {
      return await request<CostSummary>(`/cost-summary?projectId=${pid}&days=${days}`);
    } catch {
      return {
        projectId: pid,
        periodDays: days,
        totalCost: 0,
        costByModel: {},
        costByCategory: {},
        costByDay: [],
        budgetUtilization: 0,
      };
    }
  }, [request]);

  return {
    selectModel,
    getRecommendedModels,
    getAllModels,
    getBuildModeConfig,
    getAllBuildModes,
    updateBuildModeConfig,
    estimateRequestCost,
    estimateDeepResearchCost,
    getModelBenchmarks,
    getCostSummary,
    isLoading,
    error,
  };
}

// Type definitions for frontend (mirroring backend types)
export type { ModelConfig, ModelProvider, BuildMode, TaskCategory, BuildModeConfig, ModelSelectionResult, CostEstimate, ModelBenchmark, CostSummary };