/**
 * CLOUD AGENT RUNTIME — Persistent Long-Running Agents
 *
 * Features:
 * - Persistent task state (survives restarts)
 * - Scheduled triggers: cron, webhook, PR events
 * - Notifications: webhook, email, in-app
 * - Cost tracking + budgets
 * - Agent lifecycle management
 */

import { EventEmitter } from "events";
import { createBestAdapter } from "./adapter-factory";
import { runUniversalAgent, type UniversalAgentConfig, type AgentLoopResult } from "./universal-agent";
import type { ToolExecutionContext } from "./tool-types";
import { getWorktreeManager, VirtualWorktreeManager } from "./virtual-worktree";
import type { LLMAdapter } from "./llm-adapter";

/**
 * Task status
 */
export type TaskStatus =
  | "pending"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Trigger types
 */
export type TriggerType = "cron" | "webhook" | "pr_created" | "pr_updated" | "push" | "manual" | "schedule";

/**
 * Trigger configuration
 */
export interface TriggerConfig {
  id: string;
  type: TriggerType;
  enabled: boolean;
  config: {
    // Cron trigger
    cron?: string;
    timezone?: string;
    // Webhook trigger
    webhookUrl?: string;
    webhookSecret?: string;
    // PR triggers
    branches?: string[];
    // Schedule trigger (one-time)
    runAt?: number; // timestamp
    // Common
    payload?: Record<string, unknown>;
  };
  createdAt: number;
  lastTriggered?: number;
  nextRun?: number;
}

/**
 * Notification configuration
 */
export interface NotificationConfig {
  id: string;
  type: "webhook" | "email" | "in-app" | "slack" | "discord";
  enabled: boolean;
  config: {
    // Webhook
    url?: string;
    secret?: string;
    // Email
    to?: string[];
    from?: string;
    // Slack/Discord
    webhookUrl?: string;
    channel?: string;
    // In-app
    userIds?: string[];
    // Common
    events: ("started" | "completed" | "failed" | "paused" | "checkpoint" | "approval_required")[];
    template?: string;
  };
  createdAt: number;
}

/**
 * Cost tracking
 */
export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
  provider: string;
}

export interface TaskCost {
  taskId: string;
  projectId: string;
  breakdown: CostBreakdown[];
  totalCostUsd: number;
  budgetUsd?: number;
  budgetExceeded: boolean;
  updatedAt: number;
}

/**
 * Budget configuration
 */
export interface BudgetConfig {
  projectId: string;
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  perTaskLimitUsd?: number;
  alertThresholdPercent?: number; // Alert when % of budget used
  hardLimit: boolean; // Stop tasks when budget exceeded
}

/**
 * Persistent task state
 */
export interface CloudTask {
  id: string;
  projectId: string;
  projectRoot: string;
  name: string;
  description: string;
  goal: string;
  status: TaskStatus;
  priority: "low" | "normal" | "high" | "critical";

  // Agent config
  agentConfig: Partial<UniversalAgentConfig>;
  llmModel?: string;

  // Triggers
  triggers: TriggerConfig[];

  // Notifications
  notifications: NotificationConfig[];

  // Budget
  budget?: BudgetConfig;

  // State
  currentIteration: number;
  maxIterations: number;
  totalToolCalls: number;
  checkpoints: TaskCheckpoint[];
  currentCheckpointId?: string;

  // Results
  result?: AgentLoopResult;
  error?: string;

  // Cost tracking
  cost: TaskCost;

  // Timestamps
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  nextScheduledRun?: number;

  // Metadata
  metadata: Record<string, unknown>;
  tags: string[];
}

/**
 * Task checkpoint
 */
export interface TaskCheckpoint {
  id: string;
  taskId: string;
  label: string;
  iteration: number;
  toolCalls: number;
  state: {
    files: Record<string, string>;
    context: ToolExecutionContext;
    agentState: unknown;
  };
  createdAt: number;
  size: number; // bytes
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  result?: AgentLoopResult;
  error?: string;
  durationMs: number;
  cost: TaskCost;
  artifacts: string[]; // paths to artifacts
}

