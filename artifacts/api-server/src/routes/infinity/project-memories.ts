import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, projectMemories, projects, type ProjectMemory } from "@workspace/db";
import { canonicalProjectMemoryKey } from "../../lib/project-memory";
import { logActivity } from "./project-activity";

const router = Router();

type MemoryBody = Record<string, unknown>;

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hasBodyField(body: unknown, field: string): boolean {
  return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, field);
}

function cleanCategory(value: unknown): string {
  return cleanText(value, 60).toLowerCase().replace(/\s+/g, "_") || "about";
}

function getProjectIdFromBodyOrQuery(req: Request): string {
  const body = req.body as MemoryBody | undefined;
  return cleanText(body?.projectId ?? req.query.projectId, 80);
}

async function findProject(projectId: string) {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project;
}

async function findScopedMemory(projectId: string, memoryId: string): Promise<ProjectMemory | undefined> {
  const [memory] = await db
    .select()
    .from(projectMemories)
    .where(and(
      eq(projectMemories.id, memoryId),
      eq(projectMemories.projectId, projectId),
    ));
  return memory;
}

function groupMemories(rows: ProjectMemory[]): Record<string, ProjectMemory[]> {
  return rows.reduce<Record<string, ProjectMemory[]>>((groups, memory) => {
    (groups[memory.category] ??= []).push(memory);
    return groups;
  }, {});
}

async function requireProject(projectId: string, res: Response): Promise<boolean> {
  if (await findProject(projectId)) return true;
  res.status(404).json({ error: "Project not found" });
  return false;
}

async function updateScopedMemory(
  projectId: string,
  memoryId: string,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const existing = await findScopedMemory(projectId, memoryId);
    if (!existing) {
      res.status(404).json({ error: "Project memory not found" });
      return;
    }

    const body = req.body as MemoryBody | undefined;
    const hasContent = hasBodyField(body, "content");
    const hasCategory = hasBodyField(body, "category");
    const hasPinned = hasBodyField(body, "pinned");
    const hasSourceRef = hasBodyField(body, "sourceRef");
    const content = cleanText(body?.content, 4000);
    const category = cleanCategory(body?.category);
    const sourceRef = cleanText(body?.sourceRef, 500);

    if (hasContent && !content) {
      res.status(400).json({ error: "content cannot be empty" });
      return;
    }
    if (hasPinned && typeof body?.pinned !== "boolean") {
      res.status(400).json({ error: "pinned must be a boolean" });
      return;
    }
    if (!hasContent && !hasCategory && !hasPinned && !hasSourceRef) {
      res.status(400).json({ error: "No memory fields to update" });
      return;
    }

    const [updated] = await db
      .update(projectMemories)
      .set({
        ...(hasContent ? { content } : {}),
        ...(hasCategory ? { category } : {}),
        ...(hasPinned ? { pinned: body?.pinned as boolean } : {}),
        ...(hasSourceRef ? { sourceRef } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(projectMemories.id, memoryId),
        eq(projectMemories.projectId, projectId),
      ))
      .returning();

    if (updated) {
      await logActivity(projectId, "memory_updated", `Memory updated: ${updated.content.slice(0, 100)}`);
    }
    res.json(updated ?? existing);
  } catch (err) {
    req.log.error({ err }, "Failed to update project memory");
    res.status(500).json({ error: "Failed to update project memory" });
  }
}

async function deleteScopedMemory(
  projectId: string,
  memoryId: string,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const [deleted] = await db
      .delete(projectMemories)
      .where(and(
        eq(projectMemories.id, memoryId),
        eq(projectMemories.projectId, projectId),
      ))
      .returning({ id: projectMemories.id });
    if (!deleted) {
      res.status(404).json({ error: "Project memory not found" });
      return;
    }
    res.json({ ok: true, id: deleted.id });
  } catch (err) {
    req.log.error({ err }, "Failed to delete project memory");
    res.status(500).json({ error: "Failed to delete project memory" });
  }
}

async function setScopedMemoryPinned(
  projectId: string,
  memoryId: string,
  pinned: boolean,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const [updated] = await db
      .update(projectMemories)
      .set({ pinned, updatedAt: new Date() })
      .where(and(
        eq(projectMemories.id, memoryId),
        eq(projectMemories.projectId, projectId),
      ))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Project memory not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to pin project memory");
    res.status(500).json({ error: "Failed to pin project memory" });
  }
}

