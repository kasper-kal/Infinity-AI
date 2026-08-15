import { pgTable, text, timestamp, uuid, jsonb, integer, numeric, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 4.3 — Resource Limits + Cost Tracking.
 *
 * Per-workspace build budgets, token/cost tracking, daily alerts, and stats dashboard.
 * All monetary values in USD cents (integer) for precision. Token counts are raw.
 */
export const buildBudgets = pgTable("build_budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id").notNull().unique(),
  // Budget limits (0 = unlimited)
  maxTokensPerBuild: integer("max_tokens_per_build").notNull().default(0),
  maxTokensPerDay: integer("max_tokens_per_day").notNull().default(0),
  maxCostPerBuildCents: integer("max_cost_per_build_cents").notNull().default(0),
  maxCostPerDayCents: integer("max_cost_per_day_cents").notNull().default(0),
  maxBuildsPerDay: integer("max_builds_per_day").notNull().default(0),
  maxDurationMinutesPerBuild: integer("max_duration_minutes_per_build").notNull().default(0),
  // Alert thresholds (percentage of limit, 0-100)
  alertAtPercent: integer("alert_at_percent").notNull().default(80),
  // Daily aggregation reset time (UTC hour 0-23)
  dailyResetHour: integer("daily_reset_hour").notNull().default(0),
  // Whether to hard-stop on limit exceeded (vs just warn)
  hardStop: boolean("hard_stop").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("build_budgets_project_idx").on(table.projectId),
}));

export type BuildBudget = typeof buildBudgets.$inferSelect;
export type NewBuildBudget = typeof buildBudgets.$inferInsert;

/**
 * Build cost tracking — one row per build run (or per iteration for granularity).
 * Tracks tokens, estimated cost, duration, and whether limits were hit.
 */
export const buildCosts = pgTable("build_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id").notNull(),
  checkpointId: uuid("checkpoint_id"), // nullable — link to build_checkpoints when available
  iteration: integer("iteration").notNull().default(1),
  // Token usage
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  // Estimated cost in USD cents (based on model pricing at time of run)
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  // Duration
  durationMs: integer("duration_ms").notNull().default(0),
  // Limit status at completion
  limitHit: text("limit_hit", { enum: ["none", "tokens", "cost", "duration", "builds"] }).notNull().default("none"),
  // Metadata
  model: text("model"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("build_costs_project_idx").on(table.projectId),
  checkpointIdx: index("build_costs_checkpoint_idx").on(table.checkpointId),
  createdIdx: index("build_costs_created_idx").on(table.createdAt),
}));

export type BuildCost = typeof buildCosts.$inferSelect;
export type NewBuildCost = typeof buildCosts.$inferInsert;

/**
 * Daily aggregates for quick dashboard queries and alert evaluation.
 * One row per project per day (UTC, reset at dailyResetHour).
 */
export const buildDailyAggregates = pgTable("build_daily_aggregates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD in UTC
  tokensUsed: integer("tokens_used").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  buildsCount: integer("builds_count").notNull().default(0),
  totalDurationMs: integer("total_duration_ms").notNull().default(0),
  alertSent: boolean("alert_sent").notNull().default(false),
  alertSentAt: timestamp("alert_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectDateIdx: index("build_daily_aggregates_project_date_idx").on(table.projectId, table.date),
}));

export type BuildDailyAggregate = typeof buildDailyAggregates.$inferSelect;
export type NewBuildDailyAggregate = typeof buildDailyAggregates.$inferInsert;