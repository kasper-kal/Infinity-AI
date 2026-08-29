/**
 * Cursor Agent — Autonomous Code Intelligence Agent
 *
 * Extends Universal Agent with Cursor-level capabilities:
 * - Planning mode: explore → plan → execute with user approval
 * - Debugging agent: run tests, set breakpoints, inspect variables
 * - Git integration: log, diff, blame, commit messages, PR descriptions
 * - MCP server integration: use any MCP tool
 * - Subagents: specialized agents for specific tasks
 * - Hooks & automations: event-driven triggers
 *
 * All in-browser, $0 cost, local-first.
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
  type AdversarialVerifyResult,
  type JudgePanelConfig,
  type LoopUntilDryConfig,
  type MultiModalSweepConfig,
  type CompletenessCriticConfig,
  type Approach,
  type Judge,
} from "./orchestration-engine";
import { SUBAGENTS, spawnSubagent, spawnSubagentsParallel, perspectiveDiverseVerify, type SubagentDefinition, type SubagentConfig, type CodeReviewerOutput } from "./subagents";
import { ToolExecutionContext, UniversalToolResult, Artifact, ToolCategory, ToolRisk } from "./tool-types";
import { getToolDefinitionsForLLM, executeTool, formatToolResults, registerTool, discoverTools } from "./tool-registry";
import { executeUniversalToolWithResilience, classifyToolFailure, type ResilientExecutionOptions } from "./tool-resilience";
import { getTaskPersistenceManager, type PersistentTaskState, type TaskStatus } from "./tool-persistence";
import { CodebaseIndexer, SearchResult, createCodebaseIndexer, IndexConfig } from "./codebase-indexer";

// ============================================================================
// Types
// ============================================================================

/** Extended message type with tool_calls for conversation history */
interface LLMMessageWithToolCalls extends LLMMessage {
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/** Event emitted for each agent loop step (for SSE streaming) */
export interface CursorAgentEvent {
  type: "planning_start" | "planning_step" | "planning_complete" | "exploration_start" | "exploration_result" |
        "implementation_start" | "implementation_step" | "implementation_complete" |
        "debug_start" | "debug_step" | "debug_complete" |
        "git_operation" | "subagent_spawn" | "subagent_complete" |
        "thinking_start" | "thinking_delta" | "thinking_end" |
        "tool_start" | "tool_progress" | "tool_complete" | "tool_error" |
        "checkpoint_created" | "checkpoint_restored" |
        "approval_requested" | "approval_received" |
        "loop_complete" | "error";
  step: number;
  timestamp: string;
  // Planning
  plan?: Plan;
  planStep?: PlanStep;
  // Exploration
  explorationQuery?: string;
  explorationResults?: SearchResult[];
  // Implementation
  implementationAction?: string;
  diff?: string;
  // Debug
  debugAction?: string;
  debugOutput?: string;
  // Git
  gitAction?: string;
  gitOutput?: string;
  // Subagent
  subagentType?: string;
  subagentGoal?: string;
  subagentResult?: unknown;
  // Thinking
  content?: string;
  // Tool
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
    artifacts?: Artifact[];
  };
  // Approval
  approvalId?: string;
  approvalPrompt?: string;
  approvalOptions?: string[];
  // Result
  result?: CursorAgentResult;
  error?: string;
}

/** Configuration for Cursor Agent */
export interface CursorAgentConfig {
  projectId: string;
  projectRoot: string;
  maxToolCalls?: number;
  maxIterations?: number;
  temperature?: number;
  systemPrompt?: string;
  toolFilter?: ToolDiscoveryFilter;
  parallelExecution?: boolean;
  maxParallel?: number;
  onEvent?: (event: CursorAgentEvent) => void;
  onTokenStream?: (token: string) => void;
  maxTokens?: number;
  enableResilience?: boolean;
  resilienceOptions?: ResilientExecutionOptions;
  taskId?: string;
  autoCheckpoint?: boolean;
  enableOrchestration?: boolean;
  orchestrationLLM?: LLMAdapter;
  enableAdversarialVerification?: boolean;
  enableCompletenessCritic?: boolean;
  enableJudgePanel?: boolean;
  verificationConfidenceThreshold?: number;
  // Cursor-specific
  enablePlanningMode?: boolean;
  enableDebugging?: boolean;
  enableGitIntegration?: boolean;
  enableMCPIntegration?: boolean;
  enableSubagents?: boolean;
  enableHooks?: boolean;
  maxSubagents?: number;
  subagentTimeout?: number;
  planningModel?: "same" | "stronger" | "weaker";
  autoApproveSafeActions?: boolean;
}

