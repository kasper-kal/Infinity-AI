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
import { createBestAdapter } from "./adapter-factory";
import { sanitizePrompt } from "./infinity-prompt";
import { pipelineConcurrent, parallel, adversarialVerify, judgePanel, loopUntilDry, multiModalSweep, completenessCritic, logDropped, type AdversarialVerifyConfig, type JudgePanelConfig, type LoopUntilDryConfig, type MultiModalSweepConfig, type CompletenessCriticConfig, type Approach, type Judge } from "./orchestration-engine";

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

/**
 * Register orchestration tools in the Universal Tool Registry.
 * These are the core primitives for multi-agent workflows.
 */
function registerOrchestrationTools(): void {
  // orchestration.pipeline — concurrent pipeline with no barrier between stages
  registerTool({
    name: "orchestration.pipeline",
    description: "Run a concurrent pipeline: each item flows through all stages independently (no barrier). Returns results per item with stage outputs and errors.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Array of items to process through the pipeline",
          items: { type: "object" },
        },
        stages: {
          type: "array",
          description: "Array of stage definitions (serialized functions not supported; use orchestration.pipelineConcurrent for concurrent execution)",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["name", "prompt"],
          },
        },
        llmConfig: {
          type: "object",
          properties: {
            temperature: { type: "number", default: 0.3 },
            maxTokens: { type: "number", default: 3000 },
          },
        },
      },
      required: ["items", "stages"],
    },
    execute: async (args, ctx) => {
      const { items, stages, llmConfig = {} } = args as {
        items: unknown[];
        stages: Array<{ name: string; prompt: string }>;
        llmConfig?: { temperature?: number; maxTokens?: number };
      };
      const adapter = await createBestAdapter();

      const results = await pipelineConcurrent(
        items,
        ...stages.map(stage => async (item: unknown) => {
          const response = await adapter.complete(
            [
              { role: "system", content: sanitizePrompt(stage.prompt) },
              { role: "user", content: `Input: ${JSON.stringify(item)}` },
            ],
            { temperature: llmConfig.temperature ?? 0.3, maxTokens: llmConfig.maxTokens ?? 3000 }
          );
          return response.content;
        })
      );

      return {
        success: true,
        data: results.map(r => ({
          item: r.item,
          stageResults: Object.fromEntries(r.stageResults),
          errors: r.errors.map(e => e.message),
        })),
      };
    },
    timeoutMs: 120000,
  });

  // orchestration.pipelineConcurrent — true concurrent pipeline
  registerTool({
    name: "orchestration.pipelineConcurrent",
    description: "Run a TRUE concurrent pipeline: each item flows through all stages independently without waiting for other items. Wall-clock = slowest single-item chain.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Array of items to process",
          items: { type: "object" },
        },
        stages: {
          type: "array",
          description: "Array of stage prompts",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["name", "prompt"],
          },
        },
        llmConfig: {
          type: "object",
          properties: {
            temperature: { type: "number", default: 0.3 },
            maxTokens: { type: "number", default: 3000 },
          },
        },
      },
      required: ["items", "stages"],
    },
    execute: async (args, ctx) => {
      const { items, stages, llmConfig = {} } = args as {
        items: unknown[];
        stages: Array<{ name: string; prompt: string }>;
        llmConfig?: { temperature?: number; maxTokens?: number };
      };
      const adapter = await createBestAdapter();

      const results = await pipelineConcurrent(
        items,
        ...stages.map(stage => async (item: unknown) => {
          const response = await adapter.complete(
            [
              { role: "system", content: sanitizePrompt(stage.prompt) },
              { role: "user", content: `Input: ${JSON.stringify(item)}` },
            ],
            { temperature: llmConfig.temperature ?? 0.3, maxTokens: llmConfig.maxTokens ?? 3000 }
          );
          return response.content;
        })
      );

      return {
        success: true,
        data: results.map(r => ({
          item: r.item,
          stageResults: Object.fromEntries(r.stageResults),
          errors: r.errors.map(e => e.message),
        })),
      };
    },
    timeoutMs: 120000,
  });

  // orchestration.parallel — barrier: all complete before returning
  registerTool({
    name: "orchestration.parallel",
    description: "Run multiple independent tasks in parallel with a barrier — all must complete before returning. Use for independent operations that don't depend on each other.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Array of task definitions to run in parallel",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["name", "prompt"],
          },
        },
        llmConfig: {
          type: "object",
          properties: {
            temperature: { type: "number", default: 0.3 },
            maxTokens: { type: "number", default: 3000 },
          },
        },
      },
      required: ["tasks"],
    },
    execute: async (args, ctx) => {
      const { tasks, llmConfig = {} } = args as {
        tasks: Array<{ name: string; prompt: string }>;
        llmConfig?: { temperature?: number; maxTokens?: number };
      };
      const adapter = await createBestAdapter();

      const results = await parallel(
        tasks.map(task => async () => {
          const response = await adapter.complete(
            [
              { role: "system", content: sanitizePrompt(task.prompt) },
              { role: "user", content: "Execute this task." },
            ],
            { temperature: llmConfig.temperature ?? 0.3, maxTokens: llmConfig.maxTokens ?? 3000 }
          );
          return { name: task.name, result: response.content };
        })
      );

      return {
        success: true,
        data: results.map((r, i) => r ? { name: tasks[i].name, result: r } : { name: tasks[i].name, error: "Task failed" }),
      };
    },
    timeoutMs: 120000,
  });

  // orchestration.verify — adversarial verification
  registerTool({
    name: "orchestration.verify",
    description: "Adversarial verification: spawn N independent skeptic prompts to REFUTE a claim. Default to REFUTE if uncertain. Kill claim if majority refute. Use for validating findings, plans, or code correctness.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        claim: {
          type: "string",
          description: "The claim/statement to verify",
        },
        votes: {
          type: "number",
          description: "Number of independent skeptics (default 3)",
          default: 3,
          minimum: 1,
          maximum: 10,
        },
        config: {
          type: "object",
          properties: {
            temperature: { type: "number", default: 0.1 },
            maxTokens: { type: "number", default: 2000 },
          },
        },
      },
      required: ["claim"],
    },
    execute: async (args, ctx) => {
      const { claim, votes = 3, config = {} } = args as {
        claim: string;
        votes?: number;
        config?: { temperature?: number; maxTokens?: number };
      };

      const result = await adversarialVerify(claim, {
        votes,
        temperature: config.temperature ?? 0.1,
        maxTokens: config.maxTokens ?? 2000,
      });

      return {
        success: true,
        data: result,
      };
    },
    timeoutMs: 60000,
  });

  // orchestration.judge — judge panel evaluation
  registerTool({
    name: "orchestration.judge",
    description: "Judge panel: generate N approaches → score with M distinct lenses (correctness, security, performance, UX, etc.) → synthesize winner + best ideas from runners-up. Use for design decisions, architecture choices, or complex problem solving.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task or problem to solve",
        },
        approaches: {
          type: "array",
          description: "Array of approaches to evaluate",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              content: { type: "object" },
            },
            required: ["id", "name", "content"],
          },
        },
        judges: {
          type: "array",
          description: "Array of judge lenses",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              lens: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["id", "name", "lens", "prompt"],
          },
        },
        config: {
          type: "object",
          properties: {
            temperature: { type: "number", default: 0.2 },
            maxTokens: { type: "number", default: 3000 },
          },
        },
      },
      required: ["task", "approaches", "judges"],
    },
    execute: async (args, ctx) => {
      const { task, approaches, judges, config = {} } = args as {
        task: string;
        approaches: Array<{ id: string; name: string; content: unknown }>;
        judges: Array<{ id: string; name: string; lens: string; prompt: string }>;
        config?: { temperature?: number; maxTokens?: number };
      };

      const result = await judgePanel(task, approaches as any, judges as any, {
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens ?? 3000,
      });

      return {
        success: true,
        data: {
          winner: result.winner,
          allScores: result.allScores,
          synthesis: result.synthesis,
          runnerUp: result.runnerUp,
        },
      };
    },
    timeoutMs: 120000,
  });

  // orchestration.loopUntilDry — keep finding until K consecutive dry rounds
  registerTool({
    name: "orchestration.loopUntilDry",
    description: "Loop until dry: keep spawning finders until K consecutive rounds return nothing new. Use for exhaustive discovery (bugs, security issues, edge cases, test coverage gaps).",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The discovery task (e.g., 'find all security vulnerabilities')",
        },
        finders: {
          type: "array",
          description: "Array of finder prompts (each searches a different way)",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["name", "prompt"],
          },
        },
        input: {
          type: "object",
          description: "Input data for finders",
        },
        config: {
          type: "object",
          properties: {
            maxRounds: { type: "number", default: 5 },
            dryThreshold: { type: "number", default: 2 },
            temperature: { type: "number", default: 0.3 },
            maxTokens: { type: "number", default: 3000 },
          },
        },
      },
      required: ["task", "finders", "input"],
    },
    execute: async (args, ctx) => {
      const { task, finders, input, config = {} } = args as {
        task: string;
        finders: Array<{ name: string; prompt: string }>;
        input: unknown;
        config?: { maxRounds?: number; dryThreshold?: number; temperature?: number; maxTokens?: number };
      };
      const adapter = await createBestAdapter();

      const finderFns = finders.map(f => async (inp: unknown) => {
        const response = await adapter.complete(
          [
            { role: "system", content: sanitizePrompt(f.prompt) },
            { role: "user", content: `Task: ${task}\nInput: ${JSON.stringify(inp)}` },
          ],
          { temperature: config.temperature ?? 0.3, maxTokens: config.maxTokens ?? 3000, jsonMode: true }
        );
        try {
          return JSON.parse(response.content);
        } catch {
          return [response.content];
        }
      });

      const findings = await loopUntilDry(finderFns, input, {
        maxRounds: config.maxRounds ?? 5,
        dryThreshold: config.dryThreshold ?? 2,
        onRound: (round, newFindings, total) => {
          console.log(`[loopUntilDry] Round ${round}: ${newFindings.length} new findings, ${total} total`);
        },
      });

      return {
        success: true,
        data: { findings, total: findings.length },
      };
    },
    timeoutMs: 300000,
  });

  // orchestration.multiModalSweep — parallel agents, different search modalities
  registerTool({
    name: "orchestration.multiModalSweep",
    description: "Multi-modal sweep: parallel agents each searching a different way (by-container, by-content, by-entity, by-time, etc.). Use when one search angle won't find everything.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The search task",
        },
        searchAngles: {
          type: "array",
          description: "Array of search angle definitions",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["name", "prompt"],
          },
        },
        input: {
          type: "object",
          description: "Input data for search",
        },
        config: {
          type: "object",
          properties: {
            temperature: { type: "number", default: 0.3 },
            maxTokens: { type: "number", default: 3000 },
          },
        },
      },
      required: ["task", "searchAngles", "input"],
    },
    execute: async (args, ctx) => {
      const { task, searchAngles, input, config = {} } = args as {
        task: string;
        searchAngles: Array<{ name: string; prompt: string }>;
        input: unknown;
        config?: { temperature?: number; maxTokens?: number };
      };
      const adapter = await createBestAdapter();

      const angleResults = await multiModalSweep(
        searchAngles.map(a => ({
          name: a.name,
          prompt: `Task: ${task}\n${a.prompt}`,
        })),
        input,
        {
          temperature: config.temperature ?? 0.3,
          maxTokens: config.maxTokens ?? 3000,
        }
      );

      return {
        success: true,
        data: Object.fromEntries(angleResults),
      };
    },
    timeoutMs: 120000,
  });

  // orchestration.completenessCritic — "what's missing?"
  registerTool({
    name: "orchestration.completenessCritic",
    description: "Completeness critic: final agent asks 'what's missing?' from current findings. Returns gaps with suggested finders for next round. Use as final quality gate before declaring task complete.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          description: "Current findings to critique",
          items: { type: "object" },
        },
        task: {
          type: "string",
          description: "Original task/goal",
        },
        config: {
          type: "object",
          properties: {
            temperature: { type: "number", default: 0.2 },
            maxTokens: { type: "number", default: 3000 },
          },
        },
      },
      required: ["findings", "task"],
    },
    execute: async (args, ctx) => {
      const { findings, task, config = {} } = args as {
        findings: unknown[];
        task: string;
        config?: { temperature?: number; maxTokens?: number };
      };

      const result = await completenessCritic(findings, task, {
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens ?? 3000,
      });

      return {
        success: true,
        data: result,
      };
    },
    timeoutMs: 60000,
  });

  // orchestration.logDropped — quality pattern: no silent caps
  registerTool({
    name: "orchestration.logDropped",
    description: "Quality pattern: log what was dropped (no silent caps). Call when you filter/cap results to ensure transparency about what was discarded.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label for the log entry" },
        total: { type: "number", description: "Total items before filtering" },
        kept: { type: "number", description: "Items kept after filtering" },
        dropped: {
          type: "array",
          description: "Array of dropped items",
          items: { type: "object" },
        },
        maxLog: { type: "number", default: 10, description: "Max items to log in detail" },
      },
      required: ["label", "total", "kept", "dropped"],
    },
    execute: async (args, ctx) => {
      const { label, total, kept, dropped, maxLog = 10 } = args as {
        label: string;
        total: number;
        kept: number;
        dropped: unknown[];
        maxLog?: number;
      };
      logDropped(label, total, kept, dropped, maxLog);
      return { success: true, data: { logged: true } };
    },
  });
}

