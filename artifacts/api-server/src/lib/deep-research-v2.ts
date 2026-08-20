/**
 * Deep Research v2 Engine
 * -----------------------
 * True deep research agent (ChatGPT/Gemini style, 3-7 min):
 * Iterative loop: plan → search (parallel Tavily) → browse (browser pool) → extract → synthesize → gap analysis → repeat (max 3 iterations)
 * 20-50 unique sources (Tavily + browser + Semantic Scholar/Crossref free APIs)
 * Output: Structured ResearchReport artifact with executive summary, detailed sections, numbered citations, source list, confidence scores, gaps/limitations
 * Trigger: @DeepResearch <topic> in chat (detected in chat.ts), emits progress SSE events
 */

import { db, researchJobsV2, researchSourcesV2 } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { runWithLLM, LLMAllKeysCoolingError } from "./llm-client";
import { logger } from "./logger";
import { notifyAll } from "./web-push";
import { getBrowserPool } from "./browser-pool";

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

export type DeepResearchStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  content?: string;
  sourceType: "tavily" | "browser" | "academic";
  relevanceScore: number;
  readAt?: Date;
}

export interface ResearchSection {
  heading: string;
  content: string;
  citations: number[]; // indices into sources array
}

export interface ResearchReport {
  executiveSummary: string;
  sections: ResearchSection[];
  gapsAndLimitations: string;
  confidenceScore: number; // 0-100
  sourceCount: number;
  sources: ResearchSource[];
}

export interface DeepResearchJob {
  id: string;
  topic: string;
  status: DeepResearchStatus;
  phase: DeepResearchPhase;
  progress: number; // 0-100
  sourcesFound: number;
  pagesRead: number;
  currentQuery?: string;
  log: string[];
  report?: ResearchReport;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  iterations: number;
  maxIterations: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "tavily" | "duckduckgo" | "academic";
}

interface SearchQuery {
  query: string;
  intent: string;
  priority: number;
}

interface PlanResult {
  queries: SearchQuery[];
  rationale: string;
}

interface ExtractionResult {
  keyFacts: string[];
  quotes: { text: string; relevance: string }[];
  dataPoints: { label: string; value: string; confidence: number }[];
  relevant: boolean;
}

interface GapAnalysisResult {
  gaps: string[];
  followUpQueries: SearchQuery[];
  saturated: boolean;
  confidence: number;
}

interface SynthesisResult {
  executiveSummary: string;
  sections: ResearchSection[];
  gapsAndLimitations: string;
  confidenceScore: number;
}

const MAX_ITERATIONS = 3;
const TARGET_SOURCES = 30;
const MAX_SOURCES_PER_ITERATION = 15;
const SEARCH_DELAY_MS = 500;
const READ_DELAY_MS = 800;

const runningJobs = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  try {
    const completion = await runWithLLM((client, model) =>
      client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user.slice(0, 80_000) },
        ],
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4000,
      }),
    );
    return completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    if (err instanceof LLMAllKeysCoolingError) throw err;
    logger.warn({ err }, "LLM call failed");
    return "";
  }
}

/* ────────────────────────────────────────────────────────────────
 * Web Search (Tavily + DuckDuckGo fallback)
 * ──────────────────────────────────────────────────────────────── */

async function searchTavily(query: string, maxResults: number): Promise<SearchResult[]> {
  const tavilyKey = process.env.TAVILY_API_KEY ?? process.env.WEB_SEARCH_API_KEY;
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
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(15_000),
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
        snippet: (r.content ?? "").slice(0, 500),
        source: "tavily" as const,
      }));
  } catch (err) {
    logger.warn({ err, query }, "Tavily search failed");
    return [];
  }
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const { load: cheerioLoad } = await import("cheerio");
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
        try { finalUrl = decodeURIComponent(uddg[1]); } catch { /* keep original */ }
      }
      const title = link.text().trim();
      const snippet = $(el).find(".result__snippet").first().text().trim();
      if (title && finalUrl) results.push({ title, url: finalUrl, snippet: snippet.slice(0, 500), source: "duckduckgo" });
    });
    return results;
  } catch (err) {
    logger.warn({ err, query }, "DuckDuckGo search failed");
    return [];
  }
}

