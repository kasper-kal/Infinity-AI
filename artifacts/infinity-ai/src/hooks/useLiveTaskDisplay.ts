/**
 * Phase 35: Live Task Display — Hook
 *
 * Hook for managing the Live Task Display component state and interactions.
 * Provides easy access to task registry from any component.
 */

import { useCallback } from "react";
import { useTaskRegistry, useActiveTasks, usePrimaryTask, useTaskCounts } from "@/lib/task-registry";
import { Task, TaskType, TaskStatus, TaskPriority } from "@/lib/task-registry";

export interface UseLiveTaskDisplayReturn {
  // Registry access
  registry: ReturnType<typeof useTaskRegistry>["registry"];

  // Task queries
  activeTasks: Task[];
  primaryTask: Task | undefined;
  taskCounts: Record<TaskStatus, number>;
  getTask: (id: string) => Task | undefined;
  getTasks: (filter?: Parameters<typeof useTaskRegistry>[0]["getTasks"] extends (filter?: infer F) => any ? F : never) => Task[];
  getDescendants: (parentId: string) => Task[];

  // Task mutations
  createTask: (data: Omit<Task, "id" | "progress" | "status" | "startedAt" | "updatedAt" | "children">) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Pick<Task, "progress" | "status" | "description" | "eta" | "metadata" | "tags">>) => Promise<Task | undefined>;
  deleteTask: (id: string) => Promise<boolean>;
  pauseTask: (id: string) => Promise<Task | undefined>;
  resumeTask: (id: string) => Promise<Task | undefined>;

  // Convenience creators for common task types
  createBuildTask: (projectId: string, buildId: string, phase: string, title: string, description: string) => Promise<Task>;
  createResearchTask: (query: string, reportId: string, depth: number) => Promise<Task>;
  createAgentLoopTask: (agentId: string, goal: string) => Promise<Task>;
  createAutomationTask: (automationId: string, runId: string, triggerType: string) => Promise<Task>;
  createDeployTask: (projectId: string, deploymentId: string, provider: string, environment: string) => Promise<Task>;
  createChatTask: (conversationId: string, messageId: string, model: string) => Promise<Task>;

  // Progress helpers
  updateTaskProgress: (taskId: string, progress: number, description?: string) => Promise<Task | undefined>;
  markTaskError: (taskId: string, error: string) => Promise<Task | undefined>;
}

/**
 * Hook for accessing the Live Task Display functionality
 * Wraps the task registry with convenient helpers
 */
