import { pgTable, text, timestamp, uuid, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 1.2 — Checkpoint / Resume system.
 *
 * Each checkpoint captures the full build state for a project so a run can be
 * resumed exactly where it left off (close tab -> reopen -> "Resume from step
 * 3 of 7?"). On server boot the latest incomplete checkpoint triggers resume.
 */
export const buildCheckpoints = pgTable(
  "build_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id").notNull(),
    iteration: integer("iteration").notNull().default(1),
    completed: integer("completed").notNull().default(0), // 0 = in-progress, 1 = done
    plan: jsonb("plan").notNull().default(sql`'{}'::jsonb`),
    completedSteps: jsonb("completed_steps").notNull().default(sql`'[]'::jsonb`),
    workingContext: jsonb("working_context").notNull().default(sql`'{}'::jsonb`),
    /** Compacted version of workingContext when auto-compaction was applied */
    compactedContext: jsonb("compacted_context"),
    fileSnapshots: jsonb("file_snapshots"), // path -> content hash (for diff)
    tokenUsage: jsonb("token_usage").notNull().default(sql`'{}'::jsonb`),
    /** Phase 5 — lifecycle phase (planning, step-group-N, pre-verification,
      * verification, done-contract, completed). Was missing: checkpoint writes
      * SET phase but the column didn't exist, so the phase silently vanished
      * and phase-based recovery/resume could never identify where a build died. */
    phase: text("phase").notNull().default("planning"),
    /** Git commit hash captured at checkpoint — the git-reset-hard recovery
      * action rolls back to this exact commit. */
    gitCommit: text("git_commit"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * One checkpoint per (project, iteration) so `onConflictDoUpdate({ target:
     * [projectId, iteration] })` in build-context's persistContextToCheckpoint can
     * upsert. Without this unique constraint that upsert fails with "no unique or
     * exclusion constraint matching the ON CONFLICT specification" and NO
     * checkpoint is ever written — Phase 4 exposes this as the resume/checkpoint
     * must actually persist.
     */
    uniqueIndex("build_checkpoints_project_iteration_idx").on(
      table.projectId,
      table.iteration,
    ),
  ],
);

export type BuildCheckpoint = typeof buildCheckpoints.$inferSelect;
export type NewBuildCheckpoint = typeof buildCheckpoints.$inferInsert;
