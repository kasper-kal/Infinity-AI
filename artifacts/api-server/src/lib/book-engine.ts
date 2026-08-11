/**
 * Book Studio — autonomous book-generation engine.
 *
 * Runs the whole pipeline in the background for one book job, mirroring the
 * Deep Research engine's shape (DB-persisted progress + heartbeat, frontend
 * polls status, push notification when done, stuck jobs resumed on boot).
 *
 * Pipeline, all autonomous after the user approves the chapter plan:
 *   1. GENERATE — the book is written in chunks of `chunk_size` pages
 *     (default 10). Each chunk is a SEPARATE LLM call — a fresh chat — that
 *     receives the chapter plan, the Books/ style samples and the running
 *     manuscript (the growing "book.txt"), and continues the story exactly
 *     where it left off. The manuscript is persisted after every chunk so a
 *     crash/restart resumes from the last completed chunk.
 *   2. CRITIQUE — `critique_passes` (default 2) editorial passes. The full
 *     manuscript + style samples are sent back with "Tell me exactly what to
 *     change"; the model returns the revised manuscript with its changes
 *     applied. Re-run once more with the same prompt (the user's spec).
 *   3. FORMAT  — the final manuscript is rendered to a beautifully typeset
 *     A5 PDF (Times New Roman / Liberation Serif, title page, TOC, chapter
 *     headings, page numbers) via Puppeteer → data/books/<id>.pdf
 *   4. CHECK   — one last LLM final check over the finished text.
 *   5. NOTIFY  — push notification with the download link, then completed.
 *
 * BYO API keys: the key/base URL/model the user pasted into the studio are
 * stored on the job row and used directly for every call. If no BYO creds
 * are set, the job falls back to the shared LLM key pool (runWithLLM).
 */

import OpenAI from "openai";
import { db, bookJobs } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import { logger } from "./logger";
import { notifyAll } from "./web-push";
import { runWithLLM, LLMAllKeysCoolingError } from "./llm-client";
import { loadBookSamples, samplesToPrompt, type BookStyleSample } from "./book-samples";

/** Words per page used to size a chunk's target length. */
const DEFAULT_WORDS_PER_PAGE = 250;
/** Max characters of manuscript sent to the model in one chunk request. */
const MAX_MANUSCRIPT_CHARS = 110_000;
/** How many chars of the oldest text to keep as a compressed recap. */
const RECAP_KEEP_CHARS = 20_000;
/** Retry an LLM call this many times with backoff before failing the job. */
const LLM_RETRIES = 4;
const RETRY_DELAY_MS = 8000;
/** Heartbeat older than this means the job is stuck and can be resumed. */
const STALE_HEARTBEAT_MS = 10 * 60_000;

/* ── Plan types ───────────────────────────────────────────────────────── */

export interface BookChapter {
  title: string;
  summary: string;
  pages: number;
}
export interface BookPlan {
  title: string;
  summary: string;
  chapters: BookChapter[];
}

export function parsePlan(raw: string): BookPlan {
  try {
    const p = JSON.parse(raw) as BookPlan;
    if (!p || !Array.isArray(p.chapters)) throw new Error("bad plan");
    return p;
  } catch {
    return { title: "Untitled book", summary: "", chapters: [] };
  }
}

/* ── Job state helpers ─────────────────────────────────────────────────── */

async function getJob(id: string) {
  const [job] = await db.select().from(bookJobs).where(eq(bookJobs.id, id));
  return job ?? null;
}

async function patch(id: string, values: Partial<typeof bookJobs.$inferInsert>): Promise<void> {
  await db.update(bookJobs).set(values).where(eq(bookJobs.id, id));
}

async function appendLog(id: string, line: string): Promise<void> {
  const job = await getJob(id);
  if (!job) return;
  const log = `${job.log}${job.log ? "\n" : ""}[${new Date().toLocaleTimeString("en-GB")}] ${line}`;
  await patch(id, { log: log.slice(-30_000), heartbeatAt: new Date() });
}

/* ── LLM call with BYO fallback ────────────────────────────────────────── */

