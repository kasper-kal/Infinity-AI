/**
 * Phase 1: Autonomous Coding Agent with Tool-Use Loop
 *
 * Implements the agent state machine that progressively uses tools to
 * explore, modify, and verify the workspace - replacing single-shot
 * JSON-map generation.
 */

import { createBestAdapter } from "./adapter-factory";
import { buildInfinityPrompt, sanitizePrompt } from "./infinity-prompt";
import { LLMAdapter, LLMCompletionOptions, LLMMessage, LLMTool } from "./llm-adapter";
import {
  executeTool,
  executeToolSequence,
  formatToolResults,
  ToolCall,
  ToolExecutionContext,
  ToolResult,
  TOOL_DEFINITIONS,
} from "./build-tools";
import { getWorkingContext, serializeContext, recordStep, recordErrorPattern } from "./build-context";
import { verifyWorkspace, formatVerificationFeedback } from "./structured-tools";
import { combineBuildMemory, buildProjectContextForBuild } from "./build-project-context";
import { withRetry } from "./build-edge-cases";
import { logBuildEvent } from "./build-telemetry";

export interface AgentState {
  phase: "planning" | "exploring" | "implementing" | "verifying" | "fixing" | "done" | "error";
  goal: string;
  plan?: PlanStep[];
  currentStepIndex: number;
  iterations: number;
  maxIterations: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  errors: string[];
  context: ToolExecutionContext;
}

export interface PlanStep {
  id: string;
  description: string;
  dependsOn?: string[];
  parallel?: boolean;
  status: "pending" | "in_progress" | "done" | "failed";
  filesChanged?: string[];
}

export interface AgentConfig {
  maxIterations: number;
  maxToolCallsPerIteration: number;
  temperature: number;
  verifyAfterSteps: boolean;
  failFast: boolean;
}

/**
 * Default agent configuration
 */
const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 20,
  maxToolCallsPerIteration: 10,
  temperature: 0.2,
  verifyAfterSteps: true,
  failFast: false,
};

/**
 * Convert tool definitions to LLMTool format
 */
function getToolSchemas(): LLMTool[] {
  return TOOL_DEFINITIONS.map((td) => ({
    type: "function",
    function: {
      name: td.name,
      description: td.description,
      parameters: td.parameters,
    },
  }));
}

/**
 * Build the system prompt for the autonomous agent
 */
function buildAgentSystemPrompt(extraInstructions?: string): string {
  const toolDescriptions = TOOL_DEFINITIONS.map(
    (t) => `- ${t.name}: ${t.description}`
  ).join("\n");

  return `You are Infinity, an autonomous software engineering agent. You work inside a local workspace and have access to tools to explore, modify, and verify code.

AVAILABLE TOOLS:
${toolDescriptions}

WORKFLOW:
1. EXPLORE: Use list_files, read_file to understand the workspace
2. PLAN: Break down the goal into concrete steps (if not already planned)
3. IMPLEMENT: Use edit_file, run_command to make changes
4. VERIFY: Use screenshot, inspect_console, inspect_dom, run_command (tests/build), git_diff to verify
5. FIX: If verification fails, analyze errors and apply fixes
6. REPEAT until done

RULES:
- Always start by exploring the workspace before making changes
- Make small, focused changes - one logical change per tool call sequence
- After each change, verify it works before moving on
- Use run_command for tests, builds, typechecks
- Use git_diff to review your changes before considering a step done
- Never assume - always verify with tools
- Return tool calls as JSON with the exact function signatures
- When done with a goal, call the "done" tool with summary

${extraInstructions || ""}`;
}

/**
 * Parse tool calls from LLM response
 */
