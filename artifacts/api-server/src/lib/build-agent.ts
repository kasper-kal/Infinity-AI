/**
 * Phase 1: Autonomous Coding Agent with Tool-Use Loop
 *
 * Implements the agent state machine that progressively uses tools to
 * explore, modify, and verify the workspace - replacing single-shot
 * JSON-map generation.
 *
 * PHASE C (The Loop Is One Mind) rewrite:
 * - No phase machine (exploring/planning/implementing/verifying/fixing/done)
 * - Single growing conversation (append assistant + tool results each turn)
 * - Native completion.tool_calls (regex parseToolCalls is fallback only)
 * - Quality-gate stop: while (!done && iteration < maxBudget && !stallDetected)
 * - Deterministic verify-after-edit: run verifyWorkspace after every edit_file
 * - Real state return: {finalPhase, lastDecision, editedFiles, toolCalls, toolResults}
 */

import { createBestAdapter } from "./adapter-factory";
import { buildInfinityPrompt, sanitizePrompt } from "./infinity-prompt";
import { LLMAdapter, LLMCompletionOptions, LLMMessage, LLMTool, LLMToolCall } from "./llm-adapter";
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
import { routeAndExecute, AgentRole, TaskCategory } from "./model-router";
import { createLocalAdapter, isLocalModelAvailable } from "./adapters/local-adapter";
import { LLMMessage as LLMMessageType } from "./llm-adapter";

/**
 * Agent configuration
 */
export interface AgentConfig {
  maxIterations: number;
  maxToolCallsPerIteration: number;
  temperature: number;
  verifyAfterSteps: boolean;
  failFast: boolean;
  stallDetectionTurns: number; // Stop if no file changes in N turns
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 20,
  maxToolCallsPerIteration: 10,
  temperature: 0.2,
  verifyAfterSteps: true,
  failFast: false,
  stallDetectionTurns: 3,
};

/**
 * Agent state - replaces the old phase machine with a flat structure
 */
