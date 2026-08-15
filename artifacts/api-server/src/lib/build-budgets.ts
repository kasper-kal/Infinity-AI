import { db, buildBudgets, buildCosts, buildDailyAggregates } from "@workspace/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

/**
 * Phase 4.3 — Resource Limits + Cost Tracking.
 *
 * Per-workspace build budgets, token/cost tracking, daily aggregates, and stats.
 * All monetary values in USD cents (integer) for precision.
 */

export interface BudgetLimits {
  maxTokensPerBuild: number;
  maxTokensPerDay: number;
  maxCostPerBuildCents: number;
  maxCostPerDayCents: number;
  maxBuildsPerDay: number;
  maxDurationMinutesPerBuild: number;
  alertAtPercent: number;
  dailyResetHour: number;
  hardStop: boolean;
}

export interface BudgetStatus {
  withinLimits: boolean;
  limitHit: "none" | "tokens" | "cost" | "duration" | "builds" | "tokens-daily" | "cost-daily" | "builds-daily";
  currentBuildTokens: number;
  currentBuildCostCents: number;
  currentBuildDurationMs: number;
  dailyTokensUsed: number;
  dailyCostCents: number;
  dailyBuildsCount: number;
  limits: BudgetLimits;
  percentUsed: {
    tokensPerBuild: number;
    tokensPerDay: number;
    costPerBuild: number;
    costPerDay: number;
    buildsPerDay: number;
    durationPerBuild: number;
  };
}

export interface CostRecordInput {
  projectId: string;
  checkpointId?: string;
  iteration?: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCents: number;
  durationMs: number;
  limitHit?: "none" | "tokens" | "cost" | "duration" | "builds";
  model?: string;
  metadata?: Record<string, unknown>;
}

/** Get or create budget config for a project. */
export async function getOrCreateBudget(projectId: string): Promise<BudgetLimits> {
  const [existing] = await db
    .select()
    .from(buildBudgets)
    .where(eq(buildBudgets.projectId, projectId))
    .limit(1);

  if (existing) {
    return {
      maxTokensPerBuild: existing.maxTokensPerBuild,
      maxTokensPerDay: existing.maxTokensPerDay,
      maxCostPerBuildCents: existing.maxCostPerBuildCents,
      maxCostPerDayCents: existing.maxCostPerDayCents,
      maxBuildsPerDay: existing.maxBuildsPerDay,
      maxDurationMinutesPerBuild: existing.maxDurationMinutesPerBuild,
      alertAtPercent: existing.alertAtPercent,
      dailyResetHour: existing.dailyResetHour,
      hardStop: existing.hardStop,
    };
  }

  // Create default (unlimited) budget
  await db.insert(buildBudgets).values({ projectId });
  return getDefaultLimits();
}

function getDefaultLimits(): BudgetLimits {
  return {
    maxTokensPerBuild: 0,
    maxTokensPerDay: 0,
    maxCostPerBuildCents: 0,
    maxCostPerDayCents: 0,
    maxBuildsPerDay: 0,
    maxDurationMinutesPerBuild: 0,
    alertAtPercent: 80,
    dailyResetHour: 0,
    hardStop: false,
  };
}

/** Update budget limits for a project. */
export async function updateBudget(projectId: string, limits: Partial<BudgetLimits>): Promise<BudgetLimits> {
  const updateData: Record<string, unknown> = {};
  if (limits.maxTokensPerBuild !== undefined) updateData.maxTokensPerBuild = limits.maxTokensPerBuild;
  if (limits.maxTokensPerDay !== undefined) updateData.maxTokensPerDay = limits.maxTokensPerDay;
  if (limits.maxCostPerBuildCents !== undefined) updateData.maxCostPerBuildCents = limits.maxCostPerBuildCents;
  if (limits.maxCostPerDayCents !== undefined) updateData.maxCostPerDayCents = limits.maxCostPerDayCents;
  if (limits.maxBuildsPerDay !== undefined) updateData.maxBuildsPerDay = limits.maxBuildsPerDay;
  if (limits.maxDurationMinutesPerBuild !== undefined) updateData.maxDurationMinutesPerBuild = limits.maxDurationMinutesPerBuild;
  if (limits.alertAtPercent !== undefined) updateData.alertAtPercent = Math.max(0, Math.min(100, limits.alertAtPercent));
  if (limits.dailyResetHour !== undefined) updateData.dailyResetHour = Math.max(0, Math.min(23, limits.dailyResetHour));
  if (limits.hardStop !== undefined) updateData.hardStop = limits.hardStop;
  updateData.updatedAt = new Date();

  await db
    .insert(buildBudgets)
    .values({ projectId, ...updateData })
    .onConflictDoUpdate({
      target: buildBudgets.projectId,
      set: updateData,
    });

  return getOrCreateBudget(projectId);
}