/**
 * Cloud Agent Runtime
 */
export class CloudAgentRuntime extends EventEmitter {
  private tasks: Map<string, CloudTask> = new Map();
  private runningTasks: Map<string, AbortController> = new Map();
  private schedulerInterval: NodeJS.Timeout | null = null;
  private worktreeManager: VirtualWorktreeManager;
  private budgets: Map<string, BudgetConfig> = new Map();
  private persistencePath: string;
  private debug: boolean;

  constructor(options?: {
    persistencePath?: string;
    worktreeManager?: VirtualWorktreeManager;
    debug?: boolean;
  }) {
    super();
    this.persistencePath = options?.persistencePath || ".infinity/cloud-tasks";
    this.worktreeManager = options?.worktreeManager || getWorktreeManager();
    this.debug = options?.debug || false;
  }

  /**
   * Initialize the runtime
   */
  async init(): Promise<void> {
    await this.worktreeManager.init();
    await this.loadTasks();
    this.startScheduler();
    this.log("CloudAgentRuntime initialized");
  }

  /**
   * Create a new cloud task
   */
  async createTask(task: Omit<CloudTask, "id" | "createdAt" | "updatedAt" | "cost" | "checkpoints" | "currentIteration" | "totalToolCalls" | "status">): Promise<CloudTask> {
    const now = Date.now();
    const newTask: CloudTask = {
      ...task,
      id: this.generateId(),
      status: "pending",
      currentIteration: 0,
      totalToolCalls: 0,
      checkpoints: [],
      cost: {
        taskId: "",
        projectId: task.projectId,
        breakdown: [],
        totalCostUsd: 0,
        budgetExceeded: false,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    newTask.cost.taskId = newTask.id;

    // Calculate next scheduled run
    this.updateNextRun(newTask);

    this.tasks.set(newTask.id, newTask);
    await this.persistTask(newTask);
    this.emit("task:created", newTask);
    this.log(`Created task ${newTask.id}: ${newTask.name}`);

    return newTask;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): CloudTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * List tasks with optional filters
   */
  listTasks(filters?: {
    projectId?: string;
    status?: TaskStatus;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): CloudTask[] {
    let tasks = Array.from(this.tasks.values());

    if (filters?.projectId) {
      tasks = tasks.filter(t => t.projectId === filters.projectId);
    }
    if (filters?.status) {
      tasks = tasks.filter(t => t.status === filters.status);
    }
    if (filters?.tags?.length) {
      tasks = tasks.filter(t => filters.tags!.some(tag => t.tags.includes(tag)));
    }

    tasks.sort((a, b) => b.updatedAt - a.updatedAt);

    if (filters?.offset) {
      tasks = tasks.slice(filters.offset);
    }
    if (filters?.limit) {
      tasks = tasks.slice(0, filters.limit);
    }

    return tasks;
  }

  /**
   * Update task
   */
  async updateTask(taskId: string, updates: Partial<CloudTask>): Promise<CloudTask | undefined> {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const updated = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, updated);
    await this.persistTask(updated);
    this.emit("task:updated", updated);
    return updated;
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Stop if running
    if (task.status === "running") {
      await this.stopTask(taskId);
    }

    this.tasks.delete(taskId);
    await this.removePersistedTask(taskId);
    this.emit("task:deleted", { taskId, projectId: task.projectId });
    return true;
  }

  /**
   * Run a task immediately (manual trigger)
   */
  async runTask(taskId: string): Promise<TaskExecutionResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "running") {
      throw new Error(`Task ${taskId} is already running`);
    }

    // Check budget
    if (task.budget && task.cost.budgetExceeded && task.budget.hardLimit) {
      throw new Error(`Budget exceeded for task ${taskId}`);
    }

    return this.executeTask(task);
  }

  /**
   * Stop a running task
   */
  async stopTask(taskId: string, reason = "user_stopped"): Promise<boolean> {
    const controller = this.runningTasks.get(taskId);
    if (!controller) return false;

    controller.abort(reason);
    this.runningTasks.delete(taskId);

    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "cancelled";
      task.error = reason;
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      await this.persistTask(task);
    }

