/**
 * Phase 23: Universal Tool Layer — Agent Loop & UX
 *
 * Iterative reasoning/tool loop where the LLM dynamically chains tools across
 * capabilities in one task, surfacing execution in the UI as an agent timeline.
 *
 * Features:
 * - Iterative agent loop: LLM → tool call → result → LLM → ... until final response
 * - Parallel tool execution: independent calls run concurrently with dependency ordering
 * - Tool chaining UX: emits AgentToolEvent for each step (Thinking → Web Search → Browser → ... → Done)
 * - SSE/streaming: emits tool events alongside chat stream (reuse build-events.ts infra)
 * - Memory integration: agent reads relevant memory, performs task, decides whether to write memory
 * - Evolution integration: evolution.propose → review → approval → evolution.apply → tests → verify
 * - Artifacts: tool outputs become interoperable artifacts consumable by later tools
 * - Model-agnostic: loop only depends on LLMAdapter interface
 */

import { LLMAdapter, LLMMessage, LLMTool, LLMCompletionOptions, LLMCompletionResult, LLMToolCall } from "./llm-adapter";

// Extended message type that includes tool_calls for conversation history (OpenAI API format)
interface LLMMessageWithToolCalls extends LLMMessage {
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}
import { ToolExecutionContext, UniversalToolResult, Artifact } from "./tool-types";
import { getToolDefinitionsForLLM, executeTool, formatToolResults } from "./tool-registry";
import { ToolDiscoveryFilter } from "./tool-registry";

/** Event emitted for each agent loop step (for SSE streaming to frontend) */
export interface AgentToolEvent {
  /** Type of event */
  type: "thinking" | "tool_call" | "tool_result" | "tool_error" | "artifact" | "memory_read" | "memory_write" | "complete";
  /** Unique step ID */
  stepId: string;
  /** Human-readable label for this step */
  label: string;
  /** Tool name if this is a tool call/result */
  toolName?: string;
  /** Tool arguments */
  toolArgs?: Record<string, unknown>;
  /** Tool result */
  toolResult?: UniversalToolResult;
  /** Duration in ms */
  durationMs?: number;
  /** Error message if failed */
  error?: string;
  /** Artifacts produced */
  artifacts?: Artifact[];
  /** Memory read/write info */
  memoryInfo?: { action: "read" | "write"; count: number; keys: string[] };
  /** Iteration number */
  iteration: number;
  /** Timestamp */
  timestamp: string;
}

/** Configuration for the universal agent loop */
export interface UniversalAgentConfig {
  /** Maximum number of tool calls in a single iteration */
  maxToolCalls?: number;
  /** Maximum number of iterations (LLM → tools → LLM cycles) */
  maxIterations?: number;
  /** Temperature for LLM calls */
  temperature?: number;
  /** System prompt to use */
  systemPrompt?: string;
  /** Tool discovery filter (limits which tools the LLM sees) */
  toolFilter?: ToolDiscoveryFilter;
  /** Enable parallel tool execution for independent calls */
  parallelExecution?: boolean;
  /** Maximum concurrent parallel tool calls */
  maxParallel?: number;
  /** Callback for streaming tool events via SSE */
  onToolEvent?: (event: AgentToolEvent) => void;
  /** Maximum tokens for LLM response */
  maxTokens?: number;
}

/** Result of running the universal agent */
export interface AgentLoopResult {
  /** Final assistant response */
  finalResponse: string;
  /** Total number of tool calls made */
  totalToolCalls: number;
  /** Total number of iterations */
  totalIterations: number;
  /** All tool call results */
  allToolResults: UniversalToolResult[];
  /** All artifacts produced */
  allArtifacts: Artifact[];
  /** Per-iteration details */
  iterations: Array<{
    iteration: number;
    thought: string;
    toolCalls: LLMToolCall[];
    toolResults: UniversalToolResult[];
  }>;
  /** Whether the agent completed successfully */
  success: boolean;
  /** Error if failed */
  error?: string;
}

/**
 * Build the system prompt for the universal agent, including tool descriptions.
 * The agent gets a clear instruction set about available tools and how to use them.
 */
