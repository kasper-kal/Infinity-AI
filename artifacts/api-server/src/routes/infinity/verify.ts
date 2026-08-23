import { Router } from "express";

const router = Router();

interface Evidence { title: string; url: string; snippet: string }
export interface VerifyClaim {
  claim: string;
  verdict: "supported" | "contradicted" | "unverifiable";
  evidence: Evidence[];
  note?: string;
}

/** Split a long assistant answer into individual checkable claim sentences. */
function extractClaims(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9'"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 320);
  // Take at most 4 substantive claims
  return sentences.slice(0, 4);
}

async function searchTavily(query: string): Promise<{ answer?: string; results: Evidence[] }> {
  const apiKey = process.env["TAVILY_API_KEY"] ?? process.env["WEB_SEARCH_API_KEY"];
  if (!apiKey) return { results: [] };
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        include_answer: true,
        max_results: 5,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { results: [] };
    const data = (await res.json()) as {
      answer?: string;
      results?: { title: string; url: string; content: string }[];
    };
    return {
      answer: data.answer,
      results: (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: (r.content ?? "").slice(0, 220),
      })),
    };
  } catch {
    return { results: [] };
  }
}

/** A very small relevance heuristic for verdicts: does the top snippet overlap
 *  the claim's key words? Good enough to power "Check" without a 2nd LLM call. */
function keywordOverlap(claim: string, snippets: string[]): number {
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "to", "of",
    "in", "on", "for", "with", "that", "this", "it", "as", "at", "by", "from",
    "be", "been", "being", "have", "has", "had", "not", "you", "your", "i",
    "we", "they", "he", "she", "it's", "its", "about", "than", "then", "there",
  ]);
  const words = new Set(claim.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !stop.has(w)));
  if (words.size === 0) return 0;
  let hits = 0;
  for (const snippet of snippets) {
    const s = snippet.toLowerCase();
    for (const w of words) if (s.includes(w)) hits++;
  }
  return hits / words.size;
}

/**
 * POST /api/infinity/verify { text }
 * Fact-check an assistant message against the live web (Tavily).
 */
router.post("/verify", async (req, res) => {
  const { text } = (req.body ?? {}) as { text?: unknown };
  if (typeof text !== "string" || text.trim().length < 20) {
    res.status(400).json({ error: "text must be at least 20 characters" });
    return;
  }

  const claims = extractClaims(text);
  if (claims.length === 0) {
    res.json({ ok: true, claims: [], note: "Nothing substantive to verify." });
    return;
  }

  const results: VerifyClaim[] = await Promise.all(
    claims.map(async (claim) => {
      const { answer, results: evidence } = await searchTavily(claim);
      if (evidence.length === 0) {
        return { claim, verdict: "unverifiable" as const, evidence: [], note: "No sources found, could not verify." };
      }
      const overlap = keywordOverlap(claim, [answer ?? "", ...evidence.map((e) => e.snippet)]);
      const verdict: VerifyClaim["verdict"] = overlap >= 0.28 ? "supported" : "unverifiable";
      return {
        claim,
        verdict,
        evidence: evidence.slice(0, 3),
        note: verdict === "supported" ? "Matches published sources." : "Not clearly confirmed by the top sources.",
      };
    }),
  );

  res.json({ ok: true, claims: results });
});

export default router;
