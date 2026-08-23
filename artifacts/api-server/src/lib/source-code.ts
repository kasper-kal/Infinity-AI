import { existsSync } from "fs";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import path from "path";

/**
 * Root of the repository. All file access is resolved inside this directory
 * and strictly blocked from escaping it (path-traversal safe).
 *
 * The API server runs with cwd = <repo>/artifacts/api-server, but we walk up
 * to the workspace root (marked by pnpm-workspace.yaml) so this stays correct
 * regardless of where the process is started from.
 */
export const REPO_ROOT = ((): string => {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    if (existsSync(path.join(dir, ".git")) && existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "..");
})();

/** Files/dirs Infinity must never read, secrets and his own runtime instructions. */
// NOTE: dot-prefixed names must use (^|[/\\]) anchors, a leading `\b` never
// matches before a `.` when it follows a `/`, which would leak .git/.env/etc.
export const BLOCKED_PATTERNS: RegExp[] = [
  /\bnode_modules\b/,
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])\.env(\..*)?$/,
  /\.(log|tsbuildinfo)$/,
  /\bdist\b/,
  /\bcoverage\b/,
  // His own operating prompt, the exact code he's "currently using to work".
  /config\/jarvis\.ts$/,
  // Internal working docs — continuity state, not source code.
  /(^|[/\\])(KNOWLEDGE|session-brief)\.md$/,
  /(^|[/\\])\.daytona([/\\]|$)/,
];

export function isBlocked(rel: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(rel));
}

/** Resolve a repository-relative path inside REPO_ROOT or return null. */
export function safeResolve(rel: string): string | null {
  const normalized = path.normalize(rel).replace(/^([/\\])+/, "");
  const abs = path.resolve(REPO_ROOT, normalized);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) return null;
  if (isBlocked(abs.replace(REPO_ROOT, ""))) return null;
  return abs;
}

/** List the repository file tree (relative paths), excluding blocked entries. */
export async function listSourceFiles(limit = 2000): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = abs.replace(REPO_ROOT, "").replace(/^[/\\]/, "");
      if (isBlocked(relPath)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        out.push(relPath);
      }
      if (out.length >= limit) break;
    }
  };
  await walk(REPO_ROOT);
  return out.sort();
}

/** Write a file to the repository with path-traversal + blocked-pattern safety.
 *  Returns old content if the file existed (for diff display), or null. */
export async function writeSourceFile(
  rel: string,
  content: string,
): Promise<
  | { ok: true; path: string; bytesWritten: number; oldContent: string | null }
  | { ok: false; error: string }
> {
  const abs = safeResolve(rel);
  if (!abs) return { ok: false, error: "Path not allowed (outside the repository or blocked)." };
  let oldContent: string | null = null;
  try {
    oldContent = await readFile(abs, "utf8");
  } catch { /* file doesn't exist yet, that's fine */ }
  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return { ok: true, path: rel, bytesWritten: content.length, oldContent };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Write failed." };
  }
}

/** Read a single file (text, capped) or return an error object. */
export async function readSourceFile(
  rel: string,
  cap = 30_000,
): Promise<
  | { ok: true; path: string; size: number; content: string; truncated: boolean }
  | { ok: false; error: string }
> {
  const abs = safeResolve(rel);
  if (!abs) return { ok: false, error: "Path not allowed (outside the repository or blocked)." };
  const s = await stat(abs);
  if (!s.isFile()) return { ok: false, error: "Not a file." };
  const raw = await readFile(abs, "utf8");
  return {
    ok: true,
    path: rel,
    size: raw.length,
    content: raw.slice(0, cap),
    truncated: raw.length > cap,
  };
}
