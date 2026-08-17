import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * Build Schedules — persistent cron-like jobs per project.
 * Job types: build, research, memory_compaction, budget_reset, snapshot_cleanup
 * Survives restarts via DB + timer-scheduler pattern.
 */
export const buildSchedules = pgTable(
  "build_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Human-readable name, e.g. "Nightly Build" */
    name: text("name").notNull(),
    /** Job type */
    type: text("type", {
      enum: [
        "build",
        "research",
        "memory_compaction",
        "budget_reset",
        "snapshot_cleanup",
      ],
    }).notNull(),
    /** Cron expression (5-field: minute hour day-of-month month day-of-week) */
    cron: text("cron").notNull(),
    /** Job-specific config (goal, model, options) */
    config: jsonb("config").notNull().default({}),
    /** enabled | paused | error */
    status: text("status", { enum: ["enabled", "paused", "error"] })
      .notNull()
      .default("enabled"),
    /** Next scheduled fire time (wall-clock) */
    nextRunAt: timestamp("next_run_at"),
    /** Last time the job actually ran */
    lastRunAt: timestamp("last_run_at"),
    /** Result of last run (success, error, output) */
    lastRunResult: jsonb("last_run_result"),
    /** Run count for statistics */
    runCount: integer("run_count").notNull().default(0),
    /** If status=error, the error message */
    lastError: text("last_error"),
    /** Whether to send notifications on run completion (ties to Phase 10 connectors) */
    notifyOnCompletion: boolean("notify_on_completion").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("build_schedules_project_idx").on(table.projectId),
    index("build_schedules_status_idx").on(table.status),
    index("build_schedules_next_run_idx").on(table.nextRunAt),
  ],
);

export type BuildSchedule = typeof buildSchedules.$inferSelect;
export type NewBuildSchedule = typeof buildSchedules.$inferInsert;

/**
 * Build Schedule Runs — history of each job execution.
 * Used for debugging, audit trail, and the "Run now" button history.
 */
export const buildScheduleRuns = pgTable(
  "build_schedule_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => buildSchedules.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Trigger type: cron (scheduled) | manual (Run now button) | api (external) */
    trigger: text("trigger", { enum: ["cron", "manual", "api"] })
      .notNull()
      .default("cron"),
    /** started | completed | failed */
    status: text("status", { enum: ["started", "completed", "failed"] })
      .notNull()
      .default("started"),
    /** Started at */
    startedAt: timestamp("started_at").notNull().defaultNow(),
    /** Completed at (null if running/failed) */
    completedAt: timestamp("completed_at"),
    /** Error message if failed */
    error: text("error"),
    /** Structured output/result */
    result: jsonb("result"),
  },
  (table) => [
    index("build_schedule_runs_schedule_idx").on(table.scheduleId),
    index("build_schedule_runs_project_idx").on(table.projectId),
    index("build_schedule_runs_started_idx").on(table.startedAt),
  ],
);

export type BuildScheduleRun = typeof buildScheduleRuns.$inferSelect;
export type NewBuildScheduleRun = typeof buildScheduleRuns.$inferInsert;