export interface AgentState {
  goal: string;
  iterations: number;
  maxIterations: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  errors: string[];
  context: ToolExecutionContext;
  // Growing conversation history
  conversation: LLMMessage[];
  // Files edited in this run (for stall detection + return value)
  editedFiles: string[];
  // Turns since last file edit (stall detection)
  turnsSinceEdit: number;
  // Whether the agent called the `done` tool
  done: boolean;
  doneSummary?: string;
}

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
async function buildAgentSystemPrompt(): Promise<string> {
  const toolDescriptions = TOOL_DEFINITIONS.map(
    (t) => `- ${t.name}: ${t.description}`
  ).join("\n");

  // Fix 6.4a/6.4b — the scaffold rule + corpus are part of the system prompt so
  // the model knows it assembles known-good parts and never invents versions.
  const { scaffoldRulePrompt, listCorpusComponents } = await import("./scaffold-engine");
  const corpusNames = await listCorpusComponents().catch(() => []);
  const corpusBlock = corpusNames.length > 0
    ? `AVAILABLE SHADCN/UI CORPUS (${
        corpusNames.length
      } components — use generate_component to write one, do not author from scratch):\n${corpusNames.map(n => `- ${n}`).join("\n")}`
    : "";

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
- Return tool calls using the native tool_calls mechanism
- When done with a goal, call the "done" tool with summary

${corpusBlock}

${await scaffoldRulePrompt()}`;
}

/**
 * Check if the agent should stop (done tool called)
 */
function checkDone(toolCalls: ToolCall[]): { done: boolean; summary?: string; filesChanged?: string[] } {
  for (const call of toolCalls) {
    if (call.name === "done") {
      return {
        done: true,
        summary: (call.arguments.summary as string) || "Task completed",
        filesChanged: (call.arguments.filesChanged as string[]) || [],
      };
    }
  }
  return { done: false };
}

/**
 * Parse tool calls - now a FALLBACK for when native tool_calls isn't available
 */
function parseToolCallsFallback(content: string): ToolCall[] {
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
 * Convert native LLMToolCall to internal ToolCall
 */
function convertNativeToolCalls(nativeCalls: LLMToolCall[] | undefined): ToolCall[] {
  if (!nativeCalls || nativeCalls.length === 0) return [];
  return nativeCalls.map((tc) => ({
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments || "{}"),
    id: tc.id,
  }));
}

/**
 * Run verification after implementation steps
 */
async function runVerification(
  context: ToolExecutionContext,
  projectId: string,
): Promise<{ ok: boolean; feedback: string }> {
  await logBuildEvent(projectId, "verify_start", "Verification after edit", { data: { workspaceId: context.workspaceId } });
  try {
    const result = await verifyWorkspace(projectId, context.workspaceId);
    const feedback = formatVerificationFeedback(result);
    await logBuildEvent(projectId, "verify_result", `Verification ${result.ok ? "passed" : "failed"}: ${result.durationMs}ms`, {
      data: { ok: result.ok, durationMs: result.durationMs, skipped: result.skipped ?? null },
    });
    return { ok: result.ok, feedback };
  } catch (error) {
    await logBuildEvent(projectId, "error", `Verification errored: ${error instanceof Error ? error.message : String(error)}`, { data: { workspaceId: context.workspaceId } });
    return { ok: false, feedback: `Verification failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Try to get a fix from the local model for a verification failure
 */
async function tryLocalModelFix(
  error: string,
  context: { file?: string; context?: string } = {}
): Promise<{ fixes: Array<{ file: string; oldCode: string; newCode: string; explanation: string; confidence: number }>; success: boolean }> {
  try {
    const available = await isLocalModelAvailable();
    if (!available) {
      return { fixes: [], success: false };
    }

    const adapter = await createLocalAdapter();

    const systemPrompt = `You are an expert software engineer proposing a FIX for a build/compilation error.

RULES:
- Analyze the error and the provided file content
- Propose a MINIMAL, targeted fix
- Return ONLY the fixed file content (not the whole file if only a small change)
- If multiple files need changes, provide each as a separate fix
- Explain WHY this fix works
- Be precise - the fix will be applied automatically
- Return as JSON with fields: fixes[] (each has file, oldCode, newCode, explanation, confidence)`;

    const userPrompt = `Error to fix:
\`\`\`typescript
${error}
\`\`\`

${context.file ? `File: ${context.file}` : ""}
${context.context ? `Additional context:\n${context.context}` : ""}

Return JSON with fixes array: [{ file, oldCode, newCode, explanation, confidence }]`;

    const messages: LLMMessageType[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const result = await adapter.complete(messages, {
      temperature: 0.2,
      maxTokens: 4096,
      jsonMode: true,
    });

    let parsed: { fixes: Array<{ file: string; oldCode: string; newCode: string; explanation: string; confidence: number }> } | null = null;
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    } catch {
      // Ignore parse errors
    }

    if (parsed && parsed.fixes && parsed.fixes.length > 0) {
      return { fixes: parsed.fixes, success: true };
    }

    return { fixes: [], success: false };
  } catch (err) {
    console.error("[build-agent] Local model fix failed:", err);
    return { fixes: [], success: false };
  }
}

/**
 * Main autonomous agent entry point - PHASE C: The Loop Is One Mind
 *
 * Key changes from old implementation:
 * 1. Growing conversation - we append to `state.conversation` each turn
 * 2. Native tool_calls - we use completion.toolCalls directly
 * 3. Verify-after-edit - after ANY edit_file, run verification
 * 4. Stall detection - stop if no file changes in N turns
 * 5. Real state return - actual final state, not self-reported phase
 */
export async function runAutonomousAgent(
  goal: string,
  context: ToolExecutionContext,
  config: Partial<AgentConfig> = {},
): Promise<{
  success: boolean;
  summary: string;
  iterations: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  // Phase C additions:
  finalPhase: string;
  lastDecision: string;
  editedFiles: string[];
  conversation: LLMMessage[];
}> {
  const projectId = context.projectId;
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  await logBuildEvent(projectId, "agent_start", `Autonomous agent started: ${goal.slice(0, 100)}`, {
    data: { goal, workspaceId: context.workspaceId },
  });

  // Use model router to get appropriate adapter
  const routingResult = await routeAndExecute(
    "coder",
    goal,
    async (adapter: LLMAdapter) => adapter,
    { filesChanged: [], errorOutput: "" },
    undefined,
    context.projectId,
    context.workspaceId
  );
  const adapter = routingResult.decision.selectedAdapter;

  // Build system prompt ONCE
  const systemPrompt = sanitizePrompt(await buildAgentSystemPrompt());

  // Initialize growing conversation with system prompt
  const conversation: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Initial state - FLAT, no phase machine
  let state: AgentState = {
    goal,
    iterations: 0,
    maxIterations: mergedConfig.maxIterations,
    toolCalls: [],
    toolResults: [],
    errors: [],
    context,
    conversation,
    editedFiles: [],
    turnsSinceEdit: 0,
    done: false,
  };

  // Build initial user message
  const initialUserMessage = buildUserMessage(state, mergedConfig, "");
  state.conversation.push({ role: "user", content: initialUserMessage });

  // Main agent loop - NO phase machine, quality-gate stop
  while (
    state.iterations < state.maxIterations &&
    !state.done &&
    state.turnsSinceEdit < mergedConfig.stallDetectionTurns
  ) {
    try {
      state.iterations++;

      // Build messages for this turn (growing conversation)
      const messages: LLMMessage[] = [...state.conversation];

      const options: LLMCompletionOptions = {
        temperature: mergedConfig.temperature,
        maxTokens: 4000,
        tools: getToolSchemas(),
        toolChoice: "auto",
      };

      const completion = await withRetry(
        async () => adapter.complete(messages, options),
        { maxAttempts: 3, baseDelayMs: 1000, backoffMultiplier: 2 },
        { projectId: context.projectId, operation: `agent-iteration-${state.iterations}` }
      );

      // Phase C: Use native tool_calls FIRST, fallback to regex parsing
      let toolCalls: ToolCall[] = [];
      if (completion.toolCalls && completion.toolCalls.length > 0) {
        toolCalls = convertNativeToolCalls(completion.toolCalls);
      } else {
        // Fallback: parse from content (legacy behavior)
        toolCalls = parseToolCallsFallback(completion.content);
        if (toolCalls.length > 0) {
          await logBuildEvent(projectId, "tool_parse_fallback", "Used regex fallback for tool calls", {
            data: { iteration: state.iterations, callCount: toolCalls.length },
          });
        }
      }

      // Add assistant message to conversation (with tool calls if native)
      const assistantMessage: LLMMessage = {
        role: "assistant",
        content: completion.content,
        ...(completion.toolCalls && completion.toolCalls.length > 0 ? {
          // Note: Some providers include tool_calls in the message, some don't
          // We'll rely on the native completion.toolCalls array
        } : {}),
      };
      state.conversation.push(assistantMessage);

      // Execute tool calls
      const results = await executeToolSequence(toolCalls, context);
      state.toolCalls.push(...toolCalls);
      state.toolResults.push(...results);

      // Add tool results to conversation
      for (let i = 0; i < toolCalls.length; i++) {
        const call = toolCalls[i];
        const result = results[i];
        state.conversation.push({
          role: "tool",
          content: JSON.stringify(result.result || { error: result.error }),
          name: call.name,
          toolCallId: call.id || `call-${Date.now()}-${i}`,
        });
      }

      // Check for done tool
      const doneCheck = checkDone(toolCalls);
      if (doneCheck.done) {
        state.done = true;
        state.doneSummary = doneCheck.summary;
        break;
      }

      // Check for errors
      const errors = results.filter((r) => !r.success).map((r) => r.error || "Unknown error");
      if (errors.length > 0) {
        state.errors.push(...errors);
        for (const error of errors) {
          recordErrorPattern(context.projectId, `Tool execution failed`, error);
        }
      }

      // Track file edits for stall detection + return value
      const filesEditedThisTurn = toolCalls
        .filter((c) => c.name === "edit_file" || c.name === "write_file")
        .map((c) => c.arguments.path as string);

      if (filesEditedThisTurn.length > 0) {
        state.editedFiles.push(...filesEditedThisTurn);
        state.turnsSinceEdit = 0;
      } else {
        state.turnsSinceEdit++;
      }

      // Phase C: Deterministic verify-after-edit
      // Run verification immediately after ANY edit_file
      if (mergedConfig.verifyAfterSteps && filesEditedThisTurn.length > 0) {
        const verification = await runVerification(context, projectId);
        if (!verification.ok) {
          state.errors.push(`Verification failed: ${verification.feedback}`);

          // Try local model fix before next iteration
          await logBuildEvent(projectId, "local_model_attempt", "Attempting local model fix for verification failure", {
            data: { feedback: verification.feedback.slice(0, 500) },
          });

          const localFix = await tryLocalModelFix(verification.feedback, {
            context: state.toolResults.length > 0 ? JSON.stringify(state.toolResults.slice(-3)) : undefined,
          });

          if (localFix.success && localFix.fixes.length > 0) {
            await logBuildEvent(projectId, "local_model_proposed", `Local model proposed ${localFix.fixes.length} fix(es)`, {
              data: { fixes: localFix.fixes.map(f => ({ file: f.file, confidence: f.confidence, explanation: f.explanation.slice(0, 200) })) },
            });

            // Apply fixes via tool calls
            for (const fix of localFix.fixes.slice(0, 3)) {
              if (fix.file && fix.oldCode && fix.newCode) {
                try {
                  const toolResult = await executeTool({
                    name: "apply_fix",
                    arguments: { file: fix.file, oldCode: fix.oldCode, newCode: fix.newCode, explanation: fix.explanation },
                  }, context);
                  state.toolResults.push(toolResult);
                  if (!toolResult.success && "error" in toolResult) {
                    console.warn(`[build-agent] Failed to apply local fix to ${fix.file}:`, toolResult.error);
                  }
                } catch (fixError) {
                  console.warn(`[build-agent] Exception applying local fix:`, fixError);
                }
              }
            }
          }

          // Add verification feedback as a tool result for the next iteration
          state.conversation.push({
            role: "tool",
            content: JSON.stringify({ type: "verification_failure", feedback: verification.feedback }),
            name: "verification",
            toolCallId: `verification-${Date.now()}`,
          });
        }
      }

      // Record step in working context
      if (toolCalls.length > 0) {
        recordStep(projectId, {
          stepId: `iteration-${state.iterations}`,
          description: `Agent iteration ${state.iterations}: ${toolCalls.map((c) => c.name).join(", ")}`,
          ok: state.toolResults.slice(-toolCalls.length).every((r) => r.success),
          filesChanged: filesEditedThisTurn,
          notes: state.errors.slice(-3).join("; "),
        });
      }

      // Build next user message (appended to conversation)
      const nextUserMessage = buildUserMessage(state, mergedConfig, "");
      state.conversation.push({ role: "user", content: nextUserMessage });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      state.errors.push(errorMsg);
      await logBuildEvent(projectId, "agent_error", errorMsg, { step: `iteration-${state.iterations}` });
      break;
    }
  }

  // Determine final outcome
  const success = state.done;
  const finalPhase = state.done ? "done" :
    state.turnsSinceEdit >= mergedConfig.stallDetectionTurns ? "stalled" :
    state.iterations >= state.maxIterations ? "max_iterations" : "error";

  const lastDecision = state.conversation
    .filter(m => m.role === "assistant")
    .slice(-1)[0]?.content?.slice(0, 200) || "(no assistant messages)";

  const summary = success
    ? state.doneSummary || `Agent completed goal in ${state.iterations} iterations`
    : state.phase === "error" || state.errors.length > 0
      ? `Agent failed: ${state.errors.slice(-1)[0]}`
      : state.turnsSinceEdit >= mergedConfig.stallDetectionTurns
        ? `Agent stalled after ${state.turnsSinceEdit} turns without file changes`
        : `Agent stopped after ${state.iterations} iterations (max reached)`;

  await logBuildEvent(projectId, "agent_end", summary, {
    data: {
      success,
      iterations: state.iterations,
      finalPhase,
      turnsSinceEdit: state.turnsSinceEdit,
      editedFiles: state.editedFiles.length,
    },
  });

  return {
    success,
    summary,
    iterations: state.iterations,
    toolCalls: state.toolCalls,
    toolResults: state.toolResults,
    finalPhase,
    lastDecision,
    editedFiles: [...new Set(state.editedFiles)],
    conversation: state.conversation,
  };
}

/**
 * Build user message for the current iteration
 */
function buildUserMessage(state: AgentState, config: AgentConfig, extraContext: string): string {
  const { goal, iterations, toolResults, errors, context } = state;

  // Get working context for this project
  const workingContext = getWorkingContext(context.projectId);
  const contextPrompt = combineBuildMemory(
    serializeContext(context.projectId),
    // Note: buildProjectContextForBuild is async, but we're in sync function
    // We'll rely on the serialized context which includes file map, memory, activity
    ""
  );

  const parts = [
    `GOAL: ${goal}`,
    `ITERATION: ${iterations + 1}/${config.maxIterations}`,
    ``,
    `## WORKSPACE CONTEXT:`,
    contextPrompt || "(no context yet)",
    ``,
    `## PREVIOUS TOOL RESULTS (last 5):`,
    toolResults.length > 0
      ? formatToolResults(toolResults.slice(-5))
      : "(none)",
    ``,
    `## ERRORS SO FAR:`,
    errors.length > 0 ? errors.join("\n") : "(none)",
    ``,
    `What should you do next? Return tool calls using the native tool calling mechanism.`,
    `Example: call edit_file, read_file, run_command, generate_component, etc.`,
    `When the goal is fully achieved, call the "done" tool with a summary.`,
  ];

  if (extraContext) {
    parts.splice(parts.length - 3, 0, extraContext, "");
  }

  return parts.join("\n");
}

/**
 * Run agent for a specific plan step (used by execute-plan rewrite)
 */
export async function runAgentForStep(
  step: { id: string; description: string },
  goal: string,
  context: ToolExecutionContext,
  config: Partial<AgentConfig> = {},
): Promise<{ success: boolean; summary: string; filesChanged: string[] }> {
  const stepGoal = `${goal}\n\nCURRENT STEP: ${step.id} - ${step.description}`;

  const result = await runAutonomousAgent(stepGoal, context, {
    ...config,
    maxIterations: Math.min(config.maxIterations || 10, 10),
  });

  return {
    success: result.success,
    summary: result.summary,
    filesChanged: result.editedFiles,
  };
}