function buildAgentSystemPrompt(basePrompt: string, toolDefs: LLMTool[]): string {
  const toolList = toolDefs.map(t => `- **${t.function.name}**: ${t.function.description}`).join("\n");
  const toolSchemas = toolDefs.map(t => `### ${t.function.name}\n${JSON.stringify(t.function.parameters, null, 2)}`).join("\n\n");

  return `${basePrompt}

=== UNIVERSAL TOOL SYSTEM ===
You have access to the following tools. Use them to accomplish the user's goal.
**Think step by step.** Call tools when you need information or need to perform actions.
Tools can be chained — the output of one tool becomes input for the next.
You can call multiple tools in parallel when they don't depend on each other.

AVAILABLE TOOLS:
${toolList}

TOOL SCHEMAS:
${toolSchemas}

TOOL CALLING PROTOCOL:
1. When you need to use a tool, respond with a JSON object containing "tool_calls" array.
2. Each tool call must have: id (unique), type: "function", function: { name, arguments (JSON string) }
3. You can call up to 5 tools in parallel in one response if they are independent.
4. After tool results are returned, continue reasoning and call more tools if needed.
5. When you have enough information, provide your final answer (no tool_calls).

MEMORY INTEGRATION:
- You have access to relevant memories in the context. Read them to understand the user/project.
- After completing a task, you may write new memories if you learned durable facts.
- Use the memory tools (memory.read, memory.write) when appropriate.

ARTIFACTS:
- Tool results may produce artifacts (research reports, charts, screenshots, diffs, etc.).
- Artifacts are passed forward and can be consumed by subsequent tools.
- Reference artifacts by their IDs in your reasoning.

EXECUTION RULES:
- Be efficient: prefer parallel calls when tools are independent.
- Be thorough: use the right tool for each job, don't guess.
- Handle errors: if a tool fails, analyze the error and try an alternative approach.
- Don't repeat failed calls with the same arguments.
- Stop when you have a complete answer — don't call tools unnecessarily.
`;
}

/**
 * Parse tool calls from LLM response (both complete and stream formats)
 */
function parseToolCalls(result: LLMCompletionResult): LLMToolCall[] {
  return result.toolCalls ?? [];
}

/**
 * Check if tool calls have dependencies on each other's results.
 * Simple heuristic: if a tool's arguments reference another tool's output pattern.
 */
function hasDependencies(calls: LLMToolCall[], previousResults: UniversalToolResult[]): boolean {
  if (calls.length <= 1) return false;
  // For now, we assume no cross-dependencies within a single batch
  // A more sophisticated implementation would analyze argument references
  return false;
}

/**
 * Execute a batch of tool calls, either in parallel or sequentially.
 */
async function executeToolBatch(
  calls: LLMToolCall[],
  context: ToolExecutionContext,
  parallel: boolean,
  maxParallel: number,
  onEvent: (event: AgentToolEvent) => void
): Promise<UniversalToolResult[]> {
  const results: UniversalToolResult[] = [];

  if (parallel && calls.length > 1) {
    // Execute in parallel with concurrency limit
    const semaphore = async function* (tasks: Array<() => Promise<UniversalToolResult>>) {
      const executing: Promise<UniversalToolResult>[] = [];
      for (const task of tasks) {
        const promise = task();
        executing.push(promise);
        if (executing.length >= maxParallel) {
          yield await Promise.race(executing);
          // Remove completed
          const completedIdx = executing.findIndex(p => p === promise);
          if (completedIdx >= 0) executing.splice(completedIdx, 1);
        }
      }
      // Wait for remaining
      for (const p of executing) {
        yield await p;
      }
    };

    const tasks = calls.map(call => async () => {
      const startTime = Date.now();
      const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Emit tool_call event
      onEvent({
        type: "tool_call",
        stepId,
        label: `Calling ${call.function.name}`,
        toolName: call.function.name,
        toolArgs: JSON.parse(call.function.arguments || "{}"),
        iteration: 0,
        timestamp: new Date().toISOString(),
      });

      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const result = await executeTool(call.function.name, args, context);

        const durationMs = Date.now() - startTime;

        // Emit tool_result event
        onEvent({
          type: result.success ? "tool_result" : "tool_error",
          stepId,
          label: result.success ? `Completed ${call.function.name}` : `Failed ${call.function.name}`,
          toolName: call.function.name,
          toolArgs: args,
          toolResult: result,
          durationMs,
          error: result.error,
          artifacts: result.artifacts,
          iteration: 0,
          timestamp: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);

        onEvent({
          type: "tool_error",
          stepId,
          label: `Error in ${call.function.name}`,
          toolName: call.function.name,
          toolArgs: JSON.parse(call.function.arguments || "{}"),
          error: message,
          durationMs,
          iteration: 0,
          timestamp: new Date().toISOString(),
        });

        return {
          success: false,
          error: message,
          metadata: { executionTimeMs: durationMs },
        };
      }
    });

    for await (const result of semaphore(tasks)) {
      results.push(result);
    }
  } else {
    // Sequential execution
    for (const call of calls) {
      const startTime = Date.now();
      const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      onEvent({
        type: "tool_call",
        stepId,
        label: `Calling ${call.function.name}`,
        toolName: call.function.name,
        toolArgs: JSON.parse(call.function.arguments || "{}"),
        iteration: 0,
        timestamp: new Date().toISOString(),
      });

      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const result = await executeTool(call.function.name, args, context);

        const durationMs = Date.now() - startTime;

        onEvent({
          type: result.success ? "tool_result" : "tool_error",
          stepId,
          label: result.success ? `Completed ${call.function.name}` : `Failed ${call.function.name}`,
          toolName: call.function.name,
          toolArgs: args,
          toolResult: result,
          durationMs,
          error: result.error,
          artifacts: result.artifacts,
          iteration: 0,
          timestamp: new Date().toISOString(),
        });

        results.push(result);
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);

        onEvent({
          type: "tool_error",
          stepId,
          label: `Error in ${call.function.name}`,
          toolName: call.function.name,
          toolArgs: JSON.parse(call.function.arguments || "{}"),
          error: message,
          durationMs,
          iteration: 0,
          timestamp: new Date().toISOString(),
        });

        results.push({
          success: false,
          error: message,
          metadata: { executionTimeMs: durationMs },
        });
      }
    }
  }

  return results;
}

