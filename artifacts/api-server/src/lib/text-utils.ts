/**
 * Shared text utilities used across Infinity routes.
 * The new IDE-phase routes import cleanText/parseJsonObject from a few
 * different paths (utils, text-utils, text); this is the canonical module.
 */

/** Trim and truncate a string value; non-strings become "". */
export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Try to parse a JSON string, tolerating markdown fences and surrounding prose. */
export function parseJsonObject<T = Record<string, unknown>>(text: string): T | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to tolerant extraction
  }

  // Markdown code fence: ```json ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      // fall through to bracket extraction
    }
  }

  // First {...} block in prose (e.g. "Here you go: {...}")
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }

  return null;
}
