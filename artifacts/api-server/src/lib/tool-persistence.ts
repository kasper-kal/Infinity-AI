/**
 * Phase 24: Universal Tool Layer — Resilience & Persistence
 *
 * Provides persistent task state, resume after interruption, checkpointing,
 * and recovery mechanisms for the Universal Tool Registry.
 */

import { randomUUID } from "node:crypto";
import type { UniversalToolResult, ToolExecutionContext, ToolRisk } from "./tool-types";
import { saveToolExecutionState, loadToolExecutionState, type PersistentToolState, createRecoveryPlan, executeRecoveryPlan, type RecoveryPlan } from "./tool-resilience";

/**
 * Task checkpoint for persistence
 */
export interface TaskCheckpoint {
  id: string;
  taskId: string;
  conversationId: string;
  stepIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  result: UniversalToolResult;
  contextSnapshot: Partial<ToolExecutionContext>;
  timestamp: string;
  cumulativeLatencyMs: number;
}

/**
 * Full task state for persistence
 */
export interface PersistentTaskState {
  taskId: string;
  conversationId: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  checkpoints: TaskCheckpoint[];
  currentStepIndex: number;
  totalSteps: number;
  toolCallChain: ToolCallRecord[];
  pendingApprovals: PendingApproval[];
  metadata: TaskMetadata;
  error?: TaskError;
}

export type TaskStatus =
  | "initialized"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "recovering"
  | "cancelled";

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: UniversalToolResult;
  timestamp: string;
  attempt: number;
  stepIndex: number;
  checkpointId?: string;
}

export interface PendingApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  reason: string;
  requestedAt: string;
  expiresAt?: string;
  resolved: boolean;
  resolvedAt?: string;
  approved?: boolean;
}

export interface TaskMetadata {
  parentTaskId?: string;
  tags: string[];
  priority: "low" | "normal" | "high" | "critical";
  timeoutMs?: number;
  maxRetries?: number;
  retryCount: number;
  labels: Record<string, string>;
  customData: Record<string, unknown>;
}

export interface TaskError {
  code: string;
  message: string;
  toolName?: string;
  stepIndex?: number;
  recoverable: boolean;
  retryAfterMs?: number;
  details: Record<string, unknown>;
}

/**
 * Task state storage interface
 */
export interface TaskStateStore {
  save(state: PersistentTaskState): Promise<void>;
  load(taskId: string): Promise<PersistentTaskState | null>;
  delete(taskId: string): Promise<void>;
  list(filters?: TaskListFilters): Promise<PersistentTaskState[]>;
  updateStatus(taskId: string, status: TaskStatus): Promise<void>;
}

export interface TaskListFilters {
  conversationId?: string;
  userId?: string;
  projectId?: string;
  status?: TaskStatus[];
  since?: string;
  limit?: number;
  offset?: number;
}

/**
 * In-memory task state store (for development/testing)
 */
class InMemoryTaskStateStore implements TaskStateStore {
  private tasks = new Map<string, PersistentTaskState>();

  async save(state: PersistentTaskState): Promise<void> {
    this.tasks.set(state.taskId, { ...state, updatedAt: new Date().toISOString() });
  }

  async load(taskId: string): Promise<PersistentTaskState | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async delete(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
  }

  async list(filters: TaskListFilters = {}): Promise<PersistentTaskState[]> {
    let results = Array.from(this.tasks.values());

    if (filters.conversationId) {
      results = results.filter(t => t.conversationId === filters.conversationId);
    }
    if (filters.userId) {
      results = results.filter(t => t.userId === filters.userId);
    }
    if (filters.projectId) {
      results = results.filter(t => t.projectId === filters.projectId);
    }
    if (filters.status && filters.status.length > 0) {
      results = results.filter(t => filters.status!.includes(t.status));
    }
    if (filters.since) {
      const since = new Date(filters.since).getTime();
      results = results.filter(t => new Date(t.createdAt).getTime() >= since);
    }

    results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (filters.offset) {
      results = results.slice(filters.offset);
    }
    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date().toISOString();
      if (status === "completed" || status === "failed" || status === "cancelled") {
        task.completedAt = new Date().toISOString();
      }
    }
  }
}

