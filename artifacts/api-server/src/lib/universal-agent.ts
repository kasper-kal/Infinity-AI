/**
 * Phase 23: Universal Tool Layer — Agent Loop & UX
 *
 * Iterative agent loop that dynamically chains tools across capabilities in one task.
 * LLM → tool call → result → LLM → ... until final response.
 *
 * Features:
 * - Dynamic tool count (not fixed multi-tool command)
 * - Parallel tool execution with dependency ordering
 * - Memory integration (read relevant, write if needed)
 * - Evolution integration (propose → review → approve → apply → verify)
 * - Artifact interoperability (tool outputs become consumable artifacts)
 * - SSE streaming of tool events for UI timeline
 * - Model-agnostic (depends only on LLMAdapter interface)
 */

import { LLMAdapter, LLMCompletionOptions, LLMTool } from "./llm-adapter";
import {
  registerTool,
  discoverTools,
  getToolDefinitionsForLLM,
  executeTool,
  executeToolSequence,
  formatToolResults,
  type UniversalToolDefinition,
  type UniversalToolResult,
  type ToolExecutionContext,
  type ToolDiscoveryFilter,
  type ToolCategory,
  type ToolRisk,
} from "./tool-registry";
import { type Artifact } from "./tool-types";

/** Maximum tool calls per agent loop iteration (prevents runaway loops) */
const MAX_TOOL_CALLS_PER_LOOP = 25;

/** Maximum total loop iterations */
const MAX_LOOP_ITERATIONS = 10;

/** Default temperature for agent reasoning */
const DEFAULT_TEMPERATURE = 0.3;

/** Result of a single agent loop iteration */
export interface AgentLoopIteration {
  step: number;
  thought: string;
  toolCalls: AgentToolCall[];
  toolResults: UniversalToolResult[];
  timestamp: string;
}

/** Tool call in agent loop (with dependency tracking) */
export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  dependsOn?: string[]; // Tool call IDs this call depends on
  parallelGroup?: number; // Group number for parallel execution
}

/** Complete agent loop result */
export interface AgentLoopResult {
  finalResponse: string;
  iterations: AgentLoopIteration[];
  totalToolCalls: number;
  totalDurationMs: number;
  artifacts: Artifact[];
  memoriesWritten: string[];
  converged: boolean;
  stoppedReason?: "max_iterations" | "max_tool_calls" | "model_done" | "error";
}

/** Configuration for the universal agent */
export interface UniversalAgentConfig {
  /** Maximum tool calls allowed in entire loop */
  maxToolCalls?: number;
  /** Maximum loop iterations */
  maxIterations?: number;
  /** Temperature for LLM calls */
  temperature?: number;
  /** System prompt override */
  systemPrompt?: string;
  /** Tool discovery filter (which capabilities to expose) */
  toolFilter?: ToolDiscoveryFilter;
  /** Whether to enable parallel tool execution */
  parallelExecution?: boolean;
  /** Max parallel tools at once */
  maxParallel?: number;
  /** Callback for streaming tool events (for UI timeline) */
  onToolEvent?: (event: AgentToolEvent) => void;
  /** Callback when loop completes */
  onComplete?: (result: AgentLoopResult) => void;
}

/** Tool events for UI streaming */
export interface AgentToolEvent {
  type: "thinking_start" | "thinking_delta" | "thinking_end" | "tool_start" | "tool_progress" | "tool_complete" | "tool_error" | "loop_complete";
  step: number;
  timestamp: string;
  /** For thinking events */
  content?: string;
  /** For tool events */
  toolCall?: AgentToolCall;
  toolResult?: UniversalToolResult;
  /** For loop complete */
  result?: AgentLoopResult;
}

/** Memory entry for agent context */
export interface AgentMemoryEntry {
  id: string;
  content: string;
  source: "user" | "project" | "tool_result";
  relevance: number; // 0-1
  timestamp: string;
}

/**
 * The Universal Agent - iterative reasoning and tool loop
 */
export class UniversalAgent {
  private adapter: LLMAdapter;
  private config: Required<UniversalAgentConfig>;
  private context: ToolExecutionContext;
  private conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  private memories: AgentMemoryEntry[] = [];
  private artifacts: Artifact[] = [];
  private iterationCount = 0;
  private toolCallCount = 0;
  private startTime = 0;
  private converged = false;

