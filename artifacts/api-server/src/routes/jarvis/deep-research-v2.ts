/**
 * Deep Research v2 API Routes
 *
 * POST   /api/jarvis/deep-research-v2          → start new research job
 * GET    /api/jarvis/deep-research-v2/:id      → get job status/report
 * GET    /api/jarvis/deep-research-v2          → list all jobs
 * GET    /api/jarvis/deep-research-v2/:id/stream  → SSE progress stream
 * POST   /api/jarvis/deep-research-v2/:id/expert → create expert from report
 */

import { Router, Request, Response } from "express";
import {
  startDeepResearch,
  getDeepResearchJob,
  listDeepResearchJobs,
  subscribeToJob,
  type DeepResearchEvent,
  type DeepResearchJob,
  buildExpertPromptFromReport,
} from "../../lib/deep-research-v2.js";
import { logger } from "../../lib/logger.js";

const router = Router();

/* ────────────────────────────────────────────────────────────────
 * SSE Helpers
 * ──────────────────────────────────────────────────────────────── */

function sendSSE(res: Response, event: DeepResearchEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function setupSSE(res: Response): () => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write("event: open\ndata: {}\n\n");
  return () => res.end();
}

/* ────────────────────────────────────────────────────────────────
 * POST /api/jarvis/deep-research-v2  —  Start new research job
 * ──────────────────────────────────────────────────────────────── */

router.post("/", async (req: Request, res: Response) => {
  try {
    const { topic } = req.body as { topic?: string };
    if (!topic || !topic.trim()) {
      return res.status(400).json({ error: "topic is required" });
    }
    const agent = startDeepResearch(topic.trim());
    return res.status(202).json({ jobId: agent.getId() });
  } catch (err) {
    logger.error({ err }, "Deep Research v2 start failed");
    return res.status(500).json({ error: "Failed to start research" });
  }
});

/* ────────────────────────────────────────────────────────────────
 * GET /api/jarvis/deep-research-v2  —  List all jobs
 * ──────────────────────────────────────────────────────────────── */

router.get("/", (_req: Request, res: Response) => {
  const jobs = listDeepResearchJobs().map((j) => ({
    id: j.id,
    topic: j.topic,
    status: j.status,
    phase: j.phase,
    progress: j.progress,
    sourcesFound: j.sourcesFound,
    pagesRead: j.pagesRead,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  }));
  res.json({ jobs });
});

/* ────────────────────────────────────────────────────────────────
 * GET /api/jarvis/deep-research-v2/:id  —  Get job status/report
 * ──────────────────────────────────────────────────────────────── */

router.get("/:id", (req: Request, res: Response): void => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = getDeepResearchJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(job);
});

/* ────────────────────────────────────────────────────────────────
 * GET /api/jarvis/deep-research-v2/:id/stream  —  SSE progress
 * ──────────────────────────────────────────────────────────────── */

router.get("/:id/stream", (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = getDeepResearchJob(jobId);
  if (!job) {
    res.status(404).end();
    return;
  }

  const cleanup = setupSSE(res);

  // Send current state immediately
  sendSSE(res, { type: "phase", jobId, phase: job.phase, progress: job.progress });
  for (const log of job.log) sendSSE(res, { type: "log", jobId, message: log });
  for (const src of job.sources) sendSSE(res, { type: "source", jobId, source: src });
  if (job.report) sendSSE(res, { type: "complete", jobId, report: job.report });
  if (job.error) sendSSE(res, { type: "error", jobId, error: job.error });

  const unsub = subscribeToJob(jobId, (event) => sendSSE(res, event));

  req.on("close", () => {
    unsub();
    cleanup();
  });
});

/* ────────────────────────────────────────────────────────────────
 * POST /api/jarvis/deep-research-v2/:id/expert  —  Create expert prompt
 * ──────────────────────────────────────────────────────────────── */

router.post("/:id/expert", (req: Request, res: Response): void => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = getDeepResearchJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!job.report) {
    res.status(400).json({ error: "Report not ready" });
    return;
  }

  const expertPrompt = buildExpertPromptFromReport(job);
  const expertName = `Expert: ${job.topic.slice(0, 80)}`;

  // In a full implementation, this would call the expert creation API
  // For now, return the prompt so the frontend can POST to /experts
  res.json({ expertName, systemPrompt: expertPrompt });
});

export default router;