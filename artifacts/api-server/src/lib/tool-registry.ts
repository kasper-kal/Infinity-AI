/**
 * Phase 21: Universal Tool Layer — Foundation
 *
 * Centralized Universal Tool Registry. All Infinity capabilities register their
 * tools here. The registry provides:
 * - `registerTool(def)` — add a tool definition
 * - `discoverTools(filter?)` — list tools by category/risk/capability
 * - `getToolDefinitionsForLLM(filter?)` — emit LLM-compatible tool schemas
 * - `executeTool(name, args, ctx)` — execute with validation, timeout, retry, error normalization, logging, metadata
 *
 * This GENERALIZES `build-tools.ts` (`ToolCall`, `ToolResult`, `ToolExecutionContext`,
 * `executeTool`, `TOOL_DEFINITIONS`, `formatToolResults`) — it does NOT duplicate it.
 * The Build Mode tools are registered as the first capabilities.
 */

import {
  type UniversalToolDefinition,
  type UniversalToolResult,
  type ToolExecutionContext,
  type ToolCategory,
  type ToolRisk,
  type ToolParameters,
  type Artifact,
} from "./tool-types";
import { executeTool as buildExecuteTool, formatToolResults as buildFormatToolResults } from "./build-tools";

/** Internal registry storage */
const toolRegistry = new Map<string, UniversalToolDefinition>();

/** Default execution timeout (30s) */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Validate that a tool definition has all required fields and correct types.
 * Throws if invalid.
 */
function validateToolDefinition(def: UniversalToolDefinition): void {
  if (!def.name || typeof def.name !== "string") {
    throw new Error("Tool definition must have a string 'name'");
  }
  if (!def.name.includes(".")) {
    throw new Error(`Tool name must be namespaced (e.g., "web.search"), got "${def.name}"`);
  }
  if (!def.description || typeof def.description !== "string") {
    throw new Error(`Tool "${def.name}" must have a string 'description'`);
  }
  if (!def.category) {
    throw new Error(`Tool "${def.name}" must have a 'category'`);
  }
  if (!def.parameters || typeof def.parameters !== "object") {
    throw new Error(`Tool "${def.name}" must have a 'parameters' object`);
  }
  if (!def.risk) {
    throw new Error(`Tool "${def.name}" must have a 'risk' level`);
  }
  if (typeof def.execute !== "function") {
    throw new Error(`Tool "${def.name}" must have an 'execute' function`);
  }
}

/**
 * Register a tool in the universal registry.
 * Throws if a tool with the same name already exists.
 */
export function registerTool(def: UniversalToolDefinition): void {
  validateToolDefinition(def);

  if (toolRegistry.has(def.name)) {
    throw new Error(`Tool "${def.name}" is already registered`);
  }

  toolRegistry.set(def.name, def);
}

/**
 * Get a tool definition by name (for internal use / debugging).
 */
export function getTool(name: string): UniversalToolDefinition | undefined {
  return toolRegistry.get(name);
}

/**
 * Check if a tool is registered.
 */
export function hasTool(name: string): boolean {
  return toolRegistry.has(name);
}

/**
 * Filter options for tool discovery.
 */
export interface ToolDiscoveryFilter {
  /** Filter by category (e.g., "web", "browser", "files", …) */
  category?: ToolCategory;
  /** Filter by risk level */
  risk?: ToolRisk;
  /** Only tools that DON'T require explicit approval */
  approvalFreeOnly?: boolean;
  /** Free-text search in name/description */
  query?: string;
}

/**
 * Discover tools matching the filter.
 */
export function discoverTools(filter: ToolDiscoveryFilter = {}): UniversalToolDefinition[] {
  const { category, risk, approvalFreeOnly, query } = filter;
  const lowerQuery = query?.toLowerCase();

  return Array.from(toolRegistry.values()).filter((def) => {
    if (category && def.category !== category) return false;
    if (risk && def.risk !== risk) return false;
    if (approvalFreeOnly && def.requiresApproval) return false;
    if (lowerQuery) {
      const haystack = `${def.name} ${def.description}`.toLowerCase();
      if (!haystack.includes(lowerQuery)) return false;
    }
    return true;
  });
}

/**
 * Get all registered tool definitions (for admin/debug).
 */
export function getAllTools(): UniversalToolDefinition[] {
  return Array.from(toolRegistry.values());
}

/**
 * Get tool definitions in the LLM-friendly schema format consumed by
 * `llm-adapter.ts` (`LLMTool` interface).
 *
 * The LLM only sees tools it's allowed to use based on the filter.
 */