/**
 * Database-backed task state store
 */
class DatabaseTaskStateStore implements TaskStateStore {
  async save(state: PersistentTaskState): Promise<void> {
    const { db } = await import("@workspace/db");
    const { taskStates } = await import("@workspace/db/schema");

    await db.insert(taskStates).values({
      taskId: state.taskId,
      conversationId: state.conversationId,
      userId: state.userId,
      projectId: state.projectId,
      workspaceId: state.workspaceId,
      status: state.status,
      state: JSON.stringify(state),
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.updatedAt),
      completedAt: state.completedAt ? new Date(state.completedAt) : null,
    }).onConflictDoUpdate({
      target: taskStates.taskId,
      set: {
        status: state.status,
        state: JSON.stringify(state),
        updatedAt: new Date(state.updatedAt),
        completedAt: state.completedAt ? new Date(state.completedAt) : null,
      },
    });
  }

  async load(taskId: string): Promise<PersistentTaskState | null> {
    const { db } = await import("@workspace/db");
    const { taskStates } = await import("@workspace/db/schema");
    const { eq } = await import("drizzle-orm");

    const [record] = await db.select().from(taskStates).where(eq(taskStates.taskId, taskId)).limit(1);
    if (!record) return null;

    try {
      return JSON.parse(record.state as string) as PersistentTaskState;
    } catch {
      return null;
    }
  }

  async delete(taskId: string): Promise<void> {
    const { db } = await import("@workspace/db");
    const { taskStates } = await import("@workspace/db/schema");
    const { eq } = await import("drizzle-orm");

    await db.delete(taskStates).where(eq(taskStates.taskId, taskId));
  }

  async list(filters: TaskListFilters = {}): Promise<PersistentTaskState[]> {
    const { db } = await import("@workspace/db");
    const { taskStates } = await import("@workspace/db/schema");
    const { eq, and, gte, desc, inArray, sql } = await import("drizzle-orm");

    const conditions = [];
    if (filters.conversationId) conditions.push(eq(taskStates.conversationId, filters.conversationId));
    if (filters.userId) conditions.push(eq(taskStates.userId, filters.userId));
    if (filters.projectId) conditions.push(eq(taskStates.projectId, filters.projectId));
    if (filters.status && filters.status.length > 0) conditions.push(inArray(taskStates.status, filters.status));
    if (filters.since) conditions.push(gte(taskStates.createdAt, new Date(filters.since)));

    const query = db.select().from(taskStates);
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }
    query.orderBy(desc(taskStates.updatedAt));
    if (filters.limit) query.limit(filters.limit);
    if (filters.offset) query.offset(filters.offset);

    const records = await query;
    return records.map(r => {
      try {
        return JSON.parse(r.state as string) as PersistentTaskState;
      } catch {
        return null;
      }
    }).filter((s): s is PersistentTaskState => s !== null);
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const { db } = await import("@workspace/db");
    const { taskStates } = await import("@workspace/db/schema");
    const { eq } = await import("drizzle-orm");

    await db.update(taskStates).set({ status, updatedAt: new Date() }).where(eq(taskStates.taskId, taskId));
  }
}

/**
 * Get the appropriate task state store
 */
function getTaskStateStore(): TaskStateStore {
  // Check if database is available
  const useDatabase = process.env.DATABASE_URL && process.env.NODE_ENV !== "test";
  return useDatabase ? new DatabaseTaskStateStore() : new InMemoryTaskStateStore();
}

/**
 * Task persistence manager
 */