async function callLLM(
  job: NonNullable<Awaited<ReturnType<typeof getJob>>>,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const temperature = opts.temperature ?? 0.7;
  const maxTokens = opts.maxTokens ?? 6000;

  // Capture BYO creds up front so TS keeps the null-checks across the closure.
  const byo = job.apiKey && job.baseUrl && job.model ? { apiKey: job.apiKey, baseUrl: job.baseUrl, model: job.model } : null;
  const attempt = (): Promise<string> =>
    byo
      ? (async () => {
          const client = new OpenAI({ apiKey: byo.apiKey, baseURL: byo.baseUrl });
          const completion = await client.chat.completions.create({
            model: byo.model,
            messages,
            temperature,
            max_tokens: maxTokens,
          });
          return completion.choices[0]?.message?.content ?? "";
        })()
      : runWithLLM((client, model) =>
          client.chat.completions
            .create({ model, messages, temperature, max_tokens: maxTokens })
            .then((c) => c.choices[0]?.message?.content ?? ""),
        );

  let lastErr: unknown = null;
  for (let attemptNo = 0; attemptNo < LLM_RETRIES; attemptNo++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      await appendLog(job.id, `LLM call failed (attempt ${attemptNo + 1}/${LLM_RETRIES}): ${(err as Error)?.message?.slice(0, 200) ?? err}`);
      if (attemptNo < LLM_RETRIES - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ── The pipeline ───────────────────────────────────────────────────────── */

const BOOK_SYSTEM_PROMPT = `You are the author of a book being written in a Book Studio. You write ONLY the book's narrative prose — no commentary, no meta-narration, no notes to the author, no markdown fences.

Your rules:
- Write in the book's specified language.
- Match the tone, voice and texture of the provided style samples — study them before you write.
- Follow the chapter plan closely, but let the story breathe naturally.
- Continue EXACTLY where the manuscript ends. Never repeat earlier events, never restart the scene, never summarize what came before.
- Start a new chapter with a line exactly in the form:  ## Chapter N — Title
- Keep paragraphs flowing; use normal prose paragraphs, not bullet lists.
- Output only the requested number of words of story — do not include headers like "CONTINUING" or any other scaffolding.`;

/** Build the context block (plan + samples + running manuscript) for a call. */
function contextBlock(plan: BookPlan, samples: BookStyleSample[], manuscript: string): string {
  const chapters = plan.chapters
    .map((c, i) => `${i + 1}. ${c.title} (${c.pages} pages) — ${c.summary}`)
    .join("\n");
  const samplesText = samplesToPrompt(samples);

  let ms = manuscript;
  if (ms.length > MAX_MANUSCRIPT_CHARS) {
    const head = ms.slice(0, RECAP_KEEP_CHARS);
    const tail = ms.slice(-RECAP_KEEP_CHARS);
    ms = `${head}\n\n[... the middle of the book is compressed for context; continue from here ...]\n\n${tail}`;
  }

  return `## BOOK PLAN\nTitle: ${plan.title}\n\nSummary: ${plan.summary}\n\nChapters:\n${chapters}\n\n## STYLE SAMPLES\n${samplesText}\n\n## MANUSCRIPT SO FAR\n${ms}`;
}

/** Estimate pages already in the manuscript. */
function manuscriptPages(job: NonNullable<Awaited<ReturnType<typeof getJob>>>): number {
  const wpp = job.wordsPerPage || DEFAULT_WORDS_PER_PAGE;
  const words = (job.manuscript || "").split(/\s+/).filter(Boolean).length;
  return Math.round(words / wpp);
}

/** Generate the next chunk of pages. Returns the new chunk text. */
async function generateChunk(job: NonNullable<Awaited<ReturnType<typeof getJob>>>, plan: BookPlan, samples: BookStyleSample[]): Promise<string> {
  const chunkSize = job.chunkSize || 10;
  const wpp = job.wordsPerPage || DEFAULT_WORDS_PER_PAGE;
  const pagesSoFar = manuscriptPages(job);
  const fromPage = pagesSoFar + 1;
  const toPage = Math.min(job.pageCount, fromPage + chunkSize - 1);
  const targetWords = (toPage - fromPage + 1) * wpp;
  const maxTokens = Math.ceil(targetWords * 1.5) + 500;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: BOOK_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `${contextBlock(plan, samples, job.manuscript || "")}\n\n` +
        `## YOUR TASK\nWrite pages ${fromPage}–${toPage} of the book (approximately ${targetWords} words). ` +
        `This is the next ${toPage - fromPage + 1} page(s) of the story. Continue seamlessly from the manuscript above. ` +
        `Write ONLY the new story text, nothing else.`,
    },
  ];

  return (await callLLM(job, messages, { temperature: 0.8, maxTokens })).trim();
}

/** Run one editorial critique pass. Returns the revised manuscript. */
async function critiquePass(job: NonNullable<Awaited<ReturnType<typeof getJob>>>, plan: BookPlan, samples: BookStyleSample[], pass: number): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are an expert developmental editor working on a finished manuscript. ` +
        `You have read the author's chapter plan and the style samples they were writing against. ` +
        `Your job: "Tell me exactly what to change" — then APPLY those changes and return the FULL revised manuscript. ` +
        `Improve prose quality, pacing, dialogue, continuity, and character voice. Fix any gaps or repeated passages. ` +
        `Keep the same story, structure and chapter count. Output ONLY the complete revised manuscript text — ` +
        `the whole book, every chapter — with no commentary.`,
    },
    {
      role: "user",
      content:
        `${contextBlock(plan, samples, job.manuscript || "")}\n\n` +
        `## EDITORIAL PASS ${pass}\n` +
        `Tell me exactly what to change, then return the full revised manuscript with those changes applied. ` +
        `Preserve the chapter headings (## Chapter N — Title). Output ONLY the revised manuscript.`,
    },
  ];

  return (await callLLM(job, messages, { temperature: 0.4, maxTokens: 16_000 })).trim();
}

