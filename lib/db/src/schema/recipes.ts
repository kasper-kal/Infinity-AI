import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

/**
 * Recipe schema for reusable AI workflows.
 * Supports Standard Recipes (single LLM call) and Deep Research Recipes (multi-step).
 * Versioned, shareable, parameterized, and composable.
 */

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull().default("1.0.0"),
  type: text("type", { enum: ["standard", "deep-research"] }).notNull().default("standard"),
  /** JSON schema for parameters: [{ name, type, required, default, description }] */
  parameters: jsonb("parameters").$type<Array<{
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object";
    required: boolean;
    default?: unknown;
    description?: string;
    enum?: string[];
  }>>().notNull().default([]),
  /** Steps for standard recipes: [{ prompt, modelCategory, tools, outputKey }] */
  steps: jsonb("steps").$type<Array<{
    id: string;
    prompt: string;
    modelCategory?: string;
    tools?: string[];
    outputKey?: string;
    condition?: string; // conditional execution
  }>>().notNull().default([]),
  /** Output schema as Zod JSON schema */
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
  tags: text("tags").array().notNull().default([]),
  author: text("author"),
  isPublic: boolean("is_public").notNull().default(false),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  /** Deep research specific config */
  deepResearchConfig: jsonb("deep_research_config").$type<{
    researchSteps?: number;
    synthesisModel?: string;
    verificationModel?: string;
    outputFormat?: "markdown" | "json" | "pdf" | "html";
  }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("recipes_name_idx").on(table.name),
  typeIdx: index("recipes_type_idx").on(table.type),
  isPublicIdx: index("recipes_is_public_idx").on(table.isPublic),
  authorIdx: index("recipes_author_idx").on(table.author),
}));

export const recipeVersions = pgTable("recipe_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  changelog: text("changelog"),
  /** Full recipe snapshot at this version */
  snapshot: jsonb("snapshot").$type<{
    name: string;
    description: string;
    type: "standard" | "deep-research";
    parameters: Array<{
      name: string;
      type: "string" | "number" | "boolean" | "array" | "object";
      required: boolean;
      default?: unknown;
      description?: string;
      enum?: string[];
    }>;
    steps: Array<{
      id: string;
      prompt: string;
      modelCategory?: string;
      tools?: string[];
      outputKey?: string;
      condition?: string;
    }>;
    outputSchema?: Record<string, unknown>;
    deepResearchConfig?: {
      researchSteps?: number;
      synthesisModel?: string;
      verificationModel?: string;
      outputFormat?: "markdown" | "json" | "pdf" | "html";
    };
  }>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  recipeIdIdx: index("recipe_versions_recipe_id_idx").on(table.recipeId),
  versionIdx: index("recipe_versions_version_idx").on(table.version),
}));

export const recipeExecutions = pgTable("recipe_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  recipeVersion: text("recipe_version").notNull(),
  /** Input parameters for this execution */
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
  /** Execution result */
  result: jsonb("result").$type<{
    output?: unknown;
    steps?: Array<{
      stepId: string;
      status: "pending" | "running" | "complete" | "error";
      output?: unknown;
      error?: string;
      startedAt: string;
      completedAt?: string;
    }>;
    totalDuration?: number;
    cost?: number;
  }>(),
  status: text("status", { enum: ["pending", "running", "complete", "error", "cancelled"] }).notNull().default("pending"),
  error: text("error"),
  projectId: text("project_id"),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  recipeIdIdx: index("recipe_executions_recipe_id_idx").on(table.recipeId),
  projectIdIdx: index("recipe_executions_project_id_idx").on(table.projectId),
  statusIdx: index("recipe_executions_status_idx").on(table.status),
  accountIdIdx: index("recipe_executions_account_id_idx").on(table.accountId),
}));

export const recipeRatings = pgTable("recipe_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1-5
  review: text("review"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  recipeIdIdx: index("recipe_ratings_recipe_id_idx").on(table.recipeId),
  accountIdIdx: index("recipe_ratings_account_id_idx").on(table.accountId),
  uniqueRating: index("recipe_ratings_unique_idx").on(table.recipeId, table.accountId),
}));

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeVersion = typeof recipeVersions.$inferSelect;
export type NewRecipeVersion = typeof recipeVersions.$inferInsert;
export type RecipeExecution = typeof recipeExecutions.$inferSelect;
export type NewRecipeExecution = typeof recipeExecutions.$inferInsert;
export type RecipeRating = typeof recipeRatings.$inferSelect;
export type NewRecipeRating = typeof recipeRatings.$inferInsert;