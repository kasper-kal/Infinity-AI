/**
 * Phase 3.2: Project-Scoped Memory Integration for Build Mode.
 *
 * Assembles a PROJECT CONTEXT block for a build project by reusing the existing
 * Projects system as a single source of truth:
 *   - Project instructions (explicit rules, project-scoped)
 *   - Project memory (learned facts, keyword-scored)
 *   - Recent activity (last N actions)
 *   - File index (all tracked project files)
 *
 * Strictly filtered by projectId: when the build's projectId does not match a
 * real project row, the function returns null and the build proceeds without
 * injected context (no cross-project leakage, no fabricated memory).
 *
 * Note: build projects are keyed by an arbitrary `projectId` (often "default"
 * or the workspace id) that is NOT guaranteed to be a `projects.id` UUID. The
 * guard below keeps that safe — only genuine project rows contribute context.
 */
import {
  db,
  projects,
  projectInstructions,
  projectActivity,
  projectFiles,
} from "@workspace/db";
import { eq, desc, asc, sql } from "drizzle-orm";
import { buildRelevantProjectMemoryContext } from "./project-memory";

export interface BuildProjectContextOptions {
  includeActivity?: boolean;
  includeFiles?: boolean;
  activityLimit?: number;
  fileLimit?: number;
}

/**
 * Build the PROJECT CONTEXT block for a build project. Returns null when either
 * the project does not exist or none of its scoped sources yield content.
 */
export async function buildProjectContextForBuild(
  projectId: string,
  userMessage: string,
  options: BuildProjectContextOptions = {},
): Promise<string | null> {
  const includeActivity = options.includeActivity !== false;
  const includeFiles = options.includeFiles !== false;
  const activityLimit = Math.min(options.activityLimit ?? 20, 50);
  const fileLimit = Math.min(options.fileLimit ?? 50, 100);

  // Strict scoping: only real project rows contribute context.
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      instructions: projects.instructions,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return null;

  const parts: string[] = [
    `## PROJECT CONTEXT (from Infinity project '${project.name}')`,
  ];

  // 1. Project instructions — explicit rules, scoped API takes precedence.
  let instructions = project.instructions?.trim() ?? "";
  try {
    const instructionRows = await db
      .select({ text: projectInstructions.text })
      .from(projectInstructions)
      .where(eq(projectInstructions.projectId, projectId))
      .orderBy(asc(projectInstructions.sortOrder), asc(projectInstructions.createdAt));
    const dedicated = instructionRows.map((r) => r.text.trim()).filter(Boolean);
    if (dedicated.length > 0) instructions = dedicated.join("\n");
  } catch { /* legacy instructions survive if the table is unavailable */ }
  if (instructions) {
    parts.push(
      "### PROJECT INSTRUCTIONS\n" +
      "Follow these explicit project rules whenever they apply:\n" +
      instructions,
    );
  }

  // 2. Project memory — keyword-scored, reuses the chat pipeline.
  try {
    const memory = await buildRelevantProjectMemoryContext(projectId, userMessage);
    if (memory) parts.push(memory);
  } catch (err) {
    console.warn({ err, projectId }, "Build project memory retrieval failed; continuing without it");
  }

  // 3. Recent activity — last N scoped actions.
  if (includeActivity) {
    try {
      const activity = await db
        .select({ type: projectActivity.type, description: projectActivity.description })
        .from(projectActivity)
        .where(eq(projectActivity.projectId, projectId))
        .orderBy(desc(projectActivity.createdAt))
        .limit(activityLimit);
      if (activity.length > 0) {
        parts.push(
          "### RECENT PROJECT ACTIVITY\n" +
          "Recent actions in this project (most recent first):\n" +
          activity.map((a) => `- [${a.type}] ${a.description}`).join("\n"),
        );
      }
    } catch (err) {
      console.warn({ err, projectId }, "Build project activity retrieval failed; continuing without it");
    }
  }

  // 4. File index — all tracked project files (reference material).
  if (includeFiles) {
    try {
      const pf = await db
        .select({ name: projectFiles.name })
        .from(projectFiles)
        .where(eq(projectFiles.projectId, projectId))
        .orderBy(desc(projectFiles.createdAt))
        .limit(fileLimit);
      if (pf.length > 0) {
        parts.push(
          "### PROJECT FILES\n" +
          "Reference material available in this project:\n" +
          pf.map((f) => `- ${f.name}`).join("\n"),
        );
      }
    } catch (err) {
      console.warn({ err, projectId }, "Build project files retrieval failed; continuing without it");
    }
  }

  if (parts.length <= 1) return null; // Header only — nothing to inject
  return parts.join("\n\n");
}

