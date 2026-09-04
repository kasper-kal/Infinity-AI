/**
 * Phase 35: Dynamic Island / Live Task Display — Frontend Task Registry
 *
 * Frontend registry with IndexedDB cache, SSE listener, and React context provider.
 * Mirrors backend TaskRegistry API for seamless integration.
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { io, Socket } from "socket.io-client";

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
}

/**
 * Task representation (matches backend)
 */
export interface Task {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  progress: number; // 0-100
  status: TaskStatus;
  priority: TaskPriority;
  startedAt: string; // ISO string
  eta?: string; // ISO string
  metadata: TaskMetadata;
  parentId?: string;
  children: string[];
  createdBy: "system" | "user" | "agent";
  tags: string[];
  updatedAt: string; // ISO string
}

/**
 * Task event from SSE
 */
export interface TaskEvent {
  type: "task:created" | "task:updated" | "task:completed" | "task:deleted" | "task:progress" | "connected";
  task?: Task;
  timestamp: string;
  clientId?: string;
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
 * IndexedDB database name and store
 */
const DB_NAME = "InfinityTaskRegistry";
const STORE_NAME = "tasks";
const DB_VERSION = 1;

/**
 * Frontend Task Registry - manages local task state and SSE connection
 */
class FrontendTaskRegistry {
  private tasks: Map<string, Task> = new Map();
  private listeners: Set<() => void> = new Set();
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_DELAY_MS = 2000;
  private isInitialized = false;
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize the registry - load from IndexedDB and connect SSE
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Load from IndexedDB
    await this.loadFromIndexedDB();

    // Connect to SSE
    this.connectSSE();

    this.isInitialized = true;
    console.log("[FrontendTaskRegistry] Initialized with", this.tasks.size, "cached tasks");
  }

  /**
   * Connect to SSE stream for real-time updates
   */
  private connectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const url = `${this.baseUrl}/api/infinity/tasks/stream`;
    this.eventSource = new EventSource(url, { withCredentials: true });

