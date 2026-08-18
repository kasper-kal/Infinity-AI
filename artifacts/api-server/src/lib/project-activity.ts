import { db, projectActivity, projects } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { cleanText } from "./text-utils";
import { logger } from "./logger";

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
  "orchestration_ran",
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
export async function listProjectActivity(
  projectId: string,
  limit: number = 50,
  cursor: string | null = null
) {
  try {
    const project = await resolveProject(projectId);
    if (!project) {
      return { activity: [], nextCursor: null as string | null };
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

    return {
      activity: items.map(serialize),
      nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
    };
  } catch (err) {
    logger.error({ err }, "Failed to load project activity");
    throw err;
  }
}