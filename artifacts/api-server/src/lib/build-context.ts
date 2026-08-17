/**
 * Phase 3.1: Smart Working Context
 *
 * Maintains a compact working context for each build project: file map (purpose,
 * exports, last changed, hash), key decisions, error patterns, and token budget.
 * Compaction keeps the context small while preserving essential history.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getWorkspaceRoot,
  listWorkspaceFiles,
  readWorkspaceFileText,
  safeWorkspacePath,
} from "./workspace";

export interface FileSummary {
  /** Relative path from workspace root */
  path: string;
  /** One-line purpose, inferred or user-supplied */
  purpose: string;
  /** Symbols this file exports (function/class names) */
  exports: string[];
  /** ISO timestamp of last change */
  lastChanged: string;
  /** Short content hash for change detection */
  hash: string;
  /** Byte size */
  size: number;
}

export interface Decision {
  id: string;
  /** What was decided, e.g. "Use React Query not SWR" */
  decision: string;
  /** Why it was chosen */
  rationale: string;
  timestamp: string;
}

export interface ErrorPattern {
  /** Pattern signature, e.g. "missing import from @workspace/db" */
  pattern: string;
  /** How it was resolved */
  resolution: string;
  occurrences: number;
  lastSeen: string;
}

export interface TokenBudget {
  used: number;
  limit: number;
  /** Rolling window of recent usage */
  history: Array<{ timestamp: string; tokens: number }>;
}

export interface WorkingContext {
  projectGoal: string;
  currentPlan: unknown | null;
  completedSteps: StepResult[];
  keyDecisions: Decision[];
  fileMap: Map<string, FileSummary>;
  errorPatterns: ErrorPattern[];
  tokenBudget: TokenBudget;
  /** Compacted summary of older steps (steps 1-N summarized) */
  compactedSummary: string | null;
  /** Agent outputs for multi-agent orchestration handoff tracking */
  agentOutputs?: AgentOutput[];
}

export interface StepResult {
  stepId: string;
  description: string;
  ok: boolean;
  filesChanged: string[];
  timestamp: string;
  notes?: string;
}

const COMPACTION_THRESHOLD = 5;
const TOKEN_BUDGET_DEFAULT = 200_000;

/**
 * In-memory context store keyed by projectId. In a production system this would
 * be persisted (e.g. to the build_checkpoints table), but for now it lives in
 * the process and is seeded from the latest checkpoint on resume.
 */
const contexts = new Map<string, WorkingContext>();

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/** Extract exported symbol names from a TypeScript/JS file's text. */
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const regex = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  // Also catch `export { a, b }` style
  const namedExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    for (const name of match[1].split(",")) {
      const cleaned = name.trim().split(/\s+as\s+/)[0].trim();
      if (cleaned) exports.push(cleaned);
    }
  }
  return [...new Set(exports)].slice(0, 30);
}

/** Lightweight purpose inference from filename + first comment. */
function inferPurpose(relPath: string, content: string): string {
  const base = path.basename(relPath);
  const commentMatch = content.match(/\/\/\s*(.+?)\n/);
  if (commentMatch) return commentMatch[1].slice(0, 120);
  if (/index\.(ts|tsx|js|jsx)$/.test(base)) return `Entry point: ${relPath}`;
  if (/test|spec/.test(base)) return `Test suite: ${relPath}`;
  if (/route|controller/.test(base)) return `Route handler: ${relPath}`;
  if (/component|ui/.test(base)) return `UI component: ${relPath}`;
  if (/schema|model/.test(base)) return `Data model: ${relPath}`;
  return `Source file: ${relPath}`;
}

/** Build or refresh the fileMap from the current workspace state. */
export async function refreshFileMap(
  projectId: string,
  workspaceId = projectId,
): Promise<Map<string, FileSummary>> {
  const root = getWorkspaceRoot(workspaceId);
  const entries = await listWorkspaceFiles(workspaceId);
  const files = entries
    .filter((e) => e.type === "file" && !/^(\.|node_modules|dist|build)/.test(e.path) && /\.(ts|tsx|js|jsx|json|css|html|md)$/.test(e.path))
    .slice(0, 200);

  const fileMap = new Map<string, FileSummary>();
  for (const entry of files) {
    try {
      const content = await readWorkspaceFileText(entry.path, workspaceId);
      const stat = await fs.stat(path.join(root, entry.path));
      fileMap.set(entry.path, {
        path: entry.path,
        purpose: inferPurpose(entry.path, content),
        exports: /\.(ts|tsx|js|jsx)$/.test(entry.path) ? extractExports(content) : [],
        lastChanged: stat.mtime.toISOString(),
        hash: hashContent(content),
        size: stat.size,
      });
    } catch {
      // File may have been deleted between list and read — skip
    }
  }

  const ctx = contexts.get(projectId);
  if (ctx) ctx.fileMap = fileMap;
  return fileMap;
}

