/**
 * Project Research API (Phase J — step 12).
 *
 *  GET  /api/jarvis/projects/:id/research           list project-scoped research runs
 *  POST /api/jarvis/projects/:id/research           associate an existing research job with this project
 *  GET  /api/jarvis/projects/:id/research/:jobId    detail view (reuses job report/notes/log)
 *  POST /api/jarvis/projects/:id/research/:jobId/findings   save a user excerpt (saved finding)
 *  DELETE /api/jarvis/projects/:id/research/findings/:findingId  remove a saved finding
 *  PATCH  /api/jarvis/projects/:id/research/findings/:findingId  pin/unpin a saved finding
 *
 * The research engine itself (researchJobs, background loop, heartbeat/resume)
 * is NOT modified — we only add the project association layer and the
 * lightweight saved-findings store.
 */
import { Router } from "express";
import { db, projectResearch, projectResearchFindings, projects, researchJobs } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { cleanText } from "../../lib/text-utils";
import { logActivity } from "./project-activity";

const router = Router();

async function resolveProject(projectId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ? { id: projectId } : null;
}

function serializeJoin(row: typeof projectResearch.$inferSelect, job: typeof researchJobs.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    researchJobId: row.researchJobId,
    createdAt: row.createdAt.toISOString(),
    job: {
      id: job.id,
      title: job.title,
      prompt: job.prompt,
      mode: job.mode,
      depth: job.depth,
      status: job.status,
      progress: job.progress,
      phase: job.phase,
      log: job.log,
      notes: job.notes,
      report: job.report,
      gemConversationId: job.gemConversationId,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    },
  };
}

function serializeFinding(row: typeof projectResearchFindings.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    researchJobId: row.researchJobId,
    excerpt: row.excerpt,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
  };
}

/** List all research jobs associated with a project, newest first. */
router.get("/projects/:id/research", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const joins = await db
      .select()
      .from(projectResearch)
      .where(eq(projectResearch.projectId, projectId))
      .orderBy(desc(projectResearch.createdAt));

    const jobIds = joins.map((j) => j.researchJobId);
    const jobs = jobIds.length
      ? await db.select().from(researchJobs).where(eq(researchJobs.id, jobIds[0])) // placeholder - we'll fetch each
      : [];

    // Fetch all jobs in a single query using IN
    const jobsById = new Map<string, typeof researchJobs.$inferSelect>();
    if (jobIds.length) {
      const allJobs = await db.select().from(researchJobs).where(eq(researchJobs.id, jobIds[0])); // Actually need IN
      // Drizzle doesn't have a direct IN helper in this version, so we'll fetch individually or use a different approach
      for (const jid of jobIds) {
        const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, jid)).limit(1);
        if (job) jobsById.set(jid, job);
      }
    }

    const results = joins.map((join) => serializeJoin(join, jobsById.get(join.researchJobId)!));
    res.json({ research: results });
  } catch (err) {
    req.log.error({ err }, "Failed to list project research");
    res.status(500).json({ error: "Failed to list project research" });
  }
});

/** Associate an existing research job with this project. */
router.post("/projects/:id/research", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const researchJobId = cleanText(req.body?.researchJobId, 80);
  if (!researchJobId) {
    res.status(400).json({ error: "researchJobId is required" });
    return;
  }

  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [existingJob] = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(eq(researchJobs.id, researchJobId))
      .limit(1);
    if (!existingJob) {
      res.status(404).json({ error: "Research job not found" });
      return;
    }

    // Check if already associated
    const [existing] = await db
      .select({ id: projectResearch.id })
      .from(projectResearch)
      .where(and(eq(projectResearch.projectId, projectId), eq(projectResearch.researchJobId, researchJobId)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Research job already associated with this project" });
      return;
    }

    const [created] = await db
      .insert(projectResearch)
      .values({ projectId, researchJobId })
      .returning();

    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, researchJobId)).limit(1);
    await logActivity(projectId, "research_completed", `Research "${job?.title || "unknown"}" associated with project`);
    res.status(201).json({ research: serializeJoin(created, job!) });
  } catch (err) {
    req.log.error({ err }, "Failed to associate research job with project");
    res.status(500).json({ error: "Failed to associate research job with project" });
  }
});