    this.emit("task:stopped", { taskId, reason });
    return true;
  }

  /**
   * Pause a running task
   */
  async pauseTask(taskId: string): Promise<boolean> {
    const controller = this.runningTasks.get(taskId);
    if (!controller) return false;

    // Create checkpoint before pausing
    const task = this.tasks.get(taskId);
    if (task) {
      await this.createCheckpoint(taskId, "auto_pause");
      task.status = "paused";
      task.updatedAt = Date.now();
      await this.persistTask(task);
    }

    // Signal pause (agent will check abort signal)
    controller.abort("paused");
    this.runningTasks.delete(taskId);

    this.emit("task:paused", { taskId });
    return true;
  }

  /**
   * Resume a paused task
   */
  async resumeTask(taskId: string): Promise<TaskExecutionResult> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== "paused") throw new Error(`Task ${taskId} is not paused`);

    // Restore from latest checkpoint
    if (task.currentCheckpointId) {
      await this.restoreCheckpoint(taskId, task.currentCheckpointId);
    }

    return this.executeTask(task);
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(taskId: string, label: string): Promise<TaskCheckpoint | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const checkpoint: TaskCheckpoint = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      label,
      iteration: task.currentIteration,
      toolCalls: task.totalToolCalls,
      state: {
        files: {}, // Would be populated from worktree
        context: {} as ToolExecutionContext,
        agentState: {},
      },
      createdAt: Date.now(),
      size: 0,
    };

    task.checkpoints.push(checkpoint);
    task.currentCheckpointId = checkpoint.id;
    task.updatedAt = Date.now();
    await this.persistTask(task);

    this.emit("checkpoint:created", checkpoint);
    return checkpoint;
  }

  /**
   * Restore from checkpoint
   */
  async restoreCheckpoint(taskId: string, checkpointId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const checkpoint = task.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return false;

    // Restore worktree state
    // In production, would restore files from checkpoint.state.files
    task.currentIteration = checkpoint.iteration;
    task.totalToolCalls = checkpoint.toolCalls;
    task.currentCheckpointId = checkpointId;
    task.updatedAt = Date.now();
    await this.persistTask(task);

    this.emit("checkpoint:restored", { taskId, checkpointId });
    return true;
  }

  /**
   * Add trigger to task
   */
  async addTrigger(taskId: string, trigger: Omit<TriggerConfig, "id" | "createdAt">): Promise<TriggerConfig> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const newTrigger: TriggerConfig = {
      ...trigger,
      id: `trg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };

    task.triggers.push(newTrigger);
    this.updateNextRun(task);
    task.updatedAt = Date.now();
    await this.persistTask(task);

    return newTrigger;
  }

  /**
   * Remove trigger from task
   */
  async removeTrigger(taskId: string, triggerId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const index = task.triggers.findIndex(t => t.id === triggerId);
    if (index === -1) return false;

    task.triggers.splice(index, 1);
    this.updateNextRun(task);
    task.updatedAt = Date.now();
    await this.persistTask(task);
    return true;
  }

  /**
   * Add notification to task
   */
  async addNotification(taskId: string, notification: Omit<NotificationConfig, "id" | "createdAt">): Promise<NotificationConfig> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const newNotification: NotificationConfig = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };

    task.notifications.push(newNotification);
    task.updatedAt = Date.now();
    await this.persistTask(task);
    return newNotification;
  }

  /**
   * Set budget for project
   */
  async setBudget(budget: BudgetConfig): Promise<void> {
    this.budgets.set(budget.projectId, budget);
    await this.persistBudget(budget);
    this.emit("budget:updated", budget);
  }

  /**
   * Get budget for project
   */
  getBudget(projectId: string): BudgetConfig | undefined {
    return this.budgets.get(projectId);
  }

  /**
   * Get cost for task
   */
  getTaskCost(taskId: string): TaskCost | undefined {
    const task = this.tasks.get(taskId);
    return task?.cost;
  }

  /**
   * Get total cost for project
   */
  getProjectCost(projectId: string, since?: number): number {
    let total = 0;
    const now = Date.now();
    const cutoff = since || now - 30 * 24 * 60 * 60 * 1000; // Default 30 days

    for (const task of this.tasks.values()) {
      if (task.projectId === projectId && task.cost.updatedAt >= cutoff) {
        total += task.cost.totalCostUsd;
      }
    }
    return total;
  }

  /**
   * Get task statistics
   */
  getStats(projectId?: string): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    totalCost: number;
    avgDuration: number;
    successRate: number;
  } {
    let tasks = Array.from(this.tasks.values());
    if (projectId) {
      tasks = tasks.filter(t => t.projectId === projectId);
    }

    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      scheduled: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    let totalCost = 0;
    let completedCount = 0;
    let totalDuration = 0;

    for (const task of tasks) {
      byStatus[task.status]++;
      totalCost += task.cost.totalCostUsd;
      if (task.status === "completed" && task.startedAt && task.completedAt) {
        completedCount++;
        totalDuration += task.completedAt - task.startedAt;
      }
    }

    return {
      total: tasks.length,
      byStatus,
      totalCost,
      avgDuration: completedCount > 0 ? totalDuration / completedCount : 0,
      successRate: tasks.length > 0 ? completedCount / tasks.length : 0,
    };
  }

  /**
   * Shutdown runtime
   */
  async shutdown(): Promise<void> {
    this.log("Shutting down CloudAgentRuntime");

    // Stop scheduler
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    // Stop all running tasks
    for (const [taskId, controller] of this.runningTasks) {
      controller.abort("shutdown");
    }
    this.runningTasks.clear();

    // Persist all tasks
    for (const task of this.tasks.values()) {
      await this.persistTask(task);
    }

    this.emit("shutdown");
  }

  // ========================================================================
  // Private methods
  // ========================================================================

  private async executeTask(task: CloudTask): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.runningTasks.set(task.id, abortController);

    // Update task status
    task.status = "running";
    task.startedAt = startTime;
    task.updatedAt = startTime;
    await this.persistTask(task);

    this.emit("task:started", task);
    await this.sendNotifications(task, "started");

    try {
      // Create worktree for isolation
      const worktreeId = await this.worktreeManager.createWorktree(task.projectRoot);

      // Prepare agent context
      const context: ToolExecutionContext = {
        worktreeId,
        worktreeManager: this.worktreeManager,
        projectId: task.projectId,
        projectRoot: task.projectRoot,
        sharedContext: undefined,
        agentIndex: 0,
      };

      // Get LLM adapter
      const llm = await createBestAdapter();

      // Run agent with progress tracking
      const result = await runUniversalAgent(llm, context, task.goal, {
        ...task.agentConfig,
        maxIterations: task.maxIterations,
        maxToolCalls: task.agentConfig?.maxToolCalls ?? 100,
        enableOrchestration: true,
        onEvent: (event) => {
          // Update progress
          task.currentIteration++;
          task.totalToolCalls++;
          task.updatedAt = Date.now();

          // Check budget
          this.checkBudget(task);

          // Emit progress
          this.emit("task:progress", { taskId: task.id, event, iteration: task.currentIteration });
        },
      });

      // Calculate cost
      const cost = this.calculateCost(result, task.llmModel);
      task.cost.breakdown.push(...cost.breakdown);
      task.cost.totalCostUsd += cost.totalCostUsd;
      task.cost.updatedAt = Date.now();

      // Check budget
      this.checkBudget(task);

      // Success
      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      await this.persistTask(task);

      this.emit("task:completed", { task, result });
      await this.sendNotifications(task, "completed");

      return {
        taskId: task.id,
        success: true,
        result,
        durationMs: Date.now() - startTime,
        cost: task.cost,
        artifacts: [], // Would collect from worktree
      };
    } catch (error) {
      const err = error as Error;

      // Check if aborted
      if (err.name === "AbortError" || err.message === "paused") {
        // Task was paused/stopped, status already updated
        return {
          taskId: task.id,
          success: false,
          error: err.message,
          durationMs: Date.now() - startTime,
          cost: task.cost,
          artifacts: [],
        };
      }

      // Failed
      task.status = "failed";
      task.error = err.message;
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      await this.persistTask(task);

      this.emit("task:failed", { task, error: err.message });
      await this.sendNotifications(task, "failed");

      return {
        taskId: task.id,
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
        cost: task.cost,
        artifacts: [],
      };
    } finally {
      this.runningTasks.delete(task.id);

      // Cleanup worktree (or return to pool)
      // In production, would handle worktree cleanup here
    }
  }

  private checkBudget(task: CloudTask): void {
    if (!task.budget) return;

    const cost = task.cost.totalCostUsd;

    // Check per-task limit
    if (task.budget.perTaskLimitUsd && cost > task.budget.perTaskLimitUsd) {
      task.cost.budgetExceeded = true;
      this.emit("budget:exceeded", { taskId: task.id, type: "per_task", limit: task.budget.perTaskLimitUsd, cost });
      if (task.budget.hardLimit) {
        this.stopTask(task.id, "budget_exceeded");
      }
    }

    // Check daily/monthly would need project-level aggregation
    // Simplified for now
  }

  private calculateCost(result: AgentLoopResult, model?: string): { breakdown: CostBreakdown[]; totalCostUsd: number } {
    // Simplified cost calculation
    // In production, would use actual token counts from result
    const inputTokens = result.totalToolCalls * 1000; // estimate
    const outputTokens = result.totalToolCalls * 500; // estimate

    // Rough pricing (per 1M tokens)
    const pricing: Record<string, { input: number; output: number }> = {
      "claude-3.5-sonnet": { input: 3, output: 15 },
      "claude-3.5-haiku": { input: 0.25, output: 1.25 },
      "gpt-4o": { input: 5, output: 15 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
      "default": { input: 1, output: 3 },
    };

    const modelPricing = pricing[model || "default"] || pricing.default;
    const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

    const breakdown: CostBreakdown = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: inputCost + outputCost,
      model: model || "unknown",
      provider: model?.startsWith("claude") ? "anthropic" : "openai",
    };

    return {
      breakdown: [breakdown],
      totalCostUsd: inputCost + outputCost,
    };
  }

  private updateNextRun(task: CloudTask): void {
    let nextRun: number | undefined;

    for (const trigger of task.triggers) {
      if (!trigger.enabled) continue;

      if (trigger.type === "cron" && trigger.config.cron) {
        // Simple cron next run calculation (in production use cron library)
        const cronNext = this.calculateCronNextRun(trigger.config.cron, trigger.config.timezone);
        if (cronNext && (!nextRun || cronNext < nextRun)) {
          nextRun = cronNext;
        }
        trigger.nextRun = cronNext;
      } else if (trigger.type === "schedule" && trigger.config.runAt) {
        if (!nextRun || trigger.config.runAt < nextRun) {
          nextRun = trigger.config.runAt;
        }
        trigger.nextRun = trigger.config.runAt;
      }
    }

    task.nextScheduledRun = nextRun;
  }

  private calculateCronNextRun(cron: string, timezone?: string): number | undefined {
    // Simplified - in production use a proper cron library like croner
    // This is a placeholder that returns next minute for demo
    return Date.now() + 60_000;
  }

  private startScheduler(): void {
    this.schedulerInterval = setInterval(async () => {
      await this.checkScheduledTasks();
    }, 30_000); // Check every 30 seconds
  }

  private async checkScheduledTasks(): Promise<void> {
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (task.status !== "pending" && task.status !== "scheduled") continue;

      for (const trigger of task.triggers) {
        if (!trigger.enabled || !trigger.nextRun) continue;

        if (trigger.nextRun <= now) {
          // Time to run
          task.status = "scheduled";
          task.updatedAt = now;
          await this.persistTask(task);

          this.log(`Triggering task ${task.id} via ${trigger.type}`);
          this.executeTask(task).catch(err => {
            this.log(`Scheduled task ${task.id} failed: ${err}`);
          });

          // Update last triggered
          trigger.lastTriggered = now;
          this.updateNextRun(task);
          await this.persistTask(task);
        }
      }
    }
  }

  private async sendNotifications(task: CloudTask, event: NotificationConfig["config"]["events"][number]): Promise<void> {
    for (const notification of task.notifications) {
      if (!notification.enabled || !notification.config.events.includes(event)) continue;

      try {
        switch (notification.type) {
          case "webhook":
            await this.sendWebhook(notification, task, event);
            break;
          case "email":
            await this.sendEmail(notification, task, event);
            break;
          case "in-app":
            await this.sendInApp(notification, task, event);
            break;
          case "slack":
            await this.sendSlack(notification, task, event);
            break;
          case "discord":
            await this.sendDiscord(notification, task, event);
            break;
        }
      } catch (err) {
        this.log(`Notification failed: ${err}`);
      }
    }
  }

  private async sendWebhook(notification: NotificationConfig, task: CloudTask, event: string): Promise<void> {
    if (!notification.config.url) return;

    const payload = {
      event,
      task: {
        id: task.id,
        name: task.name,
        projectId: task.projectId,
        status: task.status,
        result: task.result?.finalResponse,
        error: task.error,
      },
      timestamp: Date.now(),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (notification.config.secret) {
      // Add HMAC signature
      // In production, implement proper HMAC
    }

    await fetch(notification.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }

  private async sendEmail(notification: NotificationConfig, task: CloudTask, event: string): Promise<void> {
    // Placeholder - would integrate with email service (SendGrid, etc.)
    this.log(`Email notification for task ${task.id}: ${event}`);
  }

  private async sendInApp(notification: NotificationConfig, task: CloudTask, event: string): Promise<void> {
    // Emit event for frontend to pick up
    this.emit("notification:in-app", {
      userIds: notification.config.userIds,
      taskId: task.id,
      event,
      message: this.formatNotificationMessage(task, event),
    });
  }

  private async sendSlack(notification: NotificationConfig, task: CloudTask, event: string): Promise<void> {
    if (!notification.config.webhookUrl) return;

    await fetch(notification.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: this.formatNotificationMessage(task, event),
        channel: notification.config.channel,
      }),
    });
  }

  private async sendDiscord(notification: NotificationConfig, task: CloudTask, event: string): Promise<void> {
    if (!notification.config.webhookUrl) return;

    await fetch(notification.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: this.formatNotificationMessage(task, event),
      }),
    });
  }

  private formatNotificationMessage(task: CloudTask, event: string): string {
    const statusEmoji: Record<string, string> = {
      started: "🚀",
      completed: "✅",
      failed: "❌",
      paused: "⏸️",
      checkpoint: "💾",
      approval_required: "⚠️",
    };
    return `${statusEmoji[event] || "📋"} Task **${task.name}** (${task.id.slice(0, 8)}) ${event}`;
  }

  private async loadTasks(): Promise<void> {
    // In production, load from database/filesystem
    // For now, start empty
    this.log("Loading tasks from persistence...");
  }

  private async persistTask(task: CloudTask): Promise<void> {
    // In production, persist to database
    // For now, keep in memory
  }

  private async removePersistedTask(taskId: string): Promise<void> {
    // In production, remove from database
  }

  private async persistBudget(budget: BudgetConfig): Promise<void> {
    // In production, persist to database
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private log(...args: unknown[]): void {
    if (this.debug) console.log("[CloudAgentRuntime]", ...args);
  }
}

/**
 * Factory function to create CloudAgentRuntime with defaults
 */
export async function createCloudAgentRuntime(options?: {
  persistencePath?: string;
  debug?: boolean;
}): Promise<CloudAgentRuntime> {
  const runtime = new CloudAgentRuntime(options);
  await runtime.init();
  return runtime;
}

export default CloudAgentRuntime;