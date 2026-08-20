/**
 * Deep Research v2 — ChatGPT/Gemini-style fast research agent (3-7 min)
 * ------------------------------------------------------------------
 * Unlike research-engine.ts (which runs for hours/days), this produces a
 * structured ResearchReport artifact in 3-7 minutes with:
 *   - 20-50 sources browsed
 *   - Numbered citations
 *   - Executive summary + detailed sections
 *   - Confidence scores + gaps/limitations
 *
 * Emits progress via SSE (server-sent events) to a frontend widget.
 * Persists to Postgres when available (graceful fallback to in-memory).
 *
 * Backward compat: does NOT create an "expert" chat automatically — instead
 * the report UI offers "Create Expert from this Research" (separate action).
 */

import { OpenAI } from "openai";
import { load as cheerioLoad } from "cheerio";
import { logger } from "./logger";
import { runWithLLM, LLMAllKeysCoolingError } from "./llm-client";

/* ────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────── */

export type DeepResearchPhase =
  | "planning"
  | "searching"
  | "reading"
  | "extracting"
  | "synthesizing"
  | "gap_analysis"
  | "finalizing"
  | "completed"
  | "failed";

export interface Source {
  id: number;
  title: string;
  url: string;
  snippet: string;
  content?: string;
  relevance?: number;
}

export interface Citation {
  id: number;
  sourceId: number;
  url: string;
  title: string;
}

export interface ResearchSection {
  heading: string;
  content: string;
  citations: number[];
}

export interface ResearchReport {
  executiveSummary: string;
  sections: ResearchSection[];
  gapsAndLimitations: string;
  confidenceScore: number; // 0-100
  sourceCount: number;
}

export interface DeepResearchJob {
  id: string;
  topic: string;
  status: "running" | "completed" | "failed";
  phase: DeepResearchPhase;
  progress: number; // 0-100
  sourcesFound: number;
  pagesRead: number;
  currentQuery?: string;
  log: string[];
  sources: Source[];
  report?: ResearchReport;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/* ────────────────────────────────────────────────────────────────
 * In-memory store (DB is optional; falls back to this)
 * ──────────────────────────────────────────────────────────────── */

const jobs = new Map<string, DeepResearchJob>();
const listeners = new Map<string, Set<(event: DeepResearchEvent) => void>>();

export interface DeepResearchEvent {
  type: "phase" | "progress" | "source" | "log" | "complete" | "error";
  jobId: string;
  phase?: DeepResearchPhase;
  progress?: number;
  message?: string;
  source?: Source;
  report?: ResearchReport;
  error?: string;
}

export function subscribeToJob(jobId: string, cb: (event: DeepResearchEvent) => void): () => void {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId)!.add(cb);
  return () => listeners.get(jobId)?.delete(cb);
}

function emit(jobId: string, event: DeepResearchEvent): void {
  const set = listeners.get(jobId);
  if (set) for (const cb of set) cb(event);
}

/* ────────────────────────────────────────────────────────────────
 * Web search (reuse Tavily + DuckDuckGo fallback pattern)
 * ──────────────────────────────────────────────────────────────── */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

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
      let finalUrl = url;
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) {
        try { finalUrl = decodeURIComponent(uddg[1]); } catch { /* keep */ }
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

async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  const tavily = await searchTavily(query, maxResults);
  if (tavily.length > 0) return tavily;
  return searchDuckDuckGo(query, maxResults);
}

async function readPage(url: string, maxChars = 8000): Promise<string> {
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
 * LLM helper
 * ──────────────────────────────────────────────────────────────── */

async function llm(
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number; jsonMode?: boolean } = {},
): Promise<string> {
  const completion = await runWithLLM((client, model) =>
    client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user.slice(0, 60_000) },
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2000,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  );
  return completion.choices[0]?.message?.content ?? "";
}

function extractJson(text: string): string | null {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
  return match ? match[0] : null;
}