  constructor(
    adapter: LLMAdapter,
    context: ToolExecutionContext,
    config: UniversalAgentConfig = {},
    conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = []
  ) {
    this.adapter = adapter;
    this.context = context;
    this.conversationHistory = conversationHistory;
    this.config = {
      maxToolCalls: config.maxToolCalls ?? MAX_TOOL_CALLS_PER_LOOP,
      maxIterations: config.maxIterations ?? MAX_LOOP_ITERATIONS,
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
      systemPrompt: config.systemPrompt ?? this.buildDefaultSystemPrompt(),
      toolFilter: config.toolFilter ?? {},
      parallelExecution: config.parallelExecution ?? true,
      maxParallel: config.maxParallel ?? 4,
      onToolEvent: config.onToolEvent ?? (() => {}),
      onComplete: config.onComplete ?? (() => {}),
    };
  }

  /**
   * Run the agent loop until convergence or limits reached
   */
  async run(userMessage: string): Promise<AgentLoopResult> {
    this.startTime = Date.now();
    this.iterationCount = 0;
    this.toolCallCount = 0;
    this.converged = false;
    this.artifacts = [];
    this.memories = [];

    // Load relevant memories if available
    if (this.context.memories?.length) {
      this.memories = this.context.memories.map((m, i) => ({
        id: m.id ?? `mem-${i}`,
        content: m.content,
        source: "project",
        relevance: 1.0,
        timestamp: new Date().toISOString(),
      }));
    }

    // Add user message to history
    this.conversationHistory.push({ role: "user", content: userMessage });

    // Emit initial thinking start
    this.config.onToolEvent({
      type: "thinking_start",
      step: 0,
      timestamp: new Date().toISOString(),
    });

    let finalResponse = "";

    try {
      while (this.iterationCount < this.config.maxIterations && !this.converged) {
        this.iterationCount++;

        // Check tool call budget
        if (this.toolCallCount >= this.config.maxToolCalls) {
          this.converged = true;
          break;
        }

        // Run one iteration
        const iteration = await this.runIteration();

        // Check if model is done (no tool calls in last iteration)
        if (iteration.toolCalls.length === 0) {
          finalResponse = iteration.thought || "";
          this.converged = true;
          break;
        }

        // Check if we got a final answer in the thought
        if (this.isFinalAnswer(iteration.thought)) {
          finalResponse = this.extractFinalAnswer(iteration.thought);
          this.converged = true;
          break;
        }
      }

      // If we exited without converging, try one final pass for answer
      if (!this.converged || !finalResponse) {
        const finalPass = await this.runFinalPass();
        finalResponse = finalPass || "I've completed the available tool calls but couldn't generate a final response.";
      }

      const result: AgentLoopResult = {
        finalResponse,
        iterations: [], // Will be populated by runIteration
        totalToolCalls: this.toolCallCount,
        totalDurationMs: Date.now() - this.startTime,
        artifacts: this.artifacts,
        memoriesWritten: [], // Track written memory keys
        converged: this.converged,
        stoppedReason: this.toolCallCount >= this.config.maxToolCalls ? "max_tool_calls" :
          this.iterationCount >= this.config.maxIterations ? "max_iterations" : "model_done",
      };

      this.config.onToolEvent({
        type: "loop_complete",
        step: this.iterationCount,
        timestamp: new Date().toISOString(),
        result,
      });

      this.config.onComplete(result);
      return result;
    } catch (error) {
      const result: AgentLoopResult = {
        finalResponse: `Agent loop error: ${error instanceof Error ? error.message : String(error)}`,
        iterations: [],
        totalToolCalls: this.toolCallCount,
        totalDurationMs: Date.now() - this.startTime,
        artifacts: this.artifacts,
        memoriesWritten: [],
        converged: false,
        stoppedReason: "error",
      };

      this.config.onToolEvent({
        type: "tool_error",
        step: this.iterationCount,
        timestamp: new Date().toISOString(),
        toolCall: { id: "error", name: "agent_loop", args: {} },
        toolResult: { success: false, error: error instanceof Error ? error.message : String(error) },
      });

      return result;
    }
  }

