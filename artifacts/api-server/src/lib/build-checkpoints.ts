import { db } from "@workspace/db";
import { buildCheckpoints } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Phase 1.2 — Checkpoint persistence & resume.
 *
 * - saveCheckpoint: writes a full checkpoint row (upserts by projectId + iteration)
 * - getLatestCheckpoint: fetches the most recent for a project (for resume on boot)
 * - listCheckpoints: history UI
 * - deleteCheckpoint: cleanup
 *
 * On server boot: the build route calls getLatestCheckpoint(projectId); if it
 * exists and completed=0, it emits a "resume?" prompt to the UI with the
 * stored plan/completedSteps/workingContext.
 */
export interface CheckpointData {
  projectId: string;
  iteration: number;
  completed: 0 | 1;
  plan: Record<string, unknown>;
  completedSteps: Array<Record<string, unknown>>;
  workingContext: Record<string, unknown>;
  fileSnapshots?: Record<string, string>;
  tokenUsage?: Record<string, unknown>;
}

export async function saveCheckpoint(data: CheckpointData): Promise<string> {
  const existing = await db
    .select({ id: buildCheckpoints.id })
    .from(buildCheckpoints)
    .where(eq(buildCheckpoints.projectId, data.projectId))
    .orderBy(desc(buildCheckpoints.iteration))
    .limit(1);

  if (existing.length > 0 && existing[0].id) {
    // Update existing latest checkpoint
    await db
      .update(buildCheckpoints)
      .set({
        iteration: data.iteration,
        completed: data.completed,
        plan: data.plan,
        completedSteps: data.completedSteps,
        workingContext: data.workingContext,
        fileSnapshots: data.fileSnapshots ?? null,
        tokenUsage: data.tokenUsage ?? {},
        updatedAt: new Date(),
      })
      .where(eq(buildCheckpoints.id, existing[0].id));
    return existing[0].id;
  }

  // Insert new
  const [row] = await db
    .insert(buildCheckpoints)
    .values({
      projectId: data.projectId,
      iteration: data.iteration,
      completed: data.completed,
      plan: data.plan,
      completedSteps: data.completedSteps,
      workingContext: data.workingContext,
      fileSnapshots: data.fileSnapshots ?? null,
      tokenUsage: data.tokenUsage ?? {},
    })
    .returning({ id: buildCheckpoints.id });
  return row.id;
}

export async function getLatestCheckpoint(projectId: string) {
  const rows = await db
    .select()
    .from(buildCheckpoints)
    .where(eq(buildCheckpoints.projectId, projectId))
    .orderBy(desc(buildCheckpoints.iteration))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCheckpoints(projectId: string, limit = 20) {
  return db
    .select()
    .from(buildCheckpoints)
    .where(eq(buildCheckpoints.projectId, projectId))
    .orderBy(desc(buildCheckpoints.iteration))
    .limit(limit);
}

export async function deleteCheckpoint(id: string): Promise<boolean> {
  const result = await db.delete(buildCheckpoints).where(eq(buildCheckpoints.id, id));
  return (result.rowCount ?? 0) > 0;
}

export async function markCheckpointComplete(id: string): Promise<boolean> {
  const result = await db
    .update(buildCheckpoints)
    .set({ completed: 1, updatedAt: new Date() })
    .where(eq(buildCheckpoints.id, id));
  return (result.rowCount ?? 0) > 0;
}