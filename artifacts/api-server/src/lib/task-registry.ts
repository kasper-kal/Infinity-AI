/**
 * Phase 35: Dynamic Island / Live Task Display — Task Registry
 *
 * Central registry of all active tasks across the system.
 * Provides in-memory storage with SSE broadcast and database persistence.
 */

import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { tasks, taskEvents } from "@workspace/db/src/schema/tasks";
import { eq, and, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

/**
 * Task types supported by the system
 */
export type TaskType =
  | "build"
  | "research"
  | "write"
  | "automation"
  | "agent-loop"
  | "deploy"
  | "chat"
  | "migration"
  | "sync";

/**
 * Task status values
 */
export type TaskStatus = "pending" | "running" | "complete" | "error" | "paused";

/**
 * Task priority levels
 */
export type TaskPriority = "low" | "normal" | "high" | "critical";

/**
 * Task metadata - flexible JSON for subsystem-specific data
 */
export interface TaskMetadata {
  [key: string]: unknown;
  // Common fields by task type:
  // build: { projectId, buildId, phase, framework, filesGenerated }
  // research: { query, sourcesFound, reportId, depth }
  // write: { bookId, chapterId, wordCount, targetWords }
  // automation: { automationId, runId, triggerType }
  // agent-loop: { agentId, iteration, goal, toolsUsed }
  // deploy: { projectId, deploymentId, provider, environment }
  // chat: { conversationId, messageId, model, tokens }
  // migration: { fromVersion, toVersion, tablesAffected }
  // sync: { source, target, recordsProcessed }
}

/**
 * Task representation
 */
export interface Task {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  progress: number; // 0-100
  status: TaskStatus;
  priority: TaskPriority;
  startedAt: Date;
  eta?: Date; // Estimated completion time
  metadata: TaskMetadata;
  parentId?: string; // For parent/child relationships
  children: string[]; // Child task IDs
  createdBy: "system" | "user" | "agent"; // Who/what created this task
  tags: string[]; // For filtering/grouping
  updatedAt: Date;
}

/**
 * Task event for SSE broadcasting
 */
export interface TaskEvent {
  type: "task:created" | "task:updated" | "task:completed" | "task:deleted" | "task:progress";
  task: Task;
  timestamp: Date;
}

/**
 * Task creation options
 */
export interface CreateTaskOptions {
  type: TaskType;
  title: string;
  description: string;
  priority?: TaskPriority;
  metadata?: TaskMetadata;
  parentId?: string;
  createdBy?: "system" | "user" | "agent";
  tags?: string[];
  eta?: Date;
}

/**
 * Task update options
 */
export interface UpdateTaskOptions {
  progress?: number;
  status?: TaskStatus;
  description?: string;
  eta?: Date;
  metadata?: Partial<TaskMetadata>;
  tags?: string[];
}

/**
 * Task filter options
 */
export interface TaskFilter {
  type?: TaskType;
  status?: TaskStatus;
  parentId?: string;
  tags?: string[];
  createdBy?: "system" | "user" | "agent";
  limit?: number;
  offset?: number;
}

/**
 * Task Registry — Central registry for all active tasks
 * Singleton pattern for global access
 */
export class TaskRegistry extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private sseClients: Map<string, NodeJS.WritableStream> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly COMPLETED_TASK_TTL_MS = 60 * 60 * 1000; // 1 hour
  private isInitialized = false;

  private constructor() {
    super();
    this.setMaxListeners(100); // Allow many listeners
  }

  private static instance: TaskRegistry;

  static getInstance(): TaskRegistry {
    if (!TaskRegistry.instance) {
      TaskRegistry.instance = new TaskRegistry();
    }
    return TaskRegistry.instance;
  }

  /**
   * Initialize the registry - load persisted tasks from database
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Load active tasks from database
      const persistedTasks = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.status, "running"),
            sql`${tasks.updatedAt} > ${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`
          )
        )
        .orderBy(desc(tasks.updatedAt))
        .limit(500);

      for (const pt of persistedTasks) {
        const task: Task = {
          id: pt.id,
          type: pt.type as TaskType,
          title: pt.title,
          description: pt.description,
          progress: pt.progress,
          status: pt.status as TaskStatus,
          priority: pt.priority as TaskPriority,
          startedAt: new Date(pt.startedAt),
          eta: pt.eta ? new Date(pt.eta) : undefined,
          metadata: (pt.metadata as TaskMetadata) || {},
          parentId: pt.parentId || undefined,
          children: (pt.children as string[]) || [],
          createdBy: pt.createdBy as "system" | "user" | "agent",
          tags: (pt.tags as string[]) || [],
          updatedAt: new Date(pt.updatedAt),
        };
        this.tasks.set(task.id, task);
      }

      // Start cleanup interval
      this.cleanupInterval = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL_MS);

      this.isInitialized = true;
      console.log(`[TaskRegistry] Initialized with ${this.tasks.size} persisted tasks`);
    } catch (error) {
      console.error("[TaskRegistry] Failed to initialize:", error);
      // Continue with empty registry
      this.isInitialized = true;
    }
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Persist all active tasks before shutdown
    await this.persistAllTasks();

    // Close all SSE connections
    for (const [clientId, stream] of this.sseClients) {
      try {
        stream.end();
      } catch {
        // Ignore errors on close
      }
    }
    this.sseClients.clear();

    this.tasks.clear();
    this.isInitialized = false;
  }

  /**
   * Create a new task
   */
  async createTask(options: CreateTaskOptions): Promise<Task> {
    const now = new Date();
    const task: Task = {
      id: uuidv4(),
      type: options.type,
      title: options.title,
      description: options.description,
      progress: 0,
      status: "pending",
      priority: options.priority || "normal",
      startedAt: now,
      eta: options.eta,
      metadata: options.metadata || {},
      parentId: options.parentId,
      children: [],
      createdBy: options.createdBy || "system",
      tags: options.tags || [],
      updatedAt: now,
    };

    // Add to parent's children if applicable
    if (options.parentId) {
      const parent = this.tasks.get(options.parentId);
      if (parent) {
        parent.children.push(task.id);
        parent.updatedAt = now;
        await this.persistTask(parent);
      }
    }

    this.tasks.set(task.id, task);
    await this.persistTask(task);
    this.broadcastEvent({ type: "task:created", task, timestamp: now });

    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /**
   * Update a task
   */
  async updateTask(id: string, options: UpdateTaskOptions): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    const now = new Date();
    const previousStatus = task.status;

    if (options.progress !== undefined) task.progress = Math.max(0, Math.min(100, options.progress));
    if (options.status !== undefined) task.status = options.status;
    if (options.description !== undefined) task.description = options.description;
    if (options.eta !== undefined) task.eta = options.eta;
    if (options.metadata !== undefined) task.metadata = { ...task.metadata, ...options.metadata };
    if (options.tags !== undefined) task.tags = options.tags;
    task.updatedAt = now;

    // Auto-complete if progress reaches 100
    if (task.progress >= 100 && task.status === "running") {
      task.status = "complete";
    }

    // Auto-set status to running if progress > 0 and was pending
    if (task.progress > 0 && task.status === "pending") {
      task.status = "running";
    }

    await this.persistTask(task);

    // Broadcast update event
    this.broadcastEvent({ type: "task:updated", task, timestamp: now });

    // Broadcast completion event if status changed to complete/error
    if (previousStatus !== task.status && (task.status === "complete" || task.status === "error")) {
      this.broadcastEvent({ type: "task:completed", task, timestamp: now });
    }

    // Broadcast progress event for granular updates
    if (options.progress !== undefined) {
      this.broadcastEvent({ type: "task:progress", task, timestamp: now });
    }

    return task;
  }

  /**
   * Delete a task
   */
  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;

    // Remove from parent's children
    if (task.parentId) {
      const parent = this.tasks.get(task.parentId);
      if (parent) {
        parent.children = parent.children.filter((c) => c !== id);
        parent.updatedAt = new Date();
        await this.persistTask(parent);
      }
    }

    // Delete children recursively
    for (const childId of task.children) {
      await this.deleteTask(childId);
    }

    this.tasks.delete(id);
    await this.deletePersistedTask(id);
    this.broadcastEvent({ type: "task:deleted", task, timestamp: new Date() });

    return true;
  }

  /**
   * Get tasks with optional filtering
   */
  getTasks(filter: TaskFilter = {}): Task[] {
    let result = Array.from(this.tasks.values());

    if (filter.type) {
      result = result.filter((t) => t.type === filter.type);
    }
    if (filter.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter.parentId) {
      result = result.filter((t) => t.parentId === filter.parentId);
    }
    if (filter.tags && filter.tags.length > 0) {
      result = result.filter((t) => filter.tags!.some((tag) => t.tags.includes(tag)));
    }
    if (filter.createdBy) {
      result = result.filter((t) => t.createdBy === filter.createdBy);
    }

    // Sort by priority (critical first), then by startedAt
    result.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.startedAt.getTime() - b.startedAt.getTime();
    });

    if (filter.limit) {
      result = result.slice(filter.offset || 0, (filter.offset || 0) + filter.limit);
    }

    return result;
  }

  /**
   * Get active tasks (running or pending)
   */
  getActiveTasks(): Task[] {
    return this.getTasks({ status: "running" }).concat(this.getTasks({ status: "pending" }));
  }

  /**
   * Get task count by status
   */
  getTaskCounts(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      pending: 0,
      running: 0,
      complete: 0,
      error: 0,
      paused: 0,
    };
    for (const task of this.tasks.values()) {
      counts[task.status]++;
    }
    return counts;
  }

  /**
   * Get primary task (highest priority active task)
   */
  getPrimaryTask(): Task | undefined {
    const activeTasks = this.getActiveTasks();
    if (activeTasks.length === 0) return undefined;

    // Sort by priority, then by start time
    activeTasks.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.startedAt.getTime() - b.startedAt.getTime();
    });

    return activeTasks[0];
  }

  /**
   * Register an SSE client for real-time updates
   */
  registerSSEClient(clientId: string, stream: NodeJS.WritableStream): void {
    this.sseClients.set(clientId, stream);

    // Send current state on connect
    const currentTasks = this.getTasks({ status: "running" }).concat(this.getTasks({ status: "pending" }));
    for (const task of currentTasks) {
      this.sendSSEEvent(clientId, { type: "task:created", task, timestamp: new Date() });
    }

    // Clean up on close
    stream.on("close", () => {
      this.sseClients.delete(clientId);
    });
  }

  /**
   * Broadcast event to all SSE clients
   */
  private broadcastEvent(event: TaskEvent): void {
    for (const [clientId, stream] of this.sseClients) {
      this.sendSSEEvent(clientId, event);
    }
  }

  /**
   * Send SSE event to specific client
   */
  private sendSSEEvent(clientId: string, event: TaskEvent): void {
    const stream = this.sseClients.get(clientId);
    if (!stream) return;

    try {
      const data = JSON.stringify(event);
      stream.write(`data: ${data}\n\n`);
    } catch {
      // Client disconnected, remove it
      this.sseClients.delete(clientId);
    }
  }

  /**
   * Persist a single task to database
   */
  private async persistTask(task: Task): Promise<void> {
    try {
      await db
        .insert(tasks)
        .values({
          id: task.id,
          type: task.type,
          title: task.title,
          description: task.description,
          progress: task.progress,
          status: task.status,
          priority: task.priority,
          startedAt: task.startedAt.toISOString(),
          eta: task.eta?.toISOString(),
          metadata: task.metadata,
          parentId: task.parentId,
          children: task.children,
          createdBy: task.createdBy,
          tags: task.tags,
          updatedAt: task.updatedAt.toISOString(),
        })
        .onConflictDoUpdate({
          target: tasks.id,
          set: {
            progress: task.progress,
            status: task.status,
            description: task.description,
            eta: task.eta?.toISOString(),
            metadata: task.metadata,
            children: task.children,
            tags: task.tags,
            updatedAt: task.updatedAt.toISOString(),
          },
        });
    } catch (error) {
      console.error(`[TaskRegistry] Failed to persist task ${task.id}:`, error);
    }
  }

  /**
   * Persist all active tasks
   */
  private async persistAllTasks(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (task.status === "running" || task.status === "pending") {
        await this.persistTask(task);
      }
    }
  }

  /**
   * Delete persisted task from database
   */
  private async deletePersistedTask(id: string): Promise<void> {
    try {
      await db.delete(tasks).where(eq(tasks.id, id));
    } catch (error) {
      console.error(`[TaskRegistry] Failed to delete persisted task ${id}:`, error);
    }
  }

  /**
   * Cleanup completed/error tasks older than TTL
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, task] of this.tasks) {
      if ((task.status === "complete" || task.status === "error") &&
          now - task.updatedAt.getTime() > this.COMPLETED_TASK_TTL_MS) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      await this.deleteTask(id);
    }

    if (toDelete.length > 0) {
      console.log(`[TaskRegistry] Cleaned up ${toDelete.length} completed tasks`);
    }
  }

  /**
   * Create a child task
   */
  async createChildTask(parentId: string, options: Omit<CreateTaskOptions, "parentId">): Promise<Task | undefined> {
    const parent = this.tasks.get(parentId);
    if (!parent) return undefined;

    return this.createTask({ ...options, parentId });
  }

  /**
   * Get all descendant tasks (children, grandchildren, etc.)
   */
  getDescendants(parentId: string): Task[] {
    const descendants: Task[] = [];
    const parent = this.tasks.get(parentId);
    if (!parent) return descendants;

    const queue = [...parent.children];
    while (queue.length > 0) {
      const childId = queue.shift()!;
      const child = this.tasks.get(childId);
      if (child) {
        descendants.push(child);
        queue.push(...child.children);
      }
    }
    return descendants;
  }
}

