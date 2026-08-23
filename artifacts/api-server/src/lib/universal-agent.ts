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
import {
  pipelineConcurrent,
  parallel,
  adversarialVerify,
  judgePanel,
  loopUntilDry,
  multiModalSweep,
  completenessCritic,
  logDropped,
  type AdversarialVerifyResult,
  type JudgePanelConfig,
  type LoopUntilDryConfig,
  type MultiModalSweepConfig,
  type CompletenessCriticConfig,
  type Approach,
  type Judge,
} from "./orchestration-engine";

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
import { executeUniversalToolWithResilience, classifyToolFailure, runUniversalToolHealthCheck, type ResilientExecutionOptions } from "./tool-resilience";
import { getTaskPersistenceManager, type PersistentTaskState, type TaskStatus } from "./tool-persistence";

/** Event emitted for each agent loop step (for SSE streaming to frontend) */
export interface AgentToolEvent {
  /** Type of event - matches frontend AgentToolEvent in conversation-feed.tsx */
  type: "thinking_start" | "thinking_delta" | "thinking_end" | "tool_start" | "tool_progress" | "tool_complete" | "tool_error" | "loop_complete";
  /** Step number (iteration) */
  step: number;
  /** ISO timestamp */
  timestamp: string;
  /** For thinking events */
  content?: string;
  /** For tool events */
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    dependsOn: string[];
    parallelGroup: number;
  };
  toolResult?: {
    success: boolean;
    data?: unknown;
    summary?: string;
    error?: string;
    artifacts?: unknown[];
  };
  /** For loop complete */
  result?: {
    finalResponse: string;
    iterations: unknown[];
    totalToolCalls: number;
    totalDurationMs: number;
    artifacts: unknown[];
    memoriesWritten: string[];
    converged: boolean;
    stoppedReason?: "max_iterations" | "max_tool_calls" | "model_done" | "error";
  };
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
  /** Callback for streaming final response tokens via SSE */
  onTokenStream?: (token: string) => void;
  /** Maximum tokens for LLM response */
  maxTokens?: number;
  /** Enable resilient execution with retry, circuit breaker, fallback */
  enableResilience?: boolean;
  /** Resilience execution options */
  resilienceOptions?: ResilientExecutionOptions;
  /** Task ID for persistence (enables checkpointing and recovery) */
  taskId?: string;
  /** Enable auto-checkpointing */
  autoCheckpoint?: boolean;
  /** Enable orchestration primitives (pipeline, parallel, verify, judge, etc.) */
  enableOrchestration?: boolean;
  /** LLM adapter to use for orchestration (defaults to agent's adapter) */
  orchestrationLLM?: LLMAdapter;
  /** Run adversarial verification on integration tool results (default: true) */
  enableAdversarialVerification?: boolean;
  /** Run completeness critic as final quality gate (default: true) */
  enableCompletenessCritic?: boolean;
  /** Use judge panel for complex multi-approach decisions (default: true) */
  enableJudgePanel?: boolean;
  /** Minimum confidence threshold for skipping verification (0-1, default: 0.8) */
  verificationConfidenceThreshold?: number;
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
 * Determine if a tool result should be verified via adversarial verification.
 * Verifies results from integration tools that could have factual errors.
 */
function shouldVerifyResult(result: UniversalToolResult): boolean {
  const metadata = result.metadata || {};
  const category = metadata.category as string | undefined;
  const toolName = (metadata.toolName as string) || "";

  // Verify web search, browser, research, and data tools
  if (category === "web" || category === "browser" || category === "research" || category === "data") {
    return true;
  }

  // Verify specific high-stakes tools
  const verifyTools = [
    "web.search", "web.weather",
    "browser.navigate", "browser.extract", "browser.screenshot",
    "research.run", "research.run_v2", "research.status", "research.status_v2",
    "data.analyze", "data.query",
  ];

  return verifyTools.includes(toolName);
}

/**
 * Extract a verifiable claim from a tool result for adversarial verification.
 */
