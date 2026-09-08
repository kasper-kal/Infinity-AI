/**
 * useRecipes Hook
 * React hook for interacting with the Recipe API
 */

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";

// ============================================================================
// TYPES
// ============================================================================

export type RecipeParameterType = "string" | "number" | "boolean" | "array" | "object";

export interface RecipeParameter {
  name: string;
  type: RecipeParameterType;
  required: boolean;
  default?: unknown;
  description?: string;
  enum?: string[];
}

export interface RecipeStep {
  id: string;
  prompt: string;
  modelCategory?: string;
  tools?: string[];
  outputKey?: string;
  condition?: string;
}

export interface DeepResearchConfig {
  researchSteps?: number;
  synthesisModel?: string;
  verificationModel?: string;
  outputFormat?: "markdown" | "json" | "pdf" | "html";
}

export interface Recipe {
  id?: string;
  name: string;
  description?: string;
  version: string;
  type: "standard" | "deep-research";
  parameters: RecipeParameter[];
  steps: RecipeStep[];
  outputSchema?: Record<string, unknown>;
  tags: string[];
  author?: string;
  isPublic: boolean;
  isBuiltIn: boolean;
  deepResearchConfig?: DeepResearchConfig;
  createdAt?: string;
  updatedAt?: string;
  avgRating?: number;
  ratingCount?: number;
}

export interface RecipeVersion {
  id: string;
  recipeId: string;
  version: string;
  changelog?: string;
  snapshot: Recipe;
  createdAt: string;
}