export function useLiveTaskDisplay(): UseLiveTaskDisplayReturn {
  const {
    registry,
    activeTasks,
    primaryTask,
    taskCounts,
    createTask,
    updateTask,
    deleteTask,
    pauseTask,
    resumeTask,
    getTask,
    getTasks,
    getDescendants,
  } = useTaskRegistry();

  // Convenience creators matching backend helpers
  const createBuildTask = useCallback(
    async (projectId: string, buildId: string, phase: string, title: string, description: string) => {
      return createTask({
        type: "build",
        title,
        description,
        priority: "high",
        metadata: { projectId, buildId, phase },
        tags: ["build", projectId],
        createdBy: "system",
      });
    },
    [createTask]
  );

  const createResearchTask = useCallback(
    async (query: string, reportId: string, depth: number) => {
      return createTask({
        type: "research",
        title: `Research: ${query.slice(0, 50)}${query.length > 50 ? "..." : ""}`,
        description: query,
        priority: "normal",
        metadata: { query, reportId, depth, sourcesFound: 0 },
        tags: ["research"],
        createdBy: "agent",
      });
    },
    [createTask]
  );

  const createAgentLoopTask = useCallback(
    async (agentId: string, goal: string) => {
      return createTask({
        type: "agent-loop",
        title: `Agent: ${goal.slice(0, 50)}${goal.length > 50 ? "..." : ""}`,
        description: goal,
        priority: "high",
        metadata: { agentId, iteration: 0, goal, toolsUsed: [] },
        tags: ["agent", agentId],
        createdBy: "agent",
      });
    },
    [createTask]
  );

  const createAutomationTask = useCallback(
    async (automationId: string, runId: string, triggerType: string) => {
      return createTask({
        type: "automation",
        title: `Automation: ${triggerType}`,
        description: `Running automation ${automationId}`,
        priority: "normal",
        metadata: { automationId, runId, triggerType },
        tags: ["automation", automationId],
        createdBy: "system",
      });
    },
    [createTask]
  );

  const createDeployTask = useCallback(
    async (projectId: string, deploymentId: string, provider: string, environment: string) => {
      return createTask({
        type: "deploy",
        title: `Deploy to ${provider} (${environment})`,
        description: `Deploying project ${projectId}`,
        priority: "critical",
        metadata: { projectId, deploymentId, provider, environment },
        tags: ["deploy", projectId, provider],
        createdBy: "system",
      });
    },
    [createTask]
  );

  const createChatTask = useCallback(
    async (conversationId: string, messageId: string, model: string) => {
      return createTask({
        type: "chat",
        title: "Generating response...",
        description: `Chat generation with ${model}`,
        priority: "normal",
        metadata: { conversationId, messageId, model, tokens: 0 },
        tags: ["chat", conversationId],
        createdBy: "agent",
      });
    },
    [createTask]
  );

  // Progress helpers
  const updateTaskProgress = useCallback(
    async (taskId: string, progress: number, description?: string) => {
      const updates: Partial<Pick<Task, "progress" | "status" | "description">> = { progress };
      if (description !== undefined) updates.description = description;

      // Auto-determine status based on progress
      if (progress === 0) updates.status = "pending";
      else if (progress < 100) updates.status = "running";
      else updates.status = "complete";

      return updateTask(taskId, updates);
    },
    [updateTask]
  );

  const markTaskError = useCallback(
    async (taskId: string, error: string) => {
      return updateTask(taskId, {
        status: "error",
        description: error,
        progress: 0,
      });
    },
    [updateTask]
  );

  return {
    registry,
    activeTasks,
    primaryTask,
    taskCounts,
    getTask,
    getTasks,
    getDescendants,
    createTask,
    updateTask,
    deleteTask,
    pauseTask,
    resumeTask,
    createBuildTask,
    createResearchTask,
    createAgentLoopTask,
    createAutomationTask,
    createDeployTask,
    createChatTask,
    updateTaskProgress,
    markTaskError,
  };
}

/**
 * Hook for components that want to register themselves as task providers
 * Returns a register function that creates tasks with the component's context
 */
export function useTaskProvider(componentName: string) {
  const { createTask, updateTaskProgress, markTaskError, createBuildTask, createResearchTask, createAgentLoopTask, createAutomationTask, createDeployTask, createChatTask } = useLiveTaskDisplay();

  return {
    componentName,
    // Generic task creation
    createTask,
    updateProgress: updateTaskProgress,
    markError: markTaskError,

    // Typed creators
    build: {
      start: createBuildTask,
      phase: (taskId: string, phase: string, progress: number, description?: string) =>
        updateTaskProgress(taskId, progress, `[${phase}] ${description || ""}`),
      complete: (taskId: string) => updateTaskProgress(taskId, 100, "Completed"),
      error: markTaskError,
    },
    research: {
      start: createResearchTask,
      progress: updateTaskProgress,
      complete: (taskId: string) => updateTaskProgress(taskId, 100, "Research complete"),
      error: markTaskError,
    },
    agent: {
      start: createAgentLoopTask,
      iteration: (taskId: string, iteration: number, toolsUsed: string[]) =>
        updateTask(taskId, { progress: Math.min(100, iteration * 10), metadata: { iteration, toolsUsed } }),
      complete: (taskId: string) => updateTaskProgress(taskId, 100, "Agent completed"),
      error: markTaskError,
    },
    automation: {
      start: createAutomationTask,
      progress: updateTaskProgress,
      complete: (taskId: string) => updateTaskProgress(taskId, 100, "Automation complete"),
      error: markTaskError,
    },
    deploy: {
      start: createDeployTask,
      progress: updateTaskProgress,
      complete: (taskId: string) => updateTaskProgress(taskId, 100, "Deployment complete"),
      error: markTaskError,
    },
    chat: {
      start: createChatTask,
      progress: updateTaskProgress,
      complete: (taskId: string) => updateTaskProgress(taskId, 100, "Response generated"),
      error: markTaskError,
    },
  };
}

export default useLiveTaskDisplay;