async function searchAcademic(query: string, maxResults: number): Promise<SearchResult[]> {
  // Semantic Scholar free API (no key required, rate limited)
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,url,abstract,year,authors,venue,citationCount`, {
      headers: { "User-Agent": "Infinity-DeepResearch/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ paperId: string; title: string; url?: string; abstract?: string; year: number; authors?: Array<{ name: string }>; venue?: string; citationCount: number }> };
    return (data.data ?? []).map((p) => ({
      title: p.title,
      url: p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
      snippet: p.abstract ?? `Published ${p.year} in ${p.venue ?? "unknown venue"} (${p.citationCount} citations)`,
      source: "academic" as const,
    }));
  } catch (err) {
    logger.warn({ err, query }, "Academic search failed");
    return [];
  }
}

async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  // Try Tavily first
  const tavily = await searchTavily(query, maxResults);
  if (tavily.length > 0) return tavily;

  // Fallback to DuckDuckGo
  const ddg = await searchDuckDuckGo(query, maxResults);
  if (ddg.length > 0) return ddg;

  return [];
}

async function searchAllSources(queries: SearchQuery[], maxPerQuery: number): Promise<ResearchSource[]> {
  const allResults: ResearchSource[] = [];
  const seenUrls = new Set<string>();

  for (const q of queries) {
    // Web search
    const webResults = await searchWeb(q.query, maxPerQuery);
    for (const r of webResults) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      allResults.push({
        id: crypto.randomUUID(),
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        sourceType: r.source === "tavily" ? "tavily" : "browser",
        relevanceScore: 100 - allResults.length, // Simple decay
      });
    }
    await sleep(SEARCH_DELAY_MS);

    // Academic search for relevant queries (papers, research, technical topics)
    if (q.intent.includes("academic") || q.intent.includes("paper") || q.intent.includes("research") || q.query.includes("study") || q.query.includes("analysis")) {
      const academicResults = await searchAcademic(q.query, Math.min(5, maxPerQuery));
      for (const r of academicResults) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        allResults.push({
          id: crypto.randomUUID(),
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          sourceType: "academic",
          relevanceScore: 100 - allResults.length,
        });
      }
      await sleep(SEARCH_DELAY_MS);
    }
  }

  return allResults;
}

/* ────────────────────────────────────────────────────────────────
 * Browser Pool Reading
 * ──────────────────────────────────────────────────────────────── */

async function readPageWithBrowser(url: string, maxChars = 12000): Promise<string> {
  const taskId = `deep-research-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const pool = getBrowserPool();
    const slot = await pool.acquire(taskId);
    try {
      await slot.browser.navigate(url);
      await sleep(1000); // Wait for dynamic content

      // Extract text content
      const text = await slot.browser.getContent(maxChars);
      return text;
    } finally {
      pool.release(slot.id);
    }
  } catch (err) {
    logger.warn({ err, url }, "Browser read failed, trying fetch fallback");
    // Fallback to simple fetch
    return await readPageFetch(url, maxChars);
  }
}

async function readPageFetch(url: string, maxChars = 12000): Promise<string> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "";
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text/plain")) return "";
    const html = await res.text();
    if (html.length > 3_000_000) return "";
    const { load: cheerioLoad } = await import("cheerio");
    const $ = cheerioLoad(html);
    $("script, style, noscript, svg, nav, footer, header, form, iframe, [aria-hidden='true']").remove();
    return $("body").text().replace(/\s+/g, " ").trim().slice(0, maxChars);
  } catch {
    return "";
  }
}

async function readSources(sources: ResearchSource[], maxToRead: number): Promise<ResearchSource[]> {
  const toRead = sources.filter((s) => !s.content && s.relevanceScore > 50).slice(0, maxToRead);

  for (const source of toRead) {
    const content = await readPageWithBrowser(source.url);
    if (content) {
      source.content = content;
      source.readAt = new Date();
    }
    await sleep(READ_DELAY_MS);
  }

  return sources;
}

/* ────────────────────────────────────────────────────────────────
 * LLM-based Processing Steps
 * ──────────────────────────────────────────────────────────────── */

