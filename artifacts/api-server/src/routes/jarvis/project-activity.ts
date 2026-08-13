/**
 * Project Activity API (Phase M — step 15).
 *
 *  GET /api/jarvis/projects/:id/activity   list project activity feed (newest first, paginated)
 *
 * Every handler resolves the owning project strictly by id; activity is never
 * reachable outside its project.
 *
 * A shared `logActivity` helper is exported so other routers can record
 * project-scoped events without duplicating logic.
 */
import { Router } from "express";
import { db, projectActivity, projects } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { cleanText } from "../../lib/text-utils";

const router = Router();

async function resolveProject(projectId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ? { id: projectId } : null;
}

function serialize(row: typeof projectActivity.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

const VALID_TYPES = [
  "project_created",
  "conversation_started",
  "file_uploaded",
  "file_changed",
  "research_completed",
  "memory_added",
  "memory_updated",
  "instruction_added",
  "task_added",
  "task_completed",
  "agent_ran",
] as const;

type ActivityType = (typeof VALID_TYPES)[number];

/**
 * Record a project-scoped activity event.
 * Used by other routers (project CRUD, conversation moves, files, research, tasks, memory, instructions).
 */
export async function logActivity(
  projectId: string,
  type: ActivityType,
  description: string
): Promise<void> {
  if (!VALID_TYPES.includes(type)) {
    // Fail silently in production to avoid blocking the primary operation,
    // but log for observability.
    console.warn(`[project-activity] invalid type "${type}" for project ${projectId}`);
    return;
  }
  try {
    const project = await resolveProject(projectId);
    if (!project) return;
    await db.insert(projectActivity).values({ projectId, type, description });
  } catch (err) {
    // Non-fatal: activity logging should never break the primary flow
    console.error("[project-activity] failed to log", { projectId, type, description, err });
  }
}

/** List project activity feed (newest first, paginated). */
router.get("/projects/:id/activity", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 100);
  const cursor = req.query.cursor ? cleanText(req.query.cursor, 80) : null;

  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const conditions = [eq(projectActivity.projectId, projectId)];
    if (cursor) {
      conditions.push(sql`${projectActivity.createdAt} < ${cursor}`);
    }

    const rows = await db
      .select()
      .from(projectActivity)
      .where(and(...conditions))
      .orderBy(desc(projectActivity.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      activity: items.map(serialize),
      nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load project activity");
    res.status(500).json({ error: "Failed to load project activity" });
  }
});

export default router;