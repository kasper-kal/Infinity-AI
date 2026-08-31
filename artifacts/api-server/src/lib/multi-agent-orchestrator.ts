/**
 * MULTI-AGENT ORCHESTRATOR — Parallel Agents on Single Task
 *
 * Extends orchestration engine with:
 * - Planner decomposes task → spawns N agents → merges results
 * - Shared context store for cross-agent communication
 * - Progress visible in UI
 * - Coordination patterns: map-reduce, pipeline, scatter-gather
 */

import { EventEmitter } from "events";
import type { LLMAdapter } from "./llm-adapter";
import { createBestAdapter } from "./adapter-factory";
import { orchestrator, type PlannerOutput } from "./orchestration-engine";
import { runUniversalAgent, type AgentLoopResult, type UniversalAgentConfig } from "./universal-agent";
import { spawnSubagent, type SubagentConfig } from "./subagents";
import type { ToolExecutionContext } from "./tool-types";
import { VirtualWorktreeManager, getWorktreeManager, type WorktreeMeta } from "./virtual-worktree";
import { ShadowWorkspaceManager, type ShadowWorkspaceConfig } from "./shadow-workspace";

/**
 * Multi-agent orchestration patterns
 */
export type OrchestrationPattern =
  | "map-reduce"        // Split work, run in parallel, reduce results
  | "pipeline"          // Sequential stages, each with parallel agents
  | "scatter-gather"    // Broadcast to all, gather best
  | "consensus"         // Multiple agents vote on decision
  | "adversarial"       // Proposer + critics
  | "specialist"        // Different specialists for different aspects
  ;

export interface MultiAgentConfig {
  /** Orchestration pattern to use */
  pattern: OrchestrationPattern;
  /** Task description */
  task: string;
  /** Number of agents to spawn */
  agentCount: number;
  /** Base snapshot for worktrees */
  baseSnapshot: Record<string, string>;
  /** Base commit hash */
  baseCommit: string;
  /** LLM adapter */
  llm?: LLMAdapter;
  /** Tool execution context */
  context: ToolExecutionContext;
  /** Agent config overrides */
  agentConfig?: Partial<UniversalAgentConfig>;
  /** Custom prompts per agent (for specialist pattern) */
  agentPrompts?: string[];
  /** Progress callback */
  onProgress?: (event: OrchestrationProgressEvent) => void;
  /** Enable shadow workspaces (isolated env per agent) */
  useShadowWorkspaces?: boolean;
  /** Shadow workspace config */
  shadowConfig?: Partial<ShadowWorkspaceConfig>;
  /** Max total time (ms) */
  maxTimeMs?: number;
  /** Debug logging */
  debug?: boolean;
}

export interface OrchestrationProgressEvent {
  stage: "planning" | "spawning" | "running" | "merging" | "complete" | "error";
  message: string;
  progress: number; // 0-100
  agentProgress?: AgentProgress[];
  timestamp: number;
}

export interface AgentProgress {
  agentIndex: number;
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string;
  progress: number; // 0-100
  worktreeId?: string;
}

export interface MultiAgentResult {
  orchestrationId: string;
  pattern: OrchestrationPattern;
  task: string;
  success: boolean;
  agentResults: AgentExecutionResult[];
  mergedResult: AgentLoopResult | null;
  mergeStrategy: string;
  totalDurationMs: number;
  error: string | null;
}

export interface AgentExecutionResult {
  agentIndex: number;
  worktreeId: string;
  status: "fulfilled" | "rejected";
  result: AgentLoopResult | null;
  error: string | null;
  durationMs: number;
  artifacts: string[]; // file paths created/modified
}

/**
 * Shared context store for multi-agent coordination
 */
export class SharedContextStore extends EventEmitter {
  private store: Map<string, unknown> = new Map();
  private subscribers: Map<string, Set<(value: unknown) => void>> = new Map();
  private history: Array<{ key: string; value: unknown; timestamp: number; agentIndex: number }> = [];