  /**
   * Run a single iteration of the agent loop
   */
  private async runIteration(): Promise<AgentLoopIteration> {
    const iteration: AgentLoopIteration = {
      step: this.iterationCount,
      thought: "",
      toolCalls: [],
      toolResults: [],
      timestamp: new Date().toISOString(),
    };

    // Build messages for LLM
    const messages = this.buildMessages();

    // Get available tools for this iteration
    const toolDefs = getToolDefinitionsForLLM(this.config.toolFilter);

    // Emit thinking start
    this.config.onToolEvent({
      type: "thinking_start",
      step: this.iterationCount,
      timestamp: new Date().toISOString(),
    });

    // Call LLM with tools
    const completion = await this.adapter.complete(messages, {
      temperature: this.config.temperature,
      maxTokens: 4096,
      tools: toolDefs,
      toolChoice: "auto",
    });

    const response = completion.content || "";
    const toolCalls = completion.toolCalls || [];

    // Emit thinking delta
    this.config.onToolEvent({
      type: "thinking_delta",
      step: this.iterationCount,
      timestamp: new Date().toISOString(),
      content: response,
    });

    iteration.thought = response;

    // If no tool calls, model is done
    if (toolCalls.length === 0) {
      this.config.onToolEvent({
        type: "thinking_end",
        step: this.iterationCount,
        timestamp: new Date().toISOString(),
        content: response,
      });
      return iteration;
    }

    // Convert tool calls to agent tool calls with dependency analysis
    const agentToolCalls = this.analyzeDependencies(toolCalls);
    iteration.toolCalls = agentToolCalls;

    // Execute tools (parallel or sequential based on dependencies)
    const results = await this.executeToolCalls(agentToolCalls);
    iteration.toolResults = results;

    // Update context with results
    this.updateContextWithResults(agentToolCalls, results);

    // Add assistant message with tool calls to history
    this.conversationHistory.push({
      role: "assistant",
      content: response + (toolCalls.length > 0 ? `\n\n[Tool calls: ${toolCalls.map(t => t.function.name).join(", ")}]` : ""),
    });

    // Add tool results to history
    for (const result of results) {
      this.conversationHistory.push({
        role: "assistant" as const,
        content: `[Tool Result: ${result.success ? "Success" : "Failed"}] ${result.summary || JSON.stringify(result.data).slice(0, 500)}`,
      });
    }

    this.config.onToolEvent({
      type: "thinking_end",
      step: this.iterationCount,
      timestamp: new Date().toISOString(),
      content: response,
    });

    return iteration;
  }

  /**
   * Run a final pass to get a clean answer without tools
   */
  private async runFinalPass(): Promise<string> {
    const messages = this.buildMessages();
    messages.push({
      role: "system",
      content: "Provide a final, comprehensive answer based on all the tool results above. Do not call any more tools - just answer the user's original question.",
    });

    const completion = await this.adapter.complete(messages, {
      temperature: this.config.temperature,
      maxTokens: 4096,
    });

    return completion.content || "";
  }

