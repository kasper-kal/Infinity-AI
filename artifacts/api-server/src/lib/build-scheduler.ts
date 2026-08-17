/**
 * Phase 9: Build Scheduler — Persistent cron-like job scheduler for build/research/maintenance.
 *
 * Uses DB-backed schedules with in-memory setTimeout (like timer-scheduler.ts).
 * On server boot, resumes all enabled schedules by computing next run time from cron expression.
 * Job types: build, research, memory_compaction, budget_reset, snapshot_cleanup.
 */

import { db, buildSchedules, buildScheduleRuns, type BuildSchedule, type NewBuildSchedule, type NewBuildScheduleRun } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "./logger";
import { logActivity } from "../routes/jarvis/project-activity";

const MAX_SETTIMEOUT_MS = 2_147_483_000; // ~24.8 days

/** In-memory scheduled timeouts keyed by schedule ID */
const pending = new Map<string, NodeJS.Timeout>();

/** Cron expression parser (5-field: minute hour day-of-month month day-of-week) */
interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[]; // 0=Sun ... 6=Sat
}

function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expr}" (expected 5 fields)`);
  }
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const result = new Set<number>();
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepVal = parseInt(step, 10);
      const [start, end] = range === "*" ? [min, max] : range.split("-").map(Number);
      for (let v = start; v <= end; v += stepVal) result.add(v);
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let v = start; v <= end; v++) result.add(v);
    } else {
      result.add(parseInt(part, 10));
    }
  }
  return [...result].filter(v => v >= min && v <= max).sort((a, b) => a - b);
}

/** Compute the next Date matching the cron expression after `from` (or now). */
function nextCronTime(cron: string, from: Date = new Date()): Date {
  const parsed = parseCron(cron);
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);

  // Increment minute until all fields match
  for (let attempts = 0; attempts < 10000; attempts++) {
    if (
      parsed.minute.includes(candidate.getMinutes()) &&
      parsed.hour.includes(candidate.getHours()) &&
      parsed.dayOfMonth.includes(candidate.getDate()) &&
      parsed.month.includes(candidate.getMonth() + 1) &&
      parsed.dayOfWeek.includes(candidate.getDay())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new Error(`Could not compute next run time for cron: ${cron}`);
}

/** Schedule (or re-schedule) a single schedule's next run. */
function scheduleSchedule(s: BuildSchedule): void {
  if (s.status !== "enabled" || !s.cron) return;
  cancelScheduled(s.id);

  try {
    const nextRun = nextCronTime(s.cron);
    const delay = nextRun.getTime() - Date.now();

    if (delay <= 0) {
      // Already due (shouldn't happen with nextCronTime, but safety)
      void fireSchedule(s.id);
      return;
    }

    const timeout = setTimeout(() => {
      void fireSchedule(s.id);
    }, Math.min(delay, MAX_SETTIMEOUT_MS));

    pending.set(s.id, timeout);

    // Update nextRunAt in DB
    db.update(buildSchedules)
      .set({ nextRunAt: nextRun, updatedAt: new Date() })
      .where(eq(buildSchedules.id, s.id))
      .catch(err => logger.warn({ err, scheduleId: s.id }, "[scheduler] failed to update nextRunAt"));

    logger.info({ scheduleId: s.id, name: s.name, nextRun: nextRun.toISOString() }, "[scheduler] scheduled");
  } catch (err) {
    logger.error({ err, scheduleId: s.id }, "[scheduler] failed to schedule");
    // Mark as error
    db.update(buildSchedules)
      .set({ status: "error", lastError: err instanceof Error ? err.message : "scheduling failed", updatedAt: new Date() })
      .where(eq(buildSchedules.id, s.id))
      .catch(() => {});
  }
}

/** Remove a schedule's pending timeout. */
export function cancelScheduled(id: string): void {
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing);
    pending.delete(id);
  }
}