/**
 * Convenience function to get the singleton instance
 */
export function getTaskRegistry(): TaskRegistry {
  return TaskRegistry.getInstance();
}

/**
 * Helper functions for common task operations
 */
export async function createBuildTask(
  projectId: string,
  buildId: string,
  phase: string,
  title: string,
  description: string
): Promise<Task> {
  return getTaskRegistry().createTask({
    type: "build",
    title,
    description,
    priority: "high",
    metadata: { projectId, buildId, phase },
    tags: ["build", projectId],
    createdBy: "system",
  });
}

export async function createResearchTask(
  query: string,
  reportId: string,
  depth: number
): Promise<Task> {
  return getTaskRegistry().createTask({
    type: "research",
    title: `Research: ${query.slice(0, 50)}${query.length > 50 ? "..." : ""}`,
    description: query,
    priority: "normal",
    metadata: { query, reportId, depth, sourcesFound: 0 },
    tags: ["research"],
    createdBy: "agent",
  });
}

export async function createAgentLoopTask(
  agentId: string,
  goal: string
): Promise<Task> {
  return getTaskRegistry().createTask({
    type: "agent-loop",
    title: `Agent: ${goal.slice(0, 50)}${goal.length > 50 ? "..." : ""}`,
    description: goal,
    priority: "high",
    metadata: { agentId, iteration: 0, goal, toolsUsed: [] },
    tags: ["agent", agentId],
    createdBy: "agent",
  });
}

