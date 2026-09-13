/**
 * BUILD HELPER — Phase 2 "the crew's memory".
 *
 * A deterministic, $0 answer engine that runs INSIDE the build crew. Agents ask
 * it questions about the build's own history ("what style did the user ask
 * for?") and it answers from two indexed sources, never from improvisation:
 *
 *   1. The crew conversation log (messages on the build's bus thread).
 *   2. The working context (goal, plan, keyDecisions, file map, instructions).
 *
 * Retrieval is BM25 over tokenized docs; every answer returns CITATIONS (the
 * exact message/decision it came from). Optional local-LLM synthesis is a pure
 * hook — a caller can pass a `synthesize` function (e.g. a LocalModelAdapter)
 * that rewrites the cited evidence into a short answer; when none is given the
 * helper returns the top-ranked cited doc as-is. The core never calls a model,
 * so the whole index/answer path works with zero keys and zero cost.
 *
 * This is the honest mechanism behind "Helper indexes chat history + working
 * context; agents query 'what style did user ask for?'".
 */

import type { CrewMessage } from "./build-message-bus";

// ============================================================================
// Tokenizer + BM25
// ============================================================================

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "for", "of", "in", "on", "to",
  "at", "by", "with", "from", "as", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "these", "those", "i", "you", "we", "they", "he", "she", "what", "which",
  "who", "when", "where", "why", "how", "do", "does", "did", "have", "has", "had", "will",
  "would", "should", "can", "could", "may", "might", "must", "not", "no", "yes", "so", "your",
  "my", "our", "their", "us", "am", "our", "up", "down", "out", "about", "into", "over",
]);

/** Tokenize text to lowercase word stems. Deterministic, punctuation-safe. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

export interface HelperDoc {
  /** stable citation id, e.g. "bus:coder:7" or "ctx:goal" */
  id: string;
  text: string;
  /** short human-readable source label, shown as the citation */
  source: string;
}

export interface HelperHit {
  doc: HelperDoc;
  score: number;
  matchedTerms: string[];
}

/** BM25 ranks `docs` for `query` without mutating input. avgdl guards div-by-zero. */
export function bm25Search(query: string, docs: HelperDoc[]): HelperHit[] {
  const qTerms = Array.from(new Set(tokenize(query)));
  if (qTerms.length === 0) return [];

  if (docs.length === 0) return [];
  const avgdl = docs.reduce((sum, d) => sum + tokenize(d.text).length, 0) / docs.length;

  const k1 = 1.5;
  const b = 0.75;

  const scoring: HelperHit[] = docs
    .map((doc) => {
      const terms = tokenize(doc.text);
      const docLen = terms.length;
      // term frequency per doc (first occurrence count)
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      // document frequency
      const df = (t: string) => docs.filter((d) => tokenize(d.text).includes(t)).length;

      let score = 0;
      const matched: string[] = [];
      for (const t of qTerms) {
        const f = tf.get(t) ?? 0;
        if (f === 0) continue;
        matched.push(t);
        const N = docs.length;
        const dft = Math.max(1, df(t));
        const idf = Math.log(1 + (N - dft + 0.5) / (dft + 0.5));
        const denom = f + k1 * (1 - b + (b * docLen) / avgdl);
        score += idf * ((f * (k1 + 1)) / denom);
      }
      return { doc, score, matchedTerms: matched };
    })
    .filter((h) => h.matchedTerms.length > 0)
    .sort((a, b) => b.score - a.score);

  return scoring;
}

// ============================================================================
// Index + answer
// ============================================================================

export interface HelperContext {
  /** crew conversation log (ascending) — Cite: "bus:<fromRole>:<seq>" */
  conversation?: CrewMessage[];
  /** working context — Cite: "ctx:<field>" */
  workingContext?: {
    goal?: string;
    planSummary?: string;
    keyDecisions?: string[];
    fileMap?: Array<{ path: string; purpose?: string }>;
    projectInstructions?: string;
    recentActivity?: string;
  };
}

/** A synthesizer hook: takes cited evidence and returns a short answer. */
export type HelperSynthesizer = (evidence: HelperHit[], query: string) => Promise<string>;

export interface HelperAnswer {
  query: string;
  /** ranked, cited evidence */
  hits: HelperHit[];
  /** synthesized answer (or the top hit's text when no synthesizer given) */
  answer: string;
  synthesizerUsed: boolean;
}

/** Build the doc corpus from the bus log + working context. */
export function buildHelperDocs(ctx: HelperContext): HelperDoc[] {
  const docs: HelperDoc[] = [];

  for (const m of ctx.conversation ?? []) {
    const text = m.content.trim();
    if (!text) continue;
    const payloadText =
      m.payload && typeof m.payload === "object"
        ? JSON.stringify(m.payload)
        : "";
    docs.push({
      id: `bus:${m.fromRole}:${m.seq}`,
      text: `[${m.kind} ${m.fromRole}]${m.toRole ? " → " + m.toRole : ""}: ${text}${payloadText ? " " + payloadText : ""}`,
      source: `@${m.fromRole}:${m.seq}`,
    });
  }

  const wc = ctx.workingContext ?? {};
  if (wc.goal) docs.push({ id: "ctx:goal", text: `Goal: ${wc.goal}`, source: "working context (goal)" });
  if (wc.planSummary) docs.push({ id: "ctx:plan", text: `Plan: ${wc.planSummary}`, source: "working context (plan)" });
  if (wc.projectInstructions) docs.push({ id: "ctx:instructions", text: `Project instructions: ${wc.projectInstructions}`, source: "working context (instructions)" });
  if (wc.recentActivity) docs.push({ id: "ctx:activity", text: `Recent activity: ${wc.recentActivity}`, source: "working context (activity)" });
  for (const d of wc.keyDecisions ?? []) docs.push({ id: "ctx:decision", text: `Decision: ${d}`, source: "working context (key decisions)" });
  for (const f of wc.fileMap ?? []) docs.push({ id: `ctx:file:${f.path}`, text: `File ${f.path}: ${f.purpose ?? ""}`, source: `file map (${f.path})` });

  return docs;
}

/**
 * Answer a crew question from indexed conversation + working context.
 * Deterministic core: BM25-ranked cited evidence. When `synthesize` is given
 * (e.g. a local Ollama adapter), the evidence is rewritten into a short answer.
 */
export async function askHelper(
  projectId: string,
  query: string,
  opts: {
    context?: HelperContext;
    synthesize?: HelperSynthesizer;
    topK?: number;
  } = {}
): Promise<HelperAnswer> {
  void projectId; // index is per-build, not per-project; kept for the call contract
  const docs = buildHelperDocs(opts.context ?? {});
  const topK = opts.topK ?? 3;
  const hits = bm25Search(query, docs).slice(0, topK);
  void hits;

  if (hits.length === 0) {
    return {
      query,
      hits: [],
      answer: "No evidence in the build's conversation or working context answers that question.",
      synthesizerUsed: false,
    };
  }

  if (opts.synthesize) {
    try {
      const answer = await opts.synthesize(hits, query);
      return { query, hits, answer, synthesizerUsed: true };
    } catch {
      // fall back to cited raw evidence — never fail the crew because Ollama hiccuped
    }
  }

  const answer = hits
    .map((h) => `[${h.doc.source}] ${h.doc.text}`)
    .join("\n---\n");
  return { query, hits, answer, synthesizerUsed: false };
}

/** Strictly-a-citation check: did helper actually find a source, not improvise? */
export function hasCitedConfidence(answer: HelperAnswer, minHits = 1): boolean {
  return answer.hits.length >= minHits && answer.hits.every((h) => h.matchedTerms.length > 0);
}