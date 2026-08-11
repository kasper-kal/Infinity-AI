/**
 * Book Studio routes.
 *
 * Flow: the user types an idea → POST /book/plan returns a chapter plan →
 * the user approves it OR asks for changes (POST /book/plan/review) →
 * approved → POST /book/jobs creates a background job that writes the book,
 * critiques it, typesets the A5 PDF and push-notifies when done.
 *
 * BYO API keys are pasted into the studio and stored on the job row; they are
 * NEVER returned to the client (masked in every response). If no BYO creds are
 * given, the job falls back to the shared key pool.
 */
import { Router } from "express";
import { db, bookJobs } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  startBookJob,
  recoverStuckBookJobs,
  generatePlan,
  replanPlan,
  findRepoRoot,
  parsePlan,
  type BookPlan,
  type ByoCreds,
} from "../../lib/book-engine";
import { loadBookSamples } from "../../lib/book-samples";

const router = Router();

// Resume any jobs left mid-flight by a server restart (fire-and-forget).
recoverStuckBookJobs();

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Never let the raw BYO key leave the server. */
function maskJob(job: typeof bookJobs.$inferSelect) {
  return { ...job, apiKey: job.apiKey ? `••••${job.apiKey.slice(-4)}` : null };
}

function parseByo(body: Record<string, unknown>): ByoCreds | null | undefined {
  const b = body.byo as { apiKey?: unknown; baseUrl?: unknown; model?: unknown } | null | undefined;
  if (!b || typeof b !== "object") return undefined;
  if (typeof b.apiKey !== "string" || !b.apiKey.trim()) return null;
  if (typeof b.baseUrl !== "string" || !b.baseUrl.trim()) return null;
  if (typeof b.model !== "string" || !b.model.trim()) return null;
  return { apiKey: b.apiKey.trim(), baseUrl: b.baseUrl.trim(), model: b.model.trim() };
}

const clampInt = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};

/* ── Plan (idea → chapters, before any job exists) ─────────────────────── */

/** Turn an idea into a chapter plan. */
router.post("/book/plan", async (req, res) => {
  try {
    const idea = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
    if (!idea) {
      res.status(400).json({ error: "idea is required" });
      return;
    }
    if (idea.length > 8000) {
      res.status(400).json({ error: "idea is too long (max 8000 chars)" });
      return;
    }
    const language = typeof req.body?.language === "string" && req.body.language.trim() ? req.body.language.trim().slice(0, 20) : "en";
    const pageCount = clampInt(req.body?.pageCount, 120, 10, 1000);
    const byo = parseByo(req.body ?? {});

    const samples = await loadBookSamples();
    const plan = await generatePlan({ idea, language, pageCount, samples, byo: byo ?? null });

    if (!plan.chapters.length) {
      res.status(502).json({ error: "The planner could not produce a valid chapter plan. Please try again." });
      return;
    }
    req.log.info({ chapters: plan.chapters.length }, "Book plan generated");
    res.json({ plan });
  } catch (err) {
    req.log.error({ err }, "Failed to generate book plan");
    res.status(500).json({ error: (err as Error)?.message?.slice(0, 300) ?? "Failed to generate book plan" });
  }
});

/** Re-plan when the user asks to change something. */
router.post("/book/plan/review", async (req, res) => {
  try {
    const idea = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
    const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim() : "";
    if (!idea || !feedback) {
      res.status(400).json({ error: "idea and feedback are required" });
      return;
    }
    if (feedback.length > 2000) {
      res.status(400).json({ error: "feedback is too long (max 2000 chars)" });
      return;
    }
    const language = typeof req.body?.language === "string" && req.body.language.trim() ? req.body.language.trim().slice(0, 20) : "en";
    const pageCount = clampInt(req.body?.pageCount, 120, 10, 1000);
    const byo = parseByo(req.body ?? {});
    const current = parsePlan(typeof req.body?.plan === "string" ? req.body.plan : JSON.stringify(req.body?.plan ?? {}));

    const samples = await loadBookSamples();
    const plan = await replanPlan({ idea, language, pageCount, samples, byo: byo ?? null, current, feedback });

    if (!plan.chapters.length) {
      res.status(502).json({ error: "The planner could not apply your changes. Please try again." });
      return;
    }
    res.json({ plan });
  } catch (err) {
    req.log.error({ err }, "Failed to revise book plan");
    res.status(500).json({ error: (err as Error)?.message?.slice(0, 300) ?? "Failed to revise book plan" });
  }
});

