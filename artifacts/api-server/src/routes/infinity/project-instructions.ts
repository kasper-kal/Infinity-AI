import { Router } from "express";
import type { Request, Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  projectInstructions,
  projects,
  type ProjectInstruction,
} from "@workspace/db";
import { logActivity } from "./project-activity";

const router = Router();
type InstructionBody = Record<string, unknown>;

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hasBodyField(body: unknown, field: string): boolean {
  return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, field);
}

async function findProject(projectId: string): Promise<{ id: string; instructions: string | null } | undefined> {
  const [project] = await db
    .select({ id: projects.id, instructions: projects.instructions })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project;
}

async function listRows(projectId: string): Promise<ProjectInstruction[]> {
  return db
    .select()
    .from(projectInstructions)
    .where(eq(projectInstructions.projectId, projectId))
    .orderBy(asc(projectInstructions.sortOrder), asc(projectInstructions.createdAt));
}

/**
 * Older clients stored one newline-delimited instruction block on projects.
 * Materialize it once into the dedicated table so the new UI can edit it
 * without dropping existing project rules.
 */
async function listWithLegacyFallback(
  projectId: string,
  legacyInstructions: string | null,
): Promise<ProjectInstruction[]> {
  const rows = await listRows(projectId);
  const legacy = legacyInstructions?.trim();
  if (rows.length > 0 || !legacy) return rows;

  const [migrated] = await db
    .insert(projectInstructions)
    .values({ projectId, text: legacy, sortOrder: 0 })
    .returning();
  return migrated ? [migrated] : rows;
}

/** Keep the legacy column useful for old clients while the table is canonical. */
async function syncLegacyInstructions(projectId: string): Promise<void> {
  const rows = await listRows(projectId);
  const instructions = rows.map((row) => row.text.trim()).filter(Boolean).join("\n");
  await db
    .update(projects)
    .set({ instructions: instructions || null, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

async function requireProject(
  projectId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<{ id: string; instructions: string | null } | null> {
  const project = await findProject(projectId);
  if (project) return project;
  res.status(404).json({ error: "Project not found" });
  return null;
}

router.get("/projects/:id/instructions", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  try {
    const project = await requireProject(projectId, res);
    if (!project) return;
    const instructions = await listWithLegacyFallback(projectId, project.instructions);
    res.json({ instructions });
  } catch (err) {
    req.log.error({ err }, "Failed to load project instructions");
    res.status(500).json({ error: "Failed to load project instructions" });
  }
});

router.post("/projects/:id/instructions", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const body = req.body as InstructionBody | undefined;
  const text = cleanText(body?.text, 4000);
  if (!text) {
    res.status(400).json({ error: "Instruction text is required" });
    return;
  }

  try {
    const project = await requireProject(projectId, res);
    if (!project) return;
    const current = await listWithLegacyFallback(projectId, project.instructions);
    const [created] = await db
      .insert(projectInstructions)
      .values({ projectId, text, sortOrder: current.length })
      .returning();
    await syncLegacyInstructions(projectId);
    await logActivity(projectId, "instruction_added", `Instruction added: ${text.slice(0, 100)}`);
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to add project instruction");
    res.status(500).json({ error: "Failed to add project instruction" });
  }
});

router.patch("/projects/:projectId/instructions/:instructionId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 80);
  const instructionId = cleanText(req.params.instructionId, 80);
  const body = req.body as InstructionBody | undefined;
  const hasText = hasBodyField(body, "text");
  const hasSortOrder = hasBodyField(body, "sortOrder");
  const text = cleanText(body?.text, 4000);
  const sortOrder = body?.sortOrder;

  if (hasText && !text) {
    res.status(400).json({ error: "Instruction text cannot be empty" });
    return;
  }
  if (hasSortOrder && (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) || sortOrder < 0)) {
    res.status(400).json({ error: "sortOrder must be a non-negative integer" });
    return;
  }
  if (!hasText && !hasSortOrder) {
    res.status(400).json({ error: "No instruction fields to update" });
    return;
  }

  try {
    if (!(await requireProject(projectId, res))) return;
    const [updated] = await db
      .update(projectInstructions)
      .set({
        ...(hasText ? { text } : {}),
        ...(hasSortOrder ? { sortOrder: sortOrder as number } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(projectInstructions.id, instructionId),
        eq(projectInstructions.projectId, projectId),
      ))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Project instruction not found" });
      return;
    }
    await syncLegacyInstructions(projectId);
    if (hasText) {
      await logActivity(projectId, "instruction_added", `Instruction updated: ${text.slice(0, 100)}`);
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update project instruction");
    res.status(500).json({ error: "Failed to update project instruction" });
  }
});

router.delete("/projects/:projectId/instructions/:instructionId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 80);
  const instructionId = cleanText(req.params.instructionId, 80);
  try {
    if (!(await requireProject(projectId, res))) return;
    const [existing] = await db
      .select({ text: projectInstructions.text })
      .from(projectInstructions)
      .where(and(
        eq(projectInstructions.id, instructionId),
        eq(projectInstructions.projectId, projectId),
      ))
      .limit(1);

    const [deleted] = await db
      .delete(projectInstructions)
      .where(and(
        eq(projectInstructions.id, instructionId),
        eq(projectInstructions.projectId, projectId),
      ))
      .returning({ id: projectInstructions.id });
    if (!deleted) {
      res.status(404).json({ error: "Project instruction not found" });
      return;
    }
    await syncLegacyInstructions(projectId);
    await logActivity(projectId, "instruction_added", `Instruction deleted: ${existing?.text?.slice(0, 100) || "unknown"}`);
    res.json({ ok: true, id: deleted.id });
  } catch (err) {
    req.log.error({ err }, "Failed to delete project instruction");
    res.status(500).json({ error: "Failed to delete project instruction" });
  }
});

async function reorderInstructions(req: Request, res: Response): Promise<void> {
  const projectId = cleanText(req.params.id, 80);
  const body = req.body as InstructionBody | undefined;
  const rawIds = body?.ids ?? body?.instructionIds;
  if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "ids must be an array of instruction ids" });
    return;
  }
  const ids = rawIds.map((id) => cleanText(id, 80));
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "Instruction ids must be unique" });
    return;
  }

  try {
    if (!(await requireProject(projectId, res))) return;
    const current = await listRows(projectId);
    const currentIds = new Set(current.map((instruction) => instruction.id));
    if (ids.length !== current.length || ids.some((id) => !currentIds.has(id))) {
      res.status(400).json({ error: "ids must contain every instruction in this project exactly once" });
      return;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      for (const [sortOrder, instructionId] of ids.entries()) {
        await tx
          .update(projectInstructions)
          .set({ sortOrder, updatedAt: now })
          .where(and(
            eq(projectInstructions.id, instructionId),
            eq(projectInstructions.projectId, projectId),
          ));
      }
      await tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId));
    });

    await syncLegacyInstructions(projectId);
    await logActivity(projectId, "instruction_added", `Instructions reordered`);
    res.json({ instructions: await listRows(projectId) });
  } catch (err) {
    req.log.error({ err }, "Failed to reorder project instructions");
    res.status(500).json({ error: "Failed to reorder project instructions" });
  }
}

router.post("/projects/:id/instructions/reorder", reorderInstructions);

export default router;