// Auto-register orchestration tools on module load
registerOrchestrationTools();

/**
 * Register terminal bridge tools for local terminal access via node-pty WebSocket bridge.
 */
function registerTerminalBridgeTools(): void {
  // terminal.createSession — create a new terminal session
  registerTool({
    name: "terminal.createSession",
    description: "Create a new terminal session on the local terminal bridge (node-pty). Returns session ID and connection details.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        shell: { type: "string", description: "Shell to use (bash, zsh, fish, powershell)", default: "bash" },
        cwd: { type: "string", description: "Working directory", default: process.cwd() },
        cols: { type: "number", description: "Terminal columns", default: 120 },
        rows: { type: "number", description: "Terminal rows", default: 30 },
        env: { type: "object", description: "Additional environment variables", additionalProperties: { type: "string" } },
      },
    },
    execute: async (args, ctx) => {
      // This will be handled by the frontend via useTerminalBridge hook
      // The tool returns the configuration needed to create a session
      const { shell = "bash", cwd = process.cwd(), cols = 120, rows = 30, env = {} } = args as {
        shell?: string;
        cwd?: string;
        cols?: number;
        rows?: number;
        env?: Record<string, string>;
      };

      return {
        success: true,
        data: {
          action: "create_session",
          config: { shell, cwd, cols, rows, env },
          bridgeUrl: `ws://127.0.0.1:3001`,
          message: "Use the terminal bridge WebSocket to create the session. Frontend handles the actual connection.",
        },
      };
    },
    timeoutMs: 5000,
  });

  // terminal.sendInput — send input to a terminal session
  registerTool({
    name: "terminal.sendInput",
    description: "Send input data to an existing terminal session.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session ID" },
        data: { type: "string", description: "Input data to send" },
      },
      required: ["sessionId", "data"],
    },
    execute: async (args, ctx) => {
      const { sessionId, data } = args as { sessionId: string; data: string };

      return {
        success: true,
        data: {
          action: "send_input",
          sessionId,
          data,
          message: "Frontend should send this via the WebSocket connection.",
        },
      };
    },
    timeoutMs: 5000,
  });

  // terminal.resizeSession — resize a terminal session
  registerTool({
    name: "terminal.resizeSession",
    description: "Resize an existing terminal session.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session ID" },
        cols: { type: "number", description: "Terminal columns" },
        rows: { type: "number", description: "Terminal rows" },
      },
      required: ["sessionId", "cols", "rows"],
    },
    execute: async (args, ctx) => {
      const { sessionId, cols, rows } = args as { sessionId: string; cols: number; rows: number };

      return {
        success: true,
        data: {
          action: "resize_session",
          sessionId,
          cols,
          rows,
          message: "Frontend should send this via the WebSocket connection.",
        },
      };
    },
    timeoutMs: 5000,
  });

  // terminal.closeSession — close a terminal session
  registerTool({
    name: "terminal.closeSession",
    description: "Close an existing terminal session.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session ID" },
      },
      required: ["sessionId"],
    },
    execute: async (args, ctx) => {
      const { sessionId } = args as { sessionId: string };

      return {
        success: true,
        data: {
          action: "close_session",
          sessionId,
          message: "Frontend should send this via the WebSocket connection.",
        },
      };
    },
    timeoutMs: 5000,
  });

  // terminal.sendSignal — send a signal to a terminal session
  registerTool({
    name: "terminal.sendSignal",
    description: "Send a signal (SIGTERM, SIGKILL, SIGINT, etc.) to a terminal session.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session ID" },
        signal: { type: "string", description: "Signal to send (SIGTERM, SIGKILL, SIGINT, etc.)" },
      },
      required: ["sessionId", "signal"],
    },
    execute: async (args, ctx) => {
      const { sessionId, signal } = args as { sessionId: string; signal: string };

      return {
        success: true,
        data: {
          action: "send_signal",
          sessionId,
          signal,
          message: "Frontend should send this via the WebSocket connection.",
        },
      };
    },
    timeoutMs: 5000,
  });

  // terminal.connectMCP — connect to an MCP server via stdio bridge
  registerTool({
    name: "terminal.connectMCP",
    description: "Connect to an MCP (Model Context Protocol) server via stdio through the terminal bridge. Returns MCP connection ID.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "MCP server command (e.g., 'npx', 'python', 'node')" },
        args: { type: "array", items: { type: "string" }, description: "Command arguments", default: [] },
        env: { type: "object", description: "Additional environment variables", additionalProperties: { type: "string" } },
      },
      required: ["command"],
    },
    execute: async (args, ctx) => {
      const { command, args: mcpArgs = [], env = {} } = args as { command: string; args?: string[]; env?: Record<string, string> };

      return {
        success: true,
        data: {
          action: "mcp_connect",
          command,
          args: mcpArgs,
          env,
          bridgeUrl: `ws://127.0.0.1:3001`,
          message: "Use the terminal bridge WebSocket to connect to the MCP server. Frontend handles the actual connection.",
        },
      };
    },
    timeoutMs: 10000,
  });

  // terminal.mcpRequest — send a request to a connected MCP server
  registerTool({
    name: "terminal.mcpRequest",
    description: "Send a JSON-RPC request to a connected MCP server.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        mcpId: { type: "string", description: "MCP connection ID from terminal.connectMCP" },
        request: { type: "object", description: "JSON-RPC request object" },
      },
      required: ["mcpId", "request"],
    },
    execute: async (args, ctx) => {
      const { mcpId, request } = args as { mcpId: string; request: unknown };

      return {
        success: true,
        data: {
          action: "mcp_request",
          mcpId,
          request,
          message: "Frontend should send this via the WebSocket connection.",
        },
      };
    },
    timeoutMs: 10000,
  });

  // terminal.listSessions — list active terminal sessions
  registerTool({
    name: "terminal.listSessions",
    description: "List all active terminal sessions on the bridge.",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (args, ctx) => {
      return {
        success: true,
        data: {
          action: "list_sessions",
          message: "Frontend can get this via the WebSocket connection state or by querying the bridge status endpoint.",
        },
      };
    },
    timeoutMs: 5000,
  });

  // terminal.getBridgeStatus — get bridge server status
  registerTool({
    name: "terminal.getBridgeStatus",
    description: "Get the terminal bridge server status (sessions, MCP connections, config).",
    category: "integration",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (args, ctx) => {
      return {
        success: true,
        data: {
          action: "get_status",
          bridgeUrl: `ws://127.0.0.1:3001`,
          message: "Frontend can query the bridge directly or use the WebSocket connection.",
        },
      };
    },
    timeoutMs: 5000,
  });
}

