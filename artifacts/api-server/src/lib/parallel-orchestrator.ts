/**
 * PARALLEL ORCHESTRATOR — Replit Agent 4 Style Multi-Agent Execution
 *
 * True parallel multi-agent execution: split single task into concurrent forks
 * (auth, database, UI, backend) each with own progress indicator and checkpoint system,
 * merge seamlessly when done. Not sequential — parallel from the start.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { LLMAdapter } from "./llm-adapter";
import { createBestAdapter } from "./adapter-factory";
import { orchestration, type PipelineStage, type PipelineResult } from "./orchestration-engine";
import {
  SUBAGENTS,
  type SubagentDefinition,
  type PlannerOutput,
  spawnSubagent,
  type CodeReviewerOutput,
} from "./subagents";
import { runUniversalAgent, UniversalAgent, type UniversalAgentConfig, type AgentToolEvent } from "./universal-agent";

/**
 * ===== CORE TYPES =====
 */

export interface Workstream {
  id: string;
  name: string;
  description: string;
  agentType: string; // subagent ID or "universal"
  prompt: string;
  dependencies: string[]; // workstream IDs that must complete first
  priority: number; // higher = more important
  estimatedTokens: number;
  assignedAgentId?: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  progress: number; // 0-100
  result?: unknown;
  error?: string;
  checkpointId?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ParallelTask {
  id: string;
  goal: string;
  workstreams: Workstream[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: "planning" | "running" | "completed" | "failed" | "cancelled";
  globalProgress: number;
  sharedContext: Record<string, unknown>; // cross-agent communication
  checkpoints: Checkpoint[];
  mergeResult?: MergeResult;
}

export interface Checkpoint {
  id: string;
  taskId: string;
  workstreamId: string;
  timestamp: Date;
  state: unknown; // serialized agent state
  description: string;
}

export interface MergeResult {
  success: boolean;
  mergedFiles: string[];
  conflicts: MergeConflict[];
  summary: string;
}

export interface MergeConflict {
  file: string;
  type: "code" | "design" | "config";
  baseContent: string;
  currentContent: string;
  incomingContent: string;
  resolution?: "base" | "current" | "incoming" | "manual";
  resolvedContent?: string;
}

export interface AgentProgressEvent {
  type: "progress" | "checkpoint" | "complete" | "error" | "log";
  taskId: string;
  workstreamId: string;
  agentId: string;
  timestamp: Date;
  data: {
    progress?: number;
    message?: string;
    checkpointId?: string;
    result?: unknown;
    error?: string;
    logLevel?: "debug" | "info" | "warn" | "error";
  };
}

/**
 * ===== SHARED CONTEXT STORE =====
 * Cross-agent communication for decisions affecting multiple agents
 */
export class SharedContextStore extends EventEmitter {
  private store = new Map<string, { value: unknown; version: number; updatedBy: string; updatedAt: Date }>();
  private subscribers = new Map<string, Set<(value: unknown, version: number) => void>>();

  set(key: string, value: unknown, agentId: string): void {
    const existing = this.store.get(key);
    const version = (existing?.version ?? 0) + 1;
    this.store.set(key, { value, version, updatedBy: agentId, updatedAt: new Date() });
    this.emit("change", { key, value, version, agentId });
    this.notifySubscribers(key, value, version);
  }

  get(key: string): unknown {
    return this.store.get(key)?.value;
  }

  getVersion(key: string): number {
    return this.store.get(key)?.version ?? 0;
  }

  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, { value }] of this.store) {
      result[key] = value;
    }
    return result;
  }

  subscribe(key: string, callback: (value: unknown, version: number) => void): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
    return () => this.subscribers.get(key)?.delete(callback);
  }

  private notifySubscribers(key: string, value: unknown, version: number): void {
    this.subscribers.get(key)?.forEach(cb => cb(value, version));
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * ===== AGENT POOL MANAGER =====
 * Manages concurrency limits and token budgets for parallel agent execution
 */
export interface PooledAgent {
  id: string;
  workstreamId: string;
  config: UniversalAgentConfig;
  status: "idle" | "running" | "completed" | "failed";
  tokenBudget: number;
  tokensUsed: number;
  progress: number;
  lastEvent?: AgentProgressEvent;
  assignedAgentId?: string;
}

export class AgentPoolManager extends EventEmitter {
  public maxConcurrency: number;
  private totalTokenBudget: number;
  private globalTokensUsed = 0;
  private activeAgents = new Map<string, PooledAgent>();

  constructor(maxConcurrency = 4, totalTokenBudget = 100000) {
    super();
    this.maxConcurrency = maxConcurrency;
    this.totalTokenBudget = totalTokenBudget;
  }

  async acquireAgent(workstream: Workstream, config: UniversalAgentConfig): Promise<PooledAgent> {
    // Wait for available slot
    while (this.activeAgents.size >= this.maxConcurrency || this.globalTokensUsed + (config.maxTokens ?? 30000) > this.totalTokenBudget) {
      await new Promise(resolve => setTimeout(resolve, 100));
      this.cleanupCompleted();
    }

    const agentId = `agent-${workstream.id}-${randomUUID().slice(0, 8)}`;

    const pooledAgent: PooledAgent = {
      id: agentId,
      workstreamId: workstream.id,
      config,
      status: "running",
      tokenBudget: config.maxTokens ?? 30000,
      tokensUsed: 0,
      progress: 0,
    };

    this.activeAgents.set(agentId, pooledAgent);
    this.globalTokensUsed += config.maxTokens ?? 30000;

    this.emit("agentSpawned", { agentId, workstreamId: workstream.id });
    return pooledAgent;
  }

  releaseAgent(agentId: string): void {
    const agent = this.activeAgents.get(agentId);
    if (agent) {
      this.globalTokensUsed -= agent.tokenBudget;
      this.activeAgents.delete(agentId);
      this.emit("agentReleased", { agentId, workstreamId: agent.workstreamId });
    }
  }

  private cleanupCompleted(): void {
    for (const [id, agent] of this.activeAgents) {
      if (agent.status === "completed" || agent.status === "failed") {
        this.releaseAgent(id);
      }
    }
  }

  getAgent(agentId: string): PooledAgent | undefined {
    return this.activeAgents.get(agentId);
  }

  getAllAgents(): PooledAgent[] {
    return Array.from(this.activeAgents.values());
  }

  getActiveCount(): number {
    return this.activeAgents.size;
  }

  getGlobalTokenUsage(): { used: number; budget: number } {
    return { used: this.globalTokensUsed, budget: this.totalTokenBudget };
  }
}

/**
 * ===== MERGE ENGINE =====
 * Git-style three-way merge for code, design system merge for UI
 */
export class MergeEngine {
  /**
   * Three-way merge for code files
   */
  static async mergeCode(
    base: string,
    current: string,
    incoming: string,
    filePath: string
  ): Promise<{ merged: string; conflicts: MergeConflict[] }> {
    const conflicts: MergeConflict[] = [];

    // Simple line-based three-way merge
    const baseLines = base.split("\n");
    const currentLines = current.split("\n");
    const incomingLines = incoming.split("\n");

    // Use a simple diff algorithm - in production would use a proper diff library
    const merged = this.threeWayMergeLines(baseLines, currentLines, incomingLines, conflicts, filePath);

    return { merged, conflicts };
  }

  private static threeWayMergeLines(
    base: string[],
    current: string[],
    incoming: string[],
    conflicts: MergeConflict[],
    filePath: string
  ): string {
    // Simplified: if current and incoming are same, use that
    // If different from base and each other, conflict
    const maxLen = Math.max(base.length, current.length, incoming.length);
    const result: string[] = [];

    for (let i = 0; i < maxLen; i++) {
      const b = base[i] ?? "";
      const c = current[i] ?? "";
      const inc = incoming[i] ?? "";

      if (c === inc) {
        result.push(c);
      } else if (c === b && inc !== b) {
        result.push(inc); // incoming changed, current didn't
      } else if (inc === b && c !== b) {
        result.push(c); // current changed, incoming didn't
      } else {
        // Conflict: both changed differently from base
        conflicts.push({
          file: filePath,
          type: "code",
          baseContent: b,
          currentContent: c,
          incomingContent: inc,
        });
        // Default to current for now
        result.push(`<<<<<<< CURRENT\n${c}\n=======\n${inc}\n>>>>>>> INCOMING`);
      }
    }

    return result.join("\n");
  }

  /**
   * Design system merge - merges design tokens, components
   */
  static mergeDesignSystem(
    base: Record<string, unknown>,
    current: Record<string, unknown>,
    incoming: Record<string, unknown>
  ): { merged: Record<string, unknown>; conflicts: MergeConflict[] } {
    const conflicts: MergeConflict[] = [];
    const merged = { ...base };

    // Deep merge design tokens
    const allKeys = new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(incoming)]);

    for (const key of allKeys) {
      const b = base[key];
      const c = current[key];
      const inc = incoming[key];

      if (c === inc) {
        merged[key] = c;
      } else if (this.deepEqual(c, b) && !this.deepEqual(inc, b)) {
        merged[key] = inc;
      } else if (this.deepEqual(inc, b) && !this.deepEqual(c, b)) {
        merged[key] = c;
      } else {
        conflicts.push({
          file: `design-system.${key}`,
          type: "design",
          baseContent: JSON.stringify(b),
          currentContent: JSON.stringify(c),
          incomingContent: JSON.stringify(inc),
        });
        // Default to current
        merged[key] = c;
      }
    }

    return { merged, conflicts };
  }

  private static deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

