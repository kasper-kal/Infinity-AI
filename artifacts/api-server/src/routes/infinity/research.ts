import { Router } from "express";
import { db, researchJobs } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { startResearchJob, recoverStuckJobs, estimateJob, type JobDepth } from "../../lib/research-engine";

const router = Router();

// Resume any jobs that were left mid-flight by a server restart (fire-and-forget).
recoverStuckJobs().catch(() => {});

/** Start a new deep research job. Returns the created job immediately, the
 *  engine keeps running in the background (hours → days) and the frontend
 *  polls status. */
router.post("/research", async (req, res) => {
  try {
    const { prompt, title, mode, depth } = req.body as {
      prompt?: string;
      title?: string;
      mode?: "agent" | "normal" | "both";
      depth?: "standard" | "deep" | "quantum" | "omni";
    };
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      req.log.warn({ body: { ...req.body, prompt: typeof req.body?.prompt === "string" ? req.body.prompt.length : typeof req.body?.prompt } }, "Research rejected: prompt is required");
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    if (prompt.trim().length > 8000) {
      req.log.warn({ promptLength: prompt.trim().length }, "Research rejected: prompt too long");
      res.status(400).json({ error: "prompt is too long (max 8000 chars)" });
      return;
    }

    const [job] = await db
      .insert(researchJobs)
      .values({
        title: (title?.trim() || prompt.trim().slice(0, 60)) || "Deep research",
        prompt: prompt.trim(),
        mode: mode === "normal" || mode === "both" ? mode : "agent",
        depth: depth === "standard" || depth === "quantum" || depth === "omni" ? depth : "deep",
      })
      .returning();

    // Kick off the background loop, never await it here.
    void startResearchJob(job.id);

    req.log.info({ jobId: job.id }, "Deep research job started");
    res.json(job);
  } catch (err) {
    req.log.error({ err }, "Failed to start research job");
    res.status(500).json({ error: "Failed to start research job" });
  }
});

/** List all research jobs, newest first. */
router.get("/research", async (req, res) => {
  try {
    const jobs = await db.select().from(researchJobs).orderBy(desc(researchJobs.createdAt));
    res.json(jobs);
  } catch (err) {
    req.log.error({ err }, "Failed to list research jobs");
    res.status(500).json({ error: "Failed to list research jobs" });
  }
});

/** Cost/duration estimate for a depth, shown before launching a job. */
router.get("/research/estimate", async (req, res) => {
  try {
    const depth = String(req.query.depth ?? "");
    if (depth !== "standard" && depth !== "deep" && depth !== "quantum" && depth !== "omni") {
      res.status(400).json({ error: "depth must be one of standard|deep|quantum|omni" });
      return;
    }
    res.json(estimateJob(depth as JobDepth));
  } catch (err) {
    req.log.error({ err }, "Failed to estimate research job");
    res.status(500).json({ error: "Failed to estimate research job" });
  }
});

/** Get a single research job. */
router.get("/research/:id", async (req, res) => {
  try {
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Research job not found" });
      return;
    }
    res.json(job);
  } catch (err) {
    req.log.error({ err }, "Failed to get research job");
    res.status(500).json({ error: "Failed to get research job" });
  }
});

/** Cancel a running research job. */
router.post("/research/:id/cancel", async (req, res) => {
  try {
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Research job not found" });
      return;
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      res.json({ ok: true, status: job.status });
      return;
    }
    await db.update(researchJobs).set({ status: "cancelled" }).where(eq(researchJobs.id, job.id));
    res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel research job");
    res.status(500).json({ error: "Failed to cancel research job" });
  }
});

export default router;
