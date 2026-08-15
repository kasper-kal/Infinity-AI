import { pgTable, text, timestamp, uuid, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 1.2 — Checkpoint / Resume system.
 *
 * Each checkpoint captures the full build state for a project so a run can be
 * resumed exactly where it left off (close tab -> reopen -> "Resume from step
 * 3 of 7?"). On server boot the latest incomplete checkpoint triggers resume.
 */
export const buildCheckpoints = pgTable("build_checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id").notNull(),
  iteration: integer("iteration").notNull().default(1),
  completed: integer("completed").notNull().default(0), // 0 = in-progress, 1 = done
  plan: jsonb("plan").notNull().default(sql`'{}'::jsonb`),
  completedSteps: jsonb("completed_steps").notNull().default(sql`'[]'::jsonb`),
  workingContext: jsonb("working_context").notNull().default(sql`'{}'::jsonb`),
  fileSnapshots: jsonb("file_snapshots"), // path -> content hash (for diff)
  tokenUsage: jsonb("token_usage").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BuildCheckpoint = typeof buildCheckpoints.$inferSelect;
export type NewBuildCheckpoint = typeof buildCheckpoints.$inferInsert;