export class TaskPersistenceManager {
  private store: TaskStateStore;
  private autoCheckpointInterval: number;
  private checkpointTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: { autoCheckpointIntervalMs?: number } = {}) {
    this.store = getTaskStateStore();
    this.autoCheckpointInterval = options.autoCheckpointIntervalMs ?? 30000; // 30 seconds
  }

  /**
   * Create a new persistent task
   */
  async createTask(params: {
    conversationId: string;
    userId: string;
    projectId: string;
    workspaceId: string;
    parentTaskId?: string;
    tags?: string[];
    priority?: TaskMetadata["priority"];
    timeoutMs?: number;
    maxRetries?: number;
    labels?: Record<string, string>;
    customData?: Record<string, unknown>;
  }): Promise<PersistentTaskState> {
    const taskId = randomUUID();
    const now = new Date().toISOString();

    const state: PersistentTaskState = {
      taskId,
      conversationId: params.conversationId,
      userId: params.userId,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      status: "initialized",
      createdAt: now,
      updatedAt: now,
      checkpoints: [],
      currentStepIndex: -1,
      totalSteps: 0,
      toolCallChain: [],
      pendingApprovals: [],
      metadata: {
        parentTaskId: params.parentTaskId,
        tags: params.tags ?? [],
        priority: params.priority ?? "normal",
        timeoutMs: params.timeoutMs,
        maxRetries: params.maxRetries ?? 3,
        retryCount: 0,
        labels: params.labels ?? {},
        customData: params.customData ?? {},
      },
    };

    await this.store.save(state);

    // Start auto-checkpoint timer
    this.startAutoCheckpoint(taskId);

    return state;
  }

  /**
   * Start auto-checkpoint timer for a task
   */
  private startAutoCheckpoint(taskId: string): void {
    if (this.checkpointTimers.has(taskId)) return;

    const timer = setInterval(async () => {
      const state = await this.store.load(taskId);
      if (!state || state.status !== "running") {
        this.stopAutoCheckpoint(taskId);
        return;
      }
      await this.checkpoint(taskId);
    }, this.autoCheckpointInterval);

    this.checkpointTimers.set(taskId, timer);
  }

  /**
   * Stop auto-checkpoint timer
   */
  private stopAutoCheckpoint(taskId: string): void {
    const timer = this.checkpointTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.checkpointTimers.delete(taskId);
    }
  }

  /**
   * Create a checkpoint for the current task state
   */
  async checkpoint(taskId: string, options: {
    toolName?: string;
    args?: Record<string, unknown>;
    result?: UniversalToolResult;
    context?: Partial<ToolExecutionContext>;
    stepIndex?: number;
  } = {}): Promise<TaskCheckpoint | null> {
    const state = await this.store.load(taskId);
    if (!state) return null;

    const checkpoint: TaskCheckpoint = {
      id: randomUUID(),
      taskId: state.taskId,
      conversationId: state.conversationId,
      stepIndex: options.stepIndex ?? state.currentStepIndex,
      toolName: options.toolName ?? "",
      args: options.args ?? {},
      result: options.result ?? { success: true, data: {} },
      contextSnapshot: options.context ?? {},
      timestamp: new Date().toISOString(),
      cumulativeLatencyMs: state.toolCallChain.reduce((sum, c) => sum + ((c.result.metadata?.latencyMs as number) ?? 0), 0),
    };

    state.checkpoints.push(checkpoint);
    state.updatedAt = new Date().toISOString();
    await this.store.save(state);

    return checkpoint;
  }

  /**
   * Record a tool call in the task
   */
  async recordToolCall(taskId: string, record: Omit<ToolCallRecord, "stepIndex"> & { stepIndex?: number }): Promise<void> {
    const state = await this.store.load(taskId);
    if (!state) throw new Error(`Task ${taskId} not found`);

    const stepIndex = record.stepIndex ?? state.toolCallChain.length;
    const fullRecord: ToolCallRecord = {
      ...record,
      stepIndex,
    };

    state.toolCallChain.push(fullRecord);
    state.currentStepIndex = stepIndex;
    state.totalSteps = Math.max(state.totalSteps, stepIndex + 1);
    state.updatedAt = new Date().toISOString();

    if (state.status === "initialized") {
      state.status = "running";
    }

    await this.store.save(state);
  }

  /**
   * Add a pending approval
   */
  async addPendingApproval(taskId: string, approval: Omit<PendingApproval, "id" | "requestedAt" | "resolved">): Promise<string> {
    const state = await this.store.load(taskId);
    if (!state) throw new Error(`Task ${taskId} not found`);

    const approvalId = randomUUID();
    const fullApproval: PendingApproval = {
      ...approval,
      id: approvalId,
      requestedAt: new Date().toISOString(),
      resolved: false,
    };

    state.pendingApprovals.push(fullApproval);
    state.status = "awaiting_approval";
    state.updatedAt = new Date().toISOString();

    await this.store.save(state);

    return approvalId;
  }

  /**
   * Resolve a pending approval
   */
  async resolveApproval(taskId: string, approvalId: string, approved: boolean): Promise<void> {
    const state = await this.store.load(taskId);
    if (!state) throw new Error(`Task ${taskId} not found`);

    const approval = state.pendingApprovals.find(a => a.id === approvalId);
    if (!approval) throw new Error(`Approval ${approvalId} not found`);

    approval.resolved = true;
    approval.approved = approved;
    approval.resolvedAt = new Date().toISOString();

    // Check if all approvals resolved
    const unresolved = state.pendingApprovals.filter(a => !a.resolved);
    if (unresolved.length === 0) {
      state.status = "running";
    }

    state.updatedAt = new Date().toISOString();
    await this.store.save(state);
  }

  /**
   * Update task status
   */
  async updateStatus(taskId: string, status: TaskStatus, error?: TaskError): Promise<void> {
    const state = await this.store.load(taskId);
    if (!state) throw new Error(`Task ${taskId} not found`);

    state.status = status;
    state.updatedAt = new Date().toISOString();

    if (status === "completed" || status === "failed" || status === "cancelled") {
      state.completedAt = new Date().toISOString();
      this.stopAutoCheckpoint(taskId);
    }

    if (error) {
      state.error = error;
    }

    await this.store.save(state);
  }

  /**
   * Mark task as failed with error
   */
  async failTask(taskId: string, error: TaskError): Promise<void> {
    await this.updateStatus(taskId, "failed", error);
  }

  /**
   * Get task state
   */
  async getTask(taskId: string): Promise<PersistentTaskState | null> {
    return this.store.load(taskId);
  }

  /**
   * List tasks with filters
   */
  async listTasks(filters?: TaskListFilters): Promise<PersistentTaskState[]> {
    return this.store.list(filters);
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<void> {
    this.stopAutoCheckpoint(taskId);
    await this.store.delete(taskId);
  }

  /**
   * Create recovery plan from task state
   */
  async createRecoveryPlan(taskId: string): Promise<RecoveryPlan | null> {
    const state = await this.store.load(taskId);
    if (!state) return null;

    return createRecoveryPlan(state);
  }

  /**
   * Execute recovery for a task
   */
  async recoverTask(
    taskId: string,
    context: ToolExecutionContext,
    executeFn: (toolName: string, args: Record<string, unknown>, context: ToolExecutionContext) => Promise<UniversalToolResult>
  ): Promise<{ success: boolean; results: UniversalToolResult[] }> {
    const state = await this.store.load(taskId);
    if (!state) throw new Error(`Task ${taskId} not found`);

    const plan = createRecoveryPlan(state);
    if (!plan.canResume) {
      return { success: false, results: [] };
    }

    await this.updateStatus(taskId, "recovering");
    const result = await executeRecoveryPlan(plan, context, executeFn);

    if (result.success) {
      await this.updateStatus(taskId, "completed");
    } else {
      await this.failTask(taskId, {
        code: "RECOVERY_FAILED",
        message: "Task recovery failed",
        recoverable: false,
        details: { failedStep: plan.failedStep },
      });
    }

    return result;
  }

  /**
   * Resume task from last checkpoint
   */
  async resumeTask(
    taskId: string,
    context: ToolExecutionContext,
    executeFn: (toolName: string, args: Record<string, unknown>, context: ToolExecutionContext) => Promise<UniversalToolResult>
  ): Promise<{ success: boolean; results: UniversalToolResult[] }> {
    const state = await this.store.load(taskId);
    if (!state) throw new Error(`Task ${taskId} not found`);

    if (state.status === "completed") {
      return { success: true, results: [] };
    }

    if (state.status !== "paused" && state.status !== "failed" && state.status !== "awaiting_approval") {
      throw new Error(`Cannot resume task in status: ${state.status}`);
    }

    // Check for pending approvals
    const pendingApprovals = state.pendingApprovals.filter(a => !a.resolved);
    if (pendingApprovals.length > 0) {
      // Resume waiting for approval
      await this.updateStatus(taskId, "awaiting_approval");
      return { success: true, results: [] };
    }

    // Find the last successful step
    const lastSuccessfulIndex = state.toolCallChain
      .map((c, i) => ({ index: i, success: c.result.success }))
      .filter(c => c.success)
      .pop()?.index ?? -1;

    const nextStepIndex = lastSuccessfulIndex + 1;
    const remainingSteps = state.toolCallChain.slice(nextStepIndex);

    await this.updateStatus(taskId, "running");
    this.startAutoCheckpoint(taskId);

    const results: UniversalToolResult[] = [];
    for (const step of remainingSteps) {
      try {
        const result = await executeFn(step.toolName, step.args, context);
        results.push(result);

        await this.recordToolCall(taskId, {
          toolName: step.toolName,
          args: step.args,
          result,
          timestamp: new Date().toISOString(),
          attempt: step.attempt + 1,
          stepIndex: step.stepIndex,
        });

        if (!result.success) {
          await this.failTask(taskId, {
            code: "STEP_FAILED",
            message: `Step ${step.stepIndex} (${step.toolName}) failed: ${result.error}`,
            toolName: step.toolName,
            stepIndex: step.stepIndex,
            recoverable: true,
            details: { error: result.error },
          });
          return { success: false, results };
        }
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        await this.failTask(taskId, {
          code: "STEP_ERROR",
          message: `Step ${step.stepIndex} (${step.toolName}) error: ${err}`,
          toolName: step.toolName,
          stepIndex: step.stepIndex,
          recoverable: true,
          details: { error: err },
        });
        return { success: false, results };
      }
    }

    await this.updateStatus(taskId, "completed");
    return { success: true, results };
  }

  /**
   * Pause a running task
   */
  async pauseTask(taskId: string): Promise<void> {
    const state = await this.store.load(taskId);
    if (!state) throw new Error(`Task ${taskId} not found`);

    if (state.status !== "running") {
      throw new Error(`Cannot pause task in status: ${state.status}`);
    }

    await this.updateStatus(taskId, "paused");
    this.stopAutoCheckpoint(taskId);
    await this.checkpoint(taskId);
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string, reason: string): Promise<void> {
    await this.updateStatus(taskId, "cancelled", {
      code: "CANCELLED",
      message: reason,
      recoverable: false,
      details: {},
    });
    this.stopAutoCheckpoint(taskId);
  }

  /**
   * Get task progress
   */
  async getTaskProgress(taskId: string): Promise<{
    taskId: string;
    status: TaskStatus;
    progressPercent: number;
    currentStep: number;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    pendingApprovals: number;
    estimatedTimeRemaining?: number;
  } | null> {
    const state = await this.store.load(taskId);
    if (!state) return null;

    const completedSteps = state.toolCallChain.filter(c => c.result.success).length;
    const failedSteps = state.toolCallChain.filter(c => !c.result.success).length;
    const pendingApprovals = state.pendingApprovals.filter(a => !a.resolved).length;

    const progressPercent = state.totalSteps > 0
      ? Math.round((completedSteps / state.totalSteps) * 100)
      : 0;

    // Estimate time remaining based on average step latency
    const completedRecords = state.toolCallChain.filter(c => c.result.success);
    const avgLatency = completedRecords.length > 0
      ? completedRecords.reduce((sum, c) => sum + ((c.result.metadata?.latencyMs as number) ?? 0), 0) / completedRecords.length
      : 0;
    const remainingSteps = state.totalSteps - completedSteps;
    const estimatedTimeRemaining = remainingSteps > 0 ? remainingSteps * avgLatency : undefined;

    return {
      taskId: state.taskId,
      status: state.status,
      progressPercent,
      currentStep: state.currentStepIndex,
      totalSteps: state.totalSteps,
      completedSteps,
      failedSteps,
      pendingApprovals,
      estimatedTimeRemaining,
    };
  }

  /**
   * Export task state for backup/migration
   */
  async exportTask(taskId: string): Promise<string | null> {
    const state = await this.store.load(taskId);
    if (!state) return null;

    return JSON.stringify(state, null, 2);
  }

  /**
   * Import task state from backup
   */
  async importTask(json: string): Promise<PersistentTaskState> {
    const state = JSON.parse(json) as PersistentTaskState;
    state.taskId = randomUUID(); // New task ID for import
    state.createdAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    state.completedAt = undefined;
    state.status = "initialized";

    await this.store.save(state);
    return state;
  }
}