/* ────────────────────────────────────────────────────────────────
 * Deep Research Agent
 * ──────────────────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeepResearchAgent {
  private job: DeepResearchJob;
  private sourceIdCounter = 0;

  constructor(topic: string) {
    this.job = {
      id: `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      topic,
      status: "running",
      phase: "planning",
      progress: 0,
      sourcesFound: 0,
      pagesRead: 0,
      log: [],
      sources: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    jobs.set(this.job.id, this.job);
  }

  getId(): string {
    return this.job.id;
  }

  getJob(): DeepResearchJob {
    return this.job;
  }

  private setPhase(phase: DeepResearchPhase, progress?: number): void {
    this.job.phase = phase;
    if (progress !== undefined) this.job.progress = progress;
    this.job.updatedAt = new Date().toISOString();
    emit(this.job.id, { type: "phase", jobId: this.job.id, phase, progress: this.job.progress });
  }

  private log(message: string): void {
    this.job.log.push(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
    if (this.job.log.length > 200) this.job.log.shift();
    emit(this.job.id, { type: "log", jobId: this.job.id, message });
  }

  private addSource(source: Omit<Source, "id">): Source {
    const full: Source = { ...source, id: ++this.sourceIdCounter };
    this.job.sources.push(full);
    this.job.sourcesFound = this.job.sources.length;
    emit(this.job.id, { type: "source", jobId: this.job.id, source: full });
    return full;
  }

  /**
   * Run the full research loop (3-7 minutes target).
   */
  async run(): Promise<void> {
    try {
      this.log(`Deep Research v2 started: "${this.job.topic}"`);
      this.setPhase("planning", 5);

      // 1. Plan — decompose into sub-questions + initial queries
      const plan = await this.plan();
      this.setPhase("searching", 15);

      // 2. Search + read loop (max 3 iteration rounds)
      const allSources: Source[] = [];
      const seen = new Set<string>();

      for (let round = 0; round < 3; round++) {
        const queries = plan.queries.slice(round * 4, (round + 1) * 4);
        if (queries.length === 0) break;

        for (const query of queries) {
          this.job.currentQuery = query;
          emit(this.job.id, { type: "log", jobId: this.job.id, message: `Searching: ${query}` });

          const results = await searchWeb(query, 8);
          for (const r of results) {
            if (seen.has(r.url) || allSources.length >= 50) continue;
            seen.add(r.url);
            const src = this.addSource({ title: r.title, url: r.url, snippet: r.snippet });
            allSources.push(src);
          }

          this.job.progress = Math.min(40, 15 + Math.round((allSources.length / 50) * 25));
          emit(this.job.id, { type: "progress", jobId: this.job.id, progress: this.job.progress });
          await sleep(800 + Math.random() * 1500);
        }

        // Read top unread sources
        this.setPhase("reading", 45);
        const unread = allSources.filter((s) => !s.content).slice(0, 15);
        for (const src of unread) {
          const text = await readPage(src.url, 8000);
          if (text) {
            src.content = text;
            this.job.pagesRead++;
            emit(this.job.id, { type: "progress", jobId: this.job.id, progress: this.job.progress });
          }
          await sleep(500 + Math.random() * 1000);
        }

        // Gap analysis → generate more queries for next round
        if (round < 2) {
          this.setPhase("gap_analysis", 55);
          const gaps = await this.gapAnalysis(allSources);
          if (gaps.length > 0) {
            plan.queries.push(...gaps);
            this.log(`Gap analysis found ${gaps.length} new angles to explore`);
          }
        }
      }

      // 3. Extract + synthesize
      this.setPhase("extracting", 65);
      const extractions = await this.extract(allSources.filter((s) => s.content));

      this.setPhase("synthesizing", 75);
      const report = await this.synthesize(extractions);

      // 4. Finalize
      this.setPhase("finalizing", 90);
      this.job.report = report;
      this.job.progress = 100;
      this.job.status = "completed";
      this.job.phase = "completed";
      this.job.updatedAt = new Date().toISOString();

      emit(this.job.id, { type: "complete", jobId: this.job.id, report });
      this.log(`Research complete: ${report.sourceCount} sources, confidence ${report.confidenceScore}%`);

      // Persist to DB if available (non-blocking)
      void this.persistToDB().catch(() => {});
    } catch (err) {
      this.job.status = "failed";
      this.job.phase = "failed";
      this.job.error = err instanceof Error ? err.message : String(err);
      this.job.updatedAt = new Date().toISOString();
      emit(this.job.id, { type: "error", jobId: this.job.id, error: this.job.error });
      this.log(`Research failed: ${this.job.error}`);
    }
  }

  /** Plan: decompose topic into sub-questions + initial search queries. */
  private async plan(): Promise<{ subQuestions: string[]; queries: string[] }> {
    const system =
      "You are a research planner. Decompose a research topic into 8-12 specific search queries that will surface comprehensive, authoritative information. " +
      "Cover: fundamentals, current state, key players/experts, controversies, data/statistics, practical applications, and future outlook. " +
      "Return ONLY valid JSON: {\"subQuestions\": string[], \"queries\": string[]}.";
    const user = `Research topic: ${this.job.topic}`;
    try {
      const raw = await llm(system, user, { maxTokens: 2000, temperature: 0.5, jsonMode: true });
      const json = extractJson(raw);
      if (json) {
        const parsed = JSON.parse(json) as { subQuestions?: string[]; queries?: string[] };
        return {
          subQuestions: (parsed.subQuestions ?? []).slice(0, 10),
          queries: (parsed.queries ?? []).slice(0, 12),
        };
      }
    } catch (err) {
      if (err instanceof LLMAllKeysCoolingError) throw err;
      this.log("Planner failed, using fallback queries");
    }
    // Fallback
    return {
      subQuestions: [this.job.topic],
      queries: [
        `${this.job.topic} fundamentals`,
        `${this.job.topic} state of the art 2026`,
        `${this.job.topic} expert analysis`,
        `${this.job.topic} statistics data`,
        `${this.job.topic} controversies debate`,
        `${this.job.topic} future trends`,
        `${this.job.topic} case studies examples`,
        `${this.job.topic} best practices guide`,
      ],
    };
  }

  /** Gap analysis: identify missing angles → generate follow-up queries. */
  private async gapAnalysis(sources: Source[]): Promise<string[]> {
    const system =
      "You are a research critic. Given the sources gathered so far, identify 2-4 specific search queries that would fill the biggest gaps. " +
      "Return ONLY valid JSON: {\"queries\": string[]}.";
    const snippets = sources
      .slice(-10)
      .map((s) => `- ${s.title} (${s.url})`)
      .join("\n");
    const user = `Topic: ${this.job.topic}\n\nSources so far:\n${snippets}`;
    try {
      const raw = await llm(system, user, { maxTokens: 800, temperature: 0.6, jsonMode: true });
      const json = extractJson(raw);
      if (json) {
        const parsed = JSON.parse(json) as { queries?: string[] };
        return (parsed.queries ?? []).slice(0, 4);
      }
    } catch { /* ignore */ }
    return [];
  }

  /** Extract structured facts from each readable source. */
  private async extract(sources: Source[]): Promise<string[]> {
    const extractions: string[] = [];
    const batchSize = 5;
    for (let i = 0; i < sources.length; i += batchSize) {
      const batch = sources.slice(i, i + batchSize);
      const batchText = batch
        .map((s, idx) => `### Source ${i + idx + 1}: ${s.title}\nURL: ${s.url}\n${s.content?.slice(0, 4000) ?? "(unreadable)"}`)
        .join("\n\n");

      const system =
        "You are a research extraction engine. Extract key facts, figures, quotes, and insights from the provided sources. " +
        "Format as dense markdown bullets. Attribute each bullet to its source number like [Source N].";
      const user = `Topic: ${this.job.topic}\n\nSOURCES:\n${batchText}`;
      const extracted = await llm(system, user, { maxTokens: 3000, temperature: 0.3 });
      extractions.push(extracted);
      this.job.progress = Math.min(70, 65 + Math.round((i / sources.length) * 5));
    }
    return extractions;
  }

  /** Synthesize extractions into a structured ResearchReport. */
  private async synthesize(extractions: string[]): Promise<ResearchReport> {
    const system =
      "You are a senior research analyst writing a comprehensive research report. " +
      "Produce a structured report with: executive summary, 4-6 detailed sections (each with citations to sources), gaps/limitations, and a confidence score (0-100). " +
      "Return ONLY valid JSON in this exact shape:\n" +
      "{\n" +
      '  "executiveSummary": string,\n' +
      '  "sections": [{"heading": string, "content": string, "citations": number[]}],\n' +
      '  "gapsAndLimitations": string,\n' +
      '  "confidenceScore": number\n' +
      "}\n" +
      "Citations should be 1-indexed source numbers corresponding to the order sources were found.";
    const combined = extractions.join("\n\n---\n\n").slice(0, 100_000);
    const user = `Research topic: ${this.job.topic}\n\nEXTRACTED KNOWLEDGE:\n${combined}`;

    const raw = await llm(system, user, { maxTokens: 6000, temperature: 0.3, jsonMode: true });
    const json = extractJson(raw);

    if (json) {
      try {
        const parsed = JSON.parse(json) as Partial<ResearchReport>;
        return {
          executiveSummary: parsed.executiveSummary ?? "No summary available.",
          sections: parsed.sections ?? [],
          gapsAndLimitations: parsed.gapsAndLimitations ?? "None identified.",
          confidenceScore: Math.max(0, Math.min(100, parsed.confidenceScore ?? 70)),
          sourceCount: this.job.sources.length,
        };
      } catch {
        // Fall through to text report
      }
    }

    // Fallback: wrap raw text as a single section
    return {
      executiveSummary: raw.slice(0, 500),
      sections: [{ heading: "Research Findings", content: raw, citations: [] }],
      gapsAndLimitations: "Structured parsing failed; raw output preserved.",
      confidenceScore: 60,
      sourceCount: this.job.sources.length,
    };
  }

  /** Persist report to DB (research_jobs table, kind="deep_research_v2"). */
  private async persistToDB(): Promise<void> {
    try {
      const { db, researchJobs } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      await db
        .update(researchJobs)
        .set({
          // Store report as JSON in the `report` column (text)
          report: JSON.stringify(this.job.report),
          status: "completed",
          progress: 100,
          notes: this.job.sources.map((s) => `${s.title} — ${s.url}`).join("\n"),
        })
        .where(eq(researchJobs.id, this.job.id))
        .catch(() => {});
    } catch {
      // DB unavailable, in-memory store is the source of truth
    }
  }
}

