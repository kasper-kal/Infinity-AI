import { Router } from "express";
import { db, researchJobsV2 } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  startDeepResearchV2,
  streamDeepResearchV2,
  createExpertFromResearch,
  recoverStuckDeepResearchJobs,
  type DeepResearchJob,
} from "../../lib/deep-research-v2";

const router = Router();

// Resume any jobs that were left mid-flight by a server restart (fire-and-forget).
recoverStuckDeepResearchJobs().catch(() => {});

/** Start a new deep research v2 job. Returns the created job immediately, the
 * engine runs in the background (3-7 min) and the frontend polls status or uses SSE. */
router.post("/deep-research-v2", async (req, res) => {
  try {
    const { topic } = req.body as { topic?: string };
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      req.log.warn({ body: { ...req.body, topic: typeof req.body?.topic === "string" ? req.body.topic.length : typeof req.body?.topic } }, "Deep Research v2 rejected: topic is required");
      res.status(400).json({ error: "topic is required" });
      return;
    }
    if (topic.trim().length > 500) {
      req.log.warn({ topicLength: topic.trim().length }, "Deep Research v2 rejected: topic too long");
      res.status(400).json({ error: "topic is too long (max 500 chars)" });
      return;
    }

    // Create job in database
    const [job] = await db.insert(researchJobsV2).values({
      topic: topic.trim(),
      status: "queued",
      phase: "planning",
      progress: 0,
      sourcesFound: 0,
      pagesRead: 0,
      log: ["Job created"],
      iterations: 0,
      maxIterations: 3,
    }).returning();

    // Kick off the background loop, never await it here.
    void startDeepResearchV2(job.id);

    req.log.info({ jobId: job.id, topic: topic.slice(0, 50) }, "Deep Research v2 job started");
    res.json(job);
  } catch (err) {
    req.log.error({ err }, "Failed to start deep research v2 job");
    res.status(500).json({ error: "Failed to start deep research v2 job" });
  }
});

/** List all deep research v2 jobs, newest first. */
router.get("/deep-research-v2", async (req, res) => {
  try {
    const jobs = await db.select().from(researchJobsV2).orderBy(desc(researchJobsV2.createdAt));
    res.json(jobs);
  } catch (err) {
    req.log.error({ err }, "Failed to list deep research v2 jobs");
    res.status(500).json({ error: "Failed to list deep research v2 jobs" });
  }
});

/** Get a single deep research v2 job. */
router.get("/deep-research-v2/:id", async (req, res) => {
  try {
    const [job] = await db.select().from(researchJobsV2).where(eq(researchJobsV2.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Deep research job not found" });
      return;
    }
    res.json(job);
  } catch (err) {
    req.log.error({ err }, "Failed to get deep research v2 job");
    res.status(500).json({ error: "Failed to get deep research v2 job" });
  }
});

/** SSE stream for real-time updates on a deep research v2 job. */
router.get("/deep-research-v2/:id/stream", async (req, res) => {
  try {
    const [job] = await db.select().from(researchJobsV2).where(eq(researchJobsV2.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Deep research job not found" });
      return;
    }
    await streamDeepResearchV2(req.params.id, res);
  } catch (err) {
    req.log.error({ err }, "Failed to stream deep research v2 job");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream deep research v2 job" });
    }
  }
});

/** Cancel a running deep research v2 job. */
router.post("/deep-research-v2/:id/cancel", async (req, res) => {
  try {
    const [job] = await db.select().from(researchJobsV2).where(eq(researchJobsV2.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Deep research job not found" });
      return;
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      res.json({ ok: true, status: job.status });
      return;
    }
    await db.update(researchJobsV2).set({ status: "cancelled" }).where(eq(researchJobsV2.id, job.id));
    res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel deep research v2 job");
    res.status(500).json({ error: "Failed to cancel deep research v2 job" });
  }
});

/** Create an expert conversation from a completed deep research v2 job. */
router.post("/deep-research-v2/:id/expert", async (req, res) => {
  try {
    const [job] = await db.select().from(researchJobsV2).where(eq(researchJobsV2.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Deep research job not found" });
      return;
    }
    if (job.status !== "completed") {
      res.status(400).json({ error: "Job not completed yet" });
      return;
    }
    if (!job.report) {
      res.status(400).json({ error: "No report available" });
      return;
    }

    const expert = await createExpertFromResearch(req.params.id);
    if (!expert) {
      res.status(500).json({ error: "Failed to create expert from research" });
      return;
    }

    res.json(expert);
  } catch (err) {
    req.log.error({ err }, "Failed to create expert from deep research v2");
    res.status(500).json({ error: "Failed to create expert from deep research v2" });
  }
});

export default router;