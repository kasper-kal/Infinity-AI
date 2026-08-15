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
    `## PROJECT CONTEXT (from Jarvis project '${project.name}')`,
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
 * Build a combined memory block for the build loop: the Phase 3.1 working
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