/**
 * ===== PARALLEL ORCHESTRATOR =====
 * Main entry point for parallel agent execution
 */
export class ParallelOrchestrator extends EventEmitter {
  private poolManager: AgentPoolManager;
  private sharedContext: SharedContextStore;
  private currentTask: ParallelTask | null = null;
  private progressSubscribers = new Map<string, Set<(event: AgentProgressEvent) => void>>();

  constructor(
    maxConcurrency = 4,
    totalTokenBudget = 100000
  ) {
    super();
    this.poolManager = new AgentPoolManager(maxConcurrency, totalTokenBudget);
    this.sharedContext = new SharedContextStore();

    // Forward pool events
    this.poolManager.on("progress", (event: AgentProgressEvent) => {
      if (this.currentTask) {
        event.taskId = this.currentTask.id;
        this.emit("progress", event);
        this.notifyProgressSubscribers(event);
      }
    });
  }

  /**
   * Plan phase: Decompose goal into parallel workstreams using planner subagent
   */
  async plan(goal: string): Promise<Workstream[]> {
    const llm = await createBestAdapter();
    const plannerOutput = await spawnSubagent<PlannerOutput>("planner", goal, llm);

    const workstreams: Workstream[] = plannerOutput.steps.map((step, index) => ({
      id: step.id || `ws-${index}`,
      name: step.description,
      description: step.description,
      agentType: this.mapToolHintToAgent(step.toolHint),
      prompt: step.description,
      dependencies: step.dependsOn,
      priority: step.risk === "critical" ? 100 : step.risk === "high" ? 75 : step.risk === "medium" ? 50 : 25,
      estimatedTokens: step.estimatedTokens || 5000,
      status: "pending",
      progress: 0,
    }));

    // Sort by dependencies (topological-ish) and priority
    return this.sortWorkstreams(workstreams);
  }

