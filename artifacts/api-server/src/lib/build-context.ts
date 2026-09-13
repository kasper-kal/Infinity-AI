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
import { db } from "@workspace/db";
import { buildCheckpoints } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  compactWorkingContext,
  autoCompactContext as newAutoCompactContext,
  extractPreservationRules,
  createPreservationRules,
  COMPACTION_LEVELS as NEW_COMPACTION_LEVELS,
} from "./context-compactor";

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
  /** Compaction level (1-4) */
  compactionLevel: CompactionLevel;
  /** Last compaction timestamp */
  lastCompaction?: string;
  /** Total original steps before compaction */
  totalStepsOriginal: number;
}

export interface StepResult {
  stepId: string;
  description: string;
  ok: boolean;
  filesChanged: string[];
  timestamp: string;
  notes?: string;
  /** Detailed output for summarization */
  detailedOutput?: string;
  /** Tool calls made in this step */
  toolCalls?: any[];
}

const COMPACTION_THRESHOLD = 5;
const TOKEN_BUDGET_DEFAULT = 200_000;

/**
 * Compaction levels for context management
 */
export type CompactionLevel = 1 | 2 | 3 | 4;

export interface CompactionLevelConfig {
  level: CompactionLevel;
  name: string;
  description: string;
  keepDetailedSteps: number;
  summarizeOldSteps: boolean;
  keepDecisions: boolean;
  keepFileMap: boolean;
  keepErrorPatterns: boolean;
  maxTokens: number;
}

export const COMPACTION_LEVELS: CompactionLevelConfig[] = [
  {
    level: 1,
    name: "Full",
    description: "Keep all steps detailed (short builds)",
    keepDetailedSteps: 999,
    summarizeOldSteps: false,
    keepDecisions: true,
    keepFileMap: true,
    keepErrorPatterns: true,
    maxTokens: 200_000,
  },
  {
    level: 2,
    name: "Compressed",
    description: "Compress old steps, keep last 5 detailed",
    keepDetailedSteps: 5,
    summarizeOldSteps: true,
    keepDecisions: true,
    keepFileMap: true,
    keepErrorPatterns: true,
    maxTokens: 100_000,
  },
  {
    level: 3,
    name: "Decision Log",
    description: "Decision log + file map only (long builds)",
    keepDetailedSteps: 3,
    summarizeOldSteps: true,
    keepDecisions: true,
    keepFileMap: true,
    keepErrorPatterns: false,
    maxTokens: 50_000,
  },
  {
    level: 4,
    name: "Emergency",
    description: "Goal + current state only (emergency)",
    keepDetailedSteps: 1,
    summarizeOldSteps: true,
    keepDecisions: false,
    keepFileMap: false,
    keepErrorPatterns: false,
    maxTokens: 10_000,
  },
];

/**
 * Compaction trigger conditions
 */
export interface CompactionTrigger {
  type: "token-budget" | "step-count" | "context-size" | "manual";
  threshold: number;
  currentValue: number;
  triggered: boolean;
}

/**
 * Summarizer agent configuration
 */
export interface SummarizerConfig {
  model: "lite" | "high" | "max";
  promptTemplate: string;
  maxOutputTokens: number;
}

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
export const buildFileMap = refreshFileMap;