export interface ExecutionProgress {
  stepId: string;
  status: "pending" | "running" | "complete" | "error";
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface RecipeExecution {
  id: string;
  recipeId: string;
  recipeVersion: string;
  parameters: Record<string, unknown>;
  result?: {
    output?: unknown;
    steps?: ExecutionProgress[];
    totalDuration?: number;
    cost?: number;
  };
  status: "pending" | "running" | "complete" | "error" | "cancelled";
  error?: string;
  projectId?: string;
  accountId?: string;
  startedAt: string;
  completedAt?: string;
}

export interface RecipeRating {
  id: string;
  recipeId: string;
  accountId: string;
  rating: number;
  review?: string;
  createdAt: string;
}

// ============================================================================
// HOOK
// ============================================================================

const API_BASE = "/api/infinity/recipes";

export interface UseRecipesOptions {
  autoLoad?: boolean;
  type?: "standard" | "deep-research";
  tag?: string;
  search?: string;
  includeBuiltIn?: boolean;
}

export function useRecipes(options: UseRecipesOptions = {}) {
  const { autoLoad = true, type, tag, search, includeBuiltIn = true } = options;
  const { t } = useI18n();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      const message = err instanceof Error ? err.message : fallback;
      setError(message);
      console.error(fallback, err);
      return message;
    },
    []
  );

  // List recipes with filters
  const fetchRecipes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (tag) params.set("tag", tag);
      if (search) params.set("search", search);
      params.set("limit", "100");

      const response = await fetch(`${API_BASE}?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      let items = data.recipes || [];
      if (!includeBuiltIn) {
        items = items.filter((r: Recipe) => !r.isBuiltIn);
      }
      setRecipes(items);
      return items;
    } catch (err) {
      handleError(err, t("recipes.errors.list"));
      return [];
    } finally {
      setLoading(false);
    }
  }, [type, tag, search, includeBuiltIn, handleError, t]);

  // Fetch categories
  const fetchCategories = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/categories`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCategories(data.categories || []);
      return data.categories || [];
    } catch (err) {
      handleError(err, t("recipes.errors.categories"));
      return [];
    }
  }, [handleError, t]);

  // Get single recipe
  const getRecipe = useCallback(async (id: string): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}/${id}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.get"));
      return null;
    }
  }, [handleError, t]);

  // Create recipe
  const createRecipe = useCallback(async (recipe: Partial<Recipe>): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipe),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.create"));
      return null;
    }
  }, [handleError, t]);

  // Update recipe
  const updateRecipe = useCallback(async (id: string, updates: Partial<Recipe>): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.update"));
      return null;
    }
  }, [handleError, t]);

  // Delete recipe
  const deleteRecipe = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (err) {
      handleError(err, t("recipes.errors.delete"));
      return false;
    }
  }, [handleError, t]);

  // Fork recipe
  const forkRecipe = useCallback(async (id: string, name: string): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.fork"));
      return null;
    }
  }, [handleError, t]);

  // Get versions
  const getVersions = useCallback(async (id: string): Promise<RecipeVersion[]> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/versions`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.versions || [];
    } catch (err) {
      handleError(err, t("recipes.errors.versions"));
      return [];
    }
  }, [handleError, t]);

  // Create version
  const createVersion = useCallback(async (id: string, version: string, changelog?: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, changelog }),
      });
      return response.ok;
    } catch (err) {
      handleError(err, t("recipes.errors.createVersion"));
      return false;
    }
  }, [handleError, t]);

  // Rollback to version
  const rollbackToVersion = useCallback(async (id: string, version: string): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.rollback"));
      return null;
    }
  }, [handleError, t]);

  // Execute recipe
  const executeRecipe = useCallback(
    async (
      id: string,
      parameters: Record<string, unknown>
    ): Promise<RecipeExecution | null> => {
      try {
        const response = await fetch(`${API_BASE}/${id}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parameters }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        return data.execution || null;
      } catch (err) {
        handleError(err, t("recipes.errors.execute"));
        return null;
      }
    },
    [handleError, t]
  );

  // Get execution
  const getExecution = useCallback(async (executionId: string): Promise<RecipeExecution | null> => {
    try {
      const response = await fetch(`${API_BASE}/executions/${executionId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.execution || null;
    } catch (err) {
      handleError(err, t("recipes.errors.getExecution"));
      return null;
    }
  }, [handleError, t]);

  // Cancel execution
  const cancelExecution = useCallback(async (executionId: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/executions/${executionId}/cancel`, {
        method: "POST",
      });
      return response.ok;
    } catch (err) {
      handleError(err, t("recipes.errors.cancel"));
      return false;
    }
  }, [handleError, t]);

  // Rate recipe
  const rateRecipe = useCallback(
    async (id: string, rating: number, review?: string): Promise<boolean> => {
      try {
        const response = await fetch(`${API_BASE}/${id}/rate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating,
            review,
            accountId: "local-user",
          }),
        });
        return response.ok;
      } catch (err) {
        handleError(err, t("recipes.errors.rate"));
        return false;
      }
    },
    [handleError, t]
  );

  // Publish to marketplace
  const publishRecipe = useCallback(async (id: string): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/publish`, { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.publish"));
      return null;
    }
  }, [handleError, t]);

  const unpublishRecipe = useCallback(async (id: string): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/unpublish`, { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.unpublish"));
      return null;
    }
  }, [handleError, t]);

  // Import recipe from JSON
  const importRecipe = useCallback(async (json: string): Promise<Recipe | null> => {
    try {
      const response = await fetch(`${API_BASE}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.recipe || null;
    } catch (err) {
      handleError(err, t("recipes.errors.import"));
      return null;
    }
  }, [handleError, t]);

  // Export recipe
  const exportRecipe = useCallback(async (id: string): Promise<string | null> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/export`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (err) {
      handleError(err, t("recipes.errors.export"));
      return null;
    }
  }, [handleError, t]);

  // Get ratings
  const getRatings = useCallback(async (id: string): Promise<RecipeRating[]> => {
    try {
      const response = await fetch(`${API_BASE}/${id}/ratings`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.ratings || [];
    } catch (err) {
      handleError(err, t("recipes.errors.ratings"));
      return [];
    }
  }, [handleError, t]);

  // Initial load
  useEffect(() => {
    if (autoLoad) {
      fetchRecipes();
      fetchCategories();
    }
  }, [autoLoad, fetchRecipes, fetchCategories]);

  return {
    recipes,
    categories,
    loading,
    error,
    fetchRecipes,
    fetchCategories,
    getRecipe,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    forkRecipe,
    getVersions,
    createVersion,
    rollbackToVersion,
    executeRecipe,
    getExecution,
    cancelExecution,
    rateRecipe,
    publishRecipe,
    unpublishRecipe,
    importRecipe,
    exportRecipe,
    getRatings,
  };
}