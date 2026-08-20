/**
 * Phase 21: Universal Tool Layer — Standardized Tool Contracts
 *
 * These types define the model-agnostic, namespaced, permissioned tool contract
 * that every Infinity capability registers with (see `tool-registry.ts`).
 *
 * They GENERALIZE the existing Build Mode tool architecture (`build-tools.ts`)
 * — `ToolCall` / `ToolResult` / `ToolExecutionContext` / `executeTool` — rather
 * than duplicating it. The Build Mode `ToolExecutionContext` is extended with the
 * cross-capability fields every mode needs (userId, conversationId, taskId,
 * permissions, memories, artifacts, previous results).
 */

import type { ToolExecutionContext as BuildToolExecutionContext } from "./build-tools";

/**
 * Risk classification for a tool. Drives permission enforcement in the registry.
 */
export type ToolRisk =
  | "READ"               // reads data, no side effects
  | "WRITE"              // modifies project/workspace state
  | "DESTRUCTIVE"        // irreversible or high-impact mutation (requires approval)
  | "EXTERNAL_ACTION"    // interacts with an external system/API (requires approval)
  | "SELF_MODIFICATION"; // modifies Infinity's own codebase (guarded by Evolving)

/**
 * Tool category — used for discovery/filtering so the LLM is only sent the
 * schema relevant to the current request mode (general / research / coding / …).
 */
export type ToolCategory =
  | "web"
  | "browser"
  | "files"
  | "vision"
  | "data"
  | "memory"
  | "research"
  | "build"
  | "evolution"
  | "integration";

/**
 * A reusable, interoperable output produced by a tool that later tools can
 * consume (e.g. Research Report, Image Analysis, Dataset/Chart, Screenshot,
 * Code/Diff, Evolution Record).
 */
export interface Artifact {
  type: string;          // e.g. "research_report", "image_analysis", "chart", "screenshot", "diff", "evolution_record"
  id?: string;
  title?: string;
  data?: unknown;
  refs?: string[];       // related artifact ids / source urls
  metadata?: Record<string, unknown>;
}

/**
 * Standardized result returned by every universal tool.
 */
export interface UniversalToolResult {
  success: boolean;
  data?: unknown;
  summary?: string;
  error?: string;
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

/**
 * Per-tool permission/approval metadata carried at execution time.
 */
export interface ToolPermissions {
  /** Whether WRITE/EXTERNAL/SELF_MOD tools are allowed without explicit approval. */
  allowWrite: boolean;
  allowExternal: boolean;
  allowSelfModification: boolean;
  /** Tools explicitly pre-approved for this task (bypasses approval prompt). */
  approvedTools?: string[];
}

/**
 * JSONSchema-ish parameter declaration. Kept loose (Record) to match the
 * `LLMTool` schema shape consumed by `llm-adapter.ts`.
 */
export type ToolParameters = Record<string, unknown>;

/**
 * Shared execution context extended from Build Mode's context with the
 * cross-capability fields every mode (Chat, Build, Research, …) needs.
 */
export interface ToolExecutionContext extends BuildToolExecutionContext {
  userId?: string;
  conversationId?: string;
  taskId?: string;
  permissions?: ToolPermissions;
  /** Relevant memory entries retrieved for this task. */
  memories?: Array<{ id: string; content: string; source?: string }>;
  /** Artifacts produced by earlier tool calls in this task (chained consumption). */
  artifacts?: Artifact[];
  /** Results of previous tool calls in this task, keyed by call id / name. */
  previousToolResults?: Array<{ id?: string; name: string; result: UniversalToolResult }>;
}

/**
 * The authoritative tool definition registered in the Universal Tool Registry.
 */
export interface UniversalToolDefinition {
  /** Namespaced name, e.g. "web.search", "files.read", "evolution.propose". */
  name: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameters;
  risk: ToolRisk;
  /** Force explicit human/agent approval before execution (overrides risk default). */
  requiresApproval?: boolean;
  /** Execution timeout in ms (default 30000). */
  timeoutMs?: number;
  /**
   * Execute the tool. Receives parsed args and the shared execution context.
   * MUST return a `UniversalToolResult`.
   */
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<UniversalToolResult>;
  /** Optional metadata for registry bookkeeping/UI. */
  metadata?: Record<string, unknown>;
}