function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Try to parse as JSON array
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object" && item.name && typeof item.name === "string") {
          calls.push({
            name: item.name,
            arguments: item.arguments || {},
            id: item.id,
          });
        }
      }
      return calls;
    }
  } catch {
    // Not a JSON array, try to extract JSON objects
  }

  // Try to extract individual JSON objects
  const jsonRegex = /\{[\s\S]*?\}/g;
  let match;
  while ((match = jsonRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === "object" && parsed.name && typeof parsed.name === "string") {
        calls.push({
          name: parsed.name,
          arguments: parsed.arguments || {},
          id: parsed.id,
        });
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  return calls;
}

/**
 * Check if the agent should continue or is done
 */
function checkDone(toolCalls: ToolCall[], toolResults: ToolResult[]): { done: boolean; summary?: string } {
  // Check for explicit done tool call
  for (const call of toolCalls) {
    if (call.name === "done") {
      return { done: true, summary: (call.arguments.summary as string) || "Task completed" };
    }
  }
  return { done: false };
}

/**
 * Run a single iteration of the agent loop
 */
async function runAgentIteration(
  state: AgentState,
  config: AgentConfig,
  adapter: LLMAdapter,
): Promise<AgentState> {
  const { goal, phase, iterations, context } = state;
  const newState = { ...state, iterations: iterations + 1 };

  // Build context for the LLM
  const workingContext = getWorkingContext(context.projectId);
  const contextPrompt = combineBuildMemory(
    serializeContext(context.projectId),
    await buildProjectContextForBuild(context.projectId, goal, {
      includeActivity: true,
      includeFiles: true,
      activityLimit: 20,
      fileLimit: 50,
    })
  );

  // Build messages
  const messages: LLMMessage[] = [
    { role: "system", content: sanitizePrompt(buildAgentSystemPrompt()) },
    {
      role: "user",
      content: [
        `GOAL: ${goal}`,
        `PHASE: ${phase}`,
        `ITERATION: ${iterations + 1}/${config.maxIterations}`,
        ``,
        `## WORKSPACE CONTEXT:`,
        contextPrompt,
        ``,
        `## PREVIOUS TOOL RESULTS (last iteration):`,
        state.toolResults.length > 0
          ? formatToolResults(state.toolResults.slice(-5))
          : "(none)",
        ``,
        `## ERRORS SO FAR:`,
        state.errors.length > 0 ? state.errors.join("\n") : "(none)",
        ``,
        `What should you do next? Return tool calls as a JSON array.`,
        `Example: [{"name": "list_files", "arguments": {"pattern": "**/*"}}, {"name": "read_file", "arguments": {"path": "package.json"}}]`,
        `When the goal is fully achieved, return: [{"name": "done", "arguments": {"summary": "..."}}]`,
      ].join("\n"),
    },
  ];

  // Call LLM with tools
  const options: LLMCompletionOptions = {
    temperature: config.temperature,
    maxTokens: 4000,
    tools: getToolSchemas(),
    toolChoice: "auto",
  };

  const completion = await withRetry(
    async () => adapter.complete(messages, options),
    { maxAttempts: 3, baseDelayMs: 1000, backoffMultiplier: 2 },
    { projectId: context.projectId, operation: `agent-iteration-${iterations + 1}` }
  );

  const toolCalls = parseToolCalls(completion.content);
  newState.toolCalls = toolCalls;

  // Execute tool calls
  const results = await executeToolSequence(toolCalls, context);
  newState.toolResults = results;

  // Check for done
  const doneCheck = checkDone(toolCalls, results);
  if (doneCheck.done) {
    newState.phase = "done";
    return newState;
  }

  // Check for errors
  const errors = results.filter((r) => !r.success).map((r) => r.error || "Unknown error");
  if (errors.length > 0) {
    newState.errors.push(...errors);
    for (const error of errors) {
      recordErrorPattern(context.projectId, `Tool execution failed`, error);
    }
  }

  // Update phase based on tool usage
  const hasFileEdits = toolCalls.some((c) => c.name === "edit_file");
  const hasVerification = toolCalls.some(
    (c) => ["screenshot", "inspect_console", "inspect_dom", "run_command", "git_diff"].includes(c.name)
  );

  if (phase === "exploring" && hasFileEdits) {
    newState.phase = "implementing";
  } else if (phase === "implementing" && hasVerification) {
    newState.phase = "verifying";
  } else if (phase === "verifying" && !hasVerification && !hasFileEdits) {
    newState.phase = "exploring"; // Continue exploring or move to next step
  }

  return newState;
}

/**
 * Run verification after implementation steps
 */
async function runVerification(
  context: ToolExecutionContext,
  projectId: string,
): Promise<{ ok: boolean; feedback: string }> {
  try {
    const result = await verifyWorkspace(projectId, context.workspaceId);
    const feedback = formatVerificationFeedback(result);
    return { ok: result.ok, feedback };
  } catch (error) {
    return { ok: false, feedback: `Verification failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Main autonomous agent entry point
 */
export async function runAutonomousAgent(
  goal: string,
  context: ToolExecutionContext,
  config: Partial<AgentConfig> = {},
): Promise<{ success: boolean; summary: string; iterations: number; toolCalls: ToolCall[]; toolResults: ToolResult[] }> {
  const projectId = context.projectId;
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  await logBuildEvent(projectId, "agent_start", `Autonomous agent started: ${goal.slice(0, 100)}`, {
    data: { goal, workspaceId: context.workspaceId },
  });

  const adapter = await createBestAdapter();

  // Initial state
  let state: AgentState = {
    phase: "exploring",
    goal,
    currentStepIndex: 0,
    iterations: 0,
    maxIterations: mergedConfig.maxIterations,
    toolCalls: [],
    toolResults: [],
    errors: [],
    context,
  };

  // Main agent loop
  while (state.iterations < state.maxIterations && state.phase !== "done" && state.phase !== "error") {
    try {
      state = await runAgentIteration(state, mergedConfig, adapter);

      // Run verification if configured and in verifying phase
      if (mergedConfig.verifyAfterSteps && state.phase === "verifying") {
        const verification = await runVerification(context, projectId);
        if (!verification.ok) {
          state.phase = "fixing";
          state.errors.push(`Verification failed: ${verification.feedback}`);
          // Add verification feedback as a tool result for the next iteration
          state.toolResults.push({
            success: false,
            error: verification.feedback,
            result: { type: "verification_failure", feedback: verification.feedback },
          });
        } else {
          state.phase = "exploring"; // Move to next step or explore more
        }
      }

      // Record step in working context
      if (state.toolCalls.length > 0) {
        recordStep(projectId, {
          stepId: `iteration-${state.iterations}`,
          description: `Agent iteration ${state.iterations}: ${state.toolCalls.map((c) => c.name).join(", ")}`,
          ok: state.toolResults.every((r) => r.success),
          filesChanged: state.toolResults
            .filter((r) => r.result && typeof r.result === "object" && "path" in r.result)
            .map((r) => (r.result as { path: string }).path),
          notes: state.errors.slice(-3).join("; "),
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      state.errors.push(errorMsg);
      state.phase = "error";
      await logBuildEvent(projectId, "agent_error", errorMsg, { step: `iteration-${state.iterations}` });
      break;
    }
  }

  const success = state.phase === "done";
  const summary = success
    ? `Agent completed goal in ${state.iterations} iterations`
    : state.phase === "error"
    ? `Agent failed: ${state.errors.slice(-1)[0]}`
    : `Agent stopped after ${state.iterations} iterations (max reached)`;

  await logBuildEvent(projectId, "agent_end", summary, {
    data: { success, iterations: state.iterations, phase: state.phase },
  });

  return {
    success,
    summary,
    iterations: state.iterations,
    toolCalls: state.toolCalls,
    toolResults: state.toolResults,
  };
}

/**
 * Run agent for a specific plan step
 */
export async function runAgentForStep(
  step: PlanStep,
  goal: string,
  context: ToolExecutionContext,
  config: Partial<AgentConfig> = {},
): Promise<{ success: boolean; summary: string; filesChanged: string[] }> {
  const stepGoal = `${goal}\n\nCURRENT STEP: ${step.id} - ${step.description}`;

  const result = await runAutonomousAgent(stepGoal, context, {
    ...config,
    maxIterations: Math.min(config.maxIterations || 10, 10),
  });

  const filesChanged = result.toolResults
    .filter((r) => r.result && typeof r.result === "object" && "path" in r.result)
    .map((r) => (r.result as { path: string }).path);

  return {
    success: result.success,
    summary: result.summary,
    filesChanged: [...new Set(filesChanged)],
  };
}