export async function createAutomationTask(
  automationId: string,
  runId: string,
  triggerType: string
): Promise<Task> {
  return getTaskRegistry().createTask({
    type: "automation",
    title: `Automation: ${triggerType}`,
    description: `Running automation ${automationId}`,
    priority: "normal",
    metadata: { automationId, runId, triggerType },
    tags: ["automation", automationId],
    createdBy: "system",
  });
}

export async function createDeployTask(
  projectId: string,
  deploymentId: string,
  provider: string,
  environment: string
): Promise<Task> {
  return getTaskRegistry().createTask({
    type: "deploy",
    title: `Deploy to ${provider} (${environment})`,
    description: `Deploying project ${projectId}`,
    priority: "critical",
    metadata: { projectId, deploymentId, provider, environment },
    tags: ["deploy", projectId, provider],
    createdBy: "system",
  });
}

export async function createChatTask(
  conversationId: string,
  messageId: string,
  model: string
): Promise<Task> {
  return getTaskRegistry().createTask({
    type: "chat",
    title: "Generating response...",
    description: `Chat generation with ${model}`,
    priority: "normal",
    metadata: { conversationId, messageId, model, tokens: 0 },
    tags: ["chat", conversationId],
    createdBy: "agent",
  });
}

/**
 * Update task progress with automatic status transitions
 */
export async function updateTaskProgress(
  taskId: string,
  progress: number,
  description?: string
): Promise<Task | undefined> {
  const registry = getTaskRegistry();
  const task = registry.getTask(taskId);
  if (!task) return undefined;

  const updates: UpdateTaskOptions = { progress };
  if (description !== undefined) updates.description = description;

  // Auto-determine status based on progress
  if (progress === 0) updates.status = "pending";
  else if (progress < 100) updates.status = "running";
  else updates.status = "complete";

  return registry.updateTask(taskId, updates);
}

/**
 * Mark task as error
 */
export async function markTaskError(taskId: string, error: string): Promise<Task | undefined> {
  return getTaskRegistry().updateTask(taskId, {
    status: "error",
    description: error,
    progress: 0,
  });
}

/**
 * Pause a task
 */
export async function pauseTask(taskId: string): Promise<Task | undefined> {
  return getTaskRegistry().updateTask(taskId, { status: "paused" });
}

/**
 * Resume a paused task
 */
export async function resumeTask(taskId: string): Promise<Task | undefined> {
  return getTaskRegistry().updateTask(taskId, { status: "running" });
}