/** Execute a scheduled job. */
async function fireSchedule(id: string): Promise<void> {
  pending.delete(id);

  try {
    const [s] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, id));
    if (!s || s.status !== "enabled") return; // paused/cancelled/error

    // Create run record
    const [run] = await db.insert(buildScheduleRuns).values({
      scheduleId: s.id,
      projectId: s.projectId,
      trigger: "cron",
      status: "started",
    }).returning();

    logger.info({ scheduleId: s.id, name: s.name, runId: run.id }, "[scheduler] firing");

    let result: any = null;
    let runError: string | null = null;

    try {
      // Execute based on type
      result = await executeJob(s);
    } catch (err) {
      runError = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err, scheduleId: s.id }, "[scheduler] job failed");
    }

    const completedAt = new Date();
    const success = !runError;

    // Update run record
    await db.update(buildScheduleRuns)
      .set({
        status: success ? "completed" : "failed",
        completedAt,
        error: runError,
        result,
      })
      .where(eq(buildScheduleRuns.id, run.id));

    // Update schedule
    const nextRun = nextCronTime(s.cron, new Date(Date.now() + 60_000)); // at least 1 min after
    await db.update(buildSchedules)
      .set({
        lastRunAt: completedAt,
        lastRunResult: result ? { success: true, ...result } : { success: false, error: runError },
        runCount: s.runCount + 1,
        lastError: runError,
        nextRunAt: nextRun,
        updatedAt: new Date(),
      })
      .where(eq(buildSchedules.id, s.id));

    // Dispatch notifications
    const eventType = s.type === "build" ? (success ? "build_completed" : "build_failed")
      : s.type === "research" ? (success ? "research_completed" : "research_failed")
      : s.type === "snapshot_cleanup" ? (success ? "deployment_completed" : "deployment_failed")
      : (success ? "scheduled_job_completed" : "scheduled_job_failed");

    const { dispatchNotification } = await import("../routes/jarvis/connectors");
    await dispatchNotification(s.projectId, eventType, `Scheduled ${s.type}: ${s.name}`, success ? "Completed successfully" : `Failed: ${runError}`, {
      metadata: { scheduleId: s.id, type: s.type, runCount: s.runCount + 1 },
    });

    // Log activity
    await logActivity(s.projectId, "task_completed", `Scheduled job "${s.name}" (${s.type}) ${success ? "completed" : "failed"}`);

    // Re-schedule next run
    if (success) {
      scheduleSchedule(s);
    } else {
      // On failure, mark schedule as error and stop re-scheduling
      await db.update(buildSchedules)
        .set({ status: "error", lastError: runError, updatedAt: new Date() })
        .where(eq(buildSchedules.id, s.id));
    }
  } catch (err) {
    logger.error({ err, scheduleId: id }, "[scheduler] fireSchedule failed");
  }
}

/** Execute a job based on its type. */
async function executeJob(s: BuildSchedule): Promise<any> {
  const { type, config, projectId } = s;
  const cfg = config as Record<string, unknown>;

  switch (type) {
    case "build": {
      // config: { goal, model?, workspaceId?, previewPort? }
      const { runMultiAgentBuild } = await import("./build-orchestrator");
      const { ensureWorkspace } = await import("./workspace");
      const { setProjectGoal, refreshFileMap } = await import("./build-context");
      const { logBuildEvent } = await import("./build-telemetry");

      await ensureWorkspace((cfg.workspaceId as string) || projectId);
      setProjectGoal(projectId, cfg.goal as string);
      await refreshFileMap(projectId, (cfg.workspaceId as string) || projectId);

      const toolContext = {
        projectId,
        workspaceId: (cfg.workspaceId as string) || projectId,
        previewPort: cfg.previewPort as number | undefined,
        previewUrl: cfg.previewPort ? `http://127.0.0.1:${cfg.previewPort}` : undefined,
      };

      const orchResult = await runMultiAgentBuild({
        goal: cfg.goal as string,
        projectId,
        workspaceId: (cfg.workspaceId as string) || projectId,
        model: cfg.model as string | undefined,
        toolContext,
      });

      return { success: orchResult.success, summary: orchResult.plan?.summary, steps: orchResult.plan?.steps?.length };
    }

    case "research": {
      // config: { query, depth?, sources? }
      const { runResearch } = await import("./research-engine");
      const researchResult = await runResearch(cfg.query as string, (cfg.depth as "standard" | "deep" | "quantum" | "omni") || "deep", cfg.sources as string[] | undefined);
      return { success: true, summary: researchResult.summary, sources: researchResult.sources?.length };
    }

    case "memory_compaction": {
      // config: { projectId }
      const { compactMemory } = await import("./project-memory");
      await compactMemory(projectId);
      return { success: true, summary: "Memory compacted" };
    }

    case "budget_reset": {
      // config: { projectId }
      const { resetBudget } = await import("./build-budgets");
      await resetBudget(projectId);
      return { success: true, summary: "Budget reset" };
    }

    case "snapshot_cleanup": {
      // config: { projectId, keepLastN? }
      const { cleanupSnapshots } = await import("./workspace-snapshots");
      await cleanupSnapshots(projectId, (cfg.keepLastN as number) || 10);
      return { success: true, summary: "Snapshots cleaned up" };
    }

    default:
      throw new Error(`Unknown schedule type: ${type}`);
  }
}

/** Resume all enabled schedules on server boot. */
export async function startBuildScheduler(): Promise<void> {
  try {
    const active = await db
      .select()
      .from(buildSchedules)
      .where(eq(buildSchedules.status, "enabled"));
    for (const s of active) {
      scheduleSchedule(s);
    }
    if (active.length > 0) {
      logger.info(`[scheduler] resumed ${active.length} active schedule(s) on boot`);
    }
  } catch (err) {
    logger.warn({ err }, "[scheduler] failed to resume active schedules on boot");
  }
}