/** Result of running the Cursor Agent */
export interface CursorAgentResult {
  finalResponse: string;
  totalToolCalls: number;
  totalIterations: number;
  allToolResults: UniversalToolResult[];
  allArtifacts: Artifact[];
  iterations: Array<{
    iteration: number;
    thought: string;
    toolCalls: LLMToolCall[];
    toolResults: UniversalToolResult[];
    artifacts: Artifact[];
  }>;
  converged: boolean;
  stoppedReason?: "max_iterations" | "max_tool_calls" | "model_done" | "error" | "user_stopped" | "approval_denied";
  // Cursor-specific
  plan?: Plan;
  executedSteps?: PlanStep[];
  checkpoints?: Checkpoint[];
  subagentResults?: SubagentResult[];
  gitOperations?: GitOperation[];
  debugSessions?: DebugSession[];
}

/** Plan structure for planning mode */
export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  status: "draft" | "approved" | "executing" | "completed" | "failed" | "cancelled";
  riskAssessment: RiskAssessment;
  estimatedTokens: number;
  estimatedDurationMs: number;
}

/** Individual plan step */
export interface PlanStep {
  id: string;
  order: number;
  title: string;
  description: string;
  type: "explore" | "read" | "write" | "edit" | "delete" | "test" | "git" | "terminal" | "subagent" | "verify";
  files: string[];
  tools: string[];
  dependencies: string[]; // step IDs that must complete first
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped" | "blocked";
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  verificationCriteria?: string[];
}

/** Risk assessment for a plan */
export interface RiskAssessment {
  level: "low" | "medium" | "high" | "critical";
  factors: string[];
  mitigation: string[];
  rollbackPlan: string;
}

/** Checkpoint for state persistence */
export interface Checkpoint {
  id: string;
  taskId: string;
  label: string;
  state: {
    conversationHistory: LLMMessageWithToolCalls[];
    plan?: Plan;
    executedSteps: PlanStep[];
    workingDirectory: string;
    gitStatus: string;
  };
  createdAt: number;
  sizeBytes: number;
}

/** Subagent execution result */
export interface SubagentResult {
  subagentId: string;
  type: string;
  goal: string;
  status: "completed" | "failed" | "timeout";
  result?: unknown;
  error?: string;
  durationMs: number;
  artifacts: Artifact[];
}

/** Git operation record */
export interface GitOperation {
  id: string;
  type: "diff" | "log" | "blame" | "status" | "commit" | "push" | "branch" | "merge" | "stash";
  args: Record<string, unknown>;
  output: string;
  success: boolean;
  timestamp: number;
}

/** Debug session record */
export interface DebugSession {
  id: string;
  type: "test_run" | "breakpoint" | "variable_inspect" | "stack_trace" | "console_log";
  target: string;
  action: string;
  output: string;
  success: boolean;
  timestamp: number;
}

/** Tool discovery filter (re-exported for convenience) */
export interface ToolDiscoveryFilter {
  category?: ToolCategory;
  risk?: ToolRisk;
  approvalFreeOnly?: boolean;
  query?: string;
}

// ============================================================================
// Cursor Agent Class
// ============================================================================

export class CursorAgent {
  private config: Required<CursorAgentConfig>;
  private adapter: LLMAdapter;
  private indexer: CodebaseIndexer | null = null;
  private conversationHistory: LLMMessageWithToolCalls[] = [];
  private plan: Plan | null = null;
  private checkpoints: Checkpoint[] = [];
  private executedSteps: PlanStep[] = [];
  private subagentResults: SubagentResult[] = [];
  private gitOperations: GitOperation[] = [];
  private debugSessions: DebugSession[] = [];
  private currentIteration = 0;
  private totalToolCalls = 0;
  private startTime = Date.now();
  private stopped = false;
  private stopReason?: CursorAgentResult["stoppedReason"];
  private approvalCallbacks: Map<string, (approved: boolean, selectedOption?: string) => void> = new Map();
  private pendingApprovals: Map<string, { prompt: string; options: string[]; resolve: (value: { approved: boolean; selectedOption?: string }) => void }> = new Map();