/* ────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────── */

export function startDeepResearch(topic: string): DeepResearchAgent {
  const agent = new DeepResearchAgent(topic);
  // Run in background (non-blocking)
  void agent.run().catch((err) => {
    logger.error({ err, topic }, "Deep Research v2 failed");
  });
  return agent;
}

export function getDeepResearchJob(id: string): DeepResearchJob | undefined {
  return jobs.get(id);
}

export function listDeepResearchJobs(): DeepResearchJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Build an expert system prompt from a completed research report.
 * Used by the "Create Expert from Research" button.
 */
export function buildExpertPromptFromReport(job: DeepResearchJob): string {
  if (!job.report) return "";
  const reportJson = JSON.stringify(job.report, null, 2);
  return (
    `You are a world-class expert on "${job.topic}", with the depth and judgement of someone who has studied and worked in this field for 30 years.\n\n` +
    "== DEEP RESEARCH DOSSIER (ground truth) ==\n" +
    reportJson.slice(0, 80_000) +
    "\n\nRules:\n" +
    "- Reason like a senior expert: define terms, state assumptions, weigh evidence, then conclude.\n" +
    "- When the dossier is silent, reason from first principles and say so.\n" +
    "- Be rigorous, precise, and appropriately humble about uncertainty.\n" +
    "- Format long answers with clear markdown structure."
  );
}
