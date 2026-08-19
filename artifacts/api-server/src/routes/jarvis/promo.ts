import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  createPromoJob,
  getPromoJob,
  createPromoVideo,
  listPromoJobs,
  deletePromoJob,
  estimateStepDuration,
} from "../../lib/promo-maker";

const router = Router();

// Validation schemas
const CreatePromoSchema = z.object({
  url: z.string().url("Invalid URL"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  duration: z.number().int().min(5).max(120).default(30),
  style: z.enum(["professional", "energetic", "minimal", "cinematic"]).default("professional"),
  brandKit: z.object({
    colors: z.object({
      primary: z.string(),
      secondary: z.string(),
      accent: z.string(),
      background: z.string(),
      text: z.string(),
    }),
    fonts: z.object({
      heading: z.object({ name: z.string(), url: z.string() }),
      body: z.object({ name: z.string(), url: z.string() }),
    }),
  }).optional(),
});

const JobIdParamSchema = z.object({
  id: z.string().uuid("Invalid job ID"),
});

/**
 * POST /api/jarvis/promo/create
 * Create a new promo video generation job
 */
router.post("/create", async (req: Request, res: Response) => {
  const parsed = CreatePromoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { url, prompt, duration, style, brandKit } = parsed.data;

  try {
    // Start job asynchronously
    const job = createPromoJob(url, prompt, duration, style);

    // Attach brand kit to job if provided
    if (brandKit) {
      job.brandKit = brandKit as any;
    }

    // Run in background (don't await)
    createPromoVideo(url, prompt, duration, style).catch((error) => {
      console.error("[Promo API] Background job failed:", error);
    });

    return res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      message: "Promo video generation started",
    });
  } catch (error) {
    console.error("[Promo API] Create failed:", error);
    return res.status(500).json({ error: "Failed to create promo job" });
  }
});

/**
 * GET /api/jarvis/promo/status/:id
 * Check the status of a promo video generation job
 */
router.get("/status/:id", (req: Request, res: Response) => {
  const parsed = JobIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid job ID", details: parsed.error.flatten() });
  }

  const job = getPromoJob(parsed.data.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  return res.json({
    jobId: job.id,
    url: job.url,
    prompt: job.prompt,
    duration: job.duration,
    style: job.style,
    status: job.status,
    progress: job.progress,
    videoUrl: job.videoPath ? `/api/jarvis/promo/download/${job.id}` : null,
    thumbnailUrl: job.thumbnailPath ? `/api/jarvis/promo/thumbnail/${job.id}` : null,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    script: job.script ? {
      steps: job.script.steps.map(step => ({
        action: step.action,
        description: step.description,
        duration: estimateStepDuration(step),
        section: step.section,
        textStyle: step.textStyle,
        textPosition: step.textPosition,
      })),
      targetDuration: job.script.targetDuration,
    } : null,
  });
});

/**
 * GET /api/jarvis/promo/download/:id
 * Download the generated promo video
 */
router.get("/download/:id", async (req: Request, res: Response) => {
  const parsed = JobIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid job ID", details: parsed.error.flatten() });
  }

  const job = getPromoJob(parsed.data.id);
  if (!job || !job.videoPath) {
    return res.status(404).json({ error: "Video not found or not ready" });
  }

  const { statSync, createReadStream } = await import("fs");
  const { extname } = await import("path");

  try {
    const stat = statSync(job.videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const stream = createReadStream(job.videoPath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "video/mp4",
      });
      stream.pipe(res);
      return;
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
      });
      createReadStream(job.videoPath).pipe(res);
      return;
    }
  } catch (error) {
    console.error("[Promo API] Download failed:", error);
    return res.status(500).json({ error: "Failed to download video" });
  }
});

/**
 * GET /api/jarvis/promo/thumbnail/:id
 * Get the thumbnail for a promo video
 */
router.get("/thumbnail/:id", async (req: Request, res: Response) => {
  const parsed = JobIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid job ID", details: parsed.error.flatten() });
  }

  const job = getPromoJob(parsed.data.id);
  if (!job || !job.thumbnailPath) {
    return res.status(404).json({ error: "Thumbnail not found" });
  }

  const { createReadStream } = await import("fs");
  const { extname } = await import("path");

  try {
    res.setHeader("Content-Type", "image/jpeg");
    createReadStream(job.thumbnailPath).pipe(res);
    return;
  } catch (error) {
    console.error("[Promo API] Thumbnail failed:", error);
    return res.status(500).json({ error: "Failed to serve thumbnail" });
  }
});

/**
 * GET /api/jarvis/promo/jobs
 * List all promo jobs (paginated)
 */
router.get("/jobs", (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const status = req.query.status as string;

  let jobs = listPromoJobs();

  if (status) {
    jobs = jobs.filter(j => j.status === status);
  }

  const total = jobs.length;
  const start = (page - 1) * limit;
  const paginated = jobs.slice(start, start + limit);

  return res.json({
    jobs: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * DELETE /api/jarvis/promo/:id
 * Delete a promo job and its files
 */
router.delete("/:id", (req: Request, res: Response) => {
  const parsed = JobIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid job ID", details: parsed.error.flatten() });
  }

  const deleted = deletePromoJob(parsed.data.id);
  if (!deleted) {
    return res.status(404).json({ error: "Job not found" });
  }

  return res.json({ success: true, message: "Job deleted" });
});

/**
 * POST /api/jarvis/promo/trigger/:id
 * Retry a failed job
 */
router.post("/trigger/:id", async (req: Request, res: Response) => {
  const parsed = JobIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid job ID", details: parsed.error.flatten() });
  }

  const job = getPromoJob(parsed.data.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status !== "failed") {
    return res.status(400).json({ error: "Can only retry failed jobs" });
  }

  // Reset job status and re-run
  const newJob = createPromoJob(job.url, job.prompt, job.duration, job.style);

  // Run in background
  createPromoVideo(job.url, job.prompt, job.duration, job.style).catch((error) => {
    console.error("[Promo API] Retry failed:", error);
  });

  return res.json({
    success: true,
    newJobId: newJob.id,
    message: "Job retry started",
  });
});

export default router;