/** Describe the style samples Books/ currently holds (metadata only, no excerpts). */
router.get("/book/samples", async (req, res) => {
  try {
    const samples = await loadBookSamples();
    res.json(
      samples.map((s) => ({
        file: s.file,
        kind: s.kind,
        language: s.language,
        chars: s.chars,
        error: s.error ?? null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list book samples");
    res.status(500).json({ error: "Failed to list book samples" });
  }
});

/* ── Jobs ──────────────────────────────────────────────────────────────── */

/** Create a book job from an approved plan and start the pipeline. */
router.post("/book/jobs", async (req, res) => {
  try {
    const idea = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
    if (!idea) {
      res.status(400).json({ error: "idea is required" });
      return;
    }
    const plan = parsePlan(typeof req.body?.plan === "string" ? req.body.plan : JSON.stringify(req.body?.plan ?? {}));
    if (!plan.chapters.length) {
      res.status(400).json({ error: "a valid plan is required" });
      return;
    }
    const language = typeof req.body?.language === "string" && req.body.language.trim() ? req.body.language.trim().slice(0, 20) : "en";
    const pageCount = clampInt(req.body?.pageCount, 120, 10, 1000);
    const wordsPerPage = clampInt(req.body?.wordsPerPage, 250, 100, 400);
    const chunkSize = clampInt(req.body?.chunkSize, 10, 1, 50);
    const critiquePasses = clampInt(req.body?.critiquePasses, 2, 0, 3);
    const byo = parseByo(req.body ?? {});

    const samples = await loadBookSamples();
    const [job] = await db
      .insert(bookJobs)
      .values({
        title: plan.title || "Untitled book",
        idea,
        language,
        pageCount,
        wordsPerPage,
        chunkSize,
        critiquePasses,
        status: "queued",
        phase: "Queued…",
        plan: JSON.stringify(plan),
        samples: JSON.stringify(samples.filter((s) => s.excerpt).map((s) => ({ file: s.file, kind: s.kind, language: s.language, excerpt: s.excerpt, chars: s.chars }))),
        apiKey: byo?.apiKey ?? null,
        baseUrl: byo?.baseUrl ?? null,
        model: byo?.model ?? null,
      })
      .returning();

    void startBookJob(job.id);
    req.log.info({ jobId: job.id, pages: pageCount }, "Book job started");
    res.json(maskJob(job));
  } catch (err) {
    req.log.error({ err }, "Failed to start book job");
    res.status(500).json({ error: "Failed to start book job" });
  }
});

/** List all book jobs, newest first. */
router.get("/book/jobs", async (req, res) => {
  try {
    const jobs = await db.select().from(bookJobs).orderBy(desc(bookJobs.createdAt));
    res.json(jobs.map(maskJob));
  } catch (err) {
    req.log.error({ err }, "Failed to list book jobs");
    res.status(500).json({ error: "Failed to list book jobs" });
  }
});

/** Get a single book job. */
router.get("/book/jobs/:id", async (req, res) => {
  try {
    const [job] = await db.select().from(bookJobs).where(eq(bookJobs.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Book job not found" });
      return;
    }
    res.json(maskJob(job));
  } catch (err) {
    req.log.error({ err }, "Failed to get book job");
    res.status(500).json({ error: "Failed to get book job" });
  }
});

/** Cancel a queued or running book job. */
router.post("/book/jobs/:id/cancel", async (req, res) => {
  try {
    const [job] = await db.select().from(bookJobs).where(eq(bookJobs.id, req.params.id));
    if (!job) {
      res.status(404).json({ error: "Book job not found" });
      return;
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      res.json({ ok: true, status: job.status });
      return;
    }
    await db.update(bookJobs).set({ status: "cancelled" }).where(eq(bookJobs.id, job.id));
    res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel book job");
    res.status(500).json({ error: "Failed to cancel book job" });
  }
});

/** Download the finished A5 PDF. */
router.get("/book/jobs/:id/pdf", async (req, res) => {
  try {
    const [job] = await db.select().from(bookJobs).where(eq(bookJobs.id, req.params.id));
    if (!job || !job.pdfFile) {
      res.status(404).json({ error: "PDF not ready yet" });
      return;
    }
    const filePath = path.join(findRepoRoot(), "data", "books", job.pdfFile);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: "PDF file is missing" });
      return;
    }
    const safe = (job.title || "book").replace(/[^\w\- ]/g, "").replace(/\s+/g, "-").slice(0, 60);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.pdf"`);
    res.sendFile(filePath);
  } catch (err) {
    req.log.error({ err }, "Failed to serve book PDF");
    res.status(500).json({ error: "Failed to serve book PDF" });
  }
});

export default router;
