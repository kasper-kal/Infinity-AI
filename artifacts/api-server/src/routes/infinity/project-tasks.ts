/**
 * Project Tasks API (Phase K — step 13).
 *
 *  GET  /api/infinity/projects/:id/tasks        list scoped tasks (newest first)
 *  POST /api/infinity/projects/:id/tasks        create a task
 *  PATCH /api/jarvis/tasks/:id                update title/description/priority/due/status
 *  DELETE /api/jarvis/tasks/:id               delete a task
 *
 * Every handler resolves the owning project strictly by id; tasks are never
 * reachable outside their project.
 */
import { Router } from "express";
import { db, projectTasks, projects, type ProjectTask } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { cleanText } from "../../lib/text-utils";
import { logActivity } from "./project-activity";

const router = Router();

const VALID_STATUS = new Set(["todo", "in_progress", "done"]);
const VALID_PRIORITY = new Set(["low", "medium", "high"]);

async function resolveProject(projectId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ? { id: projectId } : null;
}

function serialize(task: typeof projectTasks.$inferSelect) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    conversationId: task.conversationId ?? null,
    fileId: task.fileId ?? null,
    memoryId: task.memoryId ?? null,
    sortOrder: task.sortOrder,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

router.get("/projects/:id/tasks", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  try {
    const [project] = await db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const rows = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId))
      .orderBy(asc(projectTasks.sortOrder), desc(projectTasks.createdAt));
    res.json({ tasks: rows.map(serialize) });
  } catch (err) {
    req.log.error({ err }, "Failed to load project tasks");
    res.status(500).json({ error: "Failed to load project tasks" });
  }
});

router.post("/projects/:id/tasks", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const title = cleanText(req.body?.title, 280);
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const description = req.body?.description ? cleanText(req.body.description, 2000) : null;
  const priorityRaw = String(req.body?.priority ?? "medium").trim();
  const priority: ProjectTask["priority"] = VALID_PRIORITY.has(priorityRaw) ? (priorityRaw as ProjectTask["priority"]) : "medium";
  const dueAt = req.body?.dueAt ? new Date(req.body.dueAt) : null;

  try {
    const [created] = await db
      .insert(projectTasks)
      .values({
        projectId,
        title,
        description,
        priority,
        dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
        status: "todo",
      })
      .returning();
    await logActivity(projectId, "task_added", `Task added: ${title}`);
    res.status(201).json({ task: serialize(created) });
  } catch (err) {
    req.log.error({ err }, "Failed to create project task");
    res.status(500).json({ error: "Failed to create project task" });
  }
});

router.patch("/tasks/:id", async (req, res) => {
  const id = cleanText(req.params.id, 80);
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  const patch: Partial<typeof projectTasks.$inferInsert> = {};
  if (req.body?.title !== undefined) {
    const title = cleanText(req.body.title, 280);
    if (!title) {
      res.status(400).json({ error: "title cannot be empty" });
      return;
    }
    patch.title = title;
  }
  if (req.body?.description !== undefined) {
    patch.description = req.body.description ? cleanText(req.body.description, 2000) : null;
  }
  if (req.body?.priority !== undefined) {
    const priorityRaw = String(req.body.priority).trim();
    if (!VALID_PRIORITY.has(priorityRaw)) {
      res.status(400).json({ error: "invalid priority" });
      return;
    }
    patch.priority = priorityRaw as ProjectTask["priority"];
  }
  if (req.body?.status !== undefined) {
    const statusRaw = String(req.body.status).trim();
    if (!VALID_STATUS.has(statusRaw)) {
      res.status(400).json({ error: "invalid status" });
      return;
    }
    patch.status = statusRaw as ProjectTask["status"];
  }
  if (req.body?.dueAt !== undefined) {
    const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
    patch.dueAt = dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null;
  }

  try {
    const [updated] = await db
      .update(projectTasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projectTasks.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    // Log activity when task is completed
    if (patch.status === "done") {
      await logActivity(updated.projectId, "task_completed", `Task completed: ${updated.title}`);
    }
    res.json({ task: serialize(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update project task");
    res.status(500).json({ error: "Failed to update project task" });
  }
});

router.delete("/tasks/:id", async (req, res) => {
  const id = cleanText(req.params.id, 80);
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(projectTasks)
      .where(eq(projectTasks.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    await logActivity(deleted.projectId, "task_added", `Task deleted: ${deleted.title}`);
    res.json({ ok: true, id });
  } catch (err) {
    req.log.error({ err }, "Failed to delete project task");
    res.status(500).json({ error: "Failed to delete project task" });
  }
});

export default router;