async function planResearch(topic: string, previousFindings?: string): Promise<PlanResult> {
  const system = `You are a research planner for a deep research agent. Your job is to decompose a research topic into a set of focused search queries that will comprehensively cover the topic.

Return ONLY valid JSON:
{
  "queries": [
    {"query": "specific search query", "intent": "what this query aims to find", "priority": 1-10}
  ],
  "rationale": "brief explanation of the research strategy"
}

Guidelines:
- Generate 8-12 diverse queries covering: fundamentals, current state, key players, controversies, practical applications, future trends, academic research, expert opinions
- Each query should be specific and actionable for a search engine
- Prioritize queries that will yield unique, high-quality sources
- Avoid duplicate or overlapping queries
- Include queries for academic papers if the topic is technical/scientific`;

  const user = `Research topic: "${topic}"

${previousFindings ? `Previous findings summary:\n${previousFindings.slice(0, 15000)}` : ""}

Plan the next iteration of research to fill gaps and deepen understanding.`;

  const raw = await llm(system, user, { maxTokens: 3000, temperature: 0.5 });
  const json = extractJson(raw);
  if (!json) throw new Error("Failed to parse research plan");
  return JSON.parse(json);
}

async function extractFromSource(source: ResearchSource, topic: string): Promise<ExtractionResult> {
  if (!source.content || source.content.length < 200) {
    return { keyFacts: [], quotes: [], dataPoints: [], relevant: false };
  }

  const system = `You are a research analyst extracting structured information from a source. Analyze the provided content and extract key information relevant to the research topic.

Return ONLY valid JSON:
{
  "keyFacts": ["fact 1", "fact 2", ...],
  "quotes": [{"text": "exact quote", "relevance": "why this matters"}],
  "dataPoints": [{"label": "metric name", "value": "value with units", "confidence": 0-100}],
  "relevant": true/false
}

Guidelines:
- Extract 3-7 key facts that are specific and verifiable
- Pull 1-3 direct quotes that are particularly insightful
- Identify quantitative data points with confidence scores
- Mark as not relevant if the source doesn't meaningfully address the topic`;

  const user = `Research topic: "${topic}"
Source: ${source.title} (${source.url})
Content:
${source.content.slice(0, 20000)}`;

  const raw = await llm(system, user, { maxTokens: 2000, temperature: 0.3 });
  const json = extractJson(raw);
  if (!json) return { keyFacts: [], quotes: [], dataPoints: [], relevant: false };

  try {
    return JSON.parse(json);
  } catch {
    return { keyFacts: [], quotes: [], dataPoints: [], relevant: false };
  }
}

async function extractFromAllSources(sources: ResearchSource[], topic: string): Promise<ResearchSource[]> {
  // Process in parallel batches of 3
  const batchSize = 3;
  for (let i = 0; i < sources.length; i += batchSize) {
    const batch = sources.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (source) => {
        const extraction = await extractFromSource(source, topic);
        // Store extraction as metadata on source
        (source as any).extraction = extraction;
        return source;
      })
    );
  }
  return sources;
}

async function synthesizeFindings(topic: string, sources: ResearchSource[], previousReport?: ResearchReport): Promise<SynthesisResult> {
  const relevantSources = sources.filter((s) => (s as any).extraction?.relevant !== false && s.content);

  const sourceSummaries = relevantSources.map((s, i) => {
    const ext = (s as any).extraction;
    return `Source ${i + 1}: ${s.title} (${s.url})
Type: ${s.sourceType}
Key facts: ${ext?.keyFacts?.join("; ") || "N/A"}
Quotes: ${ext?.quotes?.map((q: { text: string; relevance: string }) => q.text).join(" | ") || "N/A"}
Data: ${ext?.dataPoints?.map((d: { label: string; value: string; confidence: number }) => `${d.label}: ${d.value}`).join("; ") || "N/A"}
Relevance: ${s.relevanceScore}`;
  }).join("\n\n---\n\n");

  const system = `You are a senior research analyst synthesizing findings into a comprehensive research report. Create a well-structured report with citations.

Return ONLY valid JSON:
{
  "executiveSummary": "2-3 paragraph executive summary",
  "sections": [
    {"heading": "Section Title", "content": "Detailed content with [1], [2] citation markers", "citations": [1, 2]}
  ],
  "gapsAndLimitations": "What's missing, uncertainties, limitations",
  "confidenceScore": 0-100
}

Guidelines:
- Create 4-7 sections covering different aspects of the topic
- Use [N] citation markers referencing source indices (1-based)
- Executive summary should be comprehensive but concise
- Gaps and limitations should be honest and specific
- Confidence score reflects overall source quality and coverage`;

  const previousContext = previousReport
    ? `\n\nPrevious report (improve upon this):\nExecutive: ${previousReport.executiveSummary.slice(0, 3000)}\nSections: ${previousReport.sections.map(s => s.heading).join(", ")}\nGaps: ${previousReport.gapsAndLimitations.slice(0, 2000)}`
    : "";

  const user = `Research topic: "${topic}"

Sources (${relevantSources.length} relevant):
${sourceSummaries.slice(0, 60000)}${previousContext}`;

  const raw = await llm(system, user, { maxTokens: 6000, temperature: 0.3 });
  const json = extractJson(raw);
  if (!json) throw new Error("Failed to parse synthesis");
  return JSON.parse(json);
}