  set(key: string, value: unknown, agentIndex: number): void {
    this.store.set(key, value);
    this.history.push({ key, value, timestamp: Date.now(), agentIndex });
    this.notify(key, value);
  }

  get(key: string): unknown {
    return this.store.get(key);
  }

  getAll(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }

  subscribe(key: string, callback: (value: unknown) => void): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
    return () => this.subscribers.get(key)?.delete(callback);
  }

  private notify(key: string, value: unknown): void {
    this.subscribers.get(key)?.forEach(cb => cb(value));
  }

  getHistory(key?: string): Array<{ key: string; value: unknown; timestamp: number; agentIndex: number }> {
    if (key) return this.history.filter(h => h.key === key);
    return [...this.history];
  }

  clear(): void {
    this.store.clear();
    this.subscribers.clear();
    this.history = [];
  }
}

/**
 * Multi-Agent Orchestrator
 */
export class MultiAgentOrchestrator extends EventEmitter {
  private config: MultiAgentConfig;
  private sharedContext: SharedContextStore;
  private worktreeManager: VirtualWorktreeManager;
  private shadowManager: ShadowWorkspaceManager | null = null;
  private agentProgress: AgentProgress[] = [];
  private debug: boolean;

  constructor(config: MultiAgentConfig) {
    super();
    this.config = {
      ...config,
      maxTimeMs: config.maxTimeMs || 600000, // 10 min default
      useShadowWorkspaces: config.useShadowWorkspaces ?? false,
    };
    this.sharedContext = new SharedContextStore();
    this.worktreeManager = getWorktreeManager();
    this.debug = config.debug || false;
  }

  /**
   * Initialize orchestrator
   */
  async init(): Promise<void> {
    await this.worktreeManager.init();

    if (this.config.useShadowWorkspaces) {
      this.shadowManager = new ShadowWorkspaceManager(
        this.worktreeManager,
        this.config.shadowConfig?.limits,
        this.config.debug
      );
      await this.shadowManager.init({
        size: this.config.agentCount,
        baseSnapshot: this.config.baseSnapshot,
        baseCommit: this.config.baseCommit,
        defaultConfig: {
          baseSnapshot: this.config.baseSnapshot,
          baseCommit: this.config.baseCommit,
          ...this.config.shadowConfig,
        },
      });
    }

    this.log("MultiAgentOrchestrator initialized");
  }

  /**
   * Run multi-agent orchestration
   */
  async run(): Promise<MultiAgentResult> {
    const orchestrationId = this.generateId();
    const startTime = Date.now();

    this.emit("orchestration:started", { orchestrationId, config: this.config });

    try {
      // Stage 1: Planning
      this.emitProgress("planning", "Planning task decomposition...", 10);
      const plan = await this.planTask();

      // Stage 2: Spawn agents
      this.emitProgress("spawning", `Spawning ${this.config.agentCount} agents...`, 20);
      await this.initializeAgentProgress();

      // Stage 3: Execute based on pattern
      this.emitProgress("running", "Running agents...", 30);
      const agentResults = await this.executePattern(plan);

      // Stage 4: Merge results
      this.emitProgress("merging", "Merging agent results...", 85);
      const mergedResult = await this.mergeResults(agentResults);

      const totalDurationMs = Date.now() - startTime;

      const result: MultiAgentResult = {
        orchestrationId,
        pattern: this.config.pattern,
        task: this.config.task,
        success: agentResults.some(r => r.status === "fulfilled"),
        agentResults,
        mergedResult,
        mergeStrategy: this.getMergeStrategy(),
        totalDurationMs,
        error: null,
      };

      this.emitProgress("complete", "Orchestration complete", 100);
      this.emit("orchestration:completed", result);
      this.log(`Orchestration ${orchestrationId} completed in ${totalDurationMs}ms`);

      return result;
    } catch (err) {
      const error = err as Error;
      const totalDurationMs = Date.now() - startTime;

      const result: MultiAgentResult = {
        orchestrationId,
        pattern: this.config.pattern,
        task: this.config.task,
        success: false,
        agentResults: [],
        mergedResult: null,
        mergeStrategy: this.getMergeStrategy(),
        totalDurationMs,
        error: error.message,
      };

      this.emitProgress("error", `Orchestration failed: ${error.message}`, 0);
      this.emit("orchestration:failed", { orchestrationId, error });
      this.log(`Orchestration ${orchestrationId} failed: ${error.message}`);

      return result;
    }
  }