    this.eventSource.onopen = () => {
      console.log("[FrontendTaskRegistry] SSE connected");
      this.reconnectAttempts = 0;
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data: TaskEvent = JSON.parse(event.data);
        this.handleTaskEvent(data);
      } catch (error) {
        // Ignore parse errors (heartbeats, etc.)
      }
    };

    this.eventSource.onerror = (error) => {
      console.warn("[FrontendTaskRegistry] SSE error, attempting reconnect...", error);
      this.eventSource?.close();
      this.scheduleReconnect();
    };
  }

  /**
   * Schedule SSE reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error("[FrontendTaskRegistry] Max reconnect attempts reached");
      return;
    }

    const delay = this.RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;

    setTimeout(() => {
      this.connectSSE();
    }, delay);
  }

  /**
   * Handle incoming task event from SSE
   */
  private handleTaskEvent(event: TaskEvent): void {
    if (event.type === "connected") return;

    const task = event.task;
    if (!task) return;

    const now = new Date().toISOString();

    switch (event.type) {
      case "task:created":
      case "task:updated":
      case "task:progress":
        this.tasks.set(task.id, { ...task, updatedAt: now });
        break;
      case "task:completed":
        this.tasks.set(task.id, { ...task, updatedAt: now });
        break;
      case "task:deleted":
        this.tasks.delete(task.id);
        break;
    }

    this.persistToIndexedDB();
    this.notifyListeners();
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Subscribe to task changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get all tasks with optional filtering
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
      const priorityOrder: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
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
   * Get task by ID
   */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get task counts by status
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

    activeTasks.sort((a, b) => {
      const priorityOrder: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    });

    return activeTasks[0];
  }

  /**
   * Get descendant tasks
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

  /**
   * Create a task (optimistic update + API call)
   */
  async createTask(taskData: Omit<Task, "id" | "progress" | "status" | "startedAt" | "updatedAt" | "children">): Promise<Task> {
    // Optimistic creation
    const now = new Date().toISOString();
    const optimisticTask: Task = {
      ...taskData,
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      progress: 0,
      status: "pending",
      startedAt: now,
      updatedAt: now,
      children: [],
    };

    this.tasks.set(optimisticTask.id, optimisticTask);
    this.persistToIndexedDB();
    this.notifyListeners();

    try {
      // Actual API call
      const response = await fetch(`${this.baseUrl}/api/infinity/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(taskData),
      });

      if (!response.ok) throw new Error("Failed to create task");

      const { data: serverTask } = await response.json();

      // Replace optimistic task with server task
      this.tasks.delete(optimisticTask.id);
      this.tasks.set(serverTask.id, serverTask);
      this.persistToIndexedDB();
      this.notifyListeners();

      return serverTask;
    } catch (error) {
      // Rollback optimistic update
      this.tasks.delete(optimisticTask.id);
      this.persistToIndexedDB();
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Update a task (optimistic update + API call)
   */
  async updateTask(id: string, updates: Partial<Pick<Task, "progress" | "status" | "description" | "eta" | "metadata" | "tags">>): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    // Optimistic update
    const updatedTask: Task = {
      ...task,
      ...updates,
      progress: updates.progress !== undefined ? Math.max(0, Math.min(100, updates.progress)) : task.progress,
      updatedAt: new Date().toISOString(),
    };

    // Auto-status transitions
    if (updates.progress !== undefined) {
      if (updatedTask.progress === 0) updatedTask.status = "pending";
      else if (updatedTask.progress < 100) updatedTask.status = "running";
      else updatedTask.status = "complete";
    }

    this.tasks.set(id, updatedTask);
    this.persistToIndexedDB();
    this.notifyListeners();

    try {
      // Actual API call
      const response = await fetch(`${this.baseUrl}/api/infinity/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error("Failed to update task");

      const { data: serverTask } = await response.json();
      this.tasks.set(serverTask.id, serverTask);
      this.persistToIndexedDB();
      this.notifyListeners();

      return serverTask;
    } catch (error) {
      // Rollback
      this.tasks.set(id, task);
      this.persistToIndexedDB();
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.delete(id);
    this.persistToIndexedDB();
    this.notifyListeners();

    try {
      const response = await fetch(`${this.baseUrl}/api/infinity/tasks/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) throw new Error("Failed to delete task");
      return true;
    } catch (error) {
      // Could rollback but SSE will eventually sync
      console.error("[FrontendTaskRegistry] Failed to delete task on server:", error);
      return false;
    }
  }

  /**
   * Pause a task
   */
  async pauseTask(id: string): Promise<Task | undefined> {
    return this.updateTask(id, { status: "paused" });
  }

  /**
   * Resume a paused task
   */
  async resumeTask(id: string): Promise<Task | undefined> {
    return this.updateTask(id, { status: "running" });
  }

  /**
   * Load tasks from IndexedDB
   */
  private async loadFromIndexedDB(): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
          const tasks = getAllRequest.result as Task[];
          const now = Date.now();
          const TTL = 24 * 60 * 60 * 1000; // 24 hours

          for (const task of tasks) {
            // Only restore recent tasks
            if (now - new Date(task.updatedAt).getTime() < TTL) {
              this.tasks.set(task.id, task);
            }
          }
          resolve();
        };

        getAllRequest.onerror = () => resolve();
      };

      request.onerror = () => resolve();
    });
  }

  /**
   * Persist tasks to IndexedDB
   */
  private async persistToIndexedDB(): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        // Clear old entries first
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => {
          // Add current tasks
          for (const task of this.tasks.values()) {
            store.put(task);
          }
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      };

      request.onerror = () => resolve();
    });
  }

  /**
   * Shutdown - close SSE connection
   */
  shutdown(): void {
    this.eventSource?.close();
    this.eventSource = null;
    this.listeners.clear();
  }
}

// Singleton instance
let frontendRegistryInstance: FrontendTaskRegistry | null = null;

export function getFrontendTaskRegistry(baseUrl?: string): FrontendTaskRegistry {
  if (!frontendRegistryInstance) {
    frontendRegistryInstance = new FrontendTaskRegistry(baseUrl);
  }
  return frontendRegistryInstance;
}

/**
 * React Context for Task Registry
 */
interface TaskRegistryContextValue {
  registry: FrontendTaskRegistry;
  tasks: Task[];
  activeTasks: Task[];
  primaryTask: Task | undefined;
  taskCounts: Record<TaskStatus, number>;
  isInitialized: boolean;
  createTask: (data: Omit<Task, "id" | "progress" | "status" | "startedAt" | "updatedAt" | "children">) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Pick<Task, "progress" | "status" | "description" | "eta" | "metadata" | "tags">>) => Promise<Task | undefined>;
  deleteTask: (id: string) => Promise<boolean>;
  pauseTask: (id: string) => Promise<Task | undefined>;
  resumeTask: (id: string) => Promise<Task | undefined>;
  getTask: (id: string) => Task | undefined;
  getTasks: (filter?: TaskFilter) => Task[];
  getDescendants: (parentId: string) => Task[];
}

const TaskRegistryContext = createContext<TaskRegistryContextValue | null>(null);

/**
 * Task Registry Provider - wraps app with task registry context
 */
interface TaskRegistryProviderProps {
  children: ReactNode;
  baseUrl?: string;
}

export function TaskRegistryProvider({ children, baseUrl = "" }: TaskRegistryProviderProps) {
  const [registry] = useState(() => getFrontendTaskRegistry(baseUrl));
  const [isInitialized, setIsInitialized] = useState(false);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    let mounted = true;

    registry.initialize().then(() => {
      if (mounted) setIsInitialized(true);
    });

    const unsubscribe = registry.subscribe(() => {
      if (mounted) forceUpdate((n) => n + 1);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [registry]);

  const value: TaskRegistryContextValue = {
    registry,
    tasks: registry.getTasks(),
    activeTasks: registry.getActiveTasks(),
    primaryTask: registry.getPrimaryTask(),
    taskCounts: registry.getTaskCounts(),
    isInitialized,
    createTask: registry.createTask.bind(registry),
    updateTask: registry.updateTask.bind(registry),
    deleteTask: registry.deleteTask.bind(registry),
    pauseTask: registry.pauseTask.bind(registry),
    resumeTask: registry.resumeTask.bind(registry),
    getTask: registry.getTask.bind(registry),
    getTasks: registry.getTasks.bind(registry),
    getDescendants: registry.getDescendants.bind(registry),
  };

  return <TaskRegistryContext.Provider value={value}>{children}</TaskRegistryContext.Provider>;
}

/**
 * Hook to access task registry
 */
export function useTaskRegistry(): TaskRegistryContextValue {
  const context = useContext(TaskRegistryContext);
  if (!context) {
    throw new Error("useTaskRegistry must be used within a TaskRegistryProvider");
  }
  return context;
}

/**
 * Hook for active tasks only
 */
export function useActiveTasks(): Task[] {
  const { activeTasks } = useTaskRegistry();
  return activeTasks;
}

/**
 * Hook for primary task
 */
export function usePrimaryTask(): Task | undefined {
  const { primaryTask } = useTaskRegistry();
  return primaryTask;
}

/**
 * Hook for task counts
 */
export function useTaskCounts(): Record<TaskStatus, number> {
  const { taskCounts } = useTaskRegistry();
  return taskCounts;
}

/**
 * Hook for filtered tasks
 */
export function useTasks(filter?: TaskFilter): Task[] {
  const { getTasks } = useTaskRegistry();
  return getTasks(filter);
}

/**
 * Hook for a specific task
 */
export function useTask(id: string | undefined): Task | undefined {
  const { getTask } = useTaskRegistry();
  if (!id) return undefined;
  return getTask(id);
}