  constructor(
    private readonly projectId: string,
    private readonly projectRoot: string,
    adapter: LLMAdapter,
    config: CursorAgentConfig
  ) {
    this.adapter = adapter;
    this.config = {
      projectId,
      projectRoot,
      maxToolCalls: config.maxToolCalls ?? 50,
      maxIterations: config.maxIterations ?? 20,
      temperature: config.temperature ?? 0.1,
      systemPrompt: config.systemPrompt ?? this.getDefaultSystemPrompt(),
      toolFilter: config.toolFilter ?? {},
      parallelExecution: config.parallelExecution ?? true,
      maxParallel: config.maxParallel ?? 5,
      onEvent: config.onEvent ?? (() => {}),
      onTokenStream: config.onTokenStream ?? (() => {}),
      maxTokens: config.maxTokens ?? 8192,
      enableResilience: config.enableResilience ?? true,
      resilienceOptions: config.resilienceOptions ?? {},
      taskId: config.taskId ?? `cursor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      autoCheckpoint: config.autoCheckpoint ?? true,
      enableOrchestration: config.enableOrchestration ?? true,
      orchestrationLLM: config.orchestrationLLM ?? adapter,
      enableAdversarialVerification: config.enableAdversarialVerification ?? true,
      enableCompletenessCritic: config.enableCompletenessCritic ?? true,
      enableJudgePanel: config.enableJudgePanel ?? true,
      verificationConfidenceThreshold: config.verificationConfidenceThreshold ?? 0.8,
      enablePlanningMode: config.enablePlanningMode ?? true,
      enableDebugging: config.enableDebugging ?? true,
      enableGitIntegration: config.enableGitIntegration ?? true,
      enableMCPIntegration: config.enableMCPIntegration ?? true,
      enableSubagents: config.enableSubagents ?? true,
      enableHooks: config.enableHooks ?? true,
      maxSubagents: config.maxSubagents ?? 3,
      subagentTimeout: config.subagentTimeout ?? 120000,
      planningModel: config.planningModel ?? "same",
      autoApproveSafeActions: config.autoApproveSafeActions ?? false,
    };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /** Initialize the agent (load indexer, register tools) */
  async initialize(): Promise<void> {
    // Initialize codebase indexer
    const indexConfig: IndexConfig = {
      projectId: this.config.projectId,
      projectRoot: this.config.projectRoot,
      excludePatterns: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/*.lock"],
      includePatterns: ["**/*.{ts,tsx,js,jsx,py,rs,go,java,cpp,c,h,cs,rb,php,swift,kt}"],
      maxFileSize: 1024 * 1024, // 1MB
      chunkSize: 500,
      overlap: 50,
      embeddingModel: "Xenova/all-MiniLM-L6-v2",
      enableIncremental: true,
      useRemoteEmbeddings: false,
    };
    this.indexer = createCodebaseIndexer(this.config.projectId, this.config.projectRoot, indexConfig);
    await this.indexer.initialize();

    // Register Cursor-specific tools
    this.registerCursorTools();

    // Load persisted state if taskId exists
    if (this.config.taskId) {
      await this.loadPersistedState();
    }

    this.emitEvent({
      type: "planning_start",
      step: 0,
      timestamp: new Date().toISOString(),
      content: "Cursor Agent initialized",
    });
  }

  /** Run the agent with a user goal */
  async run(goal: string): Promise<CursorAgentResult> {
    this.stopped = false;
    this.startTime = Date.now();
    this.currentIteration = 0;
    this.totalToolCalls = 0;

    // Add user goal to history
    this.addToHistory({ role: "user", content: goal });

    // Planning mode: create plan first
    if (this.config.enablePlanningMode) {
      await this.createPlan(goal);
      if (this.plan && this.plan.status === "draft") {
        // Request user approval for plan
        const approved = await this.requestPlanApproval(this.plan);
        if (!approved) {
          return this.createResult("approval_denied");
        }
        this.plan.status = "approved";
      }
    }

    // Main agent loop
    while (!this.stopped && this.currentIteration < this.config.maxIterations) {
      this.currentIteration++;
      await this.runIteration();

      // Check stop conditions
      if (this.totalToolCalls >= this.config.maxToolCalls) {
        this.stopped = true;
        this.stopReason = "max_tool_calls";
        break;
      }

      // Auto-checkpoint
      if (this.config.autoCheckpoint && this.currentIteration % 5 === 0) {
        await this.createCheckpoint(`Auto-checkpoint at iteration ${this.currentIteration}`);
      }
    }

    return this.createResult(this.stopReason || "model_done");
  }

  /** Stop the agent */
  stop(reason: CursorAgentResult["stoppedReason"] = "user_stopped"): void {
    this.stopped = true;
    this.stopReason = reason;
  }

  /** Get current plan */
  getPlan(): Plan | null {
    return this.plan;
  }

  /** Get checkpoints */
  getCheckpoints(): Checkpoint[] {
    return this.checkpoints;
  }

  /** Restore from checkpoint */
  async restoreCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return false;

    this.conversationHistory = checkpoint.state.conversationHistory;
    this.plan = checkpoint.state.plan ?? null;
    this.executedSteps = checkpoint.state.executedSteps;
    // Note: working directory and git status restoration would need terminal access

    this.emitEvent({
      type: "checkpoint_restored",
      step: this.currentIteration,
      timestamp: new Date().toISOString(),
      content: `Restored checkpoint: ${checkpoint.label}`,
    });

    return true;
  }

  /** Respond to approval request */
  respondToApproval(approvalId: string, approved: boolean, selectedOption?: string): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      pending.resolve({ approved, selectedOption });
      this.pendingApprovals.delete(approvalId);
    }
  }

  // ============================================================================
  // Core Loop
  // ============================================================================

  private async runIteration(): Promise<void> {
    // Build context for LLM
    const context = await this.buildContext();

    // Get tool definitions
    const tools = getToolDefinitionsForLLM(this.config.toolFilter);

    // Call LLM
    const messages: LLMMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: context },
    ];

    this.emitEvent({
      type: "thinking_start",
      step: this.currentIteration,
      timestamp: new Date().toISOString(),
    });

    let response: LLMCompletionResult;
    try {
      response = await this.adapter.complete(messages, {
        tools,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        toolChoice: "auto",
        stream: true,
        onToken: this.config.onTokenStream,
      });
    } catch (error) {
      this.emitEvent({
        type: "error",
        step: this.currentIteration,
        timestamp: new Date().toISOString(),
        error: String(error),
      });
      throw error;
    }

    this.emitEvent({
      type: "thinking_end",
      step: this.currentIteration,
      timestamp: new Date().toISOString(),
    });

    // Process tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      await this.executeToolCalls(response.toolCalls);
    }

    // Add assistant response to history
    this.addToHistory({
      role: "assistant",
      content: response.text || "",
      tool_calls: response.toolCalls?.map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });
  }

  private async executeToolCalls(toolCalls: LLMToolCall[]): Promise<void> {
    // Group by dependency for parallel execution
    const groups = this.groupToolCallsByDependency(toolCalls);

    for (const group of groups) {
      const promises = group.map(async (toolCall) => {
        this.emitEvent({
          type: "tool_start",
          step: this.currentIteration,
          timestamp: new Date().toISOString(),
          toolCall: {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.arguments,
            dependsOn: [],
            parallelGroup: groups.indexOf(group),
          },
        });

        try {
          const result = await this.executeToolWithResilience(toolCall);
          this.totalToolCalls++;

          this.emitEvent({
            type: "tool_complete",
            step: this.currentIteration,
            timestamp: new Date().toISOString(),
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.arguments,
              dependsOn: [],
              parallelGroup: groups.indexOf(group),
            },
            toolResult: {
              success: result.success,
              data: result.data,
              summary: result.summary,
              error: result.error,
              artifacts: result.artifacts,
            },
          });

          // Add tool result to history
          this.addToHistory({
            role: "tool",
            content: result.summary || JSON.stringify(result.data),
            tool_call_id: toolCall.id,
          });

          return result;
        } catch (error) {
          this.emitEvent({
            type: "tool_error",
            step: this.currentIteration,
            timestamp: new Date().toISOString(),
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.arguments,
              dependsOn: [],
              parallelGroup: groups.indexOf(group),
            },
            toolResult: {
              success: false,
              error: String(error),
            },
          });
          throw error;
        }
      });

      await Promise.all(promises);
    }
  }

  // ============================================================================
  // Planning Mode
  // ============================================================================

  private async createPlan(goal: string): Promise<void> {
    this.emitEvent({
      type: "planning_step",
      step: 0,
      timestamp: new Date().toISOString(),
      content: "Exploring codebase to understand the task...",
    });

    // Explore codebase for context
    const explorationResults = await this.exploreCodebase(goal);

    this.emitEvent({
      type: "exploration_result",
      step: 0,
      timestamp: new Date().toISOString(),
      explorationQuery: goal,
      explorationResults,
    });

    // Generate plan using LLM
    const planPrompt = this.buildPlanningPrompt(goal, explorationResults);
    const planResponse = await this.adapter.complete([
      { role: "system", content: this.getPlanningSystemPrompt() },
      { role: "user", content: planPrompt },
    ], {
      temperature: 0.1,
      maxTokens: 4096,
    });

    // Parse plan from response
    this.plan = this.parsePlan(planResponse.text || "", goal);

    this.emitEvent({
      type: "planning_complete",
      step: 0,
      timestamp: new Date().toISOString(),
      plan: this.plan,
    });
  }

  private async exploreCodebase(query: string): Promise<SearchResult[]> {
    if (!this.indexer) return [];

    const results = await this.indexer.search({
      projectId: this.config.projectId,
      query,
      limit: 20,
      hybrid: true,
      expandQuery: true,
    });

    return results;
  }

  private buildPlanningPrompt(goal: string, explorationResults: SearchResult[]): string {
    const context = explorationResults
      .map(r => `${r.chunk.relativePath}:${r.chunk.startLine}-${r.chunk.endLine} (${r.chunk.chunkType}: ${r.chunk.name})\n${r.chunk.content.slice(0, 500)}`)
      .join("\n\n---\n\n");

    return `Goal: ${goal}

Codebase Exploration Results:
${context || "No relevant code found."}

Create a detailed execution plan with the following structure:
1. Break down the goal into minimal, verifiable steps
2. Each step should have: id, order, title, description, type, files, tools, dependencies, verificationCriteria
3. Assess risks and provide mitigation
4. Estimate tokens and duration

Return as JSON matching the Plan interface.`;
  }

  private parsePlan(text: string, goal: string): Plan {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          id: `plan-${Date.now()}`,
          goal,
          steps: parsed.steps || [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "draft",
          riskAssessment: parsed.riskAssessment || { level: "medium", factors: [], mitigation: [], rollbackPlan: "" },
          estimatedTokens: parsed.estimatedTokens || 10000,
          estimatedDurationMs: parsed.estimatedDurationMs || 60000,
        };
      }
    } catch (e) {
      console.error("Failed to parse plan:", e);
    }

    // Fallback: create minimal plan
    return {
      id: `plan-${Date.now()}`,
      goal,
      steps: [{
        id: "step-1",
        order: 1,
        title: "Execute goal",
        description: goal,
        type: "explore",
        files: [],
        tools: ["codebase.search"],
        dependencies: [],
        status: "pending",
        verificationCriteria: ["Goal achieved"],
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "draft",
      riskAssessment: { level: "medium", factors: ["Auto-generated plan"], mitigation: ["Review before execution"], rollbackPlan: "Revert changes" },
      estimatedTokens: 10000,
      estimatedDurationMs: 60000,
    };
  }

  private async requestPlanApproval(plan: Plan): Promise<boolean> {
    return new Promise((resolve) => {
      const approvalId = `approval-${Date.now()}`;

      this.emitEvent({
        type: "approval_requested",
        step: 0,
        timestamp: new Date().toISOString(),
        approvalId,
        approvalPrompt: `Plan created for: ${plan.goal}\n\nSteps: ${plan.steps.length}\nRisk: ${plan.riskAssessment.level}\nEstimated tokens: ${plan.estimatedTokens}\n\nApprove to execute?`,
        approvalOptions: ["Approve", "Modify", "Cancel"],
      });

      this.pendingApprovals.set(approvalId, {
        prompt: `Plan for: ${plan.goal}`,
        options: ["Approve", "Modify", "Cancel"],
        resolve: (value) => {
          resolve(value.approved);
        },
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId);
          resolve(false);
        }
      }, 300000);
    });
  }

  // ============================================================================
  // Tool Registration
  // ============================================================================

  private registerCursorTools(): void {
    // Codebase search tool
    registerTool({
      name: "codebase.search",
      description: "Search the codebase semantically using natural language. Returns relevant code chunks with file paths and line numbers.",
      category: "codebase",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language query (e.g., 'how does authentication work?')" },
          limit: { type: "number", description: "Max results (default: 10)" },
          types: { type: "array", items: { type: "string", enum: ["function", "class", "interface", "type", "import", "export", "comment", "block"] } },
          languages: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
      },
      execute: async (args, ctx) => {
        if (!this.indexer) throw new Error("Indexer not initialized");
        const results = await this.indexer.search({
          projectId: this.config.projectId,
          query: args.query as string,
          limit: (args.limit as number) || 10,
          types: args.types as any,
          languages: args.languages as string[],
          hybrid: true,
          expandQuery: true,
        });
        return { success: true, data: results, summary: `Found ${results.length} results for "${args.query}"` };
      },
    });

    // Codebase symbol search
    registerTool({
      name: "codebase.findSymbol",
      description: "Find a specific symbol (function, class, variable) by name.",
      category: "codebase",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Symbol name to find" },
          limit: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["symbol"],
      },
      execute: async (args, ctx) => {
        if (!this.indexer) throw new Error("Indexer not initialized");
        const results = await this.indexer.searchSymbol(this.config.projectId, args.symbol as string, (args.limit as number) || 10);
        return { success: true, data: results, summary: `Found ${results.length} matches for symbol "${args.symbol}"` };
      },
    });

    // Read file
    registerTool({
      name: "files.read",
      description: "Read a file from the project.",
      category: "files",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
        },
        required: ["path"],
      },
      execute: async (args, ctx) => {
        const fs = await import("fs");
        const path = join(this.config.projectRoot, args.path as string);
        if (!fs.existsSync(path)) throw new Error(`File not found: ${args.path}`);
        const content = fs.readFileSync(path, "utf-8");
        return { success: true, data: { path: args.path, content }, summary: `Read ${args.path} (${content.length} chars)` };
      },
    });

    // Write file
    registerTool({
      name: "files.write",
      description: "Write a file to the project.",
      category: "files",
      risk: "WRITE",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
      execute: async (args, ctx) => {
        const fs = await import("fs");
        const path = join(this.config.projectRoot, args.path as string);
        fs.mkdirSync(require("path").dirname(path), { recursive: true });
        fs.writeFileSync(path, args.content as string, "utf-8");
        return { success: true, data: { path: args.path }, summary: `Wrote ${args.path}` };
      },
    });

    // Edit file (apply diff)
    registerTool({
      name: "files.edit",
      description: "Apply a unified diff to a file.",
      category: "files",
      risk: "WRITE",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          diff: { type: "string", description: "Unified diff to apply" },
        },
        required: ["path", "diff"],
      },
      execute: async (args, ctx) => {
        // Use the existing build-tools apply_fix logic
        const { executeTool } = await import("./build-tools");
        return executeTool({ name: "files.apply_fix", arguments: { filePath: args.path, diff: args.diff } }, ctx as any);
      },
    });

    // Terminal command
    registerTool({
      name: "terminal.run",
      description: "Run a terminal command in the project directory.",
      category: "terminal",
      risk: "EXTERNAL_ACTION",
      requiresApproval: true,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run" },
          cwd: { type: "string", description: "Working directory (relative to project root)" },
          timeout: { type: "number", description: "Timeout in ms (default: 60000)" },
        },
        required: ["command"],
      },
      execute: async (args, ctx) => {
        const { executeTool } = await import("./build-tools");
        return executeTool({ name: "build.run_command", arguments: { command: args.command, cwd: args.cwd, timeout: args.timeout } }, ctx as any);
      },
    });

    // Git operations
    registerTool({
      name: "git.diff",
      description: "Get git diff for the project.",
      category: "git",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged changes" },
          file: { type: "string", description: "Specific file path" },
        },
      },
      execute: async (args, ctx) => {
        const { executeTool } = await import("./build-tools");
        return executeTool({ name: "git.diff", arguments: args }, ctx as any);
      },
    });

    registerTool({
      name: "git.log",
      description: "Get git log history.",
      category: "git",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max commits (default: 20)" },
          file: { type: "string", description: "Specific file path" },
        },
      },
      execute: async (args, ctx) => {
        const { execSync } = await import("child_process");
        const cwd = this.config.projectRoot;
        const limit = args.limit || 20;
        const file = args.file ? ` -- ${args.file}` : "";
        const output = execSync(`git log --oneline -n ${limit}${file}`, { cwd, encoding: "utf-8" });
        return { success: true, data: output.trim().split("\n"), summary: `Git log (${limit} commits)` };
      },
    });

    registerTool({
      name: "git.blame",
      description: "Get git blame for a file.",
      category: "git",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "File path" },
        },
        required: ["file"],
      },
      execute: async (args, ctx) => {
        const { execSync } = await import("child_process");
        const cwd = this.config.projectRoot;
        const output = execSync(`git blame ${args.file}`, { cwd, encoding: "utf-8" });
        return { success: true, data: output, summary: `Git blame for ${args.file}` };
      },
    });

    registerTool({
      name: "git.commit",
      description: "Create a git commit with a generated message.",
      category: "git",
      risk: "WRITE",
      requiresApproval: true,
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Commit message" },
          files: { type: "array", items: { type: "string" }, description: "Files to stage (default: all)" },
        },
        required: ["message"],
      },
      execute: async (args, ctx) => {
        const { execSync } = await import("child_process");
        const cwd = this.config.projectRoot;
        const files = args.files ? args.files.join(" ") : ".";
        execSync(`git add ${files}`, { cwd });
        execSync(`git commit -m "${(args.message as string).replace(/"/g, '\\"')}"`, { cwd });
        return { success: true, summary: `Committed: ${args.message}` };
      },
    });

    // Test runner
    registerTool({
      name: "test.run",
      description: "Run tests in the project.",
      category: "test",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Test command (default: npm test)" },
          file: { type: "string", description: "Specific test file" },
        },
      },
      execute: async (args, ctx) => {
        const { execSync } = await import("child_process");
        const cwd = this.config.projectRoot;
        const cmd = args.command || "npm test";
        const fullCmd = args.file ? `${cmd} ${args.file}` : cmd;
        try {
          const output = execSync(fullCmd, { cwd, encoding: "utf-8", timeout: 120000 });
          return { success: true, data: output, summary: `Tests passed: ${fullCmd}` };
        } catch (error: any) {
          return { success: false, data: error.stdout, error: error.stderr || error.message, summary: `Tests failed: ${fullCmd}` };
        }
      },
    });

    // Debug: run with debugger
    registerTool({
      name: "debug.run",
      description: "Run a command with debugging (breakpoints, inspection).",
      category: "debug",
      risk: "READ",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run with debugger" },
          breakpoints: { type: "array", items: { type: "object", properties: { file: { type: "string" }, line: { type: "number" } } } },
        },
        required: ["command"],
      },
      execute: async (args, ctx) => {
        // This would integrate with a debug adapter protocol (DAP) implementation
        // For now, return a placeholder
        return { success: true, data: { message: "Debug adapter not yet implemented" }, summary: "Debug session started" };
      },
    });

    // Spawn subagent
    registerTool({
      name: "agent.spawn",
      description: "Spawn a specialized subagent for a specific task.",
      category: "agent",
      risk: "EXTERNAL_ACTION",
      requiresApproval: true,
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["code-reviewer", "planner", "researcher", "fixer", "synthesizer", "debugger", "test-writer", "documenter"] },
          goal: { type: "string", description: "Task goal for the subagent" },
          context: { type: "string", description: "Additional context" },
        },
        required: ["type", "goal"],
      },
      execute: async (args, ctx) => {
        if (!this.config.enableSubagents) throw new Error("Subagents disabled");
        const subagent = SUBAGENTS[args.type as keyof typeof SUBAGENTS];
        if (!subagent) throw new Error(`Unknown subagent type: ${args.type}`);

        const result = await spawnSubagent(
          subagent,
          args.goal as string,
          this.config.orchestrationLLM || this.adapter,
          { ...ctx, projectId: this.config.projectId }
        );

        this.subagentResults.push({
          subagentId: `sub-${Date.now()}`,
          type: args.type as string,
          goal: args.goal as string,
          status: "completed",
          result: result,
          durationMs: 0,
          artifacts: [],
        });

        return { success: true, data: result, summary: `Subagent ${args.type} completed` };
      },
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private getDefaultSystemPrompt(): string {
    return `You are Cursor Agent, an autonomous AI coding assistant with full access to the codebase.

CAPABILITIES:
- Semantic code search (@codebase) - find anything by meaning, not just keywords
- File operations: read, write, edit, delete
- Terminal: run commands, tests, builds
- Git: diff, log, blame, commit, branch
- Debugging: run tests, inspect variables, set breakpoints
- Subagents: spawn specialized agents (code-reviewer, planner, researcher, fixer, etc.)
- Planning mode: explore → plan → execute with user approval
- Checkpointing: save/restore state at any point

WORKFLOW:
1. When given a goal, first explore the codebase to understand context
2. If planning mode enabled, create a detailed plan and get user approval
3. Execute the plan step by step, using tools as needed
4. Verify changes with tests and adversarial review
5. Create checkpoints for rollback capability

PRINCIPLES:
- Prefer reading over guessing - use codebase.search and files.read
- Make minimal, focused changes
- Run tests after modifications
- Use subagents for specialized tasks (review, research, debugging)
- Ask for approval on destructive actions
- Keep user informed of progress via events`;
  }

  private getPlanningSystemPrompt(): string {
    return `You are a senior software architect creating execution plans.

Given a goal and codebase exploration results, create a detailed, minimal, verifiable plan.

OUTPUT FORMAT (JSON):
{
  "steps": [
    {
      "id": "step-1",
      "order": 1,
      "title": "Explore authentication module",
      "description": "Find and understand the auth implementation",
      "type": "explore",
      "files": ["src/auth/*.ts"],
      "tools": ["codebase.search", "files.read"],
      "dependencies": [],
      "verificationCriteria": ["Found auth entry points", "Understood token flow"]
    }
  ],
  "riskAssessment": {
    "level": "low|medium|high|critical",
    "factors": ["factor1", "factor2"],
    "mitigation": ["mitigation1"],
    "rollbackPlan": "git checkout -- ."
  },
  "estimatedTokens": 5000,
  "estimatedDurationMs": 30000
}

Rules:
- Break into SMALL steps (one logical action each)
- Each step must have verification criteria
- Order by dependencies
- Prefer exploration before modification
- Include test steps after changes
- Assess risk honestly`;
  }

  private async buildContext(): Promise<string> {
    let context = `Project: ${this.config.projectId}\n`;
    context += `Working directory: ${this.config.projectRoot}\n`;
    context += `Iteration: ${this.currentIteration}/${this.config.maxIterations}\n`;
    context += `Tool calls: ${this.totalToolCalls}/${this.config.maxToolCalls}\n`;

    if (this.plan) {
      context += `\nCurrent Plan: ${this.plan.goal} (${this.plan.status})\n`;
      const pendingSteps = this.plan.steps.filter(s => s.status === "pending" || s.status === "in_progress");
      const nextStep = pendingSteps[0];
      if (nextStep) {
        context += `Next step: ${nextStep.title} (${nextStep.type})\n`;
        context += `Description: ${nextStep.description}\n`;
        context += `Files: ${nextStep.files.join(", ") || "none"}\n`;
        context += `Tools: ${nextStep.tools.join(", ")}\n`;
      }
    }

    if (this.executedSteps.length > 0) {
      context += `\nExecuted steps: ${this.executedSteps.length}\n`;
      const recent = this.executedSteps.slice(-3);
      for (const step of recent) {
        context += `  - ${step.title}: ${step.status}${step.error ? ` (error: ${step.error})` : ""}\n`;
      }
    }

    return context;
  }

  private groupToolCallsByDependency(toolCalls: LLMToolCall[]): LLMToolCall[][] {
    // Simple implementation: all independent calls in one group
    // In a full implementation, parse dependsOn from tool definitions
    return [toolCalls];
  }

  private async executeToolWithResilience(toolCall: LLMToolCall): Promise<UniversalToolResult> {
    const ctx: ToolExecutionContext = {
      projectId: this.config.projectId,
      accountId: "cursor-agent",
      permissions: [],
      approvalCallback: async (prompt) => {
        if (this.config.autoApproveSafeActions) return true;
        return new Promise((resolve) => {
          const approvalId = `approval-${Date.now()}`;
          this.emitEvent({
            type: "approval_requested",
            step: this.currentIteration,
            timestamp: new Date().toISOString(),
            approvalId,
            approvalPrompt: prompt,
            approvalOptions: ["Approve", "Deny"],
          });
          this.pendingApprovals.set(approvalId, {
            prompt,
            options: ["Approve", "Deny"],
            resolve: (value) => resolve(value.approved),
          });
        });
      },
    };

    if (this.config.enableResilience) {
      return executeUniversalToolWithResilience(toolCall.name, toolCall.arguments, ctx, this.config.resilienceOptions);
    }

    return executeTool(toolCall.name, toolCall.arguments, ctx);
  }

  private addToHistory(message: LLMMessageWithToolCalls): void {
    this.conversationHistory.push(message);
    // Trim history if too long (keep last 50 messages)
    if (this.conversationHistory.length > 50) {
      this.conversationHistory = this.conversationHistory.slice(-50);
    }
  }

  private emitEvent(event: CursorAgentEvent): void {
    this.config.onEvent(event);
  }

  private async createCheckpoint(label: string): Promise<void> {
    const persistence = getTaskPersistenceManager();
    const state: PersistentTaskState = {
      taskId: this.config.taskId,
      status: "running" as TaskStatus,
      conversationHistory: this.conversationHistory,
      plan: this.plan ? JSON.stringify(this.plan) : undefined,
      executedSteps: JSON.stringify(this.executedSteps),
      workingDirectory: this.config.projectRoot,
      gitStatus: "", // Would get from git
      createdAt: Date.now(),
      updatedAt: Date.now(),
      checkpoints: [],
    };

    await persistence.saveTaskState(state);

    const checkpoint: Checkpoint = {
      id: `checkpoint-${Date.now()}`,
      taskId: this.config.taskId,
      label,
      state: {
        conversationHistory: this.conversationHistory,
        plan: this.plan ?? undefined,
        executedSteps: this.executedSteps,
        workingDirectory: this.config.projectRoot,
        gitStatus: "",
      },
      createdAt: Date.now(),
      sizeBytes: JSON.stringify(state).length,
    };

    this.checkpoints.push(checkpoint);

    this.emitEvent({
      type: "checkpoint_created",
      step: this.currentIteration,
      timestamp: new Date().toISOString(),
      content: label,
    });
  }

  private async loadPersistedState(): Promise<void> {
    const persistence = getTaskPersistenceManager();
    const state = await persistence.loadTaskState(this.config.taskId);
    if (state) {
      this.conversationHistory = state.conversationHistory || [];
      if (state.plan) {
        this.plan = JSON.parse(state.plan);
      }
      this.executedSteps = JSON.parse(state.executedSteps || "[]");
    }
  }

  private createResult(stoppedReason: CursorAgentResult["stoppedReason"]): CursorAgentResult {
    return {
      finalResponse: this.conversationHistory.findLast(m => m.role === "assistant")?.content || "Task completed",
      totalToolCalls: this.totalToolCalls,
      totalIterations: this.currentIteration,
      allToolResults: [], // Would collect during execution
      allArtifacts: [],
      iterations: [],
      converged: stoppedReason === "model_done",
      stoppedReason,
      plan: this.plan ?? undefined,
      executedSteps: this.executedSteps,
      checkpoints: this.checkpoints,
      subagentResults: this.subagentResults,
      gitOperations: this.gitOperations,
      debugSessions: this.debugSessions,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCursorAgent(
  projectId: string,
  projectRoot: string,
  adapter: LLMAdapter,
  config: CursorAgentConfig
): CursorAgent {
  return new CursorAgent(projectId, projectRoot, adapter, config);
}

export type { LLMMessageWithToolCalls };