/** Get a single research job detail (report, notes, log) for this project. */
router.get("/projects/:id/research/:jobId", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const researchJobId = cleanText(req.params.jobId, 80);

  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [join] = await db
      .select()
      .from(projectResearch)
      .where(and(eq(projectResearch.projectId, projectId), eq(projectResearch.researchJobId, researchJobId)))
      .limit(1);
    if (!join) {
      res.status(404).json({ error: "Research job not associated with this project" });
      return;
    }

    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, researchJobId)).limit(1);
    if (!job) {
      res.status(404).json({ error: "Research job not found" });
      return;
    }

    res.json({ research: serializeJoin(join, job) });
  } catch (err) {
    req.log.error({ err }, "Failed to get project research detail");
    res.status(500).json({ error: "Failed to get project research detail" });
  }
});

/** Save a user excerpt (finding) from a research run inside this project. */
router.post("/projects/:id/research/:jobId/findings", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const researchJobId = cleanText(req.params.jobId, 80);
  const excerpt = cleanText(req.body?.excerpt, 5000);
  if (!excerpt) {
    res.status(400).json({ error: "excerpt is required" });
    return;
  }

  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [join] = await db
      .select()
      .from(projectResearch)
      .where(and(eq(projectResearch.projectId, projectId), eq(projectResearch.researchJobId, researchJobId)))
      .limit(1);
    if (!join) {
      res.status(404).json({ error: "Research job not associated with this project" });
      return;
    }

    const [created] = await db
      .insert(projectResearchFindings)
      .values({ projectId, researchJobId, excerpt })
      .returning();

    await logActivity(projectId, "research_completed", `Research finding saved: ${excerpt.slice(0, 100)}`);
    res.status(201).json({ finding: serializeFinding(created) });
  } catch (err) {
    req.log.error({ err }, "Failed to save research finding");
    res.status(500).json({ error: "Failed to save research finding" });
  }
});

/** List all saved findings for a project (across all its research jobs). */
router.get("/projects/:id/research/findings", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);

  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const rows = await db
      .select()
      .from(projectResearchFindings)
      .where(eq(projectResearchFindings.projectId, projectId))
      .orderBy(desc(projectResearchFindings.createdAt));

    res.json({ findings: rows.map(serializeFinding) });
  } catch (err) {
    req.log.error({ err }, "Failed to list project research findings");
    res.status(500).json({ error: "Failed to list project research findings" });
  }
});

/** Update (pin/unpin) a saved finding. */
router.patch("/projects/:id/research/findings/:findingId", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const findingId = cleanText(req.params.findingId, 80);
  const pinned = req.body?.pinned === true;

  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [updated] = await db
      .update(projectResearchFindings)
      .set({ pinned })
      .where(and(eq(projectResearchFindings.id, findingId), eq(projectResearchFindings.projectId, projectId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }

    await logActivity(projectId, "research_completed", `Finding ${pinned ? "pinned" : "unpinned"}: ${updated.excerpt.slice(0, 100)}`);
    res.json({ finding: serializeFinding(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update research finding");
    res.status(500).json({ error: "Failed to update research finding" });
  }
});

/** Delete a saved finding. */
router.delete("/projects/:id/research/findings/:findingId", async (req, res) => {
  const projectId = cleanText(req.params.id, 80);
  const findingId = cleanText(req.params.findingId, 80);

  try {
    const project = await resolveProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [existing] = await db
      .select({ excerpt: projectResearchFindings.excerpt })
      .from(projectResearchFindings)
      .where(and(eq(projectResearchFindings.id, findingId), eq(projectResearchFindings.projectId, projectId)))
      .limit(1);

    const [deleted] = await db
      .delete(projectResearchFindings)
      .where(and(eq(projectResearchFindings.id, findingId), eq(projectResearchFindings.projectId, projectId)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }

    await logActivity(projectId, "research_completed", `Finding deleted: ${existing?.excerpt?.slice(0, 100) || "unknown"}`);
    res.json({ ok: true, id: findingId });
  } catch (err) {
    req.log.error({ err }, "Failed to delete research finding");
    res.status(500).json({ error: "Failed to delete research finding" });
  }
});

export default router;