function extractVerificationClaim(result: UniversalToolResult): string | null {
  const data = result.data;
  if (!data) return null;

  // Try to extract a meaningful claim from the result
  if (typeof data === "string") {
    return data.slice(0, 500);
  }

  if (typeof data === "object") {
    // For search results, extract snippets
    if (Array.isArray(data)) {
      return data.map(item => JSON.stringify(item)).join("; ").slice(0, 500);
    }

    // For structured results, stringify key fields (use type guard)
    const obj = data as Record<string, unknown>;
    const claimParts: string[] = [];
    if (obj.summary && typeof obj.summary === "string") claimParts.push(`Summary: ${obj.summary}`);
    if (obj.findings) claimParts.push(`Findings: ${JSON.stringify(obj.findings)}`);
    if (obj.results) claimParts.push(`Results: ${JSON.stringify(obj.results)}`);
    if (obj.content && typeof obj.content === "string") claimParts.push(`Content: ${obj.content}`);
    if (obj.message && typeof obj.message === "string") claimParts.push(`Message: ${obj.message}`);

    if (claimParts.length > 0) {
      return claimParts.join(" | ").slice(0, 500);
    }

    return JSON.stringify(data).slice(0, 500);
  }

  return null;
}

/**
 * Execute a batch of tool calls with resilience (retry, circuit breaker, fallback, diagnostic)
 */