/** Get (or lazily create) the working context for a project. */
export function getWorkingContext(projectId: string): WorkingContext {
  let ctx = contexts.get(projectId);
  if (!ctx) {
    ctx = {
      projectGoal: "",
      currentPlan: null,
      completedSteps: [],
      keyDecisions: [],
      fileMap: new Map(),
      errorPatterns: [],
      tokenBudget: { used: 0, limit: TOKEN_BUDGET_DEFAULT, history: [] },
      compactedSummary: null,
    };
    contexts.set(projectId, ctx);
  }
  return ctx;
}

/** Set the project goal and reset relevant state. */
export function setProjectGoal(projectId: string, goal: string): void {
  const ctx = getWorkingContext(projectId);
  ctx.projectGoal = goal;
}

/** Record a completed step, triggering compaction when over threshold. */
export function recordStep(
  projectId: string,
  step: Omit<StepResult, "timestamp">,
): StepResult {
  const ctx = getWorkingContext(projectId);
  const result: StepResult = { ...step, timestamp: new Date().toISOString() };
  ctx.completedSteps.push(result);

  // Compaction: keep last N steps, summarize the rest
  if (ctx.completedSteps.length > COMPACTION_THRESHOLD) {
    const keep = ctx.completedSteps.slice(-COMPACTION_THRESHOLD);
    const old = ctx.completedSteps.slice(0, ctx.completedSteps.length - COMPACTION_THRESHOLD);
    const summary = old
      .map((s) => `Step "${s.stepId}": ${s.ok ? "done" : "failed"} — ${s.description.slice(0, 80)}`)
      .join("; ");
    ctx.compactedSummary = ctx.compactedSummary
      ? `${ctx.compactedSummary} | ${summary}`
      : summary;
    ctx.completedSteps = keep;
  }

  return result;
}

/** Add or update a key decision. */
export function recordDecision(
  projectId: string,
  decision: string,
  rationale: string,
): Decision {
  const ctx = getWorkingContext(projectId);
  const id = `dec-${ctx.keyDecisions.length + 1}-${hashContent(decision).slice(0, 6)}`;
  const entry: Decision = { id, decision, rationale, timestamp: new Date().toISOString() };
  ctx.keyDecisions.push(entry);
  return entry;
}

/** Record an error pattern, merging with existing if signature matches. */
export function recordErrorPattern(
  projectId: string,
  pattern: string,
  resolution: string,
): ErrorPattern {
  const ctx = getWorkingContext(projectId);
  const existing = ctx.errorPatterns.find((e) => e.pattern === pattern);
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeen = new Date().toISOString();
    existing.resolution = resolution;
    return existing;
  }
  const entry: ErrorPattern = {
    pattern,
    resolution,
    occurrences: 1,
    lastSeen: new Date().toISOString(),
  };
  ctx.errorPatterns.push(entry);
  return entry;
}

/** Update token usage against the budget. */
export function trackTokens(projectId: string, tokens: number): TokenBudget {
  const ctx = getWorkingContext(projectId);
  ctx.tokenBudget.used += tokens;
  ctx.tokenBudget.history.push({ timestamp: new Date().toISOString(), tokens });
  // Keep history bounded
  if (ctx.tokenBudget.history.length > 50) {
    ctx.tokenBudget.history = ctx.tokenBudget.history.slice(-50);
  }
  return ctx.tokenBudget;
}

/** Detect if we're approaching the token budget. */
export function isBudgetExhausted(projectId: string): boolean {
  const ctx = getWorkingContext(projectId);
  return ctx.tokenBudget.used >= ctx.tokenBudget.limit;
}

/**
 * Serialize context into a string block for injection into model prompts.
 * Compact, structured, and bounded in size.
 */
