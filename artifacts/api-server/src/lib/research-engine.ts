/**
 * Deep Research Engine
 * --------------------
 * Runs LONG-RUNNING background research jobs (hours → days, by design).
 *
 * A job is a self-driven loop:
 *   1. PLAN   , the LLM decomposes the goal into many research phases
 *   2. SEARCH , web search (Tavily if a key exists, else free DuckDuckGo HTML)
 *   3. READ   , fetch the top sources and extract readable text (cheerio)
 *   4. SYNTHESIZE, distill each batch into sourced notes appended to the job
 *   5. CRITIQUE, the LLM finds gaps, contradictions and follow-up phases and
 *                 replans, the phase list grows, so there is NO hard limit.
 *   6. Repeat… sleep between phases scales with the chosen depth.
 *
 * When the loop finally converges, the engine writes a deep report and
 * spawns an "expert" conversation, a special chat whose system prompt makes
 * Infinity behave like a 30-year veteran of the researched field.
 *
 * Everything is persisted to Postgres on every step, so the frontend can
 * poll progress and a server restart resumes the job (via recoverStuckJobs).
 *
 * BACKWARD COMPAT: DB column `kind` remains "gem", columns `gem_system_prompt`
 * and `gem_conversation_id`, and API response fields `gemSystemPrompt`/`gemConversationId`
 * are preserved. Internal terminology uses "expert" throughout.
 */

import OpenAI from "openai";
import { db, researchJobs, conversations, messages } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { load as cheerioLoad } from "cheerio";
import { jarvisConfig } from "../config/jarvis";
import { logger } from "./logger";
import { notifyAll } from "./web-push";
import { runWithLLM, LLMAllKeysCoolingError } from "./llm-client";

/**
 * Phase 9: Run a research job synchronously (for scheduler).
 * Creates a research job with the given config and runs it to completion.
 * Returns a summary object.
 */
