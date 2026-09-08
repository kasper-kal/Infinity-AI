import { z } from "zod";
import { universalAgent } from "./universal-agent.js";
import { llmAdapter } from "./llm-adapter.js";
import { toolRegistry } from "./tool-registry.js";

// ============================================================================
// SCHEMAS
// ============================================================================

export const RecipeParameterSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

export const RecipeStepSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  modelCategory: z.string().optional(),
  tools: z.array(z.string()).optional(),
  outputKey: z.string().optional(),
  condition: z.string().optional(), // JavaScript expression for conditional execution
});

export const DeepResearchConfigSchema = z.object({
  researchSteps: z.number().int().positive().default(5),
  synthesisModel: z.string().optional(),
  verificationModel: z.string().optional(),
  outputFormat: z.enum(["markdown", "json", "pdf", "html"]).default("markdown"),
});

export const RecipeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  version: z.string().default("1.0.0"),
  type: z.enum(["standard", "deep-research"]).default("standard"),
  parameters: z.array(RecipeParameterSchema).default([]),
  steps: z.array(RecipeStepSchema).default([]),
  outputSchema: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).default([]),
  author: z.string().optional(),
  isPublic: z.boolean().default(false),
  isBuiltIn: z.boolean().default(false),
  deepResearchConfig: DeepResearchConfigSchema.optional(),
});

export const RecipeVersionSchema = z.object({
  id: z.string().uuid().optional(),
  recipeId: z.string().uuid(),
  version: z.string(),
  changelog: z.string().optional(),
  snapshot: RecipeSchema,
  createdAt: z.date().optional(),
});

export const RecipeExecutionSchema = z.object({
  id: z.string().uuid().optional(),
  recipeId: z.string().uuid(),
  recipeVersion: z.string(),
  parameters: z.record(z.unknown()),
  result: z.record(z.unknown()).optional(),
  status: z.enum(["pending", "running", "complete", "error", "cancelled"]).default("pending"),
  error: z.string().optional(),
  projectId: z.string().optional(),
  accountId: z.string().uuid().optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
});

export const RecipeRatingSchema = z.object({
  id: z.string().uuid().optional(),
  recipeId: z.string().uuid(),
  accountId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  review: z.string().optional(),
  createdAt: z.date().optional(),
});

// ============================================================================
// TYPES
// ============================================================================

export type RecipeParameter = z.infer<typeof RecipeParameterSchema>;
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type DeepResearchConfig = z.infer<typeof DeepResearchConfigSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeVersion = z.infer<typeof RecipeVersionSchema>;
export type RecipeExecution = z.infer<typeof RecipeExecutionSchema>;
export type RecipeRating = z.infer<typeof RecipeRatingSchema>;

export type ExecutionProgress = {
  stepId: string;
  status: "pending" | "running" | "complete" | "error";
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
};

export type ExecutionResult = {
  output?: unknown;
  steps?: ExecutionProgress[];
  totalDuration?: number;
  cost?: number;
};

// ============================================================================
// PARAMETER INTERPOLATION
// ============================================================================

/**
 * Interpolate parameters into a template string.
 * Supports {{paramName}}, {{#if paramName}}...{{/if}}, {{#each array}}...{{/each}}
 */
export function interpolateParams(template: string, params: Record<string, unknown>): string {
  let result = template;

  // Handle conditionals {{#if param}}...{{/if}}
  result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, paramName, content) => {
    const value = params[paramName];
    return value ? content : "";
  });

  // Handle loops {{#each array}}...{{/each}}
  result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayName, content) => {
    const array = params[arrayName] as unknown[];
    if (!Array.isArray(array)) return "";
    return array.map(item => {
      if (typeof item === "object" && item !== null) {
        return interpolateParams(content, item as Record<string, unknown>);
      }
      return content.replace(/\{\{this\}\}/g, String(item));
    }).join("");
  });

  // Handle simple variable substitution {{paramName}}
  result = result.replace(/\{\{(\w+)\}\}/g, (match, paramName) => {
    const value = params[paramName];
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });

  return result;
}

