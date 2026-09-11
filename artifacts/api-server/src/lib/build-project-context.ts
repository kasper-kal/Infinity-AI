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
import { readWorkspaceFileText } from "./workspace";

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
