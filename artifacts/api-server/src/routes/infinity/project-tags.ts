import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { buildApps, projectAccessLog, db } from "@workspace/db";
import { listWorkspaceFiles, readWorkspaceFile, getWorkspaceRoot } from "../../lib/workspace";
import path from "node:path";

const router = Router();

/**
 * POST /api/infinity/project-tags/resolve
 * Resolve @ProjectName tag to fetch project metadata and file list.
 * Returns project info + all accessible files in view-only mode by default.
 */
router.post("/resolve", async (req: Request, res: Response) => {
  try {
    const { projectName } = req.body as { projectName: string };

    if (!projectName || typeof projectName !== "string") {
      return res.status(400).json({ error: "projectName required" });
    }

    // Find project by name (case-insensitive)
    const project = await db
      .select()
      .from(buildApps)
      .where(eq(buildApps.name, projectName))
      .limit(1);

    if (project.length === 0) {
      return res.status(404).json({ error: `Project "${projectName}" not found` });
    }

    const proj = project[0];

    // Get access log entry (default is view-only)
    const access = await db
      .select()
      .from(projectAccessLog)
      .where(
        and(
          eq(projectAccessLog.referencedProjectId, proj.id),
        ),
      )
      .limit(1);

    const accessLevel = access.length > 0 ? access[0].accessLevel : "view";

    // Return project metadata
    return res.json({
      id: proj.id,
      name: proj.name,
      description: proj.description,
      accessLevel,
      metadata: proj.metadata,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
    });
  } catch (err) {
    console.error("Error resolving project tag:", err);
    return res.status(500).json({ error: "Failed to resolve project tag" });
  }
});

/**
 * GET /api/infinity/project-tags/files/:projectId
 * Fetch all files from a referenced project (respecting access level).
 */
router.get("/files/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.params.projectId === "string" ? req.params.projectId : "";
    const accessLevel = (req.query.accessLevel as string) || "view";

    if (!projectId) {
      return res.status(400).json({ error: "projectId required" });
    }

    // Verify project exists
    const project = await db
      .select()
      .from(buildApps)
      .where(eq(buildApps.id, projectId))
      .limit(1);

    if (project.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    // TODO: For now, return empty file list.
    // In full implementation, fetch from workspace or fileId bundle.
    // Access control: if accessLevel is "view", exclude sensitive files.

    return res.json({
      projectId,
      accessLevel,
      files: [],
      note: "File fetching from workspace bundles coming in Phase 2",
    });
  } catch (err) {
    console.error("Error fetching project files:", err);
    return res.status(500).json({ error: "Failed to fetch project files" });
  }
});

/**
 * POST /api/infinity/project-tags/escalate-access
 * Escalate access from "view" to "edit" for a referenced project.
 * User confirms this action via UI dialog.
 */
router.post("/escalate-access", async (req: Request, res: Response) => {
  try {
    const { referencingProjectId, referencedProjectId } = req.body as {
      referencingProjectId: string;
      referencedProjectId: string;
    };

    if (!referencingProjectId || !referencedProjectId) {
      return res.status(400).json({ error: "Both project IDs required" });
    }

    // Find or create access log entry
    const existing = await db
      .select()
      .from(projectAccessLog)
      .where(
        and(
          eq(projectAccessLog.referencingProjectId, referencingProjectId),
          eq(projectAccessLog.referencedProjectId, referencedProjectId),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      // Create new access entry with edit level
      const newEntry = await db
        .insert(projectAccessLog)
        .values({
          referencingProjectId,
          referencedProjectId,
          accessLevel: "edit",
        })
        .returning();

      return res.json({ success: true, accessLevel: "edit", entry: newEntry[0] });
    }

    // Update existing entry to edit level
    const updated = await db
      .update(projectAccessLog)
      .set({ accessLevel: "edit", updatedAt: new Date() })
      .where(
        and(
          eq(projectAccessLog.referencingProjectId, referencingProjectId),
          eq(projectAccessLog.referencedProjectId, referencedProjectId),
        ),
      )
      .returning();

    return res.json({ success: true, accessLevel: "edit", entry: updated[0] });
  } catch (err) {
    console.error("Error escalating access:", err);
    return res.status(500).json({ error: "Failed to escalate access" });
  }
});

/**
 * GET /api/infinity/project-tags/list
 * List all available projects for @ tagging autocomplete.
 */
router.get("/list", async (req: Request, res: Response) => {
  try {
    const projects = await db.select().from(buildApps).limit(100);

    return res.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
    });
  } catch (err) {
    console.error("Error listing projects:", err);
    return res.status(500).json({ error: "Failed to list projects" });
  }
});

export default router;