export function serializeContext(projectId: string): string {
  const ctx = getWorkingContext(projectId);
  const parts: string[] = [];

  if (ctx.projectGoal) parts.push(`PROJECT GOAL: ${ctx.projectGoal}`);
  if (ctx.compactedSummary) parts.push(`PRIOR WORK (summarized): ${ctx.compactedSummary}`);

  if (ctx.completedSteps.length > 0) {
    parts.push("RECENT STEPS:");
    for (const step of ctx.completedSteps) {
      parts.push(`  - [${step.ok ? "OK" : "FAIL"}] ${step.stepId}: ${step.description.slice(0, 100)}`);
      if (step.filesChanged.length > 0) parts.push(`    files: ${step.filesChanged.join(", ")}`);
    }
  }

  if (ctx.keyDecisions.length > 0) {
    parts.push("KEY DECISIONS:");
    for (const d of ctx.keyDecisions) {
      parts.push(`  - ${d.decision} (${d.rationale.slice(0, 80)})`);
    }
  }

  if (ctx.errorPatterns.length > 0) {
    parts.push("KNOWN ERROR PATTERNS (avoid repeating):");
    for (const e of ctx.errorPatterns) {
      parts.push(`  - ${e.pattern} → resolved by: ${e.resolution.slice(0, 100)} (seen ${e.occurrences}x)`);
    }
  }

  if (ctx.fileMap.size > 0) {
    parts.push(`FILE MAP (${ctx.fileMap.size} files):`);
    for (const [relPath, summary] of ctx.fileMap) {
      const exportInfo = summary.exports.length > 0 ? ` exports: [${summary.exports.slice(0, 8).join(", ")}]` : "";
      parts.push(`  - ${relPath}: ${summary.purpose}${exportInfo}`);
    }
  }

  const budget = ctx.tokenBudget;
  parts.push(`TOKEN BUDGET: ${budget.used}/${budget.limit} used`);

  // Include agent outputs for multi-agent handoff context
  if (ctx.agentOutputs && ctx.agentOutputs.length > 0) {
    parts.push(serializeAgentOutputs(projectId));
  }

  return parts.join("\n");
}

/** Clear context (e.g. on project reset). */
export function clearContext(projectId: string): void {
  contexts.delete(projectId);
}

// ============================================================================
// Multi-Agent Orchestration Extensions
// ============================================================================

export interface AgentOutput {
  stepId: string;
  agentRole: "planner" | "coder" | "reviewer" | "fixer";
  agentId: string;
  timestamp: string;
  summary: string;
  filesChanged: string[];
  toolCalls: any[];
  toolResults: any[];
  error?: string;
  reviewResult?: {
    done: boolean;
    fixRequest?: { files: string[]; issues: string[] };
    deferred?: string[];
  };
}

/**
 * Record an agent's output for a step (for handoff tracking).
 */
export function recordAgentOutput(projectId: string, output: AgentOutput): void {
  const ctx = getWorkingContext(projectId);
  if (!ctx.agentOutputs) {
    ctx.agentOutputs = [];
  }
  ctx.agentOutputs.push(output);
}

/**
 * Get all agent outputs for a project, optionally filtered by stepId.
 */
export function getAgentOutputs(projectId: string, stepId?: string): AgentOutput[] {
  const ctx = getWorkingContext(projectId);
  if (!ctx.agentOutputs) return [];
  if (stepId) {
    return ctx.agentOutputs.filter((o) => o.stepId === stepId);
  }
  return ctx.agentOutputs;
}

/**
 * Get the latest output from a specific agent role for a step.
 */
export function getLatestAgentOutput(
  projectId: string,
  stepId: string,
  agentRole: "planner" | "coder" | "reviewer" | "fixer"
): AgentOutput | undefined {
  const outputs = getAgentOutputs(projectId, stepId);
  const roleOutputs = outputs.filter((o) => o.agentRole === agentRole);
  return roleOutputs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
}

/**
 * Serialize agent outputs for inclusion in prompts.
 */
export function serializeAgentOutputs(projectId: string, stepId?: string): string {
  const outputs = getAgentOutputs(projectId, stepId);
  if (outputs.length === 0) return "";

  const parts = ["AGENT OUTPUTS (handoff context):"];
  for (const output of outputs) {
    parts.push(`  [${output.agentRole.toUpperCase()}] Step ${output.stepId}: ${output.summary}`);
    if (output.filesChanged.length > 0) {
      parts.push(`    files: ${output.filesChanged.join(", ")}`);
    }
    if (output.error) {
      parts.push(`    ERROR: ${output.error}`);
    }
    if (output.reviewResult) {
      parts.push(`    REVIEW: done=${output.reviewResult.done}`);
      if (output.reviewResult.fixRequest) {
        parts.push(`    FIX REQUEST: ${output.reviewResult.fixRequest.issues.join("; ")}`);
      }
    }
  }
  return parts.join("\n");
}

// Extend WorkingContext interface to include agentOutputs
declare module "./build-context" {
  interface WorkingContext {
    agentOutputs?: AgentOutput[];
  }
}