/**
 * Phase 6.2: Honor project conventions — read CLAUDE.md / .cursorrules /
 * AGENTS.md and package.json scripts / tsconfig / vitest / eslint config from
 * the WORKSPACE into the agent context, so generated code follows the
 * project's own rules instead of generic defaults.
 */
import { readWorkspaceFileText, getWorkspaceRoot, listWorkspaceFiles, runGit } from "./workspace";

async function readNonEmpty(relPath: string, workspaceId: string): Promise<string | null> {
  try {
    const content = (await readWorkspaceFileText(relPath, workspaceId)).trim();
    return content ? content : null;
  } catch {
    return null;
  }
}

const CONVENTION_FILES: Array<[relPath: string, label: string]> = [
  ["CLAUDE.md", "CLAUDE.md (agent instructions — follow these)"],
  ["AGENTS.md", "AGENTS.md (agent instructions — follow these)"],
  [".cursorrules", ".cursorrules (project rules — follow these)"],
  ["README.md", "README.md (project README — follow its setup/commands)"],
];

/**
 * Build a CONVENTIONS block from the workspace's own config files. Returns null
 * when nothing meaningful exists. Reads are best-effort — any failure skips
 * that file silently.
 */
export async function buildProjectConventionsContext(workspaceId: string): Promise<string | null> {
  const parts: string[] = [];

  // 1. Agent rule files the human may have dropped in the workspace.
  for (const [relPath, label] of CONVENTION_FILES) {
    const content = await readNonEmpty(relPath, workspaceId);
    if (content) {
      parts.push(`### ${label}\n${content.slice(0, 4000)}`);
    }
  }

  // 2. package.json scripts — the project's own command surface. Read raw to
  //    avoid our reader's JSON decode assumptions; fall back silently.
  try {
    const pkg = await readNonEmpty("package.json", workspaceId);
    const raw = pkg ? JSON.parse(pkg.slice(0, 20_000)) as { scripts?: Record<string, string>; name?: string } : null;
    const scripts = raw?.scripts && Object.keys(raw.scripts).length > 0
      ? Object.entries(raw.scripts).map(([name, cmd]) => `- ${name}: ${cmd}`).join("\n")
      : "";
    const name = raw?.name ? `Project name: ${raw.name}` : "";
    if (scripts || name) {
      parts.push(`### package.json\n${[name, "Available npm scripts (prefer these over guessing):", scripts].filter(Boolean).join("\n")}`);
    }
  } catch {
    // unparseable package.json — skip
  }

  // 3. tsconfig / vitest / eslint presence — tell the agent which toolchain the
  //    project commits to so verification and config edits use the right files.
  const toolchain: string[] = [];
  if (await readNonEmpty("tsconfig.json", workspaceId)) toolchain.push("tsconfig.json");
  for (const name of ["vitest.config.ts", "vitest.config.mts", "vitest.config.js"]) {
    if (await readNonEmpty(name, workspaceId)) toolchain.push(name);
  }
  for (const name of ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", ".eslintrc.json"]) {
    if (await readNonEmpty(name, workspaceId)) toolchain.push(name);
  }
  if (toolchain.length > 0) {
    parts.push(`### Toolchain config files present\n${toolchain.map((t) => `- ${t}`).join("\n")} (align new code with these; do not duplicate or contradict them)`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Build the combined memory block for the build loop: the Phase 3.1 working
 * context (fileMap, keyDecisions, errorPatterns) AND the Phase 3.2 project
 * context (instructions, memory, activity, files). Returns null when both are
 * empty. Used as a single additive section in build prompts.
 */
export function combineBuildMemory(
  workingContextPrompt: string,
  projectContextPrompt: string | null,
): string | null {
  const sections: string[] = [];
  if (workingContextPrompt.trim()) sections.push(workingContextPrompt);
  if (projectContextPrompt) sections.push(projectContextPrompt);
  if (sections.length === 0) return null;
  return sections.join("\n\n");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Phase F (R2: "The Model Sees Bytes") — real file bytes at decision points.
 *
 * 3.1 — the planner reasons over REAL file contents + repo context, not a
 *       path-only map. A path list told the model nothing about the code it
 *       was planning changes to.
 * 3.2 — the repo's command surface (package.json scripts + deps), the git
 *       file tree, and the README/CLAUDE head are inlined so the plan aligns
 *       with the project's own conventions from the first decision.
 *
 * Everything is best-effort and token-capped: reads never throw, a missing or
 * empty workspace yields "" (never a fabricated listing), and the largest
 * blocks are head-truncated. This is the thing that kills the "silent
 * zero-write ok" failure mode the gate calls out — the model sees what it is
 * about to change.
 * ──────────────────────────────────────────────────────────────────────────── */

const SKIP_CONTENT = /(^|\/)(node_modules|dist|build|coverage|\.git|\.tmp)(\/|$)|\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|zip|tar|gz|pdf|lock)$|^\\.env/i;

/**
 * Real workspace bytes + repo context for a build's planning/decision step.
 * Returns "" when the workspace is empty.
 */
export async function buildWorkspaceContentContext(
  workspaceId: string,
  options: { treeCap?: number; readmeChars?: number; fileHeadChars?: number; fileCap?: number; contentBudgetChars?: number } = {},
): Promise<string> {
  const { treeCap = 80, readmeChars = 1_200, fileHeadChars = 1_500, fileCap = 24, contentBudgetChars = 8_000 } = options;
  const sections: string[] = [];
  let contentBudget = contentBudgetChars;

  const read = async (rel: string): Promise<string | null> => {
    try {
      const text = (await readWorkspaceFileText(rel, workspaceId)).trim();
      return text || null;
    } catch {
      return null;
    }
  };

  const push = (text: string | null | undefined) => {
    if (text?.trim()) sections.push(text.trim());
  };

  // 1. Git-tracked file tree (git ls-files; falls back to a workspace walk).
  let tracked: string[] = [];
  try {
    const { ok, stdout } = await runGit(getWorkspaceRoot(workspaceId), ["ls-files"]);
    if (ok) tracked = stdout.split("\n").map((p) => p.trim()).filter(Boolean);
  } catch {
    const entries = await listWorkspaceFiles(workspaceId).catch(() => []);
    tracked = entries.filter((e) => e.type === "file" && !SKIP_CONTENT.test(e.path)).map((e) => e.path);
  }
  const relevant = tracked.filter((p) => p && !SKIP_CONTENT.test(p));
  if (relevant.length > 0) {
    push(`### Git-tracked files (${relevant.length})\n${relevant.slice(0, treeCap).join("\n")}${relevant.length > treeCap ? `\n… ${relevant.length - treeCap} more` : ""}`);
  }

  // 2. package.json — the repo's command surface + pinned deps (3.2).
  try {
    const raw = await read("package.json");
    const parsed = raw
      ? JSON.parse(raw) as { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      : null;
    if (parsed) {
      const scripts = Object.entries(parsed.scripts ?? {}).map(([n, cmd]) => `- ${n}: ${cmd}`);
      const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) } as Record<string, string>;
      const depNames = Object.keys(deps);
      const depList = depNames.slice(0, 60).map((d) => `- ${d}${deps[d] ? `@${deps[d]}` : ""}`);
      push([
        "### package.json",
        parsed.name ? `name/version: ${parsed.name}` : undefined,
        scripts.length > 0 ? `scripts:\n${scripts.join("\n")}` : undefined,
        depNames.length > 0 ? `dependencies (${depNames.length}):\n${depList.join("\n")}${depNames.length > 60 ? `\n… ${depNames.length - 60} more` : ""}` : undefined,
      ].filter((x): x is string => Boolean(x)).join("\n"));
    }
  } catch {
    // unparseable package.json — its bytes get inlined below if it survives the skip list
  }

  // 3. README / CLAUDE head — the project's own rules and entry docs.
  for (const [rel, label] of [["README.md", "README (head)"], ["CLAUDE.md", "CLAUDE.md (agent rules — follow these)"]] as const) {
    const head = await read(rel);
    if (head) push(`### ${label}\n${head.slice(0, readmeChars)}${head.length > readmeChars ? "\n… (truncated)" : ""}`);
  }

  // 4. REAL FILE BYTES for the most decision-relevant small files (3.1),
  //    priority-ordered, head-capped each, whole block budget-capped.
  const priority = (p: string) =>
    /(^|\/)(index\.html|src\/main|src\/App|src\/index|vite\.config|tsconfig|tailwind\.config|next\.config|astro\.config|nuxt\.config)(\.|$)/.test(p) ? 0
      : /\.(json|config\.(ts|js|mjs))$/.test(p) ? 1
      : /\.(ts|tsx|js|jsx|mjs|mts)$/.test(p) ? 2
      : /\.(css|html|md)$/.test(p) ? 3
      : 4;
  const contentCandidates = [...new Set(relevant)].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  const forbidden = new Set(["package.json", "README.md", "CLAUDE.md"]);
  const inlined: string[] = [];
  for (const p of contentCandidates) {
    if (forbidden.has(p)) continue;
    if (inlined.length >= fileCap || contentBudget <= 0) break;
    const text = await read(p);
    if (!text) continue;
    const head = text.length > fileHeadChars ? `${text.slice(0, fileHeadChars)}\n… (truncated)` : text;
    contentBudget -= head.length + p.length + 24;
    inlined.push(`### ${p}\n${head}`);
  }
  if (inlined.length > 0) push(`### Real file contents (decision points)\n${inlined.join("\n\n")}`);

  return sections.join("\n\n");
}

/**
 * Phase F 3.1 — inline the REAL bytes of a specific set of files (e.g. the
 * files a plan declares it will touch) so a per-step coder call starts with
 * the actual file it is about to change. Files that don't exist yet (new
 * files) or fail to read are silently skipped. Returns "" when nothing reads.
 */
export async function buildFilesContentContext(
  workspaceId: string,
  paths: string[],
  options: { headChars?: number; cap?: number; budgetChars?: number } = {},
): Promise<string> {
  const { headChars = 1_200, cap = 12, budgetChars = 6_000 } = options;
  const sections: string[] = [];
  let budget = budgetChars;
  for (const p of [...new Set(paths)].filter((x) => x && !SKIP_CONTENT.test(x)).slice(0, cap)) {
    if (budget <= 0) break;
    try {
      const text = (await readWorkspaceFileText(p, workspaceId)).trim();
      if (!text) continue;
      const head = text.length > headChars ? `${text.slice(0, headChars)}\n… (truncated)` : text;
      budget -= head.length + p.length + 12;
      sections.push(`### ${p}\n${head}`);
    } catch {
      // file doesn't exist yet (commonly a NEW file this plan will create)
    }
  }
  return sections.length > 0 ? `## FILES DECLARED FOR THIS WORK (REAL BYTES)\n${sections.join("\n\n")}` : "";
}