/** Get the current date key for daily aggregation (respecting dailyResetHour). */
function getDailyDateKey(resetHour: number): string {
  const now = new Date();
  const utcHour = now.getUTCHours();
  // If current UTC hour is before reset hour, use previous day
  const date = new Date(now);
  if (utcHour < resetHour) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Get or create today's daily aggregate. */
async function getOrCreateDailyAggregate(projectId: string, resetHour: number): Promise<typeof buildDailyAggregates.$inferSelect> {
  const date = getDailyDateKey(resetHour);
  const [existing] = await db
    .select()
    .from(buildDailyAggregates)
    .where(and(eq(buildDailyAggregates.projectId, projectId), eq(buildDailyAggregates.date, date)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(buildDailyAggregates)
    .values({ projectId, date })
    .returning();
  return created;
}

/** Record a build cost and update daily aggregates. Returns the budget status after recording. */
export async function recordBuildCost(input: CostRecordInput): Promise<BudgetStatus> {
  const budget = await getOrCreateBudget(input.projectId);
  const daily = await getOrCreateDailyAggregate(input.projectId, budget.dailyResetHour);

  const totalTokens = input.totalTokens || (input.promptTokens + input.completionTokens);
  const limitHit = input.limitHit || "none";

  // Insert cost record
  await db.insert(buildCosts).values({
    projectId: input.projectId,
    checkpointId: input.checkpointId,
    iteration: input.iteration ?? 1,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens,
    estimatedCostCents: input.estimatedCostCents,
    durationMs: input.durationMs,
    limitHit,
    model: input.model,
    metadata: input.metadata || {},
  });

  // Update daily aggregate
  await db
    .update(buildDailyAggregates)
    .set({
      tokensUsed: sql`${buildDailyAggregates.tokensUsed} + ${totalTokens}`,
      costCents: sql`${buildDailyAggregates.costCents} + ${input.estimatedCostCents}`,
      buildsCount: sql`${buildDailyAggregates.buildsCount} + 1`,
      totalDurationMs: sql`${buildDailyAggregates.totalDurationMs} + ${input.durationMs}`,
      updatedAt: new Date(),
    })
    .where(and(eq(buildDailyAggregates.projectId, input.projectId), eq(buildDailyAggregates.date, daily.date)));

  // Return updated status
  return checkBudgetStatus(input.projectId, totalTokens, input.estimatedCostCents, input.durationMs, 0);
}

/** Check if a proposed build would exceed limits (pre-flight check). */
export async function checkBudgetBeforeBuild(
  projectId: string,
  estimatedTokens: number,
  estimatedCostCents: number,
  estimatedDurationMs: number
): Promise<BudgetStatus> {
  return checkBudgetStatus(projectId, estimatedTokens, estimatedCostCents, estimatedDurationMs, 1);
}

/** Core budget status check — used for both pre-flight and post-build. */
async function checkBudgetStatus(
  projectId: string,
  currentBuildTokens: number,
  currentBuildCostCents: number,
  currentBuildDurationMs: number,
  buildsTodayIncrement: number // 0 for post-build (already counted), 1 for pre-flight
): Promise<BudgetStatus> {
  const budget = await getOrCreateBudget(projectId);
  const daily = await getOrCreateDailyAggregate(projectId, budget.dailyResetHour);

  const dailyTokensUsed = daily.tokensUsed;
  const dailyCostCents = daily.costCents;
  const dailyBuildsCount = daily.buildsCount + buildsTodayIncrement;

  const limits = budget;
  const percentUsed = {
    tokensPerBuild: limits.maxTokensPerBuild > 0 ? (currentBuildTokens / limits.maxTokensPerBuild) * 100 : 0,
    tokensPerDay: limits.maxTokensPerDay > 0 ? (dailyTokensUsed / limits.maxTokensPerDay) * 100 : 0,
    costPerBuild: limits.maxCostPerBuildCents > 0 ? (currentBuildCostCents / limits.maxCostPerBuildCents) * 100 : 0,
    costPerDay: limits.maxCostPerDayCents > 0 ? (dailyCostCents / limits.maxCostPerDayCents) * 100 : 0,
    buildsPerDay: limits.maxBuildsPerDay > 0 ? (dailyBuildsCount / limits.maxBuildsPerDay) * 100 : 0,
    durationPerBuild: limits.maxDurationMinutesPerBuild > 0 ? (currentBuildDurationMs / (limits.maxDurationMinutesPerBuild * 60 * 1000)) * 100 : 0,
  };

  let limitHit: BudgetStatus["limitHit"] = "none";
  let withinLimits = true;

  // Check per-build limits (hard stop takes precedence)
  if (limits.maxTokensPerBuild > 0 && currentBuildTokens >= limits.maxTokensPerBuild) {
    limitHit = "tokens";
    withinLimits = false;
  }
  if (limits.maxCostPerBuildCents > 0 && currentBuildCostCents >= limits.maxCostPerBuildCents) {
    limitHit = "cost";
    withinLimits = false;
  }
  if (limits.maxDurationMinutesPerBuild > 0 && currentBuildDurationMs >= limits.maxDurationMinutesPerBuild * 60 * 1000) {
    limitHit = "duration";
    withinLimits = false;
  }

  // Check daily limits
  if (limits.maxTokensPerDay > 0 && dailyTokensUsed >= limits.maxTokensPerDay) {
    limitHit = "tokens-daily";
    withinLimits = false;
  }
  if (limits.maxCostPerDayCents > 0 && dailyCostCents >= limits.maxCostPerDayCents) {
    limitHit = "cost-daily";
    withinLimits = false;
  }
  if (limits.maxBuildsPerDay > 0 && dailyBuildsCount >= limits.maxBuildsPerDay) {
    limitHit = "builds-daily";
    withinLimits = false;
  }

  // Alert threshold check (for UI, not a hard stop)
  const alertThreshold = limits.alertAtPercent / 100;
  const alerts: string[] = [];
  if (limits.maxTokensPerBuild > 0 && percentUsed.tokensPerBuild >= limits.alertAtPercent) alerts.push("tokens-per-build");
  if (limits.maxTokensPerDay > 0 && percentUsed.tokensPerDay >= limits.alertAtPercent) alerts.push("tokens-per-day");
  if (limits.maxCostPerBuildCents > 0 && percentUsed.costPerBuild >= limits.alertAtPercent) alerts.push("cost-per-build");
  if (limits.maxCostPerDayCents > 0 && percentUsed.costPerDay >= limits.alertAtPercent) alerts.push("cost-per-day");
  if (limits.maxBuildsPerDay > 0 && percentUsed.buildsPerDay >= limits.alertAtPercent) alerts.push("builds-per-day");
  if (limits.maxDurationMinutesPerBuild > 0 && percentUsed.durationPerBuild >= limits.alertAtPercent) alerts.push("duration-per-build");

  return {
    withinLimits,
    limitHit,
    currentBuildTokens,
    currentBuildCostCents,
    currentBuildDurationMs,
    dailyTokensUsed,
    dailyCostCents,
    dailyBuildsCount,
    limits,
    percentUsed,
  };
}

/** Get budget status for dashboard display. */
export async function getBudgetStatus(projectId: string): Promise<BudgetStatus> {
  return checkBudgetStatus(projectId, 0, 0, 0, 0);
}

/** Get cost history for a project (paginated). */
export async function getCostHistory(
  projectId: string,
  limit = 50,
  offset = 0
): Promise<typeof buildCosts.$inferSelect[]> {
  return db
    .select()
    .from(buildCosts)
    .where(eq(buildCosts.projectId, projectId))
    .orderBy(desc(buildCosts.createdAt))
    .limit(limit)
    .offset(offset);
}

/** Get daily aggregates for a project (last N days). */
export async function getDailyAggregates(
  projectId: string,
  days = 30
): Promise<typeof buildDailyAggregates.$inferSelect[]> {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  return db
    .select()
    .from(buildDailyAggregates)
    .where(and(eq(buildDailyAggregates.projectId, projectId), gte(buildDailyAggregates.date, cutoffStr)))
    .orderBy(desc(buildDailyAggregates.date));
}

/** Get summary stats for dashboard. */
export async function getBudgetDashboardStats(projectId: string): Promise<{
  currentBuild: { tokens: number; costCents: number; durationMs: number } | null;
  today: { tokens: number; costCents: number; builds: number; durationMs: number };
  last7Days: { tokens: number; costCents: number; builds: number; avgDurationMs: number };
  last30Days: { tokens: number; costCents: number; builds: number; avgDurationMs: number };
  limits: BudgetLimits;
}> {
  const budget = await getOrCreateBudget(projectId);
  const daily = await getOrCreateDailyAggregate(projectId, budget.dailyResetHour);

  // Current build (latest incomplete checkpoint cost)
  const [currentBuildCost] = await db
    .select()
    .from(buildCosts)
    .where(and(eq(buildCosts.projectId, projectId), eq(buildCosts.limitHit, "none")))
    .orderBy(desc(buildCosts.createdAt))
    .limit(1);

  // Last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const sevenDaysStr = sevenDaysAgo.toISOString().slice(0, 10);

  const [last7DaysAgg] = await db
    .select({
      tokens: sql<number>`coalesce(sum(${buildDailyAggregates.tokensUsed}), 0)`,
      cost: sql<number>`coalesce(sum(${buildDailyAggregates.costCents}), 0)`,
      builds: sql<number>`coalesce(sum(${buildDailyAggregates.buildsCount}), 0)`,
      duration: sql<number>`coalesce(sum(${buildDailyAggregates.totalDurationMs}), 0)`,
    })
    .from(buildDailyAggregates)
    .where(and(eq(buildDailyAggregates.projectId, projectId), gte(buildDailyAggregates.date, sevenDaysStr)));

  // Last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const thirtyDaysStr = thirtyDaysAgo.toISOString().slice(0, 10);

  const [last30DaysAgg] = await db
    .select({
      tokens: sql<number>`coalesce(sum(${buildDailyAggregates.tokensUsed}), 0)`,
      cost: sql<number>`coalesce(sum(${buildDailyAggregates.costCents}), 0)`,
      builds: sql<number>`coalesce(sum(${buildDailyAggregates.buildsCount}), 0)`,
      duration: sql<number>`coalesce(sum(${buildDailyAggregates.totalDurationMs}), 0)`,
    })
    .from(buildDailyAggregates)
    .where(and(eq(buildDailyAggregates.projectId, projectId), gte(buildDailyAggregates.date, thirtyDaysStr)));

  return {
    currentBuild: currentBuildCost
      ? { tokens: currentBuildCost.totalTokens, costCents: currentBuildCost.estimatedCostCents, durationMs: currentBuildCost.durationMs }
      : null,
    today: {
      tokens: daily.tokensUsed,
      costCents: daily.costCents,
      builds: daily.buildsCount,
      durationMs: daily.totalDurationMs,
    },
    last7Days: {
      tokens: last7DaysAgg?.tokens ?? 0,
      costCents: last7DaysAgg?.cost ?? 0,
      builds: last7DaysAgg?.builds ?? 0,
      avgDurationMs: last7DaysAgg?.builds ? Math.round((last7DaysAgg.duration ?? 0) / last7DaysAgg.builds) : 0,
    },
    last30Days: {
      tokens: last30DaysAgg?.tokens ?? 0,
      costCents: last30DaysAgg?.cost ?? 0,
      builds: last30DaysAgg?.builds ?? 0,
      avgDurationMs: last30DaysAgg?.builds ? Math.round((last30DaysAgg.duration ?? 0) / last30DaysAgg.builds) : 0,
    },
    limits: budget,
  };
}

/** Model pricing (USD per 1M tokens) — update as models change. */
export const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  "openrouter/auto": { prompt: 0.5, completion: 1.5 }, // fallback average
  "openrouter/google/gemini-2.5-flash": { prompt: 0.075, completion: 0.3 },
  "openrouter/google/gemini-2.5-pro": { prompt: 1.25, completion: 10.0 },
  "openrouter/anthropic/claude-3.5-sonnet": { prompt: 3.0, completion: 15.0 },
  "openrouter/anthropic/claude-3.5-haiku": { prompt: 1.0, completion: 5.0 },
  "openrouter/openai/gpt-4o": { prompt: 5.0, completion: 15.0 },
  "openrouter/openai/gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "nvidia/nemotron-3-ultra": { prompt: 0.5, completion: 1.5 }, // NIM free tier approx
};

/** Estimate cost in USD cents from token counts and model. */
export function estimateCostCents(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["openrouter/auto"];
  const promptCost = (promptTokens / 1_000_000) * pricing.prompt;
  const completionCost = (completionTokens / 1_000_000) * pricing.completion;
  return Math.round((promptCost + completionCost) * 100); // USD cents
}