async function executeToolBatch(
  calls: LLMToolCall[],
  context: ToolExecutionContext,
  parallel: boolean,
  maxParallel: number,
  onEvent: (event: AgentToolEvent) => void,
  iteration: number,
  parallelGroup: number,
  enableResilience: boolean,
  resilienceOptions?: ResilientExecutionOptions
): Promise<UniversalToolResult[]> {
  const results: UniversalToolResult[] = [];

  const executeWithResilience = async (call: LLMToolCall): Promise<UniversalToolResult> => {
    const startTime = Date.now();
    const args = JSON.parse(call.function.arguments || "{}");

    onEvent({
      type: "tool_start",
      step: iteration,
      timestamp: new Date().toISOString(),
      toolCall: {
        id: call.id,
        name: call.function.name,
        args,
        dependsOn: [],
        parallelGroup,
      },
    });

    if (enableResilience) {
      // Use resilient execution wrapper - wrap executeTool to match expected signature
      const executeFn = async (toolArgs: Record<string, unknown>, toolContext: ToolExecutionContext) => {
        return executeTool(call.function.name, toolArgs, toolContext);
      };
      const result = await executeUniversalToolWithResilience(
        call.function.name,
        args,
        context,
        executeFn,
        {
          ...resilienceOptions,
          onProgress: (stage, info) => {
            resilienceOptions?.onProgress?.(stage, info);
            if (stage === "tool_failed" || stage === "tool_exception") {
              onEvent({
                type: "tool_error",
                step: iteration,
                timestamp: new Date().toISOString(),
                toolResult: {
                  success: false,
                  error: info.error as string,
                  data: { stage, ...info },
                },
              });
            } else if (stage === "fallback") {
              onEvent({
                type: "tool_progress",
                step: iteration,
                timestamp: new Date().toISOString(),
                toolResult: {
                  success: false,
                  data: { fallback: info.to, from: info.from },
                },
              });
            } else if (stage === "diagnostic") {
              onEvent({
                type: "tool_progress",
                step: iteration,
                timestamp: new Date().toISOString(),
                toolResult: {
                  success: false,
                  data: { diagnostic: info.agent },
                },
              });
            }
          },
        }
      );
      return result;
    } else {
      // Standard execution without resilience
      try {
        const result = await executeTool(call.function.name, args, context);
        const durationMs = Date.now() - startTime;

        onEvent({
          type: result.success ? "tool_complete" : "tool_error",
          step: iteration,
          timestamp: new Date().toISOString(),
          toolResult: {
            success: result.success,
            data: result.data,
            summary: result.summary,
            error: result.error,
            artifacts: result.artifacts,
          },
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);

        onEvent({
          type: "tool_error",
          step: iteration,
          timestamp: new Date().toISOString(),
          toolResult: {
            success: false,
            error: message,
          },
        });

        return {
          success: false,
          error: message,
          metadata: { executionTimeMs: durationMs },
        };
      }
    }
  };

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

    const tasks = calls.map((call) => () => executeWithResilience(call));

    for await (const result of semaphore(tasks)) {
      results.push(result);
    }
  } else {
    // Sequential execution
    for (const call of calls) {
      const result = await executeWithResilience(call);
      results.push(result);
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
    onTokenStream,
    maxTokens = 4096,
    enableResilience = true,
    resilienceOptions = {},
    taskId,
    autoCheckpoint = true,
    enableOrchestration = true,
    orchestrationLLM,
    enableAdversarialVerification = true,
    enableCompletenessCritic = true,
    enableJudgePanel = true,
    verificationConfidenceThreshold = 0.8,
  } = config;

  // Register orchestration tools if enabled
  if (enableOrchestration) {
    // The orchestration tools are auto-registered when tool-registry loads
    // We just need to ensure the filter includes them
    if (!toolFilter.category) {
      toolFilter.category = "integration";
    }
  }

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

  const loopStartTime = Date.now();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Emit thinking_start event
    onToolEvent({
      type: "thinking_start",
      step: iteration,
      timestamp: new Date().toISOString(),
    });

    // Emit thinking_delta with the prompt context
    onToolEvent({
      type: "thinking_delta",
      step: iteration,
      timestamp: new Date().toISOString(),
      content: `Evaluating ${toolDefs.length} available tools for iteration ${iteration + 1}/${maxIterations}`,
    });

    // Check tool call budget
    if (totalToolCalls >= maxToolCalls) {
      onToolEvent({
        type: "tool_error",
        step: iteration,
        timestamp: new Date().toISOString(),
        toolResult: {
          success: false,
          error: `Maximum tool calls (${maxToolCalls}) reached`,
        },
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
        step: iteration,
        timestamp: new Date().toISOString(),
        toolResult: {
          success: false,
          error: message,
        },
      });
      break;
    }

    const toolCalls = parseToolCalls(completion);
    const thought = completion.content || "";

    // Emit thinking_end with the thought
    onToolEvent({
      type: "thinking_end",
      step: iteration,
      timestamp: new Date().toISOString(),
      content: thought || "No reasoning provided",
    });

    // Record this iteration
    iterations.push({
      iteration,
      thought,
      toolCalls,
      toolResults: [],
    });

    // If no tool calls, we have our final answer - stream it if onTokenStream is provided
    if (toolCalls.length === 0) {
      // Use streaming for the final response if onTokenStream callback is provided
      if (onTokenStream) {
        try {
          const streamOptions: LLMCompletionOptions = {
            temperature,
            maxTokens,
            tools: toolDefs,
            toolChoice: "none", // Force no tool calls for final response
          };

          let streamedContent = "";
          for await (const chunk of llmAdapter.stream(messages, streamOptions)) {
            if (chunk.content) {
              streamedContent += chunk.content;
              onTokenStream(chunk.content);
            }
            if (chunk.done) break;
          }
          finalResponse = streamedContent || thought;
        } catch (streamErr) {
          // Fallback to non-streamed content if streaming fails
          finalResponse = thought;
        }
      } else {
        finalResponse = thought;
      }
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

    // Execute tool calls - assign parallel groups for concurrent calls
    const parallelGroup = toolCalls.length > 1 ? 1 : 0;
    const toolResults = await executeToolBatch(
      toolCalls,
      baseContext,
      parallelExecution,
      maxParallel,
      onToolEvent,
      iteration,
      parallelGroup,
      enableResilience,
      resilienceOptions
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

    // ===== ORCHESTRATION PRIMITIVES INTEGRATION =====
    // Run quality gates on tool results when orchestration is enabled
    if (enableOrchestration && toolResults.length > 0) {
      const orchestrationLlm = orchestrationLLM || llmAdapter;

      // 1. ADVERSARIAL VERIFICATION for high-stakes tool results
      // Verify findings from integration tools (web search, research, browser, etc.)
      if (enableAdversarialVerification) {
        const verificationResults: AdversarialVerifyResult[] = [];
        for (const result of toolResults) {
          if (result.success && result.data && shouldVerifyResult(result)) {
            const claim = extractVerificationClaim(result);
            if (claim) {
              onToolEvent({
                type: "tool_progress",
                step: iteration,
                timestamp: new Date().toISOString(),
                toolResult: {
                  success: true,
                  data: { verification: `Verifying: ${claim.slice(0, 80)}...` },
                },
              });
              const verifyResult = await adversarialVerify(claim, {
                votes: 3,
                llm: orchestrationLlm,
                temperature: 0.1,
                maxTokens: 2000,
              });
              verificationResults.push(verifyResult);

              if (!verifyResult.survives) {
                onToolEvent({
                  type: "tool_error",
                  step: iteration,
                  timestamp: new Date().toISOString(),
                  toolResult: {
                    success: false,
                    error: `Adversarial verification FAILED: ${claim} — Refuted by majority of skeptics (${verifyResult.refuteCount}/${verifyResult.votes.length} refuted)`,
                    data: { verification: verifyResult },
                  },
                });
                // Mark the original result as unverified
                (result as any).verificationFailed = true;
                (result as any).verificationDetails = verifyResult;
              } else {
                onToolEvent({
                  type: "tool_progress",
                  step: iteration,
                  timestamp: new Date().toISOString(),
                  toolResult: {
                    success: true,
                    data: { verification: `Verified ✓ (${verifyResult.supportCount} support, ${verifyResult.uncertainCount} uncertain)` },
                  },
                });
              }
            }
          }
        }
      }

      // 2. COMPLETENESS CRITIC as final quality gate (run on last iteration or when no tool calls)
      if (enableCompletenessCritic) {
        const isLastIteration = iteration === maxIterations - 1;
        const noToolCalls = toolCalls.length === 0;
        if ((isLastIteration || noToolCalls) && allToolResults.length > 0) {
          onToolEvent({
            type: "tool_progress",
            step: iteration,
            timestamp: new Date().toISOString(),
            toolResult: {
              success: true,
              data: { qualityGate: "Running completeness critic..." },
            },
          });

          // Extract all findings from successful tool results
          const findings = allToolResults
            .filter(r => r.success && r.data)
            .map(r => ({
              tool: r.metadata?.toolName,
              category: r.metadata?.category,
              data: r.data,
              summary: r.summary,
            }));

          if (findings.length > 0) {
            const criticResult = await completenessCritic(findings, userMessage, {
              llm: orchestrationLlm,
              temperature: 0.2,
              maxTokens: 3000,
            });

            if (criticResult.hasGaps && criticResult.missing.length > 0) {
              onToolEvent({
                type: "tool_progress",
                step: iteration,
                timestamp: new Date().toISOString(),
                toolResult: {
                  success: true,
                  data: {
                    qualityGate: `Completeness critic found ${criticResult.missing.length} gaps`,
                  gaps: criticResult.missing.map(m => `${m.modality}: ${m.claim} (${m.severity})`),
                },
              },
            });

            // If critical gaps found and we have iterations left, continue looping
            // instead of returning early
            const criticalGaps = criticResult.missing.filter(m => m.severity === "critical");
            if (criticalGaps.length > 0 && !isLastIteration) {
              onToolEvent({
                type: "thinking_delta",
                step: iteration,
                timestamp: new Date().toISOString(),
                content: `Critical gaps detected: ${criticalGaps.map(g => g.claim).join("; ")}. Continuing to address...`,
              });
              // Don't break - let the loop continue to address gaps
            }
          }
        }
      }

      // 3. JUDGE PANEL for complex multi-approach decisions
      // Detect when the agent is evaluating multiple approaches and should use judge panel
      if (enableJudgePanel && iteration > 0 && allToolResults.length >= 2) {
        // Check if we have results from different approaches to the same problem
        const approachResults = allToolResults
          .filter(r => r.success && r.data && r.metadata?.toolName)
          .map(r => ({
            id: (r.metadata?.toolName as string) ?? `result-${Date.now()}`,
            name: (r.metadata?.toolName as string) ?? "Approach",
            content: r.data,
            metadata: { summary: r.summary },
          }));

        // If we have multiple distinct approaches from research/analysis tools, run judge panel
        if (approachResults.length >= 2) {
          // Only run judge panel if this looks like a complex decision
          const decisionKeywords = ["choose", "decide", "best", "compare", "evaluate", "tradeoff", "architecture", "design", "strategy"];
          const thoughtLower = thought.toLowerCase();
          const hasDecisionContext = decisionKeywords.some(kw => thoughtLower.includes(kw));

          if (hasDecisionContext) {
            onToolEvent({
              type: "tool_progress",
              step: iteration,
              timestamp: new Date().toISOString(),
              toolResult: {
                success: true,
                data: { qualityGate: "Running judge panel for multi-approach evaluation..." },
              },
            });

            // Define standard judge lenses
            const standardJudges: Judge[] = [
              { id: "correctness", name: "Correctness", lens: "correctness", prompt: "Does this approach correctly solve the problem? Are there logical errors, bugs, or incorrect assumptions?" },
              { id: "security", name: "Security", lens: "security", prompt: "Does this approach introduce security vulnerabilities? Are secrets handled safely? Is input validated?" },
              { id: "performance", name: "Performance", lens: "performance", prompt: "Is this approach efficient? Are there unnecessary computations, memory leaks, or scaling issues?" },
              { id: "user-experience", name: "User Experience", lens: "user-experience", prompt: "Does this approach provide a good user experience? Is it intuitive, accessible, and responsive?" },
            ];

            const approaches: Approach[] = approachResults.slice(0, 4).map((r, i) => ({
              id: r.id,
              name: r.name || `Approach ${i + 1}`,
              content: r.content,
            }));

            const judgeResult = await judgePanel(userMessage, approaches, standardJudges, {
              llm: orchestrationLlm,
              temperature: 0.2,
              maxTokens: 3000,
            });

            onToolEvent({
              type: "tool_progress",
              step: iteration,
              timestamp: new Date().toISOString(),
              toolResult: {
                success: true,
                data: {
                  qualityGate: `Judge panel selected: ${judgeResult.winner.name}`,
                  winner: judgeResult.winner.name,
                  synthesis: judgeResult.synthesis.slice(0, 200),
                  scores: judgeResult.allScores.map(s => `${s.judgeId}: ${s.score}`).join(", "),
                },
              },
            });

            // Add the synthesis as context for the next iteration
            messages.push({
              role: "system",
              content: `JUDGE PANEL SYNTHESIS (use this as guidance):\n${judgeResult.synthesis}`,
            } as LLMMessage);
          }
        }
      }
    }
    // ===== END ORCHESTRATION INTEGRATION =====
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
    if (allFailed) {
      // All tools failed in this iteration - check for specific error types to surface
      const permissionDenied = toolResults.some(r =>
        r.error?.includes("requires explicit approval") ||
        r.error?.includes("permission") ||
        r.metadata?.requiresApproval === true
      );
      const rateLimited = toolResults.some(r =>
        r.error?.includes("rate limit") ||
        r.error?.includes("429")
      );

      if (permissionDenied) {
        error = toolResults.find(r => r.error?.includes("requires explicit approval"))?.error || "Tool execution requires permission";
      } else if (rateLimited) {
        error = toolResults.find(r => r.error?.includes("rate limit"))?.error || "Rate limit exceeded";
      } else {
        error = "All tool calls failed";
      }

      onToolEvent({
        type: "tool_error",
        step: iteration,
        timestamp: new Date().toISOString(),
        toolResult: {
          success: false,
          error,
        },
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

  const totalDurationMs = Date.now() - loopStartTime;

  // Emit loop_complete event
  onToolEvent({
    type: "loop_complete",
    step: iterations.length,
    timestamp: new Date().toISOString(),
    result: {
      finalResponse,
      iterations: iterations.map(it => ({ iteration: it.iteration, thought: it.thought, toolCalls: it.toolCalls.length, toolResults: it.toolResults.length })),
      totalToolCalls,
      totalDurationMs,
      artifacts: allArtifacts,
      memoriesWritten: [],
      converged: success,
      stoppedReason: error ? "error" : "model_done",
    },
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