  private mapToolHintToAgent(toolHint?: string): string {
    const map: Record<string, string> = {
      "web": "researcher",
      "browser": "universal",
      "files": "fixer",
      "build": "universal",
      "data": "researcher",
      "memory": "universal",
      "research": "researcher",
      "integration": "universal",
    };
    return map[toolHint || ""] || "universal";
  }

  private sortWorkstreams(workstreams: Workstream[]): Workstream[] {
    // Simple topological sort by dependencies, then by priority
    const sorted: Workstream[] = [];
    const remaining = [...workstreams];

    while (remaining.length > 0) {
      const ready = remaining.filter(ws =>
        ws.dependencies.every(dep => sorted.some(s => s.id === dep))
      );
      if (ready.length === 0) {
        // Circular dependency or missing dep - just take highest priority
        ready.push(...remaining.sort((a, b) => b.priority - a.priority).slice(0, 1));
      }
      ready.sort((a, b) => b.priority - a.priority);
      const next = ready[0];
      sorted.push(next);
      remaining.splice(remaining.indexOf(next), 1);
    }

    return sorted;
  }

  /**
   * Execute parallel workstreams
   */
  async execute(
    goal: string,
    workstreams?: Workstream[],
    options?: {
      maxConcurrency?: number;
      tokenBudget?: number;
      onProgress?: (event: AgentProgressEvent) => void;
    }
  ): Promise<ParallelTask> {
    // Plan if workstreams not provided
    const streams = workstreams || await this.plan(goal);

    const task: ParallelTask = {
      id: `task-${randomUUID()}`,
      goal,
      workstreams: streams,
      createdAt: new Date(),
      startedAt: new Date(),
      status: "running",
      globalProgress: 0,
      sharedContext: {},
      checkpoints: [],
    };

    this.currentTask = task;

    // Subscribe to progress if callback provided
    if (options?.onProgress) {
      this.subscribeToProgress(task.id, options.onProgress);
    }

    try {
      // Execute workstreams in parallel respecting dependencies
      await this.runWorkstreams(task);

      task.status = "completed";
      task.completedAt = new Date();
      task.globalProgress = 100;

      // Merge results
      task.mergeResult = await this.mergeResults(task);

      this.emit("taskComplete", task);
      return task;
    } catch (error) {
      task.status = "failed";
      task.completedAt = new Date();
      this.emit("taskError", { task, error });
      throw error;
    } finally {
      this.currentTask = null;
    }
  }