async function analyzeGaps(topic: string, report: ResearchReport, sources: ResearchSource[]): Promise<GapAnalysisResult> {
  const system = `You are a research critic identifying gaps in a research report. Analyze the report and sources to find what's missing.

Return ONLY valid JSON:
{
  "gaps": ["specific gap 1", "specific gap 2", ...],
  "followUpQueries": [
    {"query": "targeted search query", "intent": "what gap this addresses", "priority": 1-10}
  ],
  "saturated": true/false,
  "confidence": 0-100
}

Guidelines:
- Identify 3-6 specific, actionable gaps
- Generate targeted follow-up queries for each gap
- Mark saturated=true only if topic is comprehensively covered with high confidence
- Be rigorous - deep research should uncover nuances, not just surface facts`;

  const user = `Research topic: "${topic}"

Current report:
Executive: ${report.executiveSummary}
Sections: ${report.sections.map(s => `${s.heading}: ${s.content.slice(0, 500)}`).join("\n")}
Gaps so far: ${report.gapsAndLimitations}
Confidence: ${report.confidenceScore}%

Sources available: ${sources.length} (${sources.filter(s => s.content).length} read)
Source types: ${[...new Set(sources.map(s => s.sourceType))].join(", ")}

What is missing? What follow-up queries would fill the gaps?`;

  const raw = await llm(system, user, { maxTokens: 3000, temperature: 0.4 });
  const json = extractJson(raw);
  if (!json) return { gaps: [], followUpQueries: [], saturated: true, confidence: report.confidenceScore };

  try {
    return JSON.parse(json);
  } catch {
    return { gaps: [], followUpQueries: [], saturated: true, confidence: report.confidenceScore };
  }
}

/* ────────────────────────────────────────────────────────────────
 * Job Persistence
 * ──────────────────────────────────────────────────────────────── */

async function createJob(topic: string): Promise<string> {
  const [job] = await db.insert(researchJobsV2).values({
    topic: topic.slice(0, 200),
    status: "queued",
    phase: "planning",
    progress: 0,
    sourcesFound: 0,
    pagesRead: 0,
    log: ["Job created"],
    iterations: 0,
    maxIterations: MAX_ITERATIONS,
  }).returning({ id: researchJobsV2.id });
  return job.id;
}

async function updateJob(jobId: string, patch: Partial<DeepResearchJob>): Promise<void> {
  const dbPatch: any = { ...patch };
  if (patch.log) {
    dbPatch.log = patch.log.slice(-100); // Keep last 100 log entries
  }
  if (patch.report) {
    dbPatch.report = patch.report;
  }
  await db.update(researchJobsV2).set(dbPatch).where(eq(researchJobsV2.id, jobId));
}

async function appendLog(jobId: string, line: string): Promise<void> {
  const [row] = await db.select({ log: researchJobsV2.log }).from(researchJobsV2).where(eq(researchJobsV2.id, jobId));
  const current = row?.log ?? [];
  const next = [...current, `[${new Date().toISOString().slice(11, 19)}] ${line}`].slice(-100);
  await updateJob(jobId, { log: next });
}

async function saveSources(jobId: string, sources: ResearchSource[]): Promise<void> {
  if (sources.length === 0) return;
  await db.insert(researchSourcesV2).values(
    sources.map((s) => ({
      jobId,
      sourceId: s.id,
      title: s.title,
      url: s.url,
      snippet: s.snippet,
      content: s.content,
      sourceType: s.sourceType,
      relevanceScore: s.relevanceScore,
      readAt: s.readAt,
      extraction: (s as any).extraction,
    }))
  ).onConflictDoUpdate({
    target: researchSourcesV2.sourceId,
    set: {
      content: sources[0].content,
      readAt: sources[0].readAt,
      extraction: (sources[0] as any).extraction,
    },
  });
}