export async function runResearch(
  query: string,
  depth: "standard" | "deep" | "quantum" | "omni" = "deep",
  sources?: string[]
): Promise<{ summary: string; sources?: string[] }> {
  const title = query.slice(0, 60);

  const [job] = await db
    .insert(researchJobs)
    .values({
      title,
      prompt: query,
      mode: "agent",
      depth,
      // Note: sources parameter would need schema changes to store
    })
    .returning();

  // Run synchronously (await the job)
  await startResearchJob(job.id);

  // Wait for completion
  const waitForCompletion = async (jobId: string): Promise<typeof researchJobs.$inferSelect> => {
    while (true) {
      const [row] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
      if (!row) throw new Error("Job not found");
      if (row.status === "completed") return row;
      if (row.status === "failed" || row.status === "cancelled") {
        throw new Error(`Research job ${row.status}: ${row.error || "Unknown error"}`);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  };

  const completed = await waitForCompletion(job.id);

  return {
    summary: completed.report || completed.notes || "Research completed",
    sources: undefined,
  };
}

const SLEEP_SECONDS: Record<JobDepth, [number, number]> = {
  standard: [30, 75],
  deep: [90, 180],
  quantum: [150, 300],
  omni: [240, 420],
};

const BASE_PHASES: Record<JobDepth, [number, number]> = {
  standard: [10, 16],
  deep: [20, 32],
  quantum: [40, 70],
  omni: [70, 120],
};

/** Per-depth deepening, how many sources per query, pages read, chars per
 *  page, and sources gathered before a phase stops digging. */
const DEPTH_RESULTS: Record<JobDepth, number> = { standard: 5, deep: 6, quantum: 7, omni: 8 };
const DEPTH_READS: Record<JobDepth, number> = { standard: 4, deep: 5, quantum: 6, omni: 8 };
const DEPTH_CHARS: Record<JobDepth, number> = { standard: 8000, deep: 12000, quantum: 16000, omni: 20000 };
const DEPTH_GATHER: Record<JobDepth, number> = { standard: 10, deep: 12, quantum: 14, omni: 16 };

/** Follow-up phases proposed per replan round, the deeper the tier, the more
 *  the research keeps branching out instead of saturating. */
const FOLLOWUP_MAX: Record<JobDepth, number> = { standard: 2, deep: 3, quantum: 4, omni: 5 };

/** Hard ceiling on total phases so a runaway job can't explode, far above
 *  what the tiers normally reach, but bounded. */
const MAX_TOTAL_PHASES: Record<JobDepth, number> = { standard: 40, deep: 120, quantum: 400, omni: 2000 };

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobDepth = "standard" | "deep" | "quantum" | "omni";

/**
 * Rough cost/duration estimate for a research job at a given depth, derived
 * from the real tuning constants above. Shown to the user BEFORE launch so a
 * casual prompt doesn't silently spawn a multi-day, quota-burning job.
 * `workSecPerPhase` is a rough wall-clock guess for search + read + synthesize
 * + critique (the sleep between phases is already in SLEEP_SECONDS).
 */
export function estimateJob(depth: JobDepth) {
  const [phasesMin, phasesMax] = BASE_PHASES[depth];
  const [sleepMin, sleepMax] = SLEEP_SECONDS[depth];
  const searchesPerPhase = DEPTH_RESULTS[depth];
  const workSecPerPhase = 45;
  const totalSecMin = phasesMin * (sleepMin + workSecPerPhase);
  const totalSecMax = phasesMax * (sleepMax + workSecPerPhase);
  return {
    depth,
    phases: { min: phasesMin, max: phasesMax },
    sleepSec: { min: sleepMin, max: sleepMax },
    searches: { min: phasesMin * searchesPerPhase, max: phasesMax * searchesPerPhase },
    totalHours: {
      min: Math.round((totalSecMin / 3600) * 10) / 10,
      max: Math.round((totalSecMax / 3600) * 10) / 10,
    },
  };
}

/** Patch shape accepted by the research_jobs row updater. */
interface JobPatch {
  status?: JobStatus;
  progress?: number;
  phase?: string;
  log?: string;
  notes?: string;
  report?: string;
  // BACKWARD COMPAT: API/DB fields keep "gem" prefix
  gemSystemPrompt?: string;
  gemConversationId?: string;
  phasesCompleted?: number;
  error?: string;
  heartbeatAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/** Jobs currently being processed (prevents double-loops after resume). */
const runningJobs = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** JSON block extractor, the NIM models love markdown fences. */
function extractJson(text: string): string | null {
  if (!text) return null;
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
  return match ? match[0] : null;
}

async function llm(
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const completion = await runWithLLM((client, model) =>
    client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user.slice(0, 60_000) },
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 1200,
    }),
  );
  return completion.choices[0]?.message?.content ?? "";
}

/* ────────────────────────────────────────────────────────────────
 * Web search, Tavily is the primary source; per-query agent-style
 * fallback kicks in when Tavily comes up empty, then the next query
 * resumes on Tavily (hybrid "both" behaviour).
 * ──────────────────────────────────────────────────────────────── */

type SearchResult = { title: string; url: string; snippet: string };
type SearchMode = "agent" | "normal" | "both";

/** Tavily search, primary source. Returns [] when no key, unavailable, or empty. */
async function searchTavily(query: string, maxResults: number): Promise<SearchResult[]> {
  const tavilyKey = process.env["TAVILY_API_KEY"] ?? process.env["WEB_SEARCH_API_KEY"];
  if (!tavilyKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        search_depth: "advanced",
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: r.title ?? r.url ?? "",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 400),
      }));
  } catch {
    return [];
  }
}

/** Free DuckDuckGo HTML endpoint (no key needed), best effort. */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerioLoad(html);
    const results: SearchResult[] = [];
    $(".result").each((_, el) => {
      if (results.length >= maxResults) return;
      const link = $(el).find("a.result__a").first();
      const url = link.attr("href") ?? "";
      if (!url) return;
      // DDG wraps links in a redirect, decode the uddg parameter if present
      let finalUrl = url;
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) {
        try { finalUrl = decodeURIComponent(uddg[1]); } catch { /* keep original */ }
      }
      const title = link.text().trim();
      const snippet = $(el).find(".result__snippet").first().text().trim();
      if (title && finalUrl) results.push({ title, url: finalUrl, snippet: snippet.slice(0, 400) });
    });
    return results;
  } catch {
    return [];
  }
}