  private async runWorkstreams(task: ParallelTask): Promise<void> {
    const completed = new Set<string>();
    const running = new Map<string, Promise<void>>();

    while (completed.size < task.workstreams.length) {
      // Find workstreams ready to run (deps met, not running, not completed)
      const ready = task.workstreams.filter(ws =>
        ws.status === "pending" &&
        ws.dependencies.every(dep => completed.has(dep))
      );

      // Start ready workstreams up to concurrency limit
      for (const ws of ready) {
        if (running.size >= this.poolManager.maxConcurrency) break;

        ws.status = "running";
        ws.startedAt = new Date();

        const promise = this.runWorkstream(task, ws).then(() => {
          completed.add(ws.id);
          ws.status = "completed";
          ws.completedAt = new Date();
          ws.progress = 100;
          running.delete(ws.id);
          this.updateGlobalProgress(task);
        }).catch(err => {
          ws.status = "failed";
          ws.error = err.message;
          running.delete(ws.id);
          this.updateGlobalProgress(task);
          throw err;
        });

        running.set(ws.id, promise);
      }

      // Wait for at least one to complete
      if (running.size > 0) {
        await Promise.race(running.values());
      } else if (ready.length === 0) {
        // No ready workstreams but not all completed - circular dependency or error
        const stuck = task.workstreams.filter(ws => ws.status === "pending" || ws.status === "running");
        if (stuck.length > 0) {
          throw new Error(`Deadlock: ${stuck.map(s => s.id).join(", ")} cannot proceed`);
        }
        break;
      }
    }

    // Wait for all running to complete
    await Promise.all(running.values());
  }

  private async runWorkstream(task: ParallelTask, workstream: Workstream): Promise<void> {
    const config: UniversalAgentConfig = {
      maxTokens: workstream.estimatedTokens,
      maxIterations: 15,
      temperature: 0.2,
      enableResilience: true,
      autoCheckpoint: true,
      taskId: `${task.id}-${workstream.id}`,
    };

    const llm = await createBestAdapter();
    const baseContext: any = {
      accountId: "system",
      projectId: task.id,
      metadata: { parallelTask: true }
    };

    try {
      // Build prompt with shared context
      const contextPrompt = this.buildWorkstreamPrompt(task, workstream);

      const result = await runUniversalAgent(llm, baseContext, contextPrompt, config);

      workstream.result = result;
      workstream.status = "completed";

      // Update shared context with results
      this.sharedContext.set(`workstream:${workstream.id}:result`, result, task.id);
    } finally {
      // Agent is stateless, no release needed
    }
  }