/** Manually trigger a schedule (Run now button). */
export async function triggerSchedule(scheduleId: string): Promise<{ ok: boolean; runId: string }> {
  const [s] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, scheduleId));
  if (!s) throw new Error("Schedule not found");

  const [run] = await db.insert(buildScheduleRuns).values({
    scheduleId: s.id,
    projectId: s.projectId,
    trigger: "manual",
    status: "started",
  }).returning();

  // Fire asynchronously (don't await)
  (async () => {
    try {
      let result: any = null;
      let runError: string | null = null;

      try {
        result = await executeJob(s);
      } catch (err) {
        runError = err instanceof Error ? err.message : "Unknown error";
      }

      const completedAt = new Date();
      const success = !runError;

      await db.update(buildScheduleRuns)
        .set({
          status: success ? "completed" : "failed",
          completedAt,
          error: runError,
          result,
        })
        .where(eq(buildScheduleRuns.id, run.id));

      // Dispatch notifications
      const eventType = s.type === "build" ? (success ? "build_completed" : "build_failed")
        : s.type === "research" ? (success ? "research_completed" : "research_failed")
        : s.type === "snapshot_cleanup" ? (success ? "deployment_completed" : "deployment_failed")
        : (success ? "scheduled_job_completed" : "scheduled_job_failed");

      const { dispatchNotification } = await import("../routes/jarvis/connectors");
      await dispatchNotification(s.projectId, eventType, `Manual ${s.type}: ${s.name}`, success ? "Completed successfully" : `Failed: ${runError}`, {
        metadata: { scheduleId: s.id, type: s.type, trigger: "manual" },
      });

      await logActivity(s.projectId, "task_completed", `Manual run of "${s.name}" (${s.type}) ${success ? "completed" : "failed"}`);
    } catch (err) {
      logger.error({ err, scheduleId }, "[scheduler] manual trigger failed");
    }
  })();

  return { ok: true, runId: run.id };
}

/** Get schedule with recent runs. */
export async function getScheduleWithRuns(scheduleId: string): Promise<(BuildSchedule & { runs: typeof buildScheduleRuns.$inferSelect[] }) | null> {
  const [s] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, scheduleId));
  if (!s) return null;

  const runs = await db
    .select()
    .from(buildScheduleRuns)
    .where(eq(buildScheduleRuns.scheduleId, scheduleId))
    .orderBy(desc(buildScheduleRuns.startedAt))
    .limit(20);

  return { ...s, runs };
}

/** List schedules for a project. */
export async function listSchedules(projectId: string): Promise<BuildSchedule[]> {
  return db.select().from(buildSchedules).where(eq(buildSchedules.projectId, projectId)).orderBy(desc(buildSchedules.createdAt));
}

/** Create a new schedule. */
export async function createSchedule(input: Omit<NewBuildSchedule, "id" | "createdAt" | "updatedAt" | "runCount" | "nextRunAt" | "lastRunAt" | "lastRunResult" | "lastError" | "status">): Promise<BuildSchedule> {
  const [s] = await db.insert(buildSchedules).values({
    ...input,
    runCount: 0,
    status: "enabled" as const,
  }).returning();

  // Schedule immediately if enabled
  if (s.status === "enabled") {
    scheduleSchedule(s);
  }

  return s;
}

/** Update a schedule (re-schedules if cron/status changed). */
export async function updateSchedule(id: string, input: Partial<Pick<BuildSchedule, "name" | "cron" | "config" | "status" | "notifyOnCompletion">>): Promise<BuildSchedule | null> {
  const [existing] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, id));
  if (!existing) return null;

  const cronChanged = input.cron && input.cron !== existing.cron;
  const statusChanged = input.status && input.status !== existing.status;

  const [updated] = await db.update(buildSchedules)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(buildSchedules.id, id))
    .returning();

  if (!updated) return null;

  // Cancel old timer
  cancelScheduled(id);

  // Re-schedule if enabled
  if (updated.status === "enabled") {
    if (cronChanged || statusChanged) {
      scheduleSchedule(updated);
    }
  }

  return updated;
}

/** Delete a schedule. */
export async function deleteSchedule(id: string): Promise<boolean> {
  cancelScheduled(id);
  const result = await db.delete(buildSchedules).where(eq(buildSchedules.id, id));
  return (result.rowCount ?? 0) > 0;
}

/** Get runs for a schedule (paginated). */
export async function getScheduleRuns(scheduleId: string, limit = 50, offset = 0): Promise<typeof buildScheduleRuns.$inferSelect[]> {
  return db
    .select()
    .from(buildScheduleRuns)
    .where(eq(buildScheduleRuns.scheduleId, scheduleId))
    .orderBy(desc(buildScheduleRuns.startedAt))
    .limit(limit)
    .offset(offset);
}