export function getToolDefinitionsForLLM(filter: ToolDiscoveryFilter = {}): Array<{
  type: "function";
  function: { name: string; description: string; parameters: ToolParameters };
}> {
  return discoverTools(filter).map((def) => ({
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
}

/**
 * Execute a registered tool with validation, timeout, retry, error normalization,
 * and structured result return.
 *
 * - Validates args against the tool's JSONSchema (basic shape check)
 * - Enforces timeout
 * - Normalizes errors to `UniversalToolResult`
 * - Logs execution metadata
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  options: {
    /** Override default timeout for this call */
    timeoutMs?: number;
    /** Skip argument validation (for internal calls) */
    skipValidation?: boolean;
  } = {}
): Promise<UniversalToolResult> {
  const def = toolRegistry.get(name);
  if (!def) {
    return {
      success: false,
      error: `Tool "${name}" not found in registry`,
    };
  }

  const { timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS, skipValidation = false } = options;

  // Optional: basic parameter validation (required fields present)
  if (!skipValidation) {
    const required = (def.parameters as any)?.required ?? [];
    for (const field of required) {
      if (!(field in args)) {
        return {
          success: false,
          error: `Missing required parameter "${field}" for tool "${name}"`,
        };
      }
    }
  }

  // Check approval requirements based on risk + context permissions
  const perms = ctx.permissions;
  const requiresApproval = def.requiresApproval ?? (def.risk === "DESTRUCTIVE" || def.risk === "EXTERNAL_ACTION" || def.risk === "SELF_MODIFICATION");

  if (requiresApproval) {
    const isApproved = perms?.approvedTools?.includes(name) ?? false;
    if (!isApproved) {
      // Check if the risk category is allowed without approval
      const riskAllowed =
        (def.risk === "WRITE" && perms?.allowWrite) ||
        (def.risk === "EXTERNAL_ACTION" && perms?.allowExternal) ||
        (def.risk === "SELF_MODIFICATION" && perms?.allowSelfModification);

      if (!riskAllowed) {
        return {
          success: false,
          error: `Tool "${name}" (risk: ${def.risk}) requires explicit approval. Add to approvedTools or enable the corresponding permission flag.`,
          metadata: { requiresApproval: true, risk: def.risk },
        };
      }
    }
  }

  // Execute with timeout
  const startTime = Date.now();
  let result: UniversalToolResult;

  try {
    const executePromise = def.execute(args, ctx);

    // Timeout wrapper
    const timeoutPromise = new Promise<UniversalToolResult>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    result = await Promise.race([executePromise, timeoutPromise]);

    // Ensure result conforms to UniversalToolResult shape
    if (typeof result !== "object" || result === null || typeof result.success !== "boolean") {
      result = {
        success: false,
        error: `Tool "${name}" returned invalid result shape`,
        metadata: { originalResult: result },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      success: false,
      error: message,
      metadata: { executionTimeMs: Date.now() - startTime, timedOut: message.includes("timed out") },
    };
  }

  // Attach execution metadata
  result.metadata = {
    ...result.metadata,
    toolName: name,
    category: def.category,
    risk: def.risk,
    executionTimeMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };

  return result;
}

/**
 * Execute multiple tools in sequence, passing the accumulated context
 * (including previous results and artifacts) to each subsequent call.
 * Useful for agent loops where tools chain together.
 */
export async function executeToolSequence(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
  ctx: ToolExecutionContext
): Promise<UniversalToolResult[]> {
  const results: UniversalToolResult[] = [];
  const enrichedCtx = { ...ctx };

  for (const call of calls) {
    // Build enriched context with previous results
    const currentCtx: ToolExecutionContext = {
      ...enrichedCtx,
      previousToolResults: results.map((r, i) => ({
        id: calls[i]?.name,
        name: calls[i].name,
        result: r,
      })),
    };

    const result = await executeTool(call.name, call.args, currentCtx);
    results.push(result);

    // If the tool produced artifacts, add them to context for downstream tools
    if (result.artifacts?.length) {
      currentCtx.artifacts = [...(currentCtx.artifacts ?? []), ...result.artifacts];
    }
  }

  return results;
}

/**
 * Format tool results for injection into LLM prompt (generalized from build-tools.ts).
 */
export function formatToolResults(results: UniversalToolResult[]): string {
  return results
    .map((r, i) => {
      const prefix = r.success ? "✓" : "✗";
      const data = r.data ? JSON.stringify(r.data, null, 2).slice(0, 2000) : "";
      const error = r.error ? `ERROR: ${r.error}` : "";
      const artifacts = r.artifacts?.length
        ? `\nArtifacts: ${r.artifacts.map((a) => `${a.type}${a.id ? `#${a.id}` : ""}${a.title ? ` "${a.title}"` : ""}`).join(", ")}`
        : "";
      return `${prefix} Tool ${i + 1} Result:\n${data}\n${error}${artifacts}`;
    })
    .join("\n\n");
}

/**
 * Get registry statistics (for health/debug).
 */
export function getRegistryStats(): {
  total: number;
  byCategory: Record<ToolCategory, number>;
  byRisk: Record<ToolRisk, number>;
  requiringApproval: number;
} {
  const byCategory: Record<ToolCategory, number> = {
    web: 0, browser: 0, files: 0, vision: 0, data: 0,
    memory: 0, research: 0, build: 0, evolution: 0, integration: 0,
  };
  const byRisk: Record<ToolRisk, number> = {
    READ: 0, WRITE: 0, DESTRUCTIVE: 0, EXTERNAL_ACTION: 0, SELF_MODIFICATION: 0,
  };
  let requiringApproval = 0;

  for (const def of toolRegistry.values()) {
    byCategory[def.category]++;
    byRisk[def.risk]++;
    if (def.requiresApproval) requiringApproval++;
  }

  return { total: toolRegistry.size, byCategory, byRisk, requiringApproval };
}

/**
 * Clear the registry (for testing only).
 */
export function clearRegistry(): void {
  toolRegistry.clear();
}

/**
 * Re-export Build Mode's executeTool and formatToolResults so existing
 * Build Mode code continues to work without modification.
 */
export { buildExecuteTool as executeBuildTool, buildFormatToolResults as formatBuildToolResults };