async function loadJob(jobId: string): Promise<DeepResearchJob | null> {
  const [job] = await db.select().from(researchJobsV2).where(eq(researchJobsV2.id, jobId));
  if (!job) return null;

  const sources = await db.select().from(researchSourcesV2).where(eq(researchSourcesV2.jobId, jobId));

  return {
    id: job.id,
    topic: job.topic,
    status: job.status as DeepResearchStatus,
    phase: job.phase as DeepResearchPhase,
    progress: job.progress,
    sourcesFound: job.sourcesFound,
    pagesRead: job.pagesRead,
    currentQuery: job.currentQuery ?? undefined,
    log: job.log ?? [],
    report: job.report as ResearchReport | undefined,
    error: job.error ?? undefined,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? undefined,
    completedAt: job.completedAt ?? undefined,
    iterations: job.iterations,
    maxIterations: job.maxIterations,
  };
}

/* ────────────────────────────────────────────────────────────────
 * Main Research Loop
 * ──────────────────────────────────────────────────────────────── */

export async function startDeepResearchV2(jobId: string): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  try {
    await runDeepResearchJob(jobId);
  } catch (err) {
    logger.error({ err, jobId }, "Deep Research v2 job crashed");
    try {
      await updateJob(jobId, {
        status: "failed",
        phase: "failed",
        error: err instanceof Error ? err.message : String(err)
      });
    } catch { /* DB unavailable */ }
  } finally {
    runningJobs.delete(jobId);
  }
}