/**
 * Global task persistence manager instance
 */
let globalTaskPersistenceManager: TaskPersistenceManager | null = null;

export function getTaskPersistenceManager(): TaskPersistenceManager {
  if (!globalTaskPersistenceManager) {
    globalTaskPersistenceManager = new TaskPersistenceManager();
  }
  return globalTaskPersistenceManager;
}

export function setTaskPersistenceManager(manager: TaskPersistenceManager): void {
  globalTaskPersistenceManager = manager;
}

/**
 * Convenience functions
 */
export async function createPersistentTask(params: Parameters<TaskPersistenceManager["createTask"]>[0]): Promise<PersistentTaskState> {
  return getTaskPersistenceManager().createTask(params);
}

export async function checkpointTask(taskId: string, options: Parameters<TaskPersistenceManager["checkpoint"]>[1]): Promise<TaskCheckpoint | null> {
  return getTaskPersistenceManager().checkpoint(taskId, options);
}

export async function recordToolCall(taskId: string, record: Parameters<TaskPersistenceManager["recordToolCall"]>[1]): Promise<void> {
  return getTaskPersistenceManager().recordToolCall(taskId, record);
}

export async function addPendingApproval(taskId: string, approval: Parameters<TaskPersistenceManager["addPendingApproval"]>[1]): Promise<string> {
  return getTaskPersistenceManager().addPendingApproval(taskId, approval);
}