/**
 * Hybrid web search, evaluated per query:
 *  1. Tavily first (cheap + high quality), the "continues on Tavily" part.
 *  2. If Tavily returns NOTHING for this specific query, switch to agent mode
 *     for that query only: try DuckDuckGo, then a couple of reformulations.
 *  3. The next query starts over on Tavily, so one dead end never derails the
 *     rest of the research.
 */
async function searchWeb(query: string, maxResults: number, mode: SearchMode = "both"): Promise<SearchResult[]> {
  const tavily = await searchTavily(query, maxResults);
  if (tavily.length > 0) return tavily;

  // Tavily found nothing for this query → agent-style persistence (agent + both modes).
  if (mode === "agent" || mode === "both") {
    const variants = [
      query,
      `${query} 2026`,
      query.replace(/[()"'“”‘’]/g, "").slice(0, 120),
    ];
    for (const variant of variants) {
      const found = await searchDuckDuckGo(variant, maxResults);
      if (found.length > 0) return found;
      await sleep(600 + Math.random() * 900);
    }
    return [];
  }

  // Normal mode: a single DDG retry, then give up on this query.
  return searchDuckDuckGo(query, maxResults);
}

/** Fetch a page and return readable text (cheerio extraction, best effort). */
async function readPage(url: string, maxChars = 6000): Promise<string> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "";
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text/plain")) return "";
    const html = await res.text();
    if (html.length > 2_000_000) return "";
    const $ = cheerioLoad(html);
    $("script, style, noscript, svg, nav, footer, header, form, iframe, [aria-hidden='true']").remove();
    return $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
  } catch {
    return "";
  }
}

/* ────────────────────────────────────────────────────────────────
 * Job persistence helpers
 * ──────────────────────────────────────────────────────────────── */

async function updateJob(jobId: string, patch: JobPatch): Promise<void> {
  await db.update(researchJobs).set(patch).where(eq(researchJobs.id, jobId));
}

async function appendLog(jobId: string, line: string): Promise<void> {
  const stamp = new Date().toISOString().slice(11, 19);
  const rows = await db.select({ log: researchJobs.log }).from(researchJobs).where(eq(researchJobs.id, jobId));
  const current = rows[0]?.log ?? "";
  const next = `${current}${current ? "\n" : ""}[${stamp}] ${line}`.slice(-200_000);
  await updateJob(jobId, { log: next, heartbeatAt: new Date() });
}

async function appendNotes(jobId: string, chunk: string): Promise<void> {
  const rows = await db.select({ notes: researchJobs.notes }).from(researchJobs).where(eq(researchJobs.id, jobId));
  const current = rows[0]?.notes ?? "";
  const next = `${current}${current ? "\n\n" : ""}${chunk}`.slice(-400_000);
  await updateJob(jobId, { notes: next });
}

/* ────────────────────────────────────────────────────────────────
 * Phase helpers
 * ──────────────────────────────────────────────────────────────── */

interface Phase {
  title: string;
  description: string;
  queries: string[];
}

interface JobMeta {
  prompt: string;
  title: string;
  mode: string;
  depth: JobDepth;
}

async function planPhases(job: JobMeta, resumeNotes: string): Promise<Phase[]> {
  const [minPhases, maxPhases] = BASE_PHASES[job.depth] ?? BASE_PHASES.deep;
  const system =
    "You are the research planner for a very deep autonomous research system. " +
    "You decompose a research goal into a comprehensive list of phases. Each phase must have a title, a one-line description, and 2-4 specific search queries. " +
    "Think like a world-class researcher: cover fundamentals, state of the art, controversies, experts, primary sources, history, future directions, and practical implications. " +
    "Return ONLY valid JSON, an array of objects: [{\"title\": string, \"description\": string, \"queries\": string[]}].";
  const user =
    `Research goal: ${job.prompt}\n` +
    `Mode: ${
      job.mode === "agent"
        ? "agent (full autonomy, explore tangents, verify claims)"
        : job.mode === "both"
          ? "both (hybrid, Tavily-first, with automatic agent-mode fallback whenever a specific query comes up empty)"
          : "normal (focused)"
    }\n` +
    `Target number of phases: between ${minPhases} and ${maxPhases}. More phases = deeper research.\n` +
    (resumeNotes ? `\nResearch already completed so far, plan the REMAINING phases to go even deeper, not repeats:\n${resumeNotes.slice(-40_000)}` : "");
  try {
    const raw = await llm(system, user, { maxTokens: 6000, temperature: 0.5 });
    const json = extractJson(raw);
    if (!json) return [];
    const parsed = JSON.parse(json) as Phase[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.title === "string" && Array.isArray(p.queries))
      .slice(0, maxPhases + 20)
      .map((p) => ({
        title: String(p.title).slice(0, 200),
        description: String(p.description ?? "").slice(0, 500),
        queries: p.queries.slice(0, 4).map((q) => String(q).slice(0, 300)),
      }));
  } catch {
    return [];
  }
}