/** Final check pass over the finished manuscript. Returns a short verdict. */
async function finalCheck(job: NonNullable<Awaited<ReturnType<typeof getJob>>>, plan: BookPlan): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are a meticulous final proofreader for a book about to be published. ` +
        `Check the manuscript for: completeness (does it reach a satisfying ending?), continuity, ` +
        `unfinished sentences, repeated passages, and whether every chapter from the plan appears. ` +
        `Give a short verdict (2-5 sentences) plus, if you find a critical issue, the single most important fix. ` +
        `Do not rewrite the book.`,
    },
    {
      role: "user",
      content:
        `## BOOK PLAN\nTitle: ${plan.title}\nChapters:\n${plan.chapters.map((c, i) => `${i + 1}. ${c.title}`).join("\n")}\n\n` +
        `## MANUSCRIPT\n${(job.manuscript || "").slice(-60_000)}`,
    },
  ];

  return (await callLLM(job, messages, { temperature: 0.2, maxTokens: 1200 })).trim();
}

/* ── PDF rendering ─────────────────────────────────────────────────────── */

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Split manuscript into {heading?, paragraphs[]} blocks at "## Chapter N" lines. */
function splitChapters(manuscript: string): Array<{ heading: string; body: string[] }> {
  const lines = manuscript.split("\n");
  const blocks: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } = { heading: "", body: [] };
  const flush = () => {
    current.body = current.body.filter((p) => p.trim());
    if (current.heading || current.body.length) blocks.push(current);
    current = { heading: "", body: [] };
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      flush();
      current.heading = m[1].trim();
    } else if (line.trim()) {
      current.body.push(line.trim());
    }
  }
  flush();
  return blocks.filter((b) => b.body.length > 0);
}