/** List one project's memories, grouped for the future Project Memory UI. */
router.get("/projects/:id/memories", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  if (!(await requireProject(projectId, res))) return;

  const query = cleanText(req.query.q, 120);
  try {
    const rows = await db
      .select()
      .from(projectMemories)
      .where(query
        ? and(
            eq(projectMemories.projectId, projectId),
            or(
              ilike(projectMemories.content, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
              ilike(projectMemories.key, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
              ilike(projectMemories.category, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
            ),
          )
        : eq(projectMemories.projectId, projectId))
      .orderBy(desc(projectMemories.pinned), desc(projectMemories.updatedAt));
    res.json({ memories: rows, groups: groupMemories(rows) });
  } catch (err) {
    req.log.error({ err }, "Failed to load project memories");
    res.status(500).json({ error: "Failed to load project memories" });
  }
});

/** Add or update one manual memory using a canonical key within the project. */
router.post("/projects/:id/memories", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const body = req.body as MemoryBody | undefined;
  const content = cleanText(body?.content, 4000);
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (!(await requireProject(projectId, res))) return;

  const key = canonicalProjectMemoryKey(cleanText(body?.key, 120) || content);
  if (!key) {
    res.status(400).json({ error: "A non-empty memory key or content is required" });
    return;
  }

  try {
    const [row] = await db
      .insert(projectMemories)
      .values({
        projectId,
        category: cleanCategory(body?.category),
        content,
        key,
        sourceType: "manual",
        sourceRef: cleanText(body?.sourceRef ?? body?.source, 500),
        ...(typeof body?.pinned === "boolean" ? { pinned: body.pinned } : {}),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [projectMemories.projectId, projectMemories.key],
        set: {
          category: cleanCategory(body?.category),
          content,
          sourceType: "manual",
          sourceRef: cleanText(body?.sourceRef ?? body?.source, 500),
          ...(typeof body?.pinned === "boolean" ? { pinned: body.pinned } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    await logActivity(projectId, "memory_added", `Memory added: ${content.slice(0, 100)}`);
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to save project memory");
    res.status(500).json({ error: "Failed to save project memory" });
  }
});

router.patch("/projects/:projectId/memories/:memoryId", async (req, res) => {
  await updateScopedMemory(
    cleanText(req.params.projectId, 80),
    cleanText(req.params.memoryId, 80),
    req,
    res,
  );
});

router.delete("/projects/:projectId/memories/:memoryId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 80);
  const memoryId = cleanText(req.params.memoryId, 80);
  try {
    const existing = await findScopedMemory(projectId, memoryId);
    if (!existing) {
      res.status(404).json({ error: "Project memory not found" });
      return;
    }
    await deleteScopedMemory(projectId, memoryId, req, res);
    await logActivity(projectId, "memory_added", `Memory deleted: ${existing.content.slice(0, 100)}`);
  } catch (err) {
    req.log.error({ err }, "Failed to delete project memory");
    res.status(500).json({ error: "Failed to delete project memory" });
  }
});

router.post("/projects/:projectId/memories/:memoryId/pin", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 80);
  const memoryId = cleanText(req.params.memoryId, 80);
  const existing = await findScopedMemory(projectId, memoryId);
  if (!existing) {
    res.status(404).json({ error: "Project memory not found" });
    return;
  }
  const body = req.body as MemoryBody | undefined;
  const pinned = typeof body?.pinned === "boolean" ? body.pinned : !existing.pinned;
  await setScopedMemoryPinned(projectId, memoryId, pinned, req, res);
});

router.delete("/projects/:projectId/memories/:memoryId/pin", async (req, res) => {
  await setScopedMemoryPinned(
    cleanText(req.params.projectId, 80),
    cleanText(req.params.memoryId, 80),
    false,
    req,
    res,
  );
});

/**
 * Compatibility endpoints from the Phase E plan. A projectId is mandatory
 * when the memory id is not nested, so a caller cannot accidentally mutate a
 * memory outside the project context it intended to address. If omitted,
 * PATCH/DELETE fall through to the existing global-memory router.
 */
router.patch("/memories/:memoryId", async (req, res, next: NextFunction) => {
  const projectId = getProjectIdFromBodyOrQuery(req);
  if (!projectId) {
    next();
    return;
  }
  await updateScopedMemory(projectId, cleanText(req.params.memoryId, 80), req, res);
});

router.delete("/memories/:memoryId", async (req, res, next: NextFunction) => {
  const projectId = getProjectIdFromBodyOrQuery(req);
  if (!projectId) {
    next();
    return;
  }
  const memoryId = cleanText(req.params.memoryId, 80);
  try {
    const existing = await findScopedMemory(projectId, memoryId);
    if (!existing) {
      res.status(404).json({ error: "Project memory not found" });
      return;
    }
    await deleteScopedMemory(projectId, memoryId, req, res);
    await logActivity(projectId, "memory_added", `Memory deleted: ${existing.content.slice(0, 100)}`);
  } catch (err) {
    req.log.error({ err }, "Failed to delete project memory");
    res.status(500).json({ error: "Failed to delete project memory" });
  }
});

router.post("/memories/:memoryId/pin", async (req, res) => {
  const projectId = getProjectIdFromBodyOrQuery(req);
  if (!projectId) {
    res.status(400).json({ error: "projectId is required for project memory pinning" });
    return;
  }
  const memoryId = cleanText(req.params.memoryId, 80);
  const existing = await findScopedMemory(projectId, memoryId);
  if (!existing) {
    res.status(404).json({ error: "Project memory not found" });
    return;
  }
  const body = req.body as MemoryBody | undefined;
  const pinned = typeof body?.pinned === "boolean" ? body.pinned : !existing.pinned;
  await setScopedMemoryPinned(projectId, memoryId, pinned, req, res);
});

router.delete("/memories/:memoryId/pin", async (req, res) => {
  const projectId = getProjectIdFromBodyOrQuery(req);
  if (!projectId) {
    res.status(400).json({ error: "projectId is required for project memory pinning" });
    return;
  }
  await setScopedMemoryPinned(projectId, cleanText(req.params.memoryId, 80), false, req, res);
});

export default router;