/** Generate follow-up phases based on the critique, this is how a job never truly ends. */
async function proposeFollowups(job: JobMeta, notes: string, gaps: string): Promise<Phase[]> {
  const system =
    "You are an obsessive researcher. Given the gaps found in a research phase, propose 0-3 follow-up phases that would genuinely deepen understanding. " +
    "Return ONLY valid JSON: [{\"title\": string, \"description\": string, \"queries\": string[]}]. Return [] if the topic is fully saturated.";
  const maxFollow = FOLLOWUP_MAX[job.depth] ?? 3;
  const user = `Goal: ${job.prompt}\n\nKnowledge so far (tail):\n${notes.slice(-20_000)}\n\nGaps found:\n${gaps.slice(-8000)}`;
  try {
    const raw = await llm(system, user, { maxTokens: 2500, temperature: 0.6 });
    const json = extractJson(raw);
    if (!json) return [];
    const parsed = JSON.parse(json) as Phase[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.title === "string" && Array.isArray(p.queries))
      .slice(0, maxFollow)
      .map((p) => ({ title: String(p.title).slice(0, 200), description: String(p.description ?? "").slice(0, 500), queries: p.queries.slice(0, 4).map((q) => String(q).slice(0, 300)) }));
  } catch {
    return [];
  }
}

/** Execute one phase: search → read → synthesize → critique. Returns gap summary. */
async function runPhase(
  jobId: string,
  job: JobMeta,
  phase: Phase,
  index: number,
  total: number,
): Promise<{ gapSummary: string; saturated: boolean }> {
  const label = `Phase ${index}/${total}, ${phase.title}`;

  // 1. Gather sources across all queries
  const gathered: { title: string; url: string; snippet: string; text: string }[] = [];
  const seen = new Set<string>();
  const mode = job.mode as SearchMode;
  const maxResults = Math.max(mode === "agent" ? 8 : mode === "both" ? 6 : 5, DEPTH_RESULTS[job.depth] ?? 5);
  const readCount = Math.max(mode === "agent" ? 5 : 4, DEPTH_READS[job.depth] ?? 4);
  const gatherCap = DEPTH_GATHER[job.depth] ?? 10;
  const pageChars = DEPTH_CHARS[job.depth] ?? 8000;
  for (const query of phase.queries) {
    const results = await searchWeb(query, maxResults, mode);
    for (const r of results) {
      if (seen.has(r.url) || gathered.length >= gatherCap) continue;
      seen.add(r.url);
      gathered.push({ ...r, text: "" });
    }
    await sleep(1200 + Math.random() * 2500); // gentle pacing
  }

  // 2. Read the top pages (deeper tiers read more, and read each page deeper)
  for (const item of gathered.slice(0, readCount)) {
    const text = await readPage(item.url, pageChars);
    if (text) item.text = text;
    await sleep(800 + Math.random() * 2000);
  }

  const sourcesText = gathered
    .map((g) => `### ${g.title}\nURL: ${g.url}\nSnippet: ${g.snippet}\n${g.text ? `Content:\n${g.text.slice(0, Math.min(8000, pageChars))}` : "(page unreadable)"}`)
    .join("\n\n");

  // 3. Synthesize
  const synthSystem =
    "You are a senior research analyst. Distill the provided sources into rigorous, well-organized notes for a deep research dossier. " +
    "Use markdown bullets. Cite sources inline as [source: domain]. Note uncertainty, conflicting claims, and missing evidence explicitly. " +
    "Be precise and dense, every bullet should carry real information, not filler.";
  const synthUser =
    `Research goal: ${job.prompt}\nPhase: ${phase.title}\n\nSOURCES:\n${sourcesText.slice(0, 95_000)}`;
  const notesChunk = await llm(synthSystem, synthUser, { maxTokens: 4000, temperature: 0.3 });
  await appendNotes(jobId, `## ${phase.title}\n${notesChunk}`);
  await appendLog(jobId, `Synthesized "${phase.title}" (${gathered.filter((g) => g.text).length} pages read)`);

  // 4. Critique, find gaps for the replanning step
  const critiqueSystem =
    "You are a ruthless research critic. Identify the biggest remaining gaps, contradictions, and untested claims in this research so far. " +
    "Return ONLY valid JSON: {\"gaps\": string, \"saturated\": boolean}.";
  const critiqueUser = `Goal: ${job.prompt}\nPhase: ${phase.title}\n\nLatest notes:\n${notesChunk.slice(-12_000)}`;
  let gapSummary = "Continue exploring adjacent and deeper aspects.";
  let saturated = false;
  try {
    const raw = await llm(critiqueSystem, critiqueUser, { maxTokens: 1200, temperature: 0.4 });
    const json = extractJson(raw);
    if (json) {
      const parsed = JSON.parse(json) as { gaps?: string; saturated?: boolean };
      if (typeof parsed.gaps === "string" && parsed.gaps.trim()) gapSummary = parsed.gaps.trim().slice(0, 4000);
      saturated = parsed.saturated === true;
    }
  } catch { /* keep defaults */ }

  return { gapSummary: saturated ? "" : gapSummary, saturated };
}