  /**
   * Plan task using planner subagent
   */
  private async planTask(): Promise<PlannerOutput> {
    const llm = this.config.llm || await createBestAdapter();

    const plan = await spawnSubagent<PlannerOutput>(
      "planner",
      `Decompose this task into ${this.config.agentCount} independent workstreams for parallel execution:

TASK: ${this.config.task}

REQUIREMENTS:
- Each workstream must be independently executable
- Minimize dependencies between workstreams
- Identify shared context needed
- Specify verification criteria for each
- Output as planner schema`,
      llm,
      { temperature: 0.2, maxTokens: 4000 } as SubagentConfig
    );

    // Store plan in shared context
    this.sharedContext.set("plan", plan, -1);
    this.sharedContext.set("task", this.config.task, -1);

    return plan;
  }

  /**
   * Initialize agent progress tracking
   */
  private async initializeAgentProgress(): Promise<void> {
    this.agentProgress = Array.from({ length: this.config.agentCount }, (_, i) => ({
      agentIndex: i,
      status: "pending" as const,
      currentStep: "Initializing",
      progress: 0,
    }));
  }

  /**
   * Execute based on orchestration pattern
   */
  private async executePattern(plan: PlannerOutput): Promise<AgentExecutionResult[]> {
    switch (this.config.pattern) {
      case "map-reduce":
        return this.executeMapReduce(plan);
      case "pipeline":
        return this.executePipeline(plan);
      case "scatter-gather":
        return this.executeScatterGather(plan);
      case "consensus":
        return this.executeConsensus(plan);
      case "adversarial":
        return this.executeAdversarial(plan);
      case "specialist":
        return this.executeSpecialist(plan);
      default:
        return this.executeMapReduce(plan);
    }
  }

  /**
   * Map-Reduce: Split work, run parallel, reduce
   */
  private async executeMapReduce(plan: PlannerOutput): Promise<AgentExecutionResult[]> {
    const steps = plan.steps.slice(0, this.config.agentCount);
    const prompts = steps.map((step, i) =>
      `You are agent ${i + 1} of ${this.config.agentCount} working on: ${this.config.task}

YOUR WORKSTREAM: ${step.description}
VERIFICATION: ${step.verification}
DEPENDS ON: ${step.dependsOn.join(", ") || "none"}

SHARED CONTEXT:
${JSON.stringify(this.sharedContext.getAll(), null, 2)}

Execute your workstream. Output your changes and results.`
    );

    return this.runAgentsParallel(prompts);
  }

  /**
   * Pipeline: Sequential stages with parallel agents per stage
   */
  private async executePipeline(plan: PlannerOutput): Promise<AgentExecutionResult[]> {
    // Group steps by dependency level
    const stages = this.groupStepsByDependency(plan.steps);
    let allResults: AgentExecutionResult[] = [];

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stageSteps = stages[stageIndex];
      const prompts = stageSteps.map((step, i) =>
        `Pipeline Stage ${stageIndex + 1}/${stages.length} - Agent ${i + 1}/${stageSteps.length}

TASK: ${this.config.task}
YOUR STEP: ${step.description}
VERIFICATION: ${step.verification}

PREVIOUS STAGE RESULTS:
${JSON.stringify(this.sharedContext.getAll(), null, 2)}

Execute your step. Results will be available to next stage.`
      );

      const stageResults = await this.runAgentsParallel(prompts);
      allResults.push(...stageResults);

      // Update shared context with stage results
      this.sharedContext.set(`stage-${stageIndex}-results`, stageResults, -1);
    }