/**
 * Validate parameters against recipe parameter schema
 */
export function validateParameters(parameters: RecipeParameter[], input: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const param of parameters) {
    const value = input[param.name];

    if (param.required && (value === undefined || value === null || value === "")) {
      errors.push(`Required parameter '${param.name}' is missing`);
      continue;
    }

    if (value !== undefined && value !== null) {
      // Type validation
      switch (param.type) {
        case "number":
          if (typeof value !== "number" && isNaN(Number(value))) {
            errors.push(`Parameter '${param.name}' must be a number`);
          }
          break;
        case "boolean":
          if (typeof value !== "boolean" && value !== "true" && value !== "false") {
            errors.push(`Parameter '${param.name}' must be a boolean`);
          }
          break;
        case "array":
          if (!Array.isArray(value)) {
            errors.push(`Parameter '${param.name}' must be an array`);
          }
          break;
        case "object":
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            errors.push(`Parameter '${param.name}' must be an object`);
          }
          break;
        case "string":
          if (typeof value !== "string") {
            errors.push(`Parameter '${param.name}' must be a string`);
          }
          break;
      }

      // Enum validation
      if (param.enum && param.enum.length > 0 && !param.enum.includes(String(value))) {
        errors.push(`Parameter '${param.name}' must be one of: ${param.enum.join(", ")}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// RECIPE ENGINE CLASS
// ============================================================================

export class RecipeEngine {
  private recipes: Map<string, Recipe> = new Map();
  private versions: Map<string, RecipeVersion[]> = new Map();
  private executions: Map<string, RecipeExecution> = new Map();
  private ratings: Map<string, RecipeRating[]> = new Map();
  private listeners: Map<string, Set<(progress: ExecutionProgress) => void>> = new Map();

  constructor() {
    this.loadBuiltInRecipes();
  }

  // ---------------------------------------------------------------------------
  // RECIPE MANAGEMENT
  // ---------------------------------------------------------------------------

  registerRecipe(recipe: Recipe): Recipe {
    const validated = RecipeSchema.parse(recipe);
    if (!validated.id) {
      validated.id = crypto.randomUUID();
    }
    this.recipes.set(validated.id, validated);
    return validated;
  }

  getRecipe(id: string): Recipe | undefined {
    return this.recipes.get(id);
  }

  getRecipeByName(name: string): Recipe | undefined {
    for (const recipe of this.recipes.values()) {
      if (recipe.name === name) return recipe;
    }
    return undefined;
  }

  listRecipes(category?: string): Recipe[] {
    const recipes = Array.from(this.recipes.values());
    if (category) {
      return recipes.filter(r => r.tags.includes(category));
    }
    return recipes;
  }

  updateRecipe(id: string, updates: Partial<Recipe>): Recipe | undefined {
    const existing = this.recipes.get(id);
    if (!existing) return undefined;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    const validated = RecipeSchema.parse(updated);
    this.recipes.set(id, validated);
    return validated;
  }

  deleteRecipe(id: string): boolean {
    return this.recipes.delete(id);
  }

  forkRecipe(id: string, newName: string): Recipe | undefined {
    const existing = this.recipes.get(id);
    if (!existing) return undefined;

    const forked: Recipe = {
      ...existing,
      id: undefined, // will be generated
      name: newName,
      version: "1.0.0",
      isBuiltIn: false,
      author: existing.author ? `${existing.author} (forked)` : "Unknown",
      tags: [...existing.tags, "forked"],
    };

    return this.registerRecipe(forked);
  }

  // ---------------------------------------------------------------------------
  // VERSION MANAGEMENT
  // ---------------------------------------------------------------------------

  createVersion(recipeId: string, version: string, changelog?: string): RecipeVersion | undefined {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return undefined;

    const recipeVersion: RecipeVersion = {
      id: crypto.randomUUID(),
      recipeId,
      version,
      changelog,
      snapshot: { ...recipe },
      createdAt: new Date(),
    };

    const versions = this.versions.get(recipeId) || [];
    versions.push(recipeVersion);
    this.versions.set(recipeId, versions);

    return recipeVersion;
  }

  getVersions(recipeId: string): RecipeVersion[] {
    return this.versions.get(recipeId) || [];
  }

  rollbackToVersion(recipeId: string, version: string): Recipe | undefined {
    const versions = this.versions.get(recipeId) || [];
    const targetVersion = versions.find(v => v.version === version);
    if (!targetVersion) return undefined;

    const restored = this.updateRecipe(recipeId, targetVersion.snapshot);
    return restored;
  }

  // ---------------------------------------------------------------------------
  // EXECUTION
  // ---------------------------------------------------------------------------

  async executeRecipe(
    recipeId: string,
    parameters: Record<string, unknown>,
    options: {
      projectId?: string;
      accountId?: string;
      onProgress?: (progress: ExecutionProgress) => void;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<RecipeExecution> {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) {
      throw new Error(`Recipe ${recipeId} not found`);
    }

    // Validate parameters
    const validation = validateParameters(recipe.parameters, parameters);
    if (!validation.valid) {
      throw new Error(`Parameter validation failed: ${validation.errors.join(", ")}`);
    }

    // Apply defaults
    for (const param of recipe.parameters) {
      if (parameters[param.name] === undefined && param.default !== undefined) {
        parameters[param.name] = param.default;
      }
    }

    // Create execution record
    const execution: RecipeExecution = {
      id: crypto.randomUUID(),
      recipeId,
      recipeVersion: recipe.version,
      parameters,
      status: "running",
      projectId: options.projectId,
      accountId: options.accountId,
      startedAt: new Date(),
    };

    this.executions.set(execution.id, execution);

    // Subscribe to progress
    if (options.onProgress) {
      const listeners = this.listeners.get(execution.id) || new Set();
      listeners.add(options.onProgress);
      this.listeners.set(execution.id, listeners);
    }

    try {
      let result: ExecutionResult;

      if (recipe.type === "standard") {
        result = await this.executeStandardRecipe(recipe, parameters, options);
      } else {
        result = await this.executeDeepResearchRecipe(recipe, parameters, options);
      }

      execution.status = "complete";
      execution.result = result as Record<string, unknown>;
      execution.completedAt = new Date();
      execution.totalDuration = execution.completedAt.getTime() - execution.startedAt.getTime();

    } catch (error) {
      execution.status = "error";
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completedAt = new Date();
      throw error;
    } finally {
      // Cleanup listeners
      this.listeners.delete(execution.id);
    }

    return execution;
  }

  private async executeStandardRecipe(
    recipe: Recipe,
    parameters: Record<string, unknown>,
    options: { abortSignal?: AbortSignal; onProgress?: (progress: ExecutionProgress) => void }
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const stepsProgress: ExecutionProgress[] = [];

    for (const step of recipe.steps) {
      if (options.abortSignal?.aborted) {
        throw new Error("Execution aborted");
      }

      // Check condition
      if (step.condition) {
        try {
          const shouldRun = new Function("params", `return ${step.condition}`)(parameters);
          if (!shouldRun) continue;
        } catch {
          // If condition fails, skip step
          continue;
        }
      }

      const stepProgress: ExecutionProgress = {
        stepId: step.id,
        status: "running",
        startedAt: new Date().toISOString(),
      };
      stepsProgress.push(stepProgress);
      options.onProgress?.(stepProgress);

      // Interpolate prompt
      const prompt = interpolateParams(step.prompt, parameters);

      // Run LLM call
      try {
        const response = await this.callModel(step, prompt, parameters);

        if (step.outputKey) {
          parameters[step.outputKey] = response;
        }

        stepProgress.status = "complete";
        stepProgress.output = response;
        stepProgress.completedAt = new Date().toISOString();
        options.onProgress?.(stepProgress);

      } catch (error) {
        stepProgress.status = "error";
        stepProgress.error = error instanceof Error ? error.message : String(error);
        stepProgress.completedAt = new Date().toISOString();
        options.onProgress?.(stepProgress);
        throw error;
      }
    }

    return {
      output: parameters[recipe.steps[recipe.steps.length - 1]?.outputKey || "output"],
      steps: stepsProgress,
      totalDuration: Date.now() - startTime,
    };
  }

  private async executeDeepResearchRecipe(
    recipe: Recipe,
    parameters: Record<string, unknown>,
    options: { abortSignal?: AbortSignal; onProgress?: (progress: ExecutionProgress) => void }
  ): Promise<ExecutionResult> {
    const config = recipe.deepResearchConfig || {};
    const researchSteps = config.researchSteps || 5;
    const startTime = Date.now();
    const stepsProgress: ExecutionProgress[] = [];

    // Phase 1: Research
    for (let i = 0; i < researchSteps; i++) {
      if (options.abortSignal?.aborted) throw new Error("Execution aborted");

      const stepProgress: ExecutionProgress = {
        stepId: `research-${i}`,
        status: "running",
        startedAt: new Date().toISOString(),
      };
      stepsProgress.push(stepProgress);
      options.onProgress?.(stepProgress);

      try {
        // Use universal agent for research
        const researchPrompt = interpolateParams(
          `Research step ${i + 1}/${researchSteps}: ${recipe.steps[0]?.prompt || "Research the topic"}`,
          parameters
        );

        const result = await universalAgent.runUniversalAgent({
          goal: researchPrompt,
          maxIterations: 3,
          enableResilience: true,
          taskId: `recipe-research-${recipe.id}-${i}`,
        });

        stepProgress.status = "complete";
        stepProgress.output = result;
        stepProgress.completedAt = new Date().toISOString();
        options.onProgress?.(stepProgress);

        // Store research result for synthesis
        parameters[`research_${i}`] = result;

      } catch (error) {
        stepProgress.status = "error";
        stepProgress.error = error instanceof Error ? error.message : String(error);
        stepProgress.completedAt = new Date().toISOString();
        options.onProgress?.(stepProgress);
      }
    }

    // Phase 2: Synthesize
    const synthesisProgress: ExecutionProgress = {
      stepId: "synthesis",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    stepsProgress.push(synthesisProgress);
    options.onProgress?.(synthesisProgress);

    try {
      const synthesisPrompt = interpolateParams(
        recipe.steps[1]?.prompt || "Synthesize the research findings into a comprehensive report",
        parameters
      );

      const synthesis = await this.callModel(
        { ...recipe.steps[1], modelCategory: config.synthesisModel },
        synthesisPrompt,
        parameters
      );

      synthesisProgress.status = "complete";
      synthesisProgress.output = synthesis;
      synthesisProgress.completedAt = new Date().toISOString();
      options.onProgress?.(synthesisProgress);

      // Phase 3: Verify (optional)
      if (config.verificationModel) {
        const verifyProgress: ExecutionProgress = {
          stepId: "verification",
          status: "running",
          startedAt: new Date().toISOString(),
        };
        stepsProgress.push(verifyProgress);
        options.onProgress?.(verifyProgress);

        const verifyPrompt = `Verify the accuracy and completeness of this report:\n\n${synthesis}`;

        const verification = await this.callModel(
          { ...recipe.steps[1], modelCategory: config.verificationModel },
          verifyPrompt,
          parameters
        );

        verifyProgress.status = "complete";
        verifyProgress.output = verification;
        verifyProgress.completedAt = new Date().toISOString();
        options.onProgress?.(verifyProgress);
      }

      // Phase 4: Format output
      const formatProgress: ExecutionProgress = {
        stepId: "format",
        status: "running",
        startedAt: new Date().toISOString(),
      };
      stepsProgress.push(formatProgress);
      options.onProgress?.(formatProgress);

      let finalOutput = synthesis;
      if (config.outputFormat !== "markdown") {
        // Could add formatters here
      }

      formatProgress.status = "complete";
      formatProgress.output = finalOutput;
      formatProgress.completedAt = new Date().toISOString();
      options.onProgress?.(formatProgress);

      return {
        output: finalOutput,
        steps: stepsProgress,
        totalDuration: Date.now() - startTime,
      };

    } catch (error) {
      synthesisProgress.status = "error";
      synthesisProgress.error = error instanceof Error ? error.message : String(error);
      synthesisProgress.completedAt = new Date().toISOString();
      options.onProgress?.(synthesisProgress);
      throw error;
    }
  }

  private async callModel(
    step: RecipeStep,
    prompt: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    // Use model router or direct LLM call
    const modelCategory = step.modelCategory || "general";
    const tools = step.tools || [];

    const result = await universalAgent.runUniversalAgent({
      goal: prompt,
      maxIterations: tools.length > 0 ? 5 : 1,
      enableResilience: true,
      taskId: `recipe-step-${step.id}`,
      // Pass context about available tools
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // EXECUTION TRACKING
  // ---------------------------------------------------------------------------

  getExecution(id: string): RecipeExecution | undefined {
    return this.executions.get(id);
  }

  listExecutions(recipeId?: string): RecipeExecution[] {
    const executions = Array.from(this.executions.values());
    if (recipeId) {
      return executions.filter(e => e.recipeId === recipeId);
    }
    return executions;
  }

  cancelExecution(id: string): boolean {
    const execution = this.executions.get(id);
    if (execution && execution.status === "running") {
      execution.status = "cancelled";
      execution.completedAt = new Date();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // RATINGS
  // ---------------------------------------------------------------------------

  addRating(rating: RecipeRating): RecipeRating {
    const validated = RecipeRatingSchema.parse(rating);
    if (!validated.id) validated.id = crypto.randomUUID();
    if (!validated.createdAt) validated.createdAt = new Date();

    const ratings = this.ratings.get(validated.recipeId) || [];
    // Remove existing rating from same account
    const filtered = ratings.filter(r => r.accountId !== validated.accountId);
    filtered.push(validated);
    this.ratings.set(validated.recipeId, filtered);

    return validated;
  }

  getRatings(recipeId: string): RecipeRating[] {
    return this.ratings.get(recipeId) || [];
  }

  getAverageRating(recipeId: string): number {
    const ratings = this.ratings.get(recipeId) || [];
    if (ratings.length === 0) return 0;
    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    return sum / ratings.length;
  }

  // ---------------------------------------------------------------------------
  // IMPORT/EXPORT
  // ---------------------------------------------------------------------------

  exportRecipe(id: string): string | undefined {
    const recipe = this.recipes.get(id);
    if (!recipe) return undefined;

    const versions = this.versions.get(id) || [];
    return JSON.stringify({ recipe, versions }, null, 2);
  }

  importRecipe(json: string): Recipe {
    const data = JSON.parse(json);
    const recipe = RecipeSchema.parse(data.recipe);
    return this.registerRecipe(recipe);
  }

  // ---------------------------------------------------------------------------
  // BUILT-IN RECIPES
  // ---------------------------------------------------------------------------

  private loadBuiltInRecipes(): void {
    const builtInRecipes: Recipe[] = [
      // Standard Recipes
      {
        name: "code-review",
        description: "Comprehensive code review with security, performance, and style checks",
        version: "1.0.0",
        type: "standard",
        tags: ["code-quality", "security", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "code", type: "string", required: true, description: "Code to review" },
          { name: "language", type: "string", required: false, default: "typescript", description: "Programming language" },
          { name: "focus", type: "string", required: false, enum: ["security", "performance", "style", "all"], default: "all", description: "Review focus area" },
        ],
        steps: [
          {
            id: "review",
            prompt: `Review the following {{language}} code with focus on {{focus}}:

{{code}}

Provide a structured review with:
1. Issues found (categorized by severity: critical, major, minor)
2. Suggestions for improvement
3. Code quality score (1-10)
4. Security concerns
5. Performance implications`,
            modelCategory: "review",
            tools: ["codebase.search", "codebase.get_definition"],
            outputKey: "review",
          },
        ],
        outputSchema: {
          type: "object",
          properties: {
            issues: { type: "array" },
            suggestions: { type: "array" },
            score: { type: "number" },
            security: { type: "array" },
            performance: { type: "array" },
          },
        },
      },
      {
        name: "write-tests",
        description: "Generate comprehensive test suite for code",
        version: "1.0.0",
        type: "standard",
        tags: ["testing", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "code", type: "string", required: true, description: "Code to test" },
          { name: "framework", type: "string", required: false, enum: ["vitest", "jest", "playwright", "cypress"], default: "vitest", description: "Test framework" },
          { name: "coverage", type: "string", required: false, enum: ["unit", "integration", "e2e", "all"], default: "unit", description: "Test coverage type" },
        ],
        steps: [
          {
            id: "generate-tests",
            prompt: `Generate {{coverage}} tests for the following code using {{framework}}:

{{code}}

Include:
- Happy path tests
- Edge case tests
- Error handling tests
- Mock external dependencies
- Follow best practices for {{framework}}`,
            modelCategory: "coding",
            tools: ["codebase.search", "codebase.get_definition"],
            outputKey: "tests",
          },
        ],
      },
      {
        name: "generate-docs",
        description: "Generate documentation from code",
        version: "1.0.0",
        type: "standard",
        tags: ["documentation", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "code", type: "string", required: true, description: "Code to document" },
          { name: "format", type: "string", required: false, enum: ["markdown", "jsdoc", "openapi", "readme"], default: "markdown", description: "Output format" },
          { name: "includeExamples", type: "boolean", required: false, default: true, description: "Include usage examples" },
        ],
        steps: [
          {
            id: "generate-docs",
            prompt: `Generate {{format}} documentation for the following code:

{{code}}

{{#if includeExamples}}
Include practical usage examples.
{{/if}}

Make it clear, comprehensive, and well-structured.`,
            modelCategory: "documentation",
            tools: ["codebase.search"],
            outputKey: "documentation",
          },
        ],
      },
      {
        name: "refactor",
        description: "Refactor code for better structure, performance, or readability",
        version: "1.0.0",
        type: "standard",
        tags: ["refactoring", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "code", type: "string", required: true, description: "Code to refactor" },
          { name: "goal", type: "string", required: false, enum: ["clean-code", "performance", "readability", "maintainability", "patterns"], default: "clean-code", description: "Refactoring goal" },
          { name: "preserveBehavior", type: "boolean", required: false, default: true, description: "Must preserve exact behavior" },
        ],
        steps: [
          {
            id: "refactor",
            prompt: `Refactor the following code for {{goal}}:

{{code}}

{{#if preserveBehavior}}
IMPORTANT: Preserve exact behavior - no functional changes.
{{/if}}

Provide:
1. Refactored code
2. Summary of changes
3. Rationale for each change`,
            modelCategory: "coding",
            tools: ["codebase.search", "codebase.get_definition"],
            outputKey: "refactored",
          },
        ],
      },
      {
        name: "explain-code",
        description: "Explain code in simple terms",
        version: "1.0.0",
        type: "standard",
        tags: ["learning", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "code", type: "string", required: true, description: "Code to explain" },
          { name: "level", type: "string", required: false, enum: ["beginner", "intermediate", "expert"], default: "intermediate", description: "Explanation level" },
        ],
        steps: [
          {
            id: "explain",
            prompt: `Explain the following code at {{level}} level:

{{code}}

Cover:
- What it does
- How it works
- Key concepts used
- Potential issues or improvements`,
            modelCategory: "explanation",
            tools: ["codebase.search"],
            outputKey: "explanation",
          },
        ],
      },
      {
        name: "generate-commit",
        description: "Generate conventional commit message from changes",
        version: "1.0.0",
        type: "standard",
        tags: ["git", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "diff", type: "string", required: true, description: "Git diff" },
          { name: "style", type: "string", required: false, enum: ["conventional", "simple", "detailed"], default: "conventional", description: "Commit message style" },
        ],
        steps: [
          {
            id: "commit",
            prompt: `Generate a {{style}} commit message for this diff:

{{diff}}

Follow conventional commits specification if style is conventional.`,
            modelCategory: "git",
            outputKey: "commitMessage",
          },
        ],
      },
      {
        name: "create-pr-description",
        description: "Create pull request description from changes",
        version: "1.0.0",
        type: "standard",
        tags: ["git", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "diff", type: "string", required: true, description: "Git diff" },
          { name: "issueNumber", type: "string", required: false, description: "Related issue number" },
          { name: "includeChecklist", type: "boolean", required: false, default: true, description: "Include review checklist" },
        ],
        steps: [
          {
            id: "pr-description",
            prompt: `Create a PR description for this diff:

{{diff}}

{{#if issueNumber}}
Related to issue #{{issueNumber}}
{{/if}}

{{#if includeChecklist}}
Include a reviewer checklist.
{{/if}}

Structure:
- Summary of changes
- Motivation
- Testing done
- Screenshots (if applicable)
- Checklist`,
            modelCategory: "git",
            outputKey: "prDescription",
          },
        ],
      },
      {
        name: "summarize-changes",
        description: "Summarize code changes for release notes or changelog",
        version: "1.0.0",
        type: "standard",
        tags: ["documentation", "release"],
        isBuiltIn: true,
        parameters: [
          { name: "diffs", type: "array", required: true, description: "Array of git diffs" },
          { name: "format", type: "string", required: false, enum: ["changelog", "release-notes", "summary"], default: "changelog", description: "Output format" },
        ],
        steps: [
          {
            id: "summarize",
            prompt: `Summarize these changes for a {{format}}:

{{diffs}}

Group by type: Added, Changed, Fixed, Removed, Security.`,
            modelCategory: "documentation",
            outputKey: "summary",
          },
        ],
      },
      {
        name: "translate-code",
        description: "Translate code between programming languages",
        version: "1.0.0",
        type: "standard",
        tags: ["translation", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "code", type: "string", required: true, description: "Code to translate" },
          { name: "fromLanguage", type: "string", required: true, description: "Source language" },
          { name: "toLanguage", type: "string", required: true, description: "Target language" },
          { name: "preservePatterns", type: "boolean", required: false, default: true, description: "Preserve idiomatic patterns" },
        ],
        steps: [
          {
            id: "translate",
            prompt: `Translate this {{fromLanguage}} code to {{toLanguage}}:

{{code}}

{{#if preservePatterns}}
Use idiomatic {{toLanguage}} patterns and best practices.
{{/if}}

Preserve all functionality.`,
            modelCategory: "coding",
            tools: ["codebase.search"],
            outputKey: "translated",
          },
        ],
      },
      {
        name: "generate-config",
        description: "Generate configuration files for common tools",
        version: "1.0.0",
        type: "standard",
        tags: ["configuration", "devops"],
        isBuiltIn: true,
        parameters: [
          { name: "tool", type: "string", required: true, enum: ["eslint", "prettier", "typescript", "tailwind", "jest", "vitest", "docker", "github-actions", "vite", "webpack"], description: "Tool to configure" },
          { name: "framework", type: "string", required: false, description: "Framework (e.g., react, vue, svelte, nextjs)" },
          { name: "features", type: "array", required: false, description: "Specific features to enable" },
        ],
        steps: [
          {
            id: "generate-config",
            prompt: `Generate a {{tool}} configuration file{{#if framework}} for {{framework}}{{/if}}:

Features: {{#if features}}{{#each features}}{{this}}, {{/each}}{{/if}}

Follow current best practices. Include comments explaining key settings.`,
            modelCategory: "configuration",
            outputKey: "config",
          },
        ],
      },

      // Deep Research Recipes
      {
        name: "competitor-analysis",
        description: "Deep research on competitors: features, pricing, positioning, strengths/weaknesses",
        version: "1.0.0",
        type: "deep-research",
        tags: ["research", "business", "strategy"],
        isBuiltIn: true,
        parameters: [
          { name: "competitors", type: "array", required: true, description: "List of competitor names/URLs" },
          { name: "industry", type: "string", required: false, description: "Industry context" },
          { name: "focusAreas", type: "array", required: false, default: ["features", "pricing", "positioning", "strengths", "weaknesses"], description: "Analysis focus areas" },
        ],
        steps: [
          {
            id: "research",
            prompt: "Research {{competitors}} in the {{industry}} industry",
            modelCategory: "research",
            tools: ["web.search", "web.fetch", "web.extract"],
            outputKey: "researchData",
          },
        ],
        deepResearchConfig: {
          researchSteps: 5,
          synthesisModel: "opus",
          verificationModel: "sonnet",
          outputFormat: "markdown",
        },
      },
      {
        name: "technical-spec",
        description: "Generate comprehensive technical specification document",
        version: "1.0.0",
        type: "deep-research",
        tags: ["documentation", "architecture", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "projectDescription", type: "string", required: true, description: "High-level project description" },
          { name: "requirements", type: "array", required: false, description: "Functional and non-functional requirements" },
          { name: "constraints", type: "array", required: false, description: "Technical constraints" },
        ],
        steps: [
          {
            id: "research",
            prompt: "Research best practices for {{projectDescription}} architecture",
            modelCategory: "research",
            tools: ["web.search", "web.fetch", "codebase.search"],
            outputKey: "researchData",
          },
        ],
        deepResearchConfig: {
          researchSteps: 4,
          synthesisModel: "opus",
          verificationModel: "sonnet",
          outputFormat: "markdown",
        },
      },
      {
        name: "market-research",
        description: "Comprehensive market research with trends, opportunities, and recommendations",
        version: "1.0.0",
        type: "deep-research",
        tags: ["research", "business", "market"],
        isBuiltIn: true,
        parameters: [
          { name: "market", type: "string", required: true, description: "Market to research" },
          { name: "region", type: "string", required: false, default: "global", description: "Geographic region" },
          { name: "timeframe", type: "string", required: false, default: "current", description: "Timeframe for data" },
        ],
        steps: [
          {
            id: "research",
            prompt: "Research {{market}} market in {{region}} for {{timeframe}}",
            modelCategory: "research",
            tools: ["web.search", "web.fetch", "web.extract"],
            outputKey: "researchData",
          },
        ],
        deepResearchConfig: {
          researchSteps: 6,
          synthesisModel: "opus",
          outputFormat: "markdown",
        },
      },
      {
        name: "architecture-decision-record",
        description: "Create Architecture Decision Record (ADR) with context, options, and consequences",
        version: "1.0.0",
        type: "deep-research",
        tags: ["architecture", "documentation", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "decision", type: "string", required: true, description: "The architectural decision" },
          { name: "context", type: "string", required: true, description: "Context and problem statement" },
          { name: "options", type: "array", required: false, description: "Alternatives considered" },
        ],
        steps: [
          {
            id: "research",
            prompt: "Research best practices and trade-offs for: {{decision}}",
            modelCategory: "research",
            tools: ["web.search", "web.fetch", "codebase.search"],
            outputKey: "researchData",
          },
        ],
        deepResearchConfig: {
          researchSteps: 3,
          synthesisModel: "opus",
          outputFormat: "markdown",
        },
      },
      {
        name: "security-audit",
        description: "Comprehensive security audit of codebase or system",
        version: "1.0.0",
        type: "deep-research",
        tags: ["security", "audit", "development"],
        isBuiltIn: true,
        parameters: [
          { name: "scope", type: "string", required: true, enum: ["code", "infrastructure", "api", "full"], description: "Audit scope" },
          { name: "code", type: "string", required: false, description: "Code to audit (for code scope)" },
          { name: "compliance", type: "array", required: false, description: "Compliance frameworks (OWASP, SOC2, etc.)" },
        ],
        steps: [
          {
            id: "research",
            prompt: "Research security vulnerabilities and best practices for {{scope}} audit",
            modelCategory: "research",
            tools: ["web.search", "web.fetch", "codebase.search", "security.scan"],
            outputKey: "researchData",
          },
        ],
        deepResearchConfig: {
          researchSteps: 5,
          synthesisModel: "opus",
          verificationModel: "opus",
          outputFormat: "markdown",
        },
      },
    ];

    for (const recipe of builtInRecipes) {
      this.registerRecipe(recipe);
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const recipeEngine = new RecipeEngine();