/* ────────────────────────────────────────────────────────────────
 * Expert creation
 * ──────────────────────────────────────────────────────────────── */

async function createExpert(
  jobId: string,
  job: JobMeta & { notes: string },
): Promise<{ gemConversationId: string; gemSystemPrompt: string; report: string }> {
  const finalSystem =
    "You are the final synthesis stage of a deep research system. Write the definitive report on the research goal. " +
    "Structure it like a world-class expert monograph: executive summary, fundamentals, state of the art, evidence and sources, " +
    "controversies and open questions, expert perspectives, practical implications, future outlook, and a conclusion. " +
    "Be exhaustively thorough, this is the capstone deliverable of a multi-hour investigation. Use markdown with headings and citations [source: domain]. " +
    "Then, on a separate line, output a JSON block with the identity for the resulting expert: " +
    '{"persona": string (a powerful system-prompt persona of a 30-year veteran expert who can reason like a world authority), "expertise": string (their specialty summary)}. ' +
    "The persona must instruct the expert to: reason rigorously like a senior researcher; use the attached knowledge base as ground truth; stay humble about uncertainty; answer with deep, structured reasoning.";
  const finalUser =
    `Goal: ${job.prompt}\n\nComplete research dossier:\n${job.notes.slice(-120_000)}`;
  const finalRaw = await llm(finalSystem, finalUser, { maxTokens: 6000, temperature: 0.3 });

  // Split report from the persona JSON block
  let report = finalRaw;
  let persona = "";
  const m = finalRaw.match(/\{[^{}]*"persona"[^{}]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as { persona?: string; expertise?: string };
      if (typeof parsed.persona === "string") persona = parsed.persona;
      if (typeof parsed.expertise === "string" && persona) {
        persona = `You are a world-class expert, ${parsed.expertise}, with the depth and judgement of someone who has studied and worked in this field for 30 years.\n\n${persona}`;
      }
      report = finalRaw.replace(m[0], "").trim();
    } catch {
      /* keep everything as report */
    }
  }
  if (!persona) {
    persona =
      `You are a world-class expert on the topic: "${job.title}", with the depth and judgement of someone who has studied and worked in this field for 30 years.\n\n` +
      "Ground every answer in the research dossier attached to this conversation. Reason rigorously, structure your answers, and acknowledge uncertainty honestly.";
  }

  const expertSystemPrompt =
    persona +
    "\n\n== RESEARCH DOSSIER (ground truth, distilled over many hours of investigation) ==\n" +
    job.notes.slice(-80_000) +
    "\n\nRules:\n- Reason like a senior expert: define terms, state assumptions, weigh evidence, then conclude.\n- When the dossier is silent, reason from first principles and say so.\n- Be rigorous, precise, and appropriately humble about uncertainty.\n- Format long answers with clear markdown structure.";

  // Create the expert conversation + seed messages
  const [conv] = await db
    .insert(conversations)
    .values({ title: `🧠 ${job.title.slice(0, 120)}`, kind: "gem", systemPrompt: expertSystemPrompt })
    .returning();
  await db.insert(messages).values([
    { conversationId: conv.id, role: "user", content: job.prompt },
    { conversationId: conv.id, role: "assistant", content: report },
  ]);
  await appendLog(jobId, `Expert chat created (${conv.id}).`);
  return { gemConversationId: conv.id, gemSystemPrompt: expertSystemPrompt, report };
}