    return allResults;
  }

  /**
   * Scatter-Gather: Broadcast same task, gather best result
   */
  private async executeScatterGather(plan: PlannerOutput): Promise<AgentExecutionResult[]> {
    const prompts = Array(this.config.agentCount).fill(
      `You are one of ${this.config.agentCount} agents solving the same task independently.

TASK: ${this.config.task}

APPROACH: Provide your best solution. Be creative and thorough.
VERIFICATION: Your solution will be compared with others and the best will be selected.

SHARED CONTEXT:
${JSON.stringify(this.sharedContext.getAll(), null, 2)}`
    );

    return this.runAgentsParallel(prompts);
  }

  /**
   * Consensus: Multiple agents vote on decision
   */
  private async executeConsensus(plan: PlannerOutput): Promise<AgentExecutionResult[]> {
    const prompts = plan.steps.slice(0, this.config.agentCount).map((step, i) =>
      `Consensus Agent ${i + 1}/${this.config.agentCount}

TASK: ${this.config.task}
YOUR PERSPECTIVE: ${step.description}

Analyze the task and provide your recommendation with reasoning.
Your output will be combined with other agents to reach consensus.`
    );

    return this.runAgentsParallel(prompts);
  }

  /**
   * Adversarial: Proposer + critics
   */
  private async executeAdversarial(plan: PlannerOutput): Promise<AgentExecutionResult[]> {
    // First agent proposes, others critique
    const proposerPrompt = `You are the PROPOSER. Create a solution for:

TASK: ${this.config.task}

Provide a complete implementation. Other agents will critique it.`;

    const criticPrompts = Array(this.config.agentCount - 1).fill(null).map((_, i) =>
      `You are CRITIC ${i + 1}. Review the proposer's solution for:

TASK: ${this.config.task}

CRITIQUE FOCUS: ${plan.steps[i]?.description || "general correctness"}

Find flaws, edge cases, security issues, performance problems.
Output: VERDICT (approve/request-changes/block) + detailed findings.`
    );

    // Run proposer first
    const proposerResult = await this.runSingleAgent(0, proposerPrompt);
    this.sharedContext.set("proposal", proposerResult.result, 0);

    // Run critics in parallel
    const criticResults = await this.runAgentsParallel(criticPrompts, 1);

    return [proposerResult, ...criticResults];
  }

  /**
   * Specialist: Different specialists for different aspects
   */
  private async executeSpecialist(plan: PlannerOutput): Promise<AgentExecutionResult[]> {
    const prompts = this.config.agentPrompts || plan.steps.slice(0, this.config.agentCount).map(step =>
      `You are a SPECIALIST for: ${step.description}

TASK: ${this.config.task}
YOUR EXPERTISE: ${step.description}
TOOL HINT: ${step.toolHint || "general"}
VERIFICATION: ${step.verification}

Execute your specialist workstream.`
    );

    return this.runAgentsParallel(prompts);
  }

  /**
   * Run agents in parallel
   */
  private async runAgentsParallel(prompts: string[], startIndex = 0): Promise<AgentExecutionResult[]> {
    const llm = this.config.llm || await createBestAdapter();
    const results: AgentExecutionResult[] = [];

    const agentPromises = prompts.map(async (prompt, i) => {
      const agentIndex = startIndex + i;
      return this.runSingleAgent(agentIndex, prompt);
    });

    const settled = await Promise.allSettled(agentPromises);

    for (let i = 0; i < settled.length; i++) {
      const agentIndex = startIndex + i;
      if (settled[i].status === "fulfilled") {
        results.push(settled[i].value);
      } else {
        results.push({
          agentIndex,
          worktreeId: "",
          status: "rejected",
          result: null,
          error: settled[i].reason?.message || "Unknown error",
          durationMs: 0,
          artifacts: [],
        });
      }
    }

    return results;
  }

  /**
   * Run a single agent with worktree isolation
   */
  private async runSingleAgent(agentIndex: number, prompt: string): Promise<AgentExecutionResult> {
    const agentStartTime = Date.now();

    this.updateAgentProgress(agentIndex, "running", "Starting", 10);

    try {
      let worktreeId: string;
      let context: ToolExecutionContext;

      if (this.config.useShadowWorkspaces && this.shadowManager) {
        // Use shadow workspace
        const workspace = await this.shadowManager.getOrCreateWorkspace({
          baseSnapshot: this.config.baseSnapshot,
          baseCommit: this.config.baseCommit,
          ...this.config.shadowConfig,
        });
        worktreeId = workspace.worktreeId;

        context = {
          ...this.config.context,
          worktreeId,
          worktreeManager: this.worktreeManager,
          sharedContext: undefined,
          agentIndex,
        };

        this.updateAgentProgress(agentIndex, "running", "Workspace ready", 20);
      } else {
        // Use virtual worktree directly
        worktreeId = await this.worktreeManager.createWorktreeFromSnapshot(
          this.config.baseCommit,
          this.config.baseSnapshot
        );

        context = {
          ...this.config.context,
          worktreeId,
          worktreeManager: this.worktreeManager,
          sharedContext: undefined,
          agentIndex,
        };
      }

      this.updateAgentProgress(agentIndex, "running", "Executing task", 30);

      // Run agent
      const result = await runUniversalAgent(
        this.config.llm || await createBestAdapter(),
        context,
        prompt,
        {
          ...this.config.agentConfig,
          enableOrchestration: true,
          onEvent: (event) => {
            this.updateAgentProgressFromEvent(agentIndex, event);
          },
        }
      );

      this.updateAgentProgress(agentIndex, "completed", "Complete", 100);

      // Get artifacts
      const worktree = await this.worktreeManager.getWorktree(worktreeId);
      const artifacts = worktree ? Array.from(worktree.files.keys()) : [];

      return {
        agentIndex,
        worktreeId,
        status: "fulfilled",
        result,
        error: null,
        durationMs: Date.now() - agentStartTime,
        artifacts,
      };
    } catch (err) {
      const error = err as Error;
      this.updateAgentProgress(agentIndex, "failed", `Failed: ${error.message}`, 0);
      return {
        agentIndex,
        worktreeId: "",
        status: "rejected",
        result: null,
        error: error.message,
        durationMs: Date.now() - agentStartTime,
        artifacts: [],
      };
    }
  }

  /**
   * Merge agent results
   */
  private async mergeResults(results: AgentExecutionResult[]): Promise<AgentLoopResult | null> {
    const successful = results.filter(r => r.status === "fulfilled");
    if (successful.length === 0) return null;

    if (successful.length === 1) {
      return successful[0].result;
    }

    // Use synthesizer subagent to merge
    const llm = this.config.llm || await createBestAdapter();

    const mergePrompt = `Merge ${successful.length} agent results into a single coherent solution.

TASK: ${this.config.task}

AGENT RESULTS:
${successful.map((r, i) => `
=== AGENT ${r.agentIndex} ===
${r.result?.content || "No output"}
ARTIFACTS: ${r.artifacts.join(", ")}
`).join("\n")}

SHARED CONTEXT:
${JSON.stringify(this.sharedContext.getAll(), null, 2)}

Produce a unified solution that combines the best from each agent.`;

    try {
      const merged = await spawnSubagent<AgentLoopResult>(
        "synthesizer",
        mergePrompt,
        llm,
        { temperature: 0.2, maxTokens: 6000 } as SubagentConfig
      );
      return merged;
    } catch (err) {
      this.log("Merge failed, returning first result:", err);
      return successful[0].result;
    }
  }

  /**
   * Group steps by dependency level
   */
  private groupStepsByDependency(steps: PlannerOutput["steps"]): PlannerOutput["steps"][] {
    const levels: PlannerOutput["steps"][] = [];
    const processed = new Set<string>();

    while (processed.size < steps.length) {
      const level = steps.filter(step =>
        !processed.has(step.id) &&
        step.dependsOn.every(dep => processed.has(dep))
      );
      if (level.length === 0) {
        // Circular dependency - add remaining
        const remaining = steps.filter(s => !processed.has(s.id));
        levels.push(remaining);
        break;
      }
      for (const step of level) processed.add(step.id);
      levels.push(level);
    }

    return levels;
  }

  /**
   * Get merge strategy name
   */
  private getMergeStrategy(): string {
    switch (this.config.pattern) {
      case "map-reduce": return "sequential-merge";
      case "pipeline": return "stage-merge";
      case "scatter-gather": return "best-of-n";
      case "consensus": return "weighted-vote";
      case "adversarial": return "proposer-critic-synthesis";
      case "specialist": return "specialist-combination";
      default: return "unknown";
    }
  }

  private updateAgentProgress(
    agentIndex: number,
    status: AgentProgress["status"],
    currentStep: string,
    progress: number
  ): void {
    const agent = this.agentProgress.find(a => a.agentIndex === agentIndex);
    if (agent) {
      agent.status = status;
      agent.currentStep = currentStep;
      agent.progress = progress;
      this.emitProgress("running", `Agent ${agentIndex}: ${currentStep}`, 30 + (agentIndex / this.config.agentCount) * 50);
    }
  }

  private updateAgentProgressFromEvent(agentIndex: number, event: { type: string; message: string }): void {
    const agent = this.agentProgress.find(a => a.agentIndex === agentIndex);
    if (agent && agent.status === "running") {
      agent.currentStep = event.message;
      this.emitProgress("running", `Agent ${agentIndex}: ${event.message}`, 30 + (agentIndex / this.config.agentCount) * 50);
    }
  }

  private emitProgress(stage: OrchestrationProgressEvent["stage"], message: string, progress: number): void {
    const event: OrchestrationProgressEvent = {
      stage,
      message,
      progress,
      agentProgress: [...this.agentProgress],
      timestamp: Date.now(),
    };
    this.emit("progress", event);
    this.config.onProgress?.(event);
  }

  private generateId(): string {
    return `mao_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private log(...args: unknown[]): void {
    if (this.debug) console.log("[MultiAgentOrchestrator]", ...args);
  }

  /**
   * Get shared context
   */
  getSharedContext(): SharedContextStore {
    return this.sharedContext;
  }

  /**
   * Get agent progress
   */
  getAgentProgress(): AgentProgress[] {
    return [...this.agentProgress];
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.shadowManager) {
      await this.shadowManager.shutdown();
    }
    this.sharedContext.clear();
    this.emit("shutdown");
  }
}

/**
 * Factory function to create and run multi-agent orchestration
 */
export async function runMultiAgent(config: MultiAgentConfig): Promise<MultiAgentResult> {
  const orchestrator = new MultiAgentOrchestrator(config);
  await orchestrator.init();
  try {
    return await orchestrator.run();
  } finally {
    await orchestrator.shutdown();
  }
}

/**
 * Quick multi-agent execution for simple tasks
 */
export async function quickMultiAgent(
  task: string,
  agentCount: number,
  baseSnapshot: Record<string, string>,
  baseCommit: string,
  context: ToolExecutionContext,
  pattern: OrchestrationPattern = "map-reduce",
  llm?: LLMAdapter
): Promise<MultiAgentResult> {
  return runMultiAgent({
    pattern,
    task,
    agentCount,
    baseSnapshot,
    baseCommit,
    context,
    llm,
    debug: true,
  });
}

export default MultiAgentOrchestrator;