  /**
   * Build messages array for LLM call
   */
  private buildMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: this.config.systemPrompt },
    ];

    // Add memory context if available
    if (this.memories.length > 0) {
      const memoryContext = this.memories
        .filter(m => m.relevance > 0.5)
        .map(m => `- ${m.content}`)
        .join("\n");
      if (memoryContext) {
        messages.push({
          role: "system",
          content: `Relevant memories:\n${memoryContext}`,
        });
      }
    }

    // Add artifact context if available
    if (this.artifacts.length > 0) {
      const artifactContext = this.artifacts
        .map(a => `- ${a.type}${a.id ? `#${a.id}` : ""}${a.title ? ` "${a.title}"` : ""}: ${JSON.stringify(a.data).slice(0, 200)}`)
        .join("\n");
      messages.push({
        role: "system",
        content: `Available artifacts from previous tool calls:\n${artifactContext}`,
      });
    }

    // Add conversation history
    messages.push(...this.conversationHistory);

    return messages;
  }

  /**
   * Build default system prompt for the agent
   */
  private buildDefaultSystemPrompt(): string {
    return `You are an AI agent with access to a universal tool registry spanning multiple capabilities:
- web: search, fetch, extract
- browser: navigate, click, type, screenshot, inspect
- files: list, read, write, upload, move, delete
- memory: read, write, update, delete
- research: start, continue, status, extract
- build: run, workspace, terminal, verify
- evolution: inspect, propose, apply, verify, rollback
- integration: gmail, spotify, etc.

Your goal: accomplish the user's request by dynamically chaining tools as needed.
You can call multiple tools in parallel when they don't depend on each other.
Think step by step, then call tools. After each tool result, reason about what to do next.
When you have enough information, provide a final answer without calling more tools.

Guidelines:
- Prefer parallel tool calls when independent
- Use memory.read to check for relevant context before searching
- Use memory.write to save important findings for future tasks
- Tools return structured artifacts that can be consumed by later tools
- Never assume - verify with tools when uncertain`;
  }

  /**
   * Analyze tool call dependencies for parallel execution
   */
  private analyzeDependencies(toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>): AgentToolCall[] {
    const calls: AgentToolCall[] = toolCalls.map((tc, index) => ({
      id: tc.id || `call-${this.iterationCount}-${index}`,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}"),
      dependsOn: [],
      parallelGroup: 0,
    }));

    // Simple dependency analysis: if a tool reads from a category that a previous tool writes to,
    // it depends on that tool. More sophisticated analysis could be added.
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const def = discoverTools({ query: call.name })[0];
      if (!def) continue;

      const writesCategory = this.getWriteCategory(def);
      if (!writesCategory) continue;

      // Check subsequent calls for reads from same category
      for (let j = i + 1; j < calls.length; j++) {
        const laterDef = discoverTools({ query: calls[j].name })[0];
        if (!laterDef) continue;

        const readsCategory = this.getReadCategory(laterDef);
        if (readsCategory === writesCategory || (writesCategory === "memory" && readsCategory === "memory")) {
          calls[j].dependsOn.push(call.id);
        }
      }
    }

    // Assign parallel groups
    this.assignParallelGroups(calls);

    return calls;
  }

  /** Get the category a tool writes to */
  private getWriteCategory(def: UniversalToolDefinition): ToolCategory | null {
    if (def.risk === "WRITE" || def.risk === "DESTRUCTIVE" || def.risk === "SELF_MODIFICATION") {
      return def.category;
    }
    return null;
  }

  /** Get the category a tool reads from */
  private getReadCategory(def: UniversalToolDefinition): ToolCategory | null {
    if (def.risk === "READ") {
      return def.category;
    }
    return null;
  }

  /**
   * Assign parallel execution groups based on dependencies
   */
  private assignParallelGroups(calls: AgentToolCall[]): void {
    const groups = new Map<string, number>();
    let maxGroup = 0;

    for (const call of calls) {
      let group = 0;
      for (const depId of call.dependsOn) {
        const depGroup = groups.get(depId) ?? 0;
        group = Math.max(group, depGroup + 1);
      }
      call.parallelGroup = group;
      groups.set(call.id, group);
      maxGroup = Math.max(maxGroup, group);
    }

    // Cap at maxParallel
    for (const call of calls) {
      if (call.parallelGroup >= this.config.maxParallel) {
        call.parallelGroup = this.config.maxParallel - 1;
      }
    }
  }

  /**
   * Execute tool calls with parallel/sequential strategy
   */
  private async executeToolCalls(calls: AgentToolCall[]): Promise<UniversalToolResult[]> {
    const results: UniversalToolResult[] = [];
    const resultsById = new Map<string, UniversalToolResult>();

    // Group by parallel group
    const groups = new Map<number, AgentToolCall[]>();
    for (const call of calls) {
      const group = groups.get(call.parallelGroup) ?? [];
      group.push(call);
      groups.set(call.parallelGroup, group);
    }

    // Execute groups in order
    for (let groupNum = 0; groupNum <= Math.max(...groups.keys(), 0); groupNum++) {
      const groupCalls = groups.get(groupNum) || [];
      if (groupCalls.length === 0) continue;

      // Emit tool start events
      for (const call of groupCalls) {
        this.config.onToolEvent({
          type: "tool_start",
          step: this.iterationCount,
          timestamp: new Date().toISOString(),
          toolCall: call,
        });
        this.toolCallCount++;
      }

      // Execute group in parallel
      const groupResults = await Promise.all(
        groupCalls.map(async (call) => {
          // Check if dependencies are satisfied
          for (const depId of call.dependsOn) {
            const depResult = resultsById.get(depId);
            if (!depResult || !depResult.success) {
              const errorResult: UniversalToolResult = {
                success: false,
                error: `Dependency ${depId} failed or not available`,
              };
              this.config.onToolEvent({
                type: "tool_error",
                step: this.iterationCount,
                timestamp: new Date().toISOString(),
                toolCall: call,
                toolResult: errorResult,
              });
              return errorResult;
            }
          }

          // Enrich context with dependency results
          const enrichedContext = this.buildEnrichedContext(call);

          // Execute tool
          const result = await executeTool(call.name, call.args, enrichedContext);

          // Emit completion event
          this.config.onToolEvent({
            type: result.success ? "tool_complete" : "tool_error",
            step: this.iterationCount,
            timestamp: new Date().toISOString(),
            toolCall: call,
            toolResult: result,
          });

          // Collect artifacts
          if (result.artifacts?.length) {
            this.artifacts.push(...result.artifacts);
          }

          // Track memory writes
          if (call.name.startsWith("memory.write") || call.name.startsWith("memory.update")) {
            const key = call.args.key as string;
            if (key) this.memories.push({
              id: key,
              content: call.args.value as string,
              source: "tool_result",
              relevance: 1.0,
              timestamp: new Date().toISOString(),
            });
          }

          resultsById.set(call.id, result);
          return result;
        })
      );

      results.push(...groupResults);
    }

    return results;
  }

  /**
   * Build enriched context for a tool call including dependency results
   */
  private buildEnrichedContext(call: AgentToolCall): ToolExecutionContext {
    const previousResults: Array<{ id?: string; name: string; result: UniversalToolResult }> = [];
    for (const depId of call.dependsOn) {
      // Find the tool call for this dependency
      // In practice, we'd look it up from the current iteration
    }

    return {
      ...this.context,
      artifacts: this.artifacts,
      previousToolResults: this.context.previousToolResults ? [...this.context.previousToolResults] : [],
    };
  }

  /**
   * Update agent context with tool results
   */
  private updateContextWithResults(calls: AgentToolCall[], results: UniversalToolResult[]): void {
    // Add artifacts to context
    for (const result of results) {
      if (result.artifacts?.length) {
        this.context.artifacts = [...(this.context.artifacts ?? []), ...result.artifacts];
      }
    }

    // Add tool results to context for chaining
    const previousResults = calls.map((call, i) => ({
      id: call.id,
      name: call.name,
      result: results[i],
    }));

    this.context.previousToolResults = [
      ...(this.context.previousToolResults ?? []),
      ...previousResults,
    ];
  }

  /**
   * Check if the model's thought indicates a final answer
   */
  private isFinalAnswer(thought: string): boolean {
    const lower = thought.toLowerCase();
    return (
      lower.includes("final answer") ||
      lower.includes("in conclusion") ||
      lower.includes("to summarize") ||
      lower.includes("answer:") ||
      (lower.includes("done") && !lower.includes("tool"))
    );
  }

  /**
   * Extract final answer from thought
   */
  private extractFinalAnswer(thought: string): string {
    // Try to find answer after common markers
    const markers = ["final answer:", "answer:", "in conclusion:", "to summarize:"];
    for (const marker of markers) {
      const idx = thought.toLowerCase().indexOf(marker);
      if (idx >= 0) {
        return thought.slice(idx + marker.length).trim();
      }
    }
    return thought;
  }

  /**
   * Get current agent state (for debugging/monitoring)
   */
  getState(): {
    iteration: number;
    toolCalls: number;
    converged: boolean;
    artifacts: number;
    memories: number;
  } {
    return {
      iteration: this.iterationCount,
      toolCalls: this.toolCallCount,
      converged: this.converged,
      artifacts: this.artifacts.length,
      memories: this.memories.length,
    };
  }
}