/** Build the full typeset HTML document for the A5 PDF. */
export function buildBookHtml(plan: BookPlan, manuscript: string): string {
  const blocks = splitChapters(manuscript);
  const toc = plan.chapters
    .map((c, i) => `<div class="toc-row"><span class="toc-num">${i + 1}.</span><span class="toc-title">${escHtml(c.title)}</span></div>`)
    .join("");

  const body =
    blocks.length > 0
      ? blocks
          .map(
            (b) =>
              (b.heading ? `<h2 class="chapter-title">${escHtml(b.heading)}</h2>` : "") +
              b.body.map((p) => `<p class="para">${escHtml(p)}</p>`).join(""),
          )
          .join("\n")
      : (manuscript || "")
          .split(/\n{2,}/)
          .map((p) => `<p class="para">${escHtml(p.trim())}</p>`)
          .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @page { size: A5; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", "Liberation Serif", Georgia, "Nimbus Roman No9 L", serif;
    font-size: 11.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    text-align: justify;
  }
  .title-page { text-align: center; page-break-after: always; padding-top: 40mm; }
  .title-page .title { font-size: 30pt; font-weight: 700; letter-spacing: 0.01em; line-height: 1.15; margin-bottom: 10mm; }
  .title-page .subtitle { font-size: 13pt; color: #444; font-style: italic; }
  .title-page .rule { width: 45mm; height: 0.6mm; background: #111; margin: 14mm auto; }
  .title-page .credit { font-size: 10pt; color: #666; margin-top: 20mm; }
  .toc-page { page-break-after: always; }
  .toc-heading { font-size: 16pt; font-weight: 700; text-align: center; margin-bottom: 8mm; }
  .toc-row { display: flex; gap: 4mm; margin-bottom: 3mm; font-size: 11pt; }
  .toc-num { min-width: 8mm; color: #555; }
  .toc-title { font-weight: 400; }
  .chapter-title {
    font-size: 17pt; font-weight: 700; text-align: center;
    margin: 0 0 8mm 0; page-break-before: always;
  }
  .para { margin: 0 0 4mm 0; text-indent: 8mm; orphans: 3; widows: 3; }
  .page-footer { font-size: 9pt; color: #666; }
</style>
</head><body>
  <div class="title-page">
    <div class="title">${escHtml(plan.title)}</div>
    <div class="rule"></div>
    <div class="subtitle">${escHtml(plan.summary || "A book written with Jarvis")}</div>
    <div class="credit">Generated with Jarvis · Book Studio</div>
  </div>
  <div class="toc-page">
    <div class="toc-heading">Contents</div>
    ${toc}
  </div>
  ${body}
</body></html>`;
}

/** Render the HTML to an A5 PDF via Puppeteer, write it to data/books/. */
export async function renderPdf(jobId: string, html: string): Promise<string> {
  const root = findRepoRoot();
  const dir = path.join(root, "data", "books");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${jobId}.pdf`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: out,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="font-family: Georgia, serif; font-size:8pt; color:#666; width:100%; text-align:center;">' +
        '<span class="pageNumber"></span></div>',
      margin: { top: "20mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    return out;
  } finally {
    await browser.close();
  }
}

/** Walk up from the server CWD to the repo root (pnpm-workspace.yaml anchor). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/* ── The runner ────────────────────────────────────────────────────────── */

/**
 * Run (or resume) a book job to completion. Idempotent: on every loop it
 * re-reads the job, derives the next stage from persisted state, and only
 * advances what is missing. Safe to call multiple times.
 */
export async function runBookJob(id: string): Promise<void> {
  let job = await getJob(id);
  if (!job) return;
  if (job.status === "cancelled") return;
  await patch(id, { status: "running", startedAt: job.startedAt ?? new Date(), error: null });

  const plan = parsePlan(job.plan);
  const samples = loadSamples(job.samples);

  try {
    // ── GENERATE ──
    await appendLog(id, `Writing ${job.pageCount} pages (${job.chunkSize}-page chunks) in ${job.language || "en"}…`);
    while (manuscriptPages(job) < job.pageCount) {
      // Re-read the job every iteration so a cancel request actually stops us.
      const fresh = await getJob(id);
      if (!fresh || fresh.status === "cancelled") return;
      job = fresh;

      const pages = manuscriptPages(job);
      const chunk = await generateChunk(job, plan, samples);
      if (!chunk) {
        await patch(id, { status: "failed", error: "LLM returned empty text", completedAt: new Date() });
        await notifyAll("Book failed", `The book "${plan.title}" failed during generation.`, `/`);
        return;
      }
      const manuscript = `${job.manuscript || ""}${job.manuscript ? "\n\n" : ""}${chunk}`;
      const nextPages = manuscriptPages(job);
      await patch(id, {
        manuscript,
        progress: Math.min(60, Math.round((nextPages / job.pageCount) * 60)),
        phase: `Writing pages ${pages + 1}–${Math.min(job.pageCount, pages + (job.chunkSize || 10))}`,
        heartbeatAt: new Date(),
      });
      job.manuscript = manuscript;
      await appendLog(id, `Chunk done — manuscript now ${manuscript.split(/\s+/).filter(Boolean).length} words (~${nextPages} pages).`);
    }

    // Refresh after the loop (status may have changed mid-run).
    job = (await getJob(id)) ?? job;
    if (job.status === "cancelled") return;
    await patch(id, { progress: 60, phase: "Assembling chapters…", heartbeatAt: new Date() });

    // ── CRITIQUE passes ──
    const passes = job.critiquePasses || 2;
    for (let pass = 1; pass <= passes; pass++) {
      job = (await getJob(id)) ?? job;
      if (job.status === "cancelled") return;
      await patch(id, { phase: `Editorial pass ${pass}/${passes} — "Tell me exactly what to change"`, heartbeatAt: new Date() });
      await appendLog(id, `Editorial pass ${pass}/${passes} running…`);
      const revised = await critiquePass(job, plan, samples, pass);
      if (revised) {
        job.manuscript = revised;
        await patch(id, { manuscript: revised, progress: 60 + Math.round((pass / passes) * 20), heartbeatAt: new Date() });
      }
      await appendLog(id, `Editorial pass ${pass}/${passes} complete.`);
    }

    job = (await getJob(id)) ?? job;
    if (job.status === "cancelled") return;
    await patch(id, { progress: 80, phase: "Typesetting A5 PDF…", heartbeatAt: new Date() });
    await appendLog(id, "Rendering the A5 PDF (Times New Roman, title page, TOC, page numbers)…");
    const pdfPath = await renderPdf(id, buildBookHtml(plan, job.manuscript || ""));
    const pdfName = path.basename(pdfPath);
    await patch(id, { pdfFile: pdfName, progress: 88, phase: "Final check…", heartbeatAt: new Date() });

    // ── FINAL CHECK ──
    const verdict = await finalCheck(job, plan);
    await appendLog(id, `Final check: ${verdict.slice(0, 400)}`);

    job = (await getJob(id)) ?? job;
    if (job.status === "cancelled") return;
    await patch(id, {
      status: "completed",
      progress: 100,
      phase: "Your book is ready 🎉",
      completedAt: new Date(),
      heartbeatAt: new Date(),
    });
    await appendLog(id, "Book complete.");

    await notifyAll(
      `Your book "${plan.title}" is ready 📚`,
      `Download the A5 PDF and the manuscript from the Book Studio.`,
      `/`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ jobId: id, err }, "Book job failed");
    await patch(id, { status: "failed", error: msg.slice(0, 2000), completedAt: new Date() });
    await appendLog(id, `Job failed: ${msg.slice(0, 300)}`);
    await notifyAll("Book failed", `The book "${plan.title}" could not be finished.`, `/`).catch(() => {});
  }
}

function loadSamples(raw: string): BookStyleSample[] {
  try {
    const arr = JSON.parse(raw) as BookStyleSample[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Kick off a job in the background. Never awaited by the caller. */
export function startBookJob(id: string): void {
  void runBookJob(id);
}

/** Resume any running jobs left mid-flight by a server restart (fire-and-forget). */
export function recoverStuckBookJobs(): void {
  const threshold = new Date(Date.now() - STALE_HEARTBEAT_MS);
  void (async () => {
    try {
      const stuck = await db
        .select()
        .from(bookJobs)
        .where(or(eq(bookJobs.status, "running"), eq(bookJobs.status, "queued")))
        .catch(() => []);
      for (const job of stuck) {
        if (!job.heartbeatAt || job.heartbeatAt < threshold) {
          logger.info({ jobId: job.id }, "Resuming stuck book job");
          startBookJob(job.id);
        }
      }
    } catch (err) {
      logger.warn({ err }, "Book job recovery scan failed");
    }
  })();
}