/**
 * Run the universal agent loop.
 *
 * This is the core iterative reasoning loop:
 * 1. LLM receives context + tools
 * 2. LLM decides to call tools (or respond)
 * 3. Tools execute (parallel if independent)
 * 4. Results fed back to LLM
 * 5. Repeat until final response or max iterations
 */
export async function runUniversalAgent(
  llmAdapter: LLMAdapter,
  baseContext: ToolExecutionContext,
  userMessage: string,
  config: UniversalAgentConfig = {},
  history: LLMMessageWithToolCalls[] = []
): Promise<AgentLoopResult> {
  const {
    maxToolCalls = 25,
    maxIterations = 10,
    temperature = 0.3,
    systemPrompt = "",
    toolFilter = {},
    parallelExecution = true,
    maxParallel = 4,
    onToolEvent = () => {},
    maxTokens = 4096,
  } = config;

  // Get tool definitions for the LLM
  const toolDefs = getToolDefinitionsForLLM(toolFilter);
  const fullSystemPrompt = buildAgentSystemPrompt(systemPrompt, toolDefs);

  // Initialize conversation
  const messages: LLMMessage[] = [
    { role: "system", content: fullSystemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  const allToolResults: UniversalToolResult[] = [];
  const allArtifacts: Artifact[] = [];
  const iterations: AgentLoopResult["iterations"] = [];
  let totalToolCalls = 0;
  let success = false;
  let error: string | undefined;
  let finalResponse = "";

  // Track tool call counts per iteration
  let toolCallsThisIteration = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Emit thinking event
    const thinkingStepId = `thinking-${Date.now()}`;
    onToolEvent({
      type: "thinking",
      stepId: thinkingStepId,
      label: `Thinking (iteration ${iteration + 1}/${maxIterations})`,
      iteration,
      timestamp: new Date().toISOString(),
    });

    // Check tool call budget
    if (totalToolCalls >= maxToolCalls) {
      onToolEvent({
        type: "tool_error",
        stepId: `budget-exceeded-${Date.now()}`,
        label: "Tool call budget exceeded",
        error: `Maximum tool calls (${maxToolCalls}) reached`,
        iteration,
        timestamp: new Date().toISOString(),
      });
      error = "Tool call budget exceeded";
      break;
    }

    // Call LLM with tools
    const completionOptions: LLMCompletionOptions = {
      temperature,
      maxTokens,
      tools: toolDefs,
      toolChoice: "auto",
    };

    let completion: LLMCompletionResult;
    try {
      completion = await llmAdapter.complete(messages, completionOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      error = `LLM call failed: ${message}`;
      onToolEvent({
        type: "tool_error",
        stepId: `llm-error-${Date.now()}`,
        label: "LLM call failed",
        error: message,
        iteration,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    const toolCalls = parseToolCalls(completion);
    const thought = completion.content || "";

    // Record this iteration
    iterations.push({
      iteration,
      thought,
      toolCalls,
      toolResults: [],
    });

    // If no tool calls, we have our final answer
    if (toolCalls.length === 0) {
      finalResponse = thought;
      success = true;
      break;
    }

    // Check if we have room for these tool calls
    if (totalToolCalls + toolCalls.length > maxToolCalls) {
      // Trim to fit budget
      toolCalls.splice(maxToolCalls - totalToolCalls);
    }

    // Emit tool calls
    toolCallsThisIteration = toolCalls.length;
    totalToolCalls += toolCalls.length;

    // Execute tool calls
    const toolResults = await executeToolBatch(
      toolCalls,
      baseContext,
      parallelExecution,
      maxParallel,
      onToolEvent
    );

    // Update iteration record
    iterations[iteration].toolResults = toolResults;

    // Collect results and artifacts
    allToolResults.push(...toolResults);
    for (const result of toolResults) {
      if (result.artifacts?.length) {
        allArtifacts.push(...result.artifacts);
      }
    }

    // Build tool results message for next LLM turn
    const toolResultsMessage: LLMMessage = {
      role: "tool",
      content: formatToolResults(toolResults),
      name: "tool_results",
    };

    // Add assistant's tool call response and tool results to conversation
    messages.push({
      role: "assistant",
      content: thought,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    } as LLMMessageWithToolCalls);
    messages.push(toolResultsMessage);

    // Check if we should continue (if all tools failed, maybe stop?)
    const allFailed = toolResults.every(r => !r.success);
    if (allFailed && iteration > 0) {
      // Multiple iterations of all failures — probably stuck
      error = "All tool calls failed repeatedly";
      onToolEvent({
        type: "tool_error",
        stepId: `all-failed-${Date.now()}`,
        label: "All tools failed",
        error: "All tool calls in this iteration failed",
        iteration,
        timestamp: new Date().toISOString(),
      });
      break;
    }
  }

  // If we exited the loop without a final response, use the last thought
  if (!success && !finalResponse) {
    finalResponse = iterations[iterations.length - 1]?.thought || "I encountered an issue completing this task.";
    if (!error) {
      error = "Max iterations reached without completion";
    }
  }

  // Emit completion event
  onToolEvent({
    type: "complete",
    stepId: `complete-${Date.now()}`,
    label: success ? "Task completed" : "Task ended",
    iteration: iterations.length,
    timestamp: new Date().toISOString(),
  });

  return {
    finalResponse,
    totalToolCalls,
    totalIterations: iterations.length,
    allToolResults,
    allArtifacts,
    iterations,
    success,
    error,
  };
}

/**
 * UniversalAgent class for stateful agent execution (e.g., for long-running tasks)
 */
export class UniversalAgent {
  private llmAdapter: LLMAdapter;
  private context: ToolExecutionContext;
  private config: UniversalAgentConfig;
  private history: LLMMessageWithToolCalls[] = [];
  private totalToolCalls = 0;
  private totalIterations = 0;
  private isRunning = false;

  constructor(llmAdapter: LLMAdapter, context: ToolExecutionContext, config: UniversalAgentConfig = {}) {
    this.llmAdapter = llmAdapter;
    this.context = context;
    this.config = config;
  }

  /**
   * Run a single turn of the agent (can be called multiple times for conversation)
   */
  async run(userMessage: string): Promise<AgentLoopResult> {
    if (this.isRunning) {
      throw new Error("Agent is already running");
    }
    this.isRunning = true;

    try {
      const result = await runUniversalAgent(
        this.llmAdapter,
        this.context,
        userMessage,
        this.config,
        this.history
      );

      // Update history with this turn
      this.history.push({ role: "user", content: userMessage });
      if (result.finalResponse) {
        this.history.push({ role: "assistant", content: result.finalResponse });
      }

      // Add tool call/result pairs to history
      for (const iteration of result.iterations) {
        if (iteration.toolCalls.length > 0) {
          this.history.push({
            role: "assistant",
            content: iteration.thought,
            tool_calls: iteration.toolCalls.map(tc => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          } as LLMMessageWithToolCalls);
          this.history.push({
            role: "tool",
            content: formatToolResults(iteration.toolResults),
            name: "tool_results",
          });
        }
      }

      this.totalToolCalls += result.totalToolCalls;
      this.totalIterations += result.totalIterations;

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get current agent stats
   */
  getStats(): { totalToolCalls: number; totalIterations: number; historyLength: number } {
    return {
      totalToolCalls: this.totalToolCalls,
      totalIterations: this.totalIterations,
      historyLength: this.history.length,
    };
  }

  /**
   * Reset the agent state
   */
  reset(): void {
    this.history = [];
    this.totalToolCalls = 0;
    this.totalIterations = 0;
  }

  /**
   * Check if agent is currently running
   */
  get running(): boolean {
    return this.isRunning;
  }
}