/** Build or refresh the fileMap from the current workspace state. */
export async function refreshFileMap(
  projectId: string,
  workspaceId = projectId,
): Promise<Map<string, FileSummary>> {
  const root = getWorkspaceRoot(workspaceId);
  const ctx = contexts.get(projectId);
  const goal = ctx?.projectGoal || "";

  const entries = await listWorkspaceFiles(workspaceId);
  const files = entries.filter(
    (e) =>
      e.type === "file" &&
      !/^(\.|node_modules|dist|build)/.test(e.path) &&
      /\.(ts|tsx|js|jsx|json|css|html|md)$/.test(e.path),
  );

  // Phase 4 smart file inclusion: for a large workspace, rank candidates without
  // reading their contents (path keywords + error-pattern references + recency +
  // entry/config boost), read only the top slice, then apply a final cap so the
  // agent sees ~20 relevant files instead of the whole repo. Small workspaces
  // keep every eligible file.
  const SMART_CAP = 20;
  const LARGE_REPO_THRESHOLD = 120;
  const smart = files.length > LARGE_REPO_THRESHOLD && goal.length > 0;

  const fileMap = new Map<string, FileSummary>();
  let candidates = files;

  if (smart) {
    const goalKeywords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const errorPaths = new Set<string>();
    for (const ep of ctx?.errorPatterns ?? []) {
      const m = ep.pattern.match(/([\w@/.-]+\.(ts|tsx|js|jsx|json|css|html|md))/);
      if (m) errorPaths.add(m[1].replace(/^\.\//, ""));
    }
    const now = Date.now();

    const stats = new Map<string, { mtime: number; size: number }>();
    for (const e of files) {
      try {
        const st = await fs.stat(path.join(root, e.path));
        stats.set(e.path, { mtime: st.mtime.getTime(), size: st.size });
      } catch {
        stats.set(e.path, { mtime: 0, size: 0 });
      }
    }

    const scored = files
      .map((e) => {
        const p = e.path.toLowerCase();
        let score = 0;
        for (const kw of goalKeywords) if (p.includes(kw)) score += 3;
        if (errorPaths.has(e.path)) score += 4;
        if (
          /index\.(ts|tsx|js|jsx)$/.test(e.path) ||
          /^(package\.json|tsconfig\.json|vite\.config\.|next\.config\.|src\/main\.|src\/app\.)/.test(p)
        ) score += 2;
        const st = stats.get(e.path);
        if (st && now - st.mtime < 24 * 60 * 60 * 1000) score += 5; // edited in the last 24h
        return { entry: e, score };
      })
      .sort((a, b) => b.score - a.score);

    // Read ~3x the cap so purpose/export matches can still win the final cut.
    candidates = scored.slice(0, SMART_CAP * 3).map((s) => s.entry);
  }

  for (const entry of candidates) {
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

  if (smart) {
    // Final smart cut: re-rank the read slice by goal purpose/export matches +
    // recency, always keep entry/config files, cap at SMART_CAP.
    const goalKeywords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const ranked = Array.from(fileMap.entries())
      .map(([relPath, summary]) => {
        let score = 0;
        for (const kw of goalKeywords) {
          if (
            summary.purpose.toLowerCase().includes(kw) ||
            summary.exports.some((x) => x.toLowerCase().includes(kw))
          ) score += 4;
          else if (`${relPath} ${summary.purpose}`.toLowerCase().includes(kw)) score += 1;
        }
        if (
          /index\.(ts|tsx|js|jsx)$/.test(relPath) ||
          /^(package\.json|tsconfig\.json|vite\.config\.|next\.config\.|src\/main\.|src\/app\.)/.test(relPath)
        ) score += 8;
        if (Date.now() - new Date(summary.lastChanged).getTime() < 24 * 60 * 60 * 1000) score += 3;
        return { relPath, summary, score };
      })
      .sort((a, b) => b.score - a.score);

    fileMap.clear();
    for (const entry of ranked.slice(0, SMART_CAP)) fileMap.set(entry.relPath, entry.summary);
  }

  const context = getWorkingContext(projectId);
  context.fileMap = fileMap;
  void saveWorkingContextToDisk(projectId, workspaceId);
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
      compactionLevel: 1,
      totalStepsOriginal: 0,
    };
    contexts.set(projectId, ctx);
  }
  // Ensure new fields exist for backward compatibility
  if (ctx.compactionLevel === undefined) ctx.compactionLevel = 1;
  if (ctx.totalStepsOriginal === undefined) ctx.totalStepsOriginal = 0;
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
  ctx.totalStepsOriginal += 1;

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

  // Phase 4: persist to .infinity/working-context.json so a kill/restart never
  // loses the plot, and run the 4-level auto-compactor in the live agent loop.
  void saveWorkingContextToDisk(projectId);
  maybeAutoCompact(projectId);

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
  // Token usage is the primary compaction trigger — fire-and-forget both the
  // disk persistence and the 4-level auto-compaction check.
  void saveWorkingContextToDisk(projectId);
  maybeAutoCompact(projectId);
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

/**
 * ============================================================
 * CONTEXT COMPRESSION & SUMMARIZATION
 * ============================================================
 */

/**
 * Determine if compaction should trigger
 */
export function checkCompactionTriggers(projectId: string): CompactionTrigger[] {
  const ctx = getWorkingContext(projectId);
  const triggers: CompactionTrigger[] = [];

  // Token budget trigger (>80%)
  const tokenUsage = (ctx.tokenBudget.used / ctx.tokenBudget.limit) * 100;
  triggers.push({
    type: "token-budget",
    threshold: 80,
    currentValue: tokenUsage,
    triggered: tokenUsage >= 80,
  });

  // Step count trigger (>10)
  triggers.push({
    type: "step-count",
    threshold: 10,
    currentValue: ctx.totalStepsOriginal,
    triggered: ctx.totalStepsOriginal > 10,
  });

  // Context size trigger (>50k tokens estimated)
  const estimatedTokens = estimateContextTokens(ctx);
  triggers.push({
    type: "context-size",
    threshold: 50_000,
    currentValue: estimatedTokens,
    triggered: estimatedTokens > 50_000,
  });

  return triggers;
}

/**
 * Estimate token count of serialized context
 */
function estimateContextTokens(ctx: WorkingContext): number {
  // Rough estimate based on context components
  let estimate = 0;
  if (ctx.projectGoal) estimate += ctx.projectGoal.length;
  if (ctx.compactedSummary) estimate += ctx.compactedSummary.length;
  estimate += ctx.completedSteps.length * 150; // ~150 chars per step
  estimate += ctx.keyDecisions.length * 100; // ~100 chars per decision
  estimate += ctx.errorPatterns.length * 120; // ~120 chars per error pattern
  estimate += ctx.fileMap.size * 80; // ~80 chars per file entry
  estimate += JSON.stringify(ctx.tokenBudget).length;
  // Rough estimate: ~4 chars per token
  return Math.ceil(estimate / 4);
}

/**
 * Auto-compact context based on triggers - uses new context-compactor.ts pipeline
 */
export async function autoCompactContext(projectId: string): Promise<CompactionLevel> {
  const ctx = getWorkingContext(projectId);
  const triggers = checkCompactionTriggers(projectId);
  const triggered = triggers.filter(t => t.triggered);

  if (triggered.length === 0) {
    return ctx.compactionLevel;
  }

  // Determine target level based on severity
  let targetLevel: CompactionLevel = 1;
  for (const trigger of triggered) {
    if (trigger.type === "token-budget" && trigger.currentValue >= 95) targetLevel = Math.max(targetLevel, 4) as CompactionLevel;
    else if (trigger.type === "token-budget" && trigger.currentValue >= 90) targetLevel = Math.max(targetLevel, 3) as CompactionLevel;
    else if (trigger.type === "token-budget" && trigger.currentValue >= 80) targetLevel = Math.max(targetLevel, 2) as CompactionLevel;
    else if (trigger.type === "step-count" && trigger.currentValue > 20) targetLevel = Math.max(targetLevel, 3) as CompactionLevel;
    else if (trigger.type === "step-count" && trigger.currentValue > 10) targetLevel = Math.max(targetLevel, 2) as CompactionLevel;
    else if (trigger.type === "context-size" && trigger.currentValue > 100_000) targetLevel = Math.max(targetLevel, 3) as CompactionLevel;
    else if (trigger.type === "context-size" && trigger.currentValue > 50_000) targetLevel = Math.max(targetLevel, 2) as CompactionLevel;
  }

  // Avoid re-compacting to the same or a weaker level on every turn.
  if (targetLevel <= ctx.compactionLevel) return ctx.compactionLevel;

  // Report the trigger that pushed the highest ratio (the honest cause).
  const strongestTrigger = triggered.reduce((best, t) =>
    t.currentValue / t.threshold > best.currentValue / best.threshold ? t : best,
    triggered[0],
  );

  // Use the new context-compactor for working context compaction
  await compactContext(projectId, targetLevel, strongestTrigger.type);
  return targetLevel;
}

/**
 * Phase 4: fire-and-forget compaction check for the live agent loop. Called from
 * recordStep and trackTokens on every turn/step. Failures are swallowed so a
 * compaction hiccup never breaks the build.
 */
export function maybeAutoCompact(projectId: string): void {
  autoCompactContext(projectId).catch((err) => {
    console.error(`[build-context] auto-compaction failed for ${projectId}:`, err);
  });
}

/**
 * Compact context to a specific level - delegates to context-compactor for working context
 */
export async function compactContext(
  projectId: string,
  level: CompactionLevel,
  trigger: CompactionTrigger["type"] = "manual",
): Promise<void> {
  const ctx = getWorkingContext(projectId);
  const config = COMPACTION_LEVELS.find(c => c.level === level)!;
  const startedAt = Date.now();

  // Phase 4: capture before-state so we can report an honest compaction event.
  const beforeSteps = ctx.completedSteps.length;
  const beforeTokens = estimateContextTokens(ctx);
  const hadPlan = !!ctx.currentPlan;
  const hadGoal = !!ctx.projectGoal;

  // Summarize old steps using LLM (or fallback)
  if (config.summarizeOldSteps && ctx.completedSteps.length > config.keepDetailedSteps) {
    const stepsToSummarize = ctx.completedSteps.slice(0, ctx.completedSteps.length - config.keepDetailedSteps);
    const summary = await summarizeSteps(stepsToSummarize, projectId);

    ctx.compactedSummary = ctx.compactedSummary
      ? `${ctx.compactedSummary} | ${summary}`
      : summary;

    ctx.completedSteps = ctx.completedSteps.slice(-config.keepDetailedSteps);
  }

  // Use new context-compactor for working context compression (preserves fileMap, decisions, errors)
  const preserveRules = extractPreservationRules([], {
    fileMap: Object.fromEntries(ctx.fileMap),
    keyDecisions: ctx.keyDecisions,
    errorPatterns: ctx.errorPatterns,
    currentPlan: ctx.currentPlan,
    originalGoal: ctx.projectGoal,
    projectInstructions: [],
  });

  const compactResult = compactWorkingContext(ctx, level, preserveRules);

  // Apply compressed working context back to ctx
  if (compactResult.compacted && compactResult.compacted !== ctx) {
    const compressed = compactResult.compacted;
    if (compressed.keyDecisions) ctx.keyDecisions = compressed.keyDecisions;
    if (compressed.errorPatterns) ctx.errorPatterns = compressed.errorPatterns;
    if (compressed.fileMap) {
      // Convert back to Map
      ctx.fileMap = new Map(Object.entries(compressed.fileMap).map(([path, info]: [string, any]) => [
        path,
        {
          ...ctx.fileMap.get(path)!,
          purpose: info.summary || info.purpose,
          exports: info.symbols || info.exports || []
        }
      ]));
    }
  }

  // Prune decisions if needed (level 3+)
  if (!config.keepDecisions && ctx.keyDecisions.length > 0) {
    ctx.keyDecisions = ctx.keyDecisions.slice(-5); // Keep last 5
  }

  // Prune file map if needed (level 3+)
  if (!config.keepFileMap && ctx.fileMap.size > 50) {
    // Keep only recently changed files
    const entries = Array.from(ctx.fileMap.entries())
      .sort((a, b) => new Date(b[1].lastChanged).getTime() - new Date(a[1].lastChanged).getTime())
      .slice(0, 50);
    ctx.fileMap = new Map(entries);
  }

  // Prune error patterns if needed (level 3+)
  if (!config.keepErrorPatterns) {
    ctx.errorPatterns = ctx.errorPatterns.slice(-10);
  }

  // Update compaction level
  ctx.compactionLevel = level;
  ctx.lastCompaction = new Date().toISOString();

  // Persist to checkpoint + disk
  await persistContextToCheckpoint(projectId);
  void saveWorkingContextToDisk(projectId);

  // Phase 4: emit a real compaction telemetry event (drives CompactionHistory UI).
  const afterTokens = estimateContextTokens(ctx);
  const messagesCompacted = Math.max(0, beforeSteps - ctx.completedSteps.length);
  const eventData = {
    level,
    levelName: config.name,
    trigger,
    tokensBefore: beforeTokens,
    tokensAfter: afterTokens,
    tokensSaved: Math.max(0, beforeTokens - afterTokens),
    messagesCompacted,
    preservedItems: {
      userInstructions: 0,
      projectInstructions: 0,
      fileMapFiles: ctx.fileMap.size,
      errorPatterns: ctx.errorPatterns.length,
      decisions: ctx.keyDecisions.length,
      currentPlan: hadPlan,
      originalGoal: hadGoal,
    },
    description: `Compacted to level ${level} (${config.name}) triggered by ${trigger}`,
    durationMs: Date.now() - startedAt,
  };
  try {
    const { logBuildEvent } = await import("./build-telemetry");
    await logBuildEvent(projectId, "compaction", eventData.description, {
      durationMs: eventData.durationMs,
      data: eventData,
    });
  } catch (err) {
    console.error("[build-context] compaction telemetry failed:", err);
  }
}

/**
 * Summarize steps using LLM (with fallback to simple concatenation)
 */
async function summarizeSteps(steps: StepResult[], projectId: string): Promise<string> {
  const { execa } = await import("execa");
  const workspaceId = projectId;
  const projectPath = getWorkspaceRoot(workspaceId);

  // Try to use a local/small model for summarization
  // Fallback: simple concatenation
  try {
    const stepText = steps.map(s =>
      `Step ${s.stepId}: ${s.description} — ${s.ok ? "SUCCESS" : "FAILED"}${s.filesChanged.length ? ` (files: ${s.filesChanged.join(", ")})` : ""}`
    ).join("\n");

    // In production, this would call a Lite model via LLM adapter
    // For now, return concise summary
    const successCount = steps.filter(s => s.ok).length;
    return `Completed ${steps.length} steps (${successCount} success, ${steps.length - successCount} failed): ${steps.map(s => s.stepId).join(", ")}`;
  } catch {
    return `Completed ${steps.length} steps`;
  }
}

/** Serializable plan payload for a checkpoint — goal, plan, decisions, errors. */
function checkpointPlanPayload(ctx: WorkingContext) {
  return {
    goal: ctx.projectGoal,
    currentPlan: ctx.currentPlan,
    compactionLevel: ctx.compactionLevel,
    compactedSummary: ctx.compactedSummary,
    keyDecisions: ctx.keyDecisions,
    errorPatterns: ctx.errorPatterns,
  };
}

/** Serializable working-context payload for a checkpoint — includes the real fileMap. */
function checkpointWorkingContextPayload(ctx: WorkingContext) {
  return {
    tokenBudget: ctx.tokenBudget,
    fileMap: Object.fromEntries(ctx.fileMap),
    currentPlan: ctx.currentPlan,
    compactionLevel: ctx.compactionLevel,
    lastCompaction: ctx.lastCompaction,
    totalStepsOriginal: ctx.totalStepsOriginal,
  };
}

/**
 * Persist context to checkpoint table — stores the full fileMap (not just its
 * size) and currentPlan so resume can reconstruct the working context exactly.
 */
async function persistContextToCheckpoint(projectId: string): Promise<void> {
  const ctx = getWorkingContext(projectId);

  try {
    await db
      .insert(buildCheckpoints)
      .values({
        projectId,
        iteration: ctx.totalStepsOriginal,
        completed: 0,
        plan: checkpointPlanPayload(ctx),
        completedSteps: ctx.completedSteps,
        workingContext: checkpointWorkingContextPayload(ctx),
        fileSnapshots: null,
        tokenUsage: ctx.tokenBudget,
      })
      .onConflictDoUpdate({
        target: [buildCheckpoints.projectId, buildCheckpoints.iteration],
        set: {
          plan: checkpointPlanPayload(ctx),
          completedSteps: ctx.completedSteps,
          workingContext: checkpointWorkingContextPayload(ctx),
          tokenUsage: ctx.tokenBudget,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Checkpoint persistence failed, continue with in-memory
  }
}

/**
 * Load context from checkpoint
 */
export async function loadContextFromCheckpoint(projectId: string): Promise<WorkingContext | null> {
  const rows = await db
    .select()
    .from(buildCheckpoints)
    .where(eq(buildCheckpoints.projectId, projectId))
    .orderBy(desc(buildCheckpoints.iteration))
    .limit(1);

  if (rows.length === 0) return null;

  const checkpoint = rows[0];
  const plan = checkpoint.plan as any;
  const workingContext = checkpoint.workingContext as any;

  const ctx: WorkingContext = {
    projectGoal: plan?.goal || workingContext?.goal || "",
    currentPlan: plan?.currentPlan ?? workingContext?.currentPlan ?? null,
    completedSteps: (checkpoint.completedSteps as StepResult[]) || [],
    keyDecisions: plan?.keyDecisions || [],
    fileMap: fileMapFromObject(workingContext?.fileMap),
    errorPatterns: plan?.errorPatterns || [],
    tokenBudget: workingContext?.tokenBudget || { used: 0, limit: TOKEN_BUDGET_DEFAULT, history: [] },
    compactedSummary: plan?.compactedSummary || null,
    agentOutputs: [],
    compactionLevel: plan?.compactionLevel || workingContext?.compactionLevel || 1,
    lastCompaction: workingContext?.lastCompaction,
    totalStepsOriginal: workingContext?.totalStepsOriginal || checkpoint.iteration || 0,
  };

  contexts.set(projectId, ctx);
  return ctx;
}

// ============================================================================
// Phase 4: Persistent working context (.infinity/working-context.json)
// ============================================================================

const WORKING_CONTEXT_DIR = ".infinity";
const WORKING_CONTEXT_FILE = "working-context.json";

function workingContextDiskPath(workspaceId: string): string {
  return path.join(getWorkspaceRoot(workspaceId), WORKING_CONTEXT_DIR, WORKING_CONTEXT_FILE);
}

/** Serialize a file Map into a plain object for JSON storage. */
function fileMapToObject(map: Map<string, FileSummary>): Record<string, FileSummary> {
  return Object.fromEntries(map);
}

/** Reconstruct a file Map from the serialized object, dropping malformed entries. */
function fileMapFromObject(obj: unknown): Map<string, FileSummary> {
  const map = new Map<string, FileSummary>();
  if (!obj || typeof obj !== "object") return map;
  for (const [p, v] of Object.entries(obj as Record<string, any>)) {
    if (!v || typeof v !== "object" || typeof v.path !== "string") continue;
    map.set(p, {
      path: v.path,
      purpose: typeof v.purpose === "string" ? v.purpose : "",
      exports: Array.isArray(v.exports) ? v.exports.filter((x) => typeof x === "string") : [],
      lastChanged: typeof v.lastChanged === "string" ? v.lastChanged : "",
      hash: typeof v.hash === "string" ? v.hash : "",
      size: Number(v.size) || 0,
    });
  }
  return map;
}

/**
 * Phase 4: persist the full working context — goal, plan, decisions, file map,
 * error patterns, token budget, compaction state — to .infinity/working-context.json.
 * This is what lets the build survive a process restart, not just the DB resume.
 */
export async function saveWorkingContextToDisk(
  projectId: string,
  workspaceId = projectId,
): Promise<void> {
  const ctx = contexts.get(projectId);
  if (!ctx) return;
  try {
    const p = workingContextDiskPath(workspaceId);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const payload = {
      savedAt: new Date().toISOString(),
      projectId,
      projectGoal: ctx.projectGoal,
      currentPlan: ctx.currentPlan,
      completedSteps: ctx.completedSteps,
      keyDecisions: ctx.keyDecisions,
      fileMap: fileMapToObject(ctx.fileMap),
      errorPatterns: ctx.errorPatterns,
      tokenBudget: ctx.tokenBudget,
      compactedSummary: ctx.compactedSummary,
      agentOutputs: ctx.agentOutputs || [],
      compactionLevel: ctx.compactionLevel,
      lastCompaction: ctx.lastCompaction ?? null,
      totalStepsOriginal: ctx.totalStepsOriginal,
    };
    await fs.writeFile(p, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.error(`[build-context] saveWorkingContextToDisk failed for ${projectId}:`, err);
  }
}

/**
 * Phase 4: restore a working context from .infinity/working-context.json if present.
 * Returns null when nothing has been persisted yet (fresh build).
 */
export async function loadWorkingContextFromDisk(
  projectId: string,
  workspaceId = projectId,
): Promise<WorkingContext | null> {
  try {
    const raw = await fs.readFile(workingContextDiskPath(workspaceId), "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const ctx: WorkingContext = {
      projectGoal: typeof data.projectGoal === "string" ? data.projectGoal : "",
      currentPlan: data.currentPlan ?? null,
      completedSteps: Array.isArray(data.completedSteps) ? data.completedSteps : [],
      keyDecisions: Array.isArray(data.keyDecisions) ? data.keyDecisions : [],
      fileMap: fileMapFromObject(data.fileMap),
      errorPatterns: Array.isArray(data.errorPatterns) ? data.errorPatterns : [],
      tokenBudget: data.tokenBudget || { used: 0, limit: TOKEN_BUDGET_DEFAULT, history: [] },
      compactedSummary: data.compactedSummary || null,
      agentOutputs: Array.isArray(data.agentOutputs) ? data.agentOutputs : [],
      compactionLevel: (data.compactionLevel as CompactionLevel) || 1,
      lastCompaction: data.lastCompaction || undefined,
      totalStepsOriginal: Number(data.totalStepsOriginal) || 0,
    };
    contexts.set(projectId, ctx);
    return ctx;
  } catch {
    return null; // no persisted context yet
  }
}

/**
 * Phase 4: resume order — the on-disk working-context is freshest and survives
 * the longest, so restore it first, then the latest DB checkpoint, then blank.
 */
export async function loadOrCreateContextFromPersistentStore(
  projectId: string,
  workspaceId = projectId,
): Promise<WorkingContext> {
  const fromDisk = await loadWorkingContextFromDisk(projectId, workspaceId);
  if (fromDisk) return fromDisk;
  const fromCheckpoint = await loadContextFromCheckpoint(projectId);
  if (fromCheckpoint) return fromCheckpoint;
  return getWorkingContext(projectId);
}

/**
 * Get context debug info for UI panel
 */
export function getContextDebugInfo(projectId: string): {
  compactionLevel: CompactionLevel;
  compactionLevelName: string;
  totalStepsOriginal: number;
  detailedStepsKept: number;
  summarizedSteps: number;
  tokenBudget: TokenBudget;
  estimatedTokens: number;
  triggers: CompactionTrigger[];
  fileMapSize: number;
  decisionsCount: number;
  errorPatternsCount: number;
  lastCompaction?: string;
} {
  const ctx = getWorkingContext(projectId);
  const config = COMPACTION_LEVELS.find(c => c.level === ctx.compactionLevel)!;

  return {
    compactionLevel: ctx.compactionLevel,
    compactionLevelName: config.name,
    totalStepsOriginal: ctx.totalStepsOriginal,
    detailedStepsKept: ctx.completedSteps.length,
    summarizedSteps: ctx.totalStepsOriginal - ctx.completedSteps.length,
    tokenBudget: ctx.tokenBudget,
    estimatedTokens: estimateContextTokens(ctx),
    triggers: checkCompactionTriggers(projectId),
    fileMapSize: ctx.fileMap.size,
    decisionsCount: ctx.keyDecisions.length,
    errorPatternsCount: ctx.errorPatterns.length,
    lastCompaction: ctx.lastCompaction,
  };
}

/**
 * Manually trigger compaction to a level
 */
export async function manualCompact(projectId: string, level: CompactionLevel): Promise<void> {
  await compactContext(projectId, level, "manual");
}

/**
 * Reset compaction to level 1 (full detail)
 */
export async function resetCompaction(projectId: string): Promise<void> {
  const ctx = getWorkingContext(projectId);
  ctx.compactionLevel = 1;
  ctx.compactedSummary = null;
  ctx.completedSteps = []; // Would need full history from checkpoint
  await persistContextToCheckpoint(projectId);
  void saveWorkingContextToDisk(projectId);
}

/**
 * Serialize context for specific compaction level (for model prompt)
 */
export function serializeContextForLevel(projectId: string, level: CompactionLevel): string {
  const ctx = getWorkingContext(projectId);
  const config = COMPACTION_LEVELS.find(c => c.level === level)!;

  const parts: string[] = [];

  if (ctx.projectGoal) parts.push(`PROJECT GOAL: ${ctx.projectGoal}`);

  if (config.summarizeOldSteps && ctx.compactedSummary) {
    parts.push(`PRIOR WORK (summarized): ${ctx.compactedSummary}`);
  }

  if (config.keepDetailedSteps > 0 && ctx.completedSteps.length > 0) {
    const stepsToShow = ctx.completedSteps.slice(-config.keepDetailedSteps);
    parts.push("RECENT STEPS:");
    for (const step of stepsToShow) {
      parts.push(`  - [${step.ok ? "OK" : "FAIL"}] ${step.stepId}: ${step.description.slice(0, 100)}`);
      if (step.filesChanged.length > 0) parts.push(`    files: ${step.filesChanged.join(", ")}`);
    }
  }

  if (config.keepDecisions && ctx.keyDecisions.length > 0) {
    parts.push("KEY DECISIONS:");
    for (const d of ctx.keyDecisions) {
      parts.push(`  - ${d.decision} (${d.rationale.slice(0, 80)})`);
    }
  }

  if (config.keepErrorPatterns && ctx.errorPatterns.length > 0) {
    parts.push("KNOWN ERROR PATTERNS (avoid repeating):");
    for (const e of ctx.errorPatterns) {
      parts.push(`  - ${e.pattern} → resolved by: ${e.resolution.slice(0, 100)} (seen ${e.occurrences}x)`);
    }
  }

  if (config.keepFileMap && ctx.fileMap.size > 0) {
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

/**
 * Update total steps counter
 */
export function incrementTotalSteps(projectId: string): void {
  const ctx = getWorkingContext(projectId);
  ctx.totalStepsOriginal += 1;
}