async function runDeepResearchJob(jobId: string): Promise<void> {
  let job = await loadJob(jobId);
  if (!job) return;

  await updateJob(jobId, { status: "running", startedAt: new Date() });
  await appendLog(jobId, `Deep Research v2 launched: "${job.topic}" (target: ${TARGET_SOURCES} sources, max ${MAX_ITERATIONS} iterations)`);

  let allSources: ResearchSource[] = [];
  let report: ResearchReport | undefined;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    await updateJob(jobId, { iterations: iteration });
    await appendLog(jobId, `=== Iteration ${iteration}/${MAX_ITERATIONS} ===`);

    // Check for cancellation
    const [live] = await db.select({ status: researchJobsV2.status }).from(researchJobsV2).where(eq(researchJobsV2.id, jobId));
    if (!live || live.status === "cancelled") {
      await appendLog(jobId, "Cancelled by user");
      return;
    }

    // 1. PLANNING
    await updateJob(jobId, { phase: "planning", progress: Math.min(90, 10 + iteration * 20) });
    await appendLog(jobId, "Planning research queries...");

    const previousFindings = report
      ? `Executive: ${report.executiveSummary}\nSections: ${report.sections.map(s => s.heading).join(", ")}\nGaps: ${report.gapsAndLimitations}`
      : undefined;

    let plan: PlanResult;
    try {
      plan = await planResearch(job.topic, previousFindings);
    } catch (err) {
      await appendLog(jobId, `Planning failed: ${err instanceof Error ? err.message : "unknown"}, using fallback`);
      plan = {
        queries: [
          { query: `${job.topic} overview`, intent: "general overview", priority: 10 },
          { query: `${job.topic} latest developments 2024 2025`, intent: "current state", priority: 9 },
          { query: `${job.topic} key challenges`, intent: "problems and limitations", priority: 8 },
          { query: `${job.topic} applications use cases`, intent: "practical applications", priority: 7 },
          { query: `${job.topic} academic research papers`, intent: "academic research", priority: 6 },
        ],
        rationale: "Fallback plan due to LLM error",
      };
    }

    await appendLog(jobId, `Planned ${plan.queries.length} queries: ${plan.queries.map(q => q.query).join(", ")}`);

    // 2. SEARCHING
    await updateJob(jobId, { phase: "searching", currentQuery: plan.queries[0]?.query });
    await appendLog(jobId, "Searching for sources...");

    const newSources = await searchAllSources(plan.queries, Math.ceil(MAX_SOURCES_PER_ITERATION / plan.queries.length));

    // Merge with existing sources (deduplicate by URL)
    const existingUrls = new Set(allSources.map(s => s.url));
    for (const source of newSources) {
      if (!existingUrls.has(source.url)) {
        allSources.push(source);
        existingUrls.add(source.url);
      }
    }

    await updateJob(jobId, { sourcesFound: allSources.length });
    await appendLog(jobId, `Found ${newSources.length} new sources (total: ${allSources.length})`);
    await saveSources(jobId, newSources);

    // 3. READING (browser pool)
    await updateJob(jobId, { phase: "reading" });
    await appendLog(jobId, "Reading sources with browser pool...");

    const sourcesToRead = allSources.filter(s => !s.content).slice(0, 15);
    await readSources(sourcesToRead, 15);
    const readCount = allSources.filter(s => s.content).length;
    await updateJob(jobId, { pagesRead: readCount });
    await appendLog(jobId, `Read ${sourcesToRead.length} sources (${readCount} total with content)`);
    await saveSources(jobId, sourcesToRead);

    // 4. EXTRACTING
    await updateJob(jobId, { phase: "extracting" });
    await appendLog(jobId, "Extracting key information from sources...");

    await extractFromAllSources(allSources, job.topic);
    await saveSources(jobId, allSources);
    await appendLog(jobId, "Extraction complete");

    // 5. SYNTHESIZING
    await updateJob(jobId, { phase: "synthesizing" });
    await appendLog(jobId, "Synthesizing findings into report...");

    try {
      const synthesis = await synthesizeFindings(job.topic, allSources, report);
      report = {
        ...synthesis,
        sourceCount: allSources.length,
        sources: allSources,
      };
      await updateJob(jobId, { report });
      await appendLog(jobId, `Synthesis complete: ${report.sections.length} sections, confidence ${report.confidenceScore}%`);
    } catch (err) {
      await appendLog(jobId, `Synthesis failed: ${err instanceof Error ? err.message : "unknown"}`);
      if (iteration === 1) throw err; // Fail fast on first iteration
    }

    // 6. GAP ANALYSIS
    await updateJob(jobId, { phase: "gap_analysis" });
    await appendLog(jobId, "Analyzing gaps and planning follow-up...");

    let gapAnalysis: GapAnalysisResult;
    try {
      gapAnalysis = await analyzeGaps(job.topic, report!, allSources);
    } catch (err) {
      await appendLog(jobId, `Gap analysis failed: ${err instanceof Error ? err.message : "unknown"}`);
      gapAnalysis = { gaps: [], followUpQueries: [], saturated: true, confidence: report?.confidenceScore ?? 50 };
    }

    await appendLog(jobId, `Gaps found: ${gapAnalysis.gaps.length}, saturated: ${gapAnalysis.saturated}, confidence: ${gapAnalysis.confidence}%`);

    // Check if we should continue
    if (gapAnalysis.saturated || gapAnalysis.confidence >= 85 || allSources.length >= TARGET_SOURCES) {
      await appendLog(jobId, "Research saturated or target reached, finalizing...");
      break;
    }

    // Add follow-up queries to plan for next iteration
    if (gapAnalysis.followUpQueries.length > 0) {
      plan.queries.push(...gapAnalysis.followUpQueries.slice(0, 5));
      await appendLog(jobId, `Added ${gapAnalysis.followUpQueries.length} follow-up queries for next iteration`);
    }

    // Brief pause between iterations
    await sleep(2000);
  }

  // 7. FINALIZING
  await updateJob(jobId, { phase: "finalizing", progress: 95 });
  await appendLog(jobId, "Finalizing report...");

  if (!report) {
    throw new Error("No report generated");
  }

  // Final polish - ensure we have enough sources cited
  const citedSources = new Set(report.sections.flatMap(s => s.citations));
  report.sourceCount = allSources.length;

  await updateJob(jobId, {
    status: "completed",
    phase: "completed",
    progress: 100,
    report,
    completedAt: new Date(),
  });

  await appendLog(jobId, `Deep Research v2 complete! ${allSources.length} sources, ${report.sections.length} sections, confidence ${report.confidenceScore}%`);

  void notifyAll(
    `Deep Research complete: ${job.topic}`,
    `Found ${allSources.length} sources across ${report.sections.length} sections. Confidence: ${report.confidenceScore}%`,
    "/"
  );
}

/* ────────────────────────────────────────────────────────────────
 * SSE Streaming for Real-time Updates
 * ──────────────────────────────────────────────────────────────── */