export async function resolveApproval(taskId: string, approvalId: string, approved: boolean): Promise<void> {
  return getTaskPersistenceManager().resolveApproval(taskId, approvalId, approved);
}

export async function getTask(taskId: string): Promise<PersistentTaskState | null> {
  return getTaskPersistenceManager().getTask(taskId);
}

export async function listTasks(filters?: TaskListFilters): Promise<PersistentTaskState[]> {
  return getTaskPersistenceManager().listTasks(filters);
}

export async function deleteTask(taskId: string): Promise<void> {
  return getTaskPersistenceManager().deleteTask(taskId);
}

export async function recoverTask(
  taskId: string,
  context: ToolExecutionContext,
  executeFn: (toolName: string, args: Record<string, unknown>, context: ToolExecutionContext) => Promise<UniversalToolResult>
): Promise<{ success: boolean; results: UniversalToolResult[] }> {
  return getTaskPersistenceManager().recoverTask(taskId, context, executeFn);
}

export async function resumeTask(
  taskId: string,
  context: ToolExecutionContext,
  executeFn: (toolName: string, args: Record<string, unknown>, context: ToolExecutionContext) => Promise<UniversalToolResult>
): Promise<{ success: boolean; results: UniversalToolResult[] }> {
  return getTaskPersistenceManager().resumeTask(taskId, context, executeFn);
}

export async function pauseTask(taskId: string): Promise<void> {
  return getTaskPersistenceManager().pauseTask(taskId);
}

export async function cancelTask(taskId: string, reason: string): Promise<void> {
  return getTaskPersistenceManager().cancelTask(taskId, reason);
}

export async function getTaskProgress(taskId: string): Promise<Awaited<ReturnType<TaskPersistenceManager["getTaskProgress"]>>> {
  return getTaskPersistenceManager().getTaskProgress(taskId);
}