/* ────────────────────────────────────────────────────────────────
 * The main loop
 * ──────────────────────────────────────────────────────────────── */

export async function startResearchJob(jobId: string): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  try {
    await runJob(jobId);
  } catch (err) {
    logger.error({ err, jobId }, "Research job crashed");
    try {
      await updateJob(jobId, { status: "failed", error: err instanceof Error ? err.message : String(err) });
    } catch { /* DB unavailable */ }
  } finally {
    runningJobs.delete(jobId);
  }
}

async function runJob(jobId: string): Promise<void> {
  let [row] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
  if (!row) return;

  await updateJob(jobId, { status: "running", startedAt: new Date() });

  const job: JobMeta = { prompt: row.prompt, title: row.title, mode: row.mode, depth: row.depth };

  await appendLog(jobId, `Research launched: "${row.title}", ${row.mode} mode, ${row.depth} depth. This will run for a very long time.`);

  // 1. Initial plan (or continuation plan when resuming with notes)
  let phases = await planPhases(job, row.notes);
  if (phases.length === 0) {
    // Fallback when the planner failed, build a generic phase list
    phases = [
      { title: "Foundations", description: "Core concepts", queries: [`${job.prompt} fundamentals`] },
      { title: "State of the art", description: "Current developments", queries: [`${job.prompt} state of the art 2025`] },
      { title: "Expert perspectives", description: "What experts say", queries: [`${job.prompt} expert analysis`] },
    ];
  }
  await appendLog(jobId, `Planner produced ${phases.length} phases.`);

  let completed = 0;
  let index = 0;
  while (phases.length > 0 && index < phases.length) {
    const phase = phases[index];
    index += 1;

    // Cancellation + liveness checks
    const [live] = await db.select({ status: researchJobs.status }).from(researchJobs).where(eq(researchJobs.id, jobId));
    if (!live) return;
    if (live.status === "cancelled") {
      await appendLog(jobId, "Cancelled by user.");
      return;
    }

    const total = phases.length;
    await updateJob(jobId, {
      progress: Math.min(99, Math.round((completed / total) * 100)),
      phase: `Phase ${index}/${total}, ${phase.title}`,
      heartbeatAt: new Date(),
    });

    try {
      const { gapSummary } = await runPhase(jobId, job, phase, index, total);
      completed += 1;
      await updateJob(jobId, { phasesCompleted: completed });

      // Replan: propose follow-up phases from the critique. Deeper tiers replan
      // more aggressively (omni/quantum after EVERY phase, deep every 2nd,
      // standard every 3rd) so the research branches out instead of saturating.
      const replanEvery = job.depth === "standard" ? 3 : job.depth === "deep" ? 2 : 1;
      if (gapSummary && index % replanEvery === 0) {
        const [fresh] = await db.select({ notes: researchJobs.notes }).from(researchJobs).where(eq(researchJobs.id, jobId));
        if (fresh) row = { ...row, notes: fresh.notes };
        const followups = await proposeFollowups(job, row.notes, gapSummary);
        const cap = MAX_TOTAL_PHASES[job.depth] ?? 100;
        if (followups.length > 0 && phases.length + followups.length <= cap) {
          phases.splice(index, 0, ...followups);
          await appendLog(jobId, `Replanning: +${followups.length} follow-up phase(s) from critique. Total now ${phases.length}.`);
        } else if (followups.length > 0) {
          await appendLog(jobId, `Replanning skipped, phase ceiling reached (${cap}).`);
        }
      }
    } catch (phaseErr) {
      if (phaseErr instanceof LLMAllKeysCoolingError) {
        // Every LLM key is cooling down, pause + notify + auto-resume on the SAME phase.
        await appendLog(jobId, "All LLM keys are cooling down (quota/rate limits). Pausing research for ~10 minutes, will auto-resume on this same phase. Nothing is lost.");
        void notifyAll(`Research paused: ${job.title}`, "Every LLM key is cooling down. Infinity will auto-resume in ~10 minutes, nothing is lost.", "/");
        await sleep(10 * 60 * 1000);
        index -= 1; // retry this phase
        continue;
      }
      // Transient errors (search down, LLM hiccup), log and continue, never kill the job
      logger.warn({ err: phaseErr, jobId }, "Research phase failed transiently");
      await appendLog(jobId, `Phase "${phase.title}" hit an error, continuing: ${phaseErr instanceof Error ? phaseErr.message.slice(0, 300) : "unknown"}`);
      completed += 1;
    }

    // Pacing, scaled by depth so a deep/quantum job genuinely spans hours/days
    const [lo, hi] = SLEEP_SECONDS[job.depth] ?? SLEEP_SECONDS.deep;
    await sleep((lo + Math.random() * (hi - lo)) * 1000);
  }

  // 2. Final synthesis + expert
  const [finalRow] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
  if (!finalRow) return;
  await updateJob(jobId, { progress: 99, phase: "Final synthesis, writing the expert…" });
  await appendLog(jobId, "Phases complete. Writing final report and spawning the expert chat…");

  // Final synthesis uses the key pool too, if every key is cooling, pause
  // and retry rather than failing the whole job at the last step.
  let expertResult: { gemConversationId: string; gemSystemPrompt: string; report: string } | null = null;
  for (let attempt = 0; attempt < 3 && !expertResult; attempt++) {
    try {
      expertResult = await createExpert(
        jobId,
        { prompt: finalRow.prompt, title: finalRow.title, notes: finalRow.notes, mode: finalRow.mode, depth: finalRow.depth },
      );
    } catch (gemRetryErr) {
      if (gemRetryErr instanceof LLMAllKeysCoolingError && attempt < 2) {
        await appendLog(jobId, "All LLM keys cooling during final synthesis, retrying in 10 minutes.");
        void notifyAll(`Research nearly done: ${job.title}`, "Every LLM key is cooling down. Infinity will write the final report when a key revives.", "/");
        await sleep(10 * 60 * 1000);
      } else {
        throw gemRetryErr;
      }
    }
  }
  const { gemConversationId, gemSystemPrompt, report } = expertResult!;
  try {
    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      phase: "Complete",
      report,
      gemSystemPrompt,
      gemConversationId,
      completedAt: new Date(),
    });
    await appendLog(jobId, "Done. The expert chat is ready.");
    void notifyAll(
      `Research complete: ${job.title}`,
      "Your deep research finished, the expert chat is ready to open.",
      "/",
    );
  } catch (gemErr) {
    logger.error({ err: gemErr, jobId }, "Expert creation failed");
    await updateJob(jobId, { status: "failed", error: gemErr instanceof Error ? gemErr.message : String(gemErr) });
    void notifyAll(
      `Research finished with an error: ${job.title}`,
      "Something went wrong while creating your expert.",
      "/",
    );
  }
}

/**
 * Resume ANY unfinished job ('queued' or 'running') after a server (re)start.
 * Because a fresh process has no loops running, heartbeat age is irrelevant —
 * everything unfinished gets picked up again from its saved notes.
 * Also runs periodically as a safety net: if a loop ever dies hard, the job is
 * reclaimed without waiting for a full restart. startResearchJob's in-process
 * guard (runningJobs) prevents double-processing.
 */
export async function recoverStuckJobs(): Promise<void> {
  try {
    const unfinished = await db
      .select()
      .from(researchJobs)
      .where(or(eq(researchJobs.status, "running"), eq(researchJobs.status, "queued")));
    for (const job of unfinished) {
      await appendLog(job.id, "Server (re)started, resuming research from accumulated notes.");
      void startResearchJob(job.id);
    }
  } catch {
    logger.warn("recoverStuckJobs: DB unavailable at boot, research jobs will start when the server can reach the DB.");
  }
}

// Safety net: reclaim any job that ended up stuck without a server restart.
setInterval(() => {
  void recoverStuckJobs().catch(() => {});
}, 10 * 60 * 1000).unref();