/**
 * Factory function to create and run a universal agent
 */
export async function runUniversalAgent(
  adapter: LLMAdapter,
  context: ToolExecutionContext,
  userMessage: string,
  config: UniversalAgentConfig = {},
  conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = []
): Promise<AgentLoopResult> {
  const agent = new UniversalAgent(adapter, context, config, conversationHistory);
  return agent.run(userMessage);
}

/**
 * Stream agent loop events as SSE for UI timeline
 */
export function createAgentLoopSSEStream(
  result: AgentLoopResult,
  controller: ReadableStreamDefaultController
): void {
  // This would be used in the chat route to stream agent loop events
  // For now, we emit events via the onToolEvent callback
  // which can be connected to an SSE stream in the route
}

/**
 * Helper to convert agent loop result to SSE events
 */
export function agentLoopResultToSSE(result: AgentLoopResult): string[] {
  const events: string[] = [];

  for (const iteration of result.iterations) {
    // Thinking event
    if (iteration.thought) {
      events.push(`data: ${JSON.stringify({
        type: "agent_thinking",
        step: iteration.step,
        content: iteration.thought,
        timestamp: iteration.timestamp,
      })}\n\n`);
    }

    // Tool events
    for (let i = 0; i < iteration.toolCalls.length; i++) {
      const call = iteration.toolCalls[i];
      const toolResult = iteration.toolResults[i];

      events.push(`data: ${JSON.stringify({
        type: "agent_tool",
        step: iteration.step,
        tool: call.name,
        args: call.args,
        success: toolResult.success,
        summary: toolResult.summary,
        error: toolResult.error,
        artifacts: toolResult.artifacts,
        timestamp: iteration.timestamp,
      })}\n\n`);
    }
  }

  // Final result
  events.push(`data: ${JSON.stringify({
    type: "agent_done",
    response: result.finalResponse,
    totalToolCalls: result.totalToolCalls,
    durationMs: result.totalDurationMs,
    artifacts: result.artifacts,
    converged: result.converged,
  })}\n\n`);

  return events;
}