  private buildWorkstreamPrompt(task: ParallelTask, workstream: Workstream): string {
    const depResults = workstream.dependencies
      .map(depId => {
        const dep = task.workstreams.find(w => w.id === depId);
        return dep?.result ? `## ${dep.name} Result:\n${JSON.stringify(dep.result, null, 2)}` : null;
      })
      .filter(Boolean)
      .join("\n\n");

    const sharedContext = this.sharedContext.getAll();

    return `TASK: ${task.goal}

WORKSTREAM: ${workstream.name}
DESCRIPTION: ${workstream.description}

${depResults ? `DEPENDENCY RESULTS:\n${depResults}\n` : ""}

SHARED CONTEXT:
${JSON.stringify(sharedContext, null, 2)}

Execute this workstream. Produce a clear, structured result that other workstreams can depend on.
Output your final result as JSON with a "summary" field and any other relevant data.`;
  }

  private updateGlobalProgress(task: ParallelTask): void {
    const total = task.workstreams.length;
    const done = task.workstreams.filter(ws => ws.status === "completed").length;
    task.globalProgress = Math.round((done / total) * 100);
    this.emit("globalProgress", { taskId: task.id, progress: task.globalProgress });
  }

  private async mergeResults(task: ParallelTask): Promise<MergeResult> {
    // Collect all file changes from workstream results
    // In production, each workstream would return file diffs
    // For now, return a summary merge result

    const allResults = task.workstreams
      .filter(ws => ws.status === "completed" && ws.result)
      .map(ws => ws.result);

    // Use synthesizer subagent to merge
    const llm = await createBestAdapter();
    const synthesizerOutput = await spawnSubagent<any>(
      "synthesizer",
      `Merge these parallel workstream results into a coherent solution for: ${task.goal}\n\nResults:\n${allResults.map((r, i) => `Workstream ${i}: ${JSON.stringify(r)}`).join("\n\n")}`,
      llm
    );

    return {
      success: true,
      mergedFiles: [],
      conflicts: [],
      summary: synthesizerOutput.synthesis,
    };
  }

  /**
   * Create checkpoint for a workstream
   */
  async createCheckpoint(taskId: string, workstreamId: string, state: unknown, description: string): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: `checkpoint-${randomUUID()}`,
      taskId,
      workstreamId,
      timestamp: new Date(),
      state,
      description,
    };

    if (this.currentTask && this.currentTask.id === taskId) {
      this.currentTask.checkpoints.push(checkpoint);
    }

    this.emit("checkpoint", checkpoint);
    return checkpoint;
  }

  /**
   * Rollback to checkpoint
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.currentTask?.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return false;

    // In production, would restore agent state from checkpoint
    this.emit("rollback", { checkpoint });
    return true;
  }

  /**
   * Subscribe to progress events
   */
  subscribeToProgress(taskId: string, callback: (event: AgentProgressEvent) => void): () => void {
    if (!this.progressSubscribers.has(taskId)) {
      this.progressSubscribers.set(taskId, new Set());
    }
    this.progressSubscribers.get(taskId)!.add(callback);
    return () => this.progressSubscribers.get(taskId)?.delete(callback);
  }

  private notifyProgressSubscribers(event: AgentProgressEvent): void {
    this.progressSubscribers.get(event.taskId)?.forEach(cb => cb(event));
  }

  /**
   * Get shared context store for direct access
   */
  getSharedContext(): SharedContextStore {
    return this.sharedContext;
  }

  /**
   * Get pool manager for direct access
   */
  getPoolManager(): AgentPoolManager {
    return this.poolManager;
  }

  /**
   * Cancel current task
   */
  cancel(): void {
    if (this.currentTask) {
      this.currentTask.status = "cancelled";
      this.emit("taskCancelled", this.currentTask);
      this.currentTask = null;
    }
    // Release all agents
    for (const agent of this.poolManager.getAllAgents()) {
      this.poolManager.releaseAgent(agent.id);
    }
  }
}

/**
 * ===== CONVENIENCE FUNCTION =====
 * Quick parallel execution
 */
export async function runParallel(
  goal: string,
  options?: {
    maxConcurrency?: number;
    tokenBudget?: number;
    workstreams?: Workstream[];
    onProgress?: (event: AgentProgressEvent) => void;
  }
): Promise<ParallelTask> {
  const orchestrator = new ParallelOrchestrator(options?.maxConcurrency, options?.tokenBudget);
  return orchestrator.execute(goal, options?.workstreams, options);
}

export default ParallelOrchestrator;