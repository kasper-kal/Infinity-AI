/**
 * Book Studio — style-sample reader.
 *
 * Scans the repo's `Books/` folder (the user drops real book excerpts in
 * there — it WILL be updated often, so we re-scan on every call, never cache
 * the folder listing) and returns a few pages of each as style reference.
 *
 * For the LLM prompts we want a bounded, curated sample: the opening of each
 * book is usually where the author's voice is strongest, so we take the first
 * `maxChars` characters per file. PDFs are parsed with pdf-parse (the same
 * parser chat attachments use); plain text is read directly.
 *
 * Everything here is defensive — a corrupt PDF, an unreadable file or a
 * missing folder must never take the studio down. Per-file failures are
 * recorded and skipped, the rest still ship.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";

export interface BookStyleSample {
  file: string;
  /** "txt" | "pdf" */
  kind: "txt" | "pdf";
  /** Best-guess language, derived from the sample text (en/nl/other). */
  language: "en" | "nl" | "other";
  excerpt: string;
  chars: number;
  error?: string;
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

/** Books/ lives at the repo root. */
export function booksFolder(): string {
  return path.join(findRepoRoot(), "Books");
}

/**
 * Very light language sniffing — enough to label a sample so the studio can
 * hint "use samples written in your book's language". Counts common English
 * vs Dutch stopwords and lets the majority win.
 */
const EN_STOP = new Set("the and of to a in it is was for on with as at be this from or had have are they that his her you".split(" "));
const NL_STOP = new Set("de het een en van dat niet is op voor in met als aan te om ook maar zijn er wordt hij zij".split(" "));

export function sniffLanguage(text: string): "en" | "nl" | "other" {
  const words = text.toLowerCase().match(/[a-zà-ÿ]{2,}/g) ?? [];
  if (words.length === 0) return "other";
  let en = 0;
  let nl = 0;
  for (const w of words) {
    if (EN_STOP.has(w)) en += 1;
    if (NL_STOP.has(w)) nl += 1;
  }
  if (en === 0 && nl === 0) return "other";
  return nl > en * 1.15 ? "nl" : "en";
}

/** Open the PDF and pull its opening text (bounded). */
async function extractPdfText(filePath: string, maxChars: number): Promise<string> {
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return (parsed.text ?? "").slice(0, maxChars);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export interface SampleOptions {
  /** Max characters sampled per book. Default 6000 (~2-3 A5 pages). */
  maxCharsPerBook?: number;
  /** Skip books whose extracted text is shorter than this. Default 200. */
  minChars?: number;
  /** Hard cap on how many samples are returned. Default 12. */
  maxBooks?: number;
}

/**
 * Read a few pages from every book in Books/. Re-scans the folder each call —
 * the folder changes often, so never cache it.
 */
export async function loadBookSamples(opts: SampleOptions = {}): Promise<BookStyleSample[]> {
  const maxCharsPerBook = opts.maxCharsPerBook ?? 6000;
  const minChars = opts.minChars ?? 200;
  const maxBooks = opts.maxBooks ?? 12;

  const folder = booksFolder();
  if (!existsSync(folder)) return [];

  let entries: string[] = [];
  try {
    entries = await readdir(folder);
  } catch {
    return [];
  }

  const files = entries
    .filter((name) => /\.(txt|md|pdf)$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, maxBooks);

  const samples: BookStyleSample[] = [];
  for (const name of files) {
    const filePath = path.join(folder, name);
    try {
      const isPdf = /\.pdf$/i.test(name);
      const raw = isPdf ? await extractPdfText(filePath, maxCharsPerBook) : (await readFile(filePath, "utf8")).slice(0, maxCharsPerBook);
      const excerpt = raw.trim();
      if (excerpt.length < minChars) {
        samples.push({ file: name, kind: isPdf ? "pdf" : "txt", language: "other", excerpt: "", chars: 0, error: "too short" });
        continue;
      }
      samples.push({
        file: name,
        kind: isPdf ? "pdf" : "txt",
        language: sniffLanguage(excerpt),
        excerpt,
        chars: excerpt.length,
      });
    } catch (err) {
      samples.push({
        file: name,
        kind: /\.pdf$/i.test(name) ? "pdf" : "txt",
        language: "other",
        excerpt: "",
        chars: 0,
        error: err instanceof Error ? err.message.slice(0, 120) : String(err),
      });
    }
  }
  return samples;
}

/**
 * Format samples for a prompt: bounded, labelled, and trimmed to a total
 * budget so a folder of many books never blows the context window.
 */
export function samplesToPrompt(samples: BookStyleSample[], totalBudget = 18_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const s of samples) {
    if (!s.excerpt) continue;
    const budget = Math.max(0, totalBudget - used);
    if (budget <= 0) break;
    const text = s.excerpt.length > budget ? s.excerpt.slice(0, budget) + "\n…" : s.excerpt;
    parts.push(`──── Sample from "${s.file}" (${s.language}) ────\n${text}`);
    used += text.length;
  }
  return parts.join("\n\n");
}