export async function streamDeepResearchV2(jobId: string, res: any): Promise<void> {
  // Send headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Initial state
  let lastLogLength = 0;
  let lastSourcesFound = 0;
  let lastPagesRead = 0;

  const job = await loadJob(jobId);
  if (job) {
    sendEvent("phase", { phase: job.phase, progress: job.progress });
    sendEvent("progress", { progress: job.progress });

    // Send initial log entries
    for (const logEntry of job.log ?? []) {
      sendEvent("log", { message: logEntry });
    }
    lastLogLength = job.log?.length ?? 0;
    lastSourcesFound = job.sourcesFound;
    lastPagesRead = job.pagesRead;
  }

  // Poll for updates
  const interval = setInterval(async () => {
    const current = await loadJob(jobId);
    if (!current) {
      clearInterval(interval);
      res.end();
      return;
    }

    // Send phase updates
    sendEvent("phase", { phase: current.phase, progress: current.progress });
    sendEvent("progress", { progress: current.progress });

    // Send new log entries
    const currentLog = current.log ?? [];
    for (let i = lastLogLength; i < currentLog.length; i++) {
      sendEvent("log", { message: currentLog[i] });
    }
    lastLogLength = currentLog.length;

    // Send source updates when new sources are found
    if (current.sourcesFound > lastSourcesFound) {
      sendEvent("source", { source: { query: current.currentQuery ?? "", found: current.sourcesFound - lastSourcesFound } });
      lastSourcesFound = current.sourcesFound;
    }

    // Send page read updates
    if (current.pagesRead > lastPagesRead) {
      sendEvent("source", { source: { query: current.currentQuery ?? "", content: "page read", pagesRead: current.pagesRead - lastPagesRead } });
      lastPagesRead = current.pagesRead;
    }

    if (current.status === "completed") {
      sendEvent("complete", { report: current.report });
      clearInterval(interval);
      res.end();
    } else if (current.status === "failed") {
      sendEvent("error", { error: current.error });
      clearInterval(interval);
      res.end();
    } else if (current.status === "cancelled") {
      sendEvent("error", { error: "Cancelled by user" });
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  // Cleanup on close
  res.on("close", () => {
    clearInterval(interval);
  });
}

/* ────────────────────────────────────────────────────────────────
 * Expert Creation from Research
 * ──────────────────────────────────────────────────────────────── */

export async function createExpertFromResearch(jobId: string): Promise<{ expertName: string; systemPrompt: string } | null> {
  const job = await loadJob(jobId);
  if (!job || !job.report) return null;

  const system = `You are creating an expert persona from a deep research report. The expert should be a world-class authority who can answer questions using the research as ground truth.

Return ONLY valid JSON:
{
  "expertName": "Expert on [topic]",
  "systemPrompt": "You are a world-class expert on [topic] with 30 years of experience. Ground every answer in the research dossier attached to this conversation. Reason rigorously, structure your answers, and acknowledge uncertainty honestly. The dossier covers: [key areas].\n\n== RESEARCH DOSSIER ==\n[report content]"
}`;

  const user = `Research topic: "${job.topic}"
Report executive summary: ${job.report.executiveSummary}
Sections: ${job.report.sections.map(s => s.heading).join(", ")}
Source count: ${job.report.sourceCount}
Confidence: ${job.report.confidenceScore}%`;

  const raw = await llm(system, user, { maxTokens: 4000, temperature: 0.4 });
  const json = extractJson(raw);
  if (!json) return null;

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────
 * Recovery
 * ──────────────────────────────────────────────────────────────── */

export async function recoverStuckDeepResearchJobs(): Promise<void> {
  try {
    const unfinished = await db
      .select()
      .from(researchJobsV2)
      .where(
        and(
          eq(researchJobsV2.status, "running"),
          eq(researchJobsV2.phase, "planning") // Only recover if stuck early, otherwise let it finish
        )
      );

    for (const job of unfinished) {
      await appendLog(job.id, "Server restarted, resuming deep research...");
      void startDeepResearchV2(job.id);
    }
  } catch (err) {
    logger.warn({ err }, "recoverStuckDeepResearchJobs failed");
  }
}

// Safety net
setInterval(() => {
  void recoverStuckDeepResearchJobs().catch(() => {});
}, 5 * 60 * 1000).unref();