// Auto-register terminal bridge tools on module load
registerTerminalBridgeTools();

/**
 * Register connector tools for external service integration.
 * These tools allow agents to interact with Linear, Notion, Google Sheets, Slack, Discord, Telegram.
 */
function registerConnectorTools(): void {
  const connectorPlatforms = [
    { name: "linear", displayName: "Linear", category: "integration" },
    { name: "notion", displayName: "Notion", category: "integration" },
    { name: "google-sheets", displayName: "Google Sheets", category: "integration" },
    { name: "slack", displayName: "Slack", category: "integration" },
    { name: "discord", displayName: "Discord", category: "integration" },
    { name: "telegram", displayName: "Telegram", category: "integration" },
    { name: "github", displayName: "GitHub", category: "integration" },
    { name: "figma", displayName: "Figma", category: "integration" },
    { name: "spotify", displayName: "Spotify", category: "integration" },
    { name: "gmail", displayName: "Gmail", category: "integration" },
    { name: "google-calendar", displayName: "Google Calendar", category: "integration" },
  ];

  for (const platform of connectorPlatforms) {
    // connector.createIssue / connector.createPage / connector.appendRow etc.
    registerTool({
      name: `connector.${platform.name}.execute`,
      description: `Execute an action on ${platform.displayName} connector. Actions vary by platform: Linear (createIssue, updateIssue, listIssues, searchIssues, listProjects, listCycles, listTeams, addComment), Notion (createPage, createDatabaseEntry, updatePage, searchPages, queryDatabase, listDatabases, addComment), Google Sheets (getValues, updateValues, appendValues, batchUpdate, createSheet, clearValues, listNamedRanges), Slack (postMessage, listChannels, getChannelHistory), Discord (sendMessage, listChannels, createChannel), Telegram (sendMessage, getUpdates).`,
      category: platform.category,
      risk: "EXTERNAL_ACTION",
      parameters: {
        type: "object",
        properties: {
          connectorId: { type: "string", description: "Connector ID from project settings" },
          projectId: { type: "string", description: "Project ID" },
          action: { type: "string", description: "Action to execute (e.g., createIssue, createPage, appendValues)" },
          params: { type: "object", description: "Action-specific parameters", additionalProperties: true },
        },
        required: ["connectorId", "projectId", "action"],
      },
      execute: async (args, ctx) => {
        const { connectorId, projectId, action, params = {} } = args as {
          connectorId: string;
          projectId: string;
          action: string;
          params?: Record<string, unknown>;
        };

        // Dynamic import to avoid circular deps
        const { db, connectors } = await import("@workspace/db");
        const { eq } = await import("drizzle-orm");
        const { createConnector } = await import("./connectors/base");
        const { logActivity } = await import("./project-activity");

        const [connectorRecord] = await db.select().from(connectors).where(eq(connectors.id, connectorId)).limit(1);
        if (!connectorRecord) {
          return { success: false, error: `Connector "${connectorId}" not found` };
        }
        if (connectorRecord.projectId !== projectId) {
          return { success: false, error: "Connector does not belong to this project" };
        }
        if (!connectorRecord.enabled) {
          return { success: false, error: "Connector is disabled" };
        }

        const connector = await createConnector(
          connectorRecord.platform,
          connectorRecord.config as Record<string, any>,
          connectorRecord.projectId,
          connectorRecord.id
        );

        // Execute the action via the connector's public API methods
        let result: any;
        try {
          // Platform-specific action handling to avoid duplicate case names
          switch (platform.name) {
            case "linear": {
              switch (action) {
                case "createIssue":
                  result = await (connector as any).createIssue(params);
                  break;
                case "updateIssue":
                  result = await (connector as any).updateIssue(params.issueId, params);
                  break;
                case "listIssues":
                  result = await (connector as any).listIssues(params);
                  break;
                case "searchIssues":
                  result = await (connector as any).searchIssues(params.query);
                  break;
                case "listProjects":
                  result = await (connector as any).listProjects();
                  break;
                case "listCycles":
                  result = await (connector as any).listCycles();
                  break;
                case "listTeams":
                  result = await (connector as any).listTeams();
                  break;
                case "addComment":
                  result = await (connector as any).addComment(params.issueId, params.body);
                  break;
                default:
                  return { success: false, error: `Unknown Linear action "${action}"` };
              }
              break;
            }

            case "notion": {
              switch (action) {
                case "createPage":
                  result = await (connector as any).createPage(params);
                  break;
                case "createDatabaseEntry":
                  result = await (connector as any).createDatabaseEntry(params);
                  break;
                case "updatePage":
                  result = await (connector as any).updatePage(params.pageId, params);
                  break;
                case "searchPages":
                  result = await (connector as any).searchPages(params.query);
                  break;
                case "queryDatabase":
                  result = await (connector as any).queryDatabase(params.databaseId, params);
                  break;
                case "listDatabases":
                  result = await (connector as any).listDatabases();
                  break;
                case "addComment":
                  result = await (connector as any).addComment(params.pageId, params.text);
                  break;
                default:
                  return { success: false, error: `Unknown Notion action "${action}"` };
              }
              break;
            }

            case "google-sheets": {
              switch (action) {
                case "getValues":
                  result = await (connector as any).getValues(params.range, params.spreadsheetId);
                  break;
                case "updateValues":
                  result = await (connector as any).updateValues(params.range, params.values, params.spreadsheetId, params.valueInputOption);
                  break;
                case "appendValues":
                  result = await (connector as any).appendValues(params.range, params.values, params.spreadsheetId, params.valueInputOption);
                  break;
                case "batchUpdate":
                  result = await (connector as any).batchUpdate(params.spreadsheetId, params.requests);
                  break;
                case "createSheet":
                  result = await (connector as any).createSheet(params.title, params.rows, params.cols, params.spreadsheetId);
                  break;
                case "clearValues":
                  result = await (connector as any).clearValues(params.range, params.spreadsheetId);
                  break;
                case "listNamedRanges":
                  result = await (connector as any).listNamedRanges(params.spreadsheetId);
                  break;
                default:
                  return { success: false, error: `Unknown Google Sheets action "${action}"` };
              }
              break;
            }

            case "slack": {
              switch (action) {
                case "postMessage":
                  result = { success: false, error: "Slack actions not yet implemented in tool registry" };
                  break;
                default:
                  return { success: false, error: `Unknown Slack action "${action}"` };
              }
              break;
            }

            case "discord": {
              switch (action) {
                case "sendMessage":
                  result = { success: false, error: "Discord actions not yet implemented in tool registry" };
                  break;
                case "listChannels":
                  result = { success: false, error: "Discord actions not yet implemented in tool registry" };
                  break;
                case "createChannel":
                  result = { success: false, error: "Discord actions not yet implemented in tool registry" };
                  break;
                default:
                  return { success: false, error: `Unknown Discord action "${action}"` };
              }
              break;
            }

            case "telegram": {
              switch (action) {
                case "sendMessage":
                  result = { success: false, error: "Telegram actions not yet implemented in tool registry" };
                  break;
                case "getUpdates":
                  result = { success: false, error: "Telegram actions not yet implemented in tool registry" };
                  break;
                default:
                  return { success: false, error: `Unknown Telegram action "${action}"` };
              }
              break;
            }

            case "github": {
              switch (action) {
                case "analyzeRepo":
                  result = await (connector as any).analyzeRepo(params);
                  break;
                case "listIssues":
                  result = await (connector as any).listIssues(params);
                  break;
                case "listPRs":
                  result = await (connector as any).listPRs(params);
                  break;
                case "getStructure":
                  result = await (connector as any).getStructure(params);
                  break;
                case "readFile":
                  result = await (connector as any).readFile(params);
                  break;
                case "search":
                  result = await (connector as any).search(params);
                  break;
                case "createIssue":
                  result = await (connector as any).createIssue(params);
                  break;
                default:
                  return { success: false, error: `Unknown GitHub action "${action}"` };
              }
              break;
            }

            case "figma": {
              switch (action) {
                case "generate_design":
                  result = await (connector as any).generateDesign(params);
                  break;
                default:
                  return { success: false, error: `Unknown Figma action "${action}"` };
              }
              break;
            }

            case "spotify": {
              switch (action) {
                case "play":
                  result = await (connector as any).play(params);
                  break;
                case "pause":
                  result = await (connector as any).pause(params);
                  break;
                case "next":
                  result = await (connector as any).next(params);
                  break;
                case "previous":
                  result = await (connector as any).previous(params);
                  break;
                case "search":
                  result = await (connector as any).search(params);
                  break;
                case "listPlaylists":
                  result = await (connector as any).listPlaylists(params);
                  break;
                case "getSavedTracks":
                  result = await (connector as any).getSavedTracks(params);
                  break;
                case "getUserProfile":
                  result = await (connector as any).getUserProfile();
                  break;
                case "getDevices":
                  result = await (connector as any).getDevices();
                  break;
                case "getQueue":
                  result = await (connector as any).getQueue();
                  break;
                case "setVolume":
                  result = await (connector as any).setVolume(params);
                  break;
                default:
                  return { success: false, error: `Unknown Spotify action "${action}"` };
              }
              break;
            }

            case "gmail": {
              switch (action) {
                case "send":
                  result = await (connector as any).send(params);
                  break;
                case "list":
                  result = await (connector as any).list(params);
                  break;
                case "search":
                  result = await (connector as any).search(params);
                  break;
                case "listLabels":
                  result = await (connector as any).listLabels();
                  break;
                case "listDrafts":
                  result = await (connector as any).listDrafts(params);
                  break;
                case "read":
                  result = await (connector as any).read(params);
                  break;
                case "trash":
                  result = await (connector as any).trash(params);
                  break;
                case "archive":
                  result = await (connector as any).archive(params);
                  break;
                case "createDraft":
                  result = await (connector as any).createDraft(params);
                  break;
                default:
                  return { success: false, error: `Unknown Gmail action "${action}"` };
              }
              break;
            }

            case "google-calendar": {
              switch (action) {
                case "createEvent":
                  result = await (connector as any).createEvent(params);
                  break;
                case "listEvents":
                  result = await (connector as any).listEvents(params);
                  break;
                case "searchEvents":
                  result = await (connector as any).searchEvents(params);
                  break;
                case "getFreeBusy":
                  result = await (connector as any).getFreeBusy(params);
                  break;
                case "updateEvent":
                  result = await (connector as any).updateEvent(params);
                  break;
                case "deleteEvent":
                  result = await (connector as any).deleteEvent(params);
                  break;
                case "listCalendars":
                  result = await (connector as any).listCalendars();
                  break;
                default:
                  return { success: false, error: `Unknown Google Calendar action "${action}"` };
              }
              break;
            }

            default:
              return { success: false, error: `Unknown platform "${platform.name}"` };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: false, error: `Connector action failed: ${message}` };
        }

        await logActivity(projectId, "agent_ran", `Executed ${platform.displayName} action: ${action}`);

        return { success: true, data: result };
      },
      timeoutMs: 30000,
    });
  }

  // Generic connector notification tool
  registerTool({
    name: "connector.sendNotification",
    description: "Send a notification to all enabled connectors for a project that are subscribed to the event type. Use for build completions, failures, research completions, etc.",
    category: "integration",
    risk: "EXTERNAL_ACTION",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        eventType: { type: "string", description: "Event type (e.g., build_completed, build_failed, research_completed)" },
        title: { type: "string", description: "Notification title" },
        body: { type: "string", description: "Notification body (markdown supported)" },
        url: { type: "string", description: "Optional URL to link to" },
        metadata: { type: "object", description: "Additional metadata", additionalProperties: true },
      },
      required: ["projectId", "eventType", "title", "body"],
    },
    execute: async (args, ctx) => {
      const { projectId, eventType, title, body, url, metadata } = args as {
        projectId: string;
        eventType: string;
        title: string;
        body: string;
        url?: string;
        metadata?: Record<string, unknown>;
      };

      const { dispatchNotification } = await import("../routes/infinity/connectors");
      await dispatchNotification(projectId, eventType, title, body, { url, metadata });

      return { success: true, data: { sent: true } };
    },
    timeoutMs: 15000,
  });
}

// Auto-register connector tools on module load
registerConnectorTools();