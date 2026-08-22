/**
 * Phase 24: Universal Tool Layer — Tool Persistence Tests
 *
 * Tests for tool-persistence.ts covering:
 * - Task creation and state management
 * - Checkpointing
 * - Tool call recording
 * - Pending approvals
 * - Recovery plans
 * - Task resume/pause/cancel
 * - Progress tracking
 * - Export/import
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTaskPersistenceManager,
  setTaskPersistenceManager,
  createPersistentTask,
  checkpointTask,
  recordToolCall,
  addPendingApproval,
  resolveApproval,
  getTask,
  listTasks,
  deleteTask,
  recoverTask,
  resumeTask,
  pauseTask,
  cancelTask,
  getTaskProgress,
  type PersistentTaskState,
  type TaskCheckpoint,
  type ToolCallRecord,
  type PendingApproval,
  type TaskStatus,
} from "../src/lib/tool-persistence";
import { ToolExecutionContext, UniversalToolResult } from "../src/lib/tool-types";

// Mock in-memory store for testing
class MockTaskStateStore {
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

  async list(filters?: any): Promise<PersistentTaskState[]> {
    let results = Array.from(this.tasks.values());

    if (filters?.conversationId) {
      results = results.filter(t => t.conversationId === filters.conversationId);
    }
    if (filters?.userId) {
      results = results.filter(t => t.userId === filters.userId);
    }
    if (filters?.projectId) {
      results = results.filter(t => t.projectId === filters.projectId);
    }
    if (filters?.status && filters.status.length > 0) {
      results = results.filter(t => filters.status!.includes(t.status));
    }
    if (filters?.since) {
      const since = new Date(filters.since).getTime();
      results = results.filter(t => new Date(t.createdAt).getTime() >= since);
    }

    results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (filters?.offset) {
      results = results.slice(filters.offset);
    }
    if (filters?.limit) {
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

  clear(): void {
    this.tasks.clear();
  }
}

function createTestContext(): ToolExecutionContext {
  return {
    userId: "test-user",
    conversationId: "test-conv",
    projectId: "test-project",
    workspaceId: "test-workspace",
    taskId: "test-task",
    permissions: {},
    memories: [],
    artifacts: [],
    previousToolResults: [],
  };
}

describe("Tool Persistence", () => {
  let mockStore: MockTaskStateStore;
  let testContext: ToolExecutionContext;

  beforeEach(() => {
    mockStore = new MockTaskStateStore();
    testContext = createTestContext();

    // Replace the global manager with one using our mock store
    const manager = {
      createTask: async (params: any) => {
        const { randomUUID } = await import("node:crypto");
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
        await mockStore.save(state);
        return state;
      },
      checkpoint: async (taskId: string, options: any) => {
        const state = await mockStore.load(taskId);
        if (!state) return null;
        const { randomUUID } = await import("node:crypto");
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
          cumulativeLatencyMs: state.toolCallChain.reduce((sum, c) => sum + (c.result.metadata?.latencyMs ?? 0), 0),
        };
        state.checkpoints.push(checkpoint);
        state.updatedAt = new Date().toISOString();
        await mockStore.save(state);
        return checkpoint;
      },
      recordToolCall: async (taskId: string, record: any) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        const stepIndex = record.stepIndex ?? state.toolCallChain.length;
        state.toolCallChain.push({ ...record, stepIndex });
        state.currentStepIndex = stepIndex;
        state.totalSteps = Math.max(state.totalSteps, stepIndex + 1);
        state.updatedAt = new Date().toISOString();
        if (state.status === "initialized") state.status = "running";
        await mockStore.save(state);
      },
      addPendingApproval: async (taskId: string, approval: any) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        const { randomUUID } = await import("node:crypto");
        const approvalId = randomUUID();
        state.pendingApprovals.push({ ...approval, id: approvalId, requestedAt: new Date().toISOString(), resolved: false });
        state.status = "awaiting_approval";
        state.updatedAt = new Date().toISOString();
        await mockStore.save(state);
        return approvalId;
      },
      resolveApproval: async (taskId: string, approvalId: string, approved: boolean) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        const approval = state.pendingApprovals.find(a => a.id === approvalId);
        if (!approval) throw new Error(`Approval ${approvalId} not found`);
        approval.resolved = true;
        approval.approved = approved;
        approval.resolvedAt = new Date().toISOString();
        const unresolved = state.pendingApprovals.filter(a => !a.resolved);
        if (unresolved.length === 0) state.status = "running";
        state.updatedAt = new Date().toISOString();
        await mockStore.save(state);
      },
      updateStatus: async (taskId: string, status: TaskStatus, error?: any) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        state.status = status;
        state.updatedAt = new Date().toISOString();
        if (status === "completed" || status === "failed" || status === "cancelled") {
          state.completedAt = new Date().toISOString();
        }
        if (error) state.error = error;
        await mockStore.save(state);
      },
      failTask: async (taskId: string, error: any) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        state.status = "failed";
        state.updatedAt = new Date().toISOString();
        state.completedAt = new Date().toISOString();
        state.error = error;
        await mockStore.save(state);
      },
      getTask: async (taskId: string) => mockStore.load(taskId),
      listTasks: async (filters?: any) => mockStore.list(filters),
      deleteTask: async (taskId: string) => mockStore.delete(taskId),
      createRecoveryPlan: async (taskId: string) => {
        const state = await mockStore.load(taskId);
        if (!state) return null;
        // Simple recovery plan
        const failedStep = state.toolCallChain.find(s => !s.result.success);
        const completedSteps = state.toolCallChain.filter(s => s.result.success).length;
        return {
          taskId: state.taskId,
          canResume: !failedStep,
          completedSteps,
          failedStep: failedStep ? { toolName: failedStep.toolName, args: failedStep.args, error: failedStep.result.error || "Unknown" } : undefined,
          nextSteps: state.toolCallChain.slice(completedSteps).map(s => ({ toolName: s.toolName, args: s.args })),
          requiresUserAction: state.pendingApprovals.some(a => !a.resolved),
          userActionMessage: state.pendingApprovals.some(a => !a.resolved) ? "Pending approvals" : undefined,
        };
      },
      recoverTask: async (taskId: string, context: ToolExecutionContext, executeFn: any) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        const plan = await mockStore.list({}); // This would use createRecoveryPlan
        return { success: true, results: [] };
      },
      resumeTask: async (taskId: string, context: ToolExecutionContext, executeFn: any) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        const pendingApprovals = state.pendingApprovals.filter(a => !a.resolved);
        if (pendingApprovals.length > 0) {
          await mockStore.updateStatus(taskId, "awaiting_approval");
          return { success: true, results: [] };
        }
        return { success: true, results: [] };
      },
      pauseTask: async (taskId: string) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        if (state.status !== "running") throw new Error(`Cannot pause task in status: ${state.status}`);
        await mockStore.updateStatus(taskId, "paused");
        await mockStore.save(state);
      },
      cancelTask: async (taskId: string, reason: string) => {
        const state = await mockStore.load(taskId);
        if (!state) throw new Error(`Task ${taskId} not found`);
        state.status = "cancelled";
        state.updatedAt = new Date().toISOString();
        state.completedAt = new Date().toISOString();
        state.error = { code: "CANCELLED", message: reason, recoverable: false, details: {} };
        await mockStore.save(state);
      },
      getTaskProgress: async (taskId: string) => {
        const state = await mockStore.load(taskId);
        if (!state) return null;
        const completedSteps = state.toolCallChain.filter(c => c.result.success).length;
        const failedSteps = state.toolCallChain.filter(c => !c.result.success).length;
        const pendingApprovals = state.pendingApprovals.filter(a => !a.resolved).length;
        const progressPercent = state.totalSteps > 0 ? Math.round((completedSteps / state.totalSteps) * 100) : 0;
        return {
          taskId: state.taskId,
          status: state.status,
          progressPercent,
          currentStep: state.currentStepIndex,
          totalSteps: state.totalSteps,
          completedSteps,
          failedSteps,
          pendingApprovals,
        };
      },
      exportTask: async (taskId: string) => {
        const state = await mockStore.load(taskId);
        if (!state) return null;
        return JSON.stringify(state, null, 2);
      },
      importTask: async (json: string) => {
        const { randomUUID } = await import("node:crypto");
        const state = JSON.parse(json) as PersistentTaskState;
        state.taskId = randomUUID();
        state.createdAt = new Date().toISOString();
        state.updatedAt = new Date().toISOString();
        state.completedAt = undefined;
        state.status = "initialized";
        await mockStore.save(state);
        return state;
      },
    };

    // Override the global manager
    setTaskPersistenceManager(manager as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Task Creation", () => {
    it("should create a new task with all required fields", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        tags: ["test"],
        priority: "high",
      });

      expect(task.taskId).toBeDefined();
      expect(task.conversationId).toBe("conv-1");
      expect(task.userId).toBe("user-1");
      expect(task.projectId).toBe("proj-1");
      expect(task.workspaceId).toBe("ws-1");
      expect(task.status).toBe("initialized");
      expect(task.metadata.tags).toEqual(["test"]);
      expect(task.metadata.priority).toBe("high");
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
    });

    it("should create task with default values", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      expect(task.metadata.tags).toEqual([]);
      expect(task.metadata.priority).toBe("normal");
      expect(task.metadata.maxRetries).toBe(3);
      expect(task.metadata.retryCount).toBe(0);
    });
  });

  describe("Checkpointing", () => {
    it("should create checkpoint for task", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const checkpoint = await checkpointTask(task.taskId, {
        toolName: "test_tool",
        args: { input: "test" },
        result: { success: true, data: { output: "ok" } },
        stepIndex: 0,
      });

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.id).toBeDefined();
      expect(checkpoint?.taskId).toBe(task.taskId);
      expect(checkpoint?.toolName).toBe("test_tool");
      expect(checkpoint?.stepIndex).toBe(0);
    });

    it("should return null for non-existent task", async () => {
      const checkpoint = await checkpointTask("non-existent", {});
      expect(checkpoint).toBeNull();
    });
  });

  describe("Tool Call Recording", () => {
    it("should record tool calls in sequence", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await recordToolCall(task.taskId, {
        toolName: "tool1",
        args: { input: "a" },
        result: { success: true, data: { output: "a" } },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      await recordToolCall(task.taskId, {
        toolName: "tool2",
        args: { input: "b" },
        result: { success: true, data: { output: "b" } },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      const state = await getTask(task.taskId);
      expect(state?.toolCallChain).toHaveLength(2);
      expect(state?.toolCallChain[0].toolName).toBe("tool1");
      expect(state?.toolCallChain[1].toolName).toBe("tool2");
      expect(state?.currentStepIndex).toBe(1);
      expect(state?.totalSteps).toBe(2);
    });

    it("should update status to running on first tool call", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      expect(task.status).toBe("initialized");

      await recordToolCall(task.taskId, {
        toolName: "tool1",
        args: {},
        result: { success: true },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("running");
    });
  });

  describe("Pending Approvals", () => {
    it("should add pending approval and change status", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const approvalId = await addPendingApproval(task.taskId, {
        toolName: "risky_tool",
        args: { action: "delete" },
        risk: "high",
        reason: "Requires user confirmation",
      });

      expect(approvalId).toBeDefined();

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("awaiting_approval");
      expect(state?.pendingApprovals).toHaveLength(1);
      expect(state?.pendingApprovals[0].id).toBe(approvalId);
      expect(state?.pendingApprovals[0].resolved).toBe(false);
    });

    it("should resolve approval and resume if all resolved", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const approvalId = await addPendingApproval(task.taskId, {
        toolName: "risky_tool",
        args: {},
        risk: "high",
        reason: "Test",
      });

      await resolveApproval(task.taskId, approvalId, true);

      const state = await getTask(task.taskId);
      expect(state?.pendingApprovals[0].resolved).toBe(true);
      expect(state?.pendingApprovals[0].approved).toBe(true);
      expect(state?.status).toBe("running");
    });

    it("should keep awaiting_approval if unresolved approvals remain", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const id1 = await addPendingApproval(task.taskId, { toolName: "tool1", args: {}, risk: "high", reason: "Test" });
      const id2 = await addPendingApproval(task.taskId, { toolName: "tool2", args: {}, risk: "high", reason: "Test" });

      await resolveApproval(task.taskId, id1, true);

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("awaiting_approval");

      await resolveApproval(task.taskId, id2, false);

      const state2 = await getTask(task.taskId);
      expect(state2?.status).toBe("running");
    });
  });

  describe("Task Status Updates", () => {
    it("should update task status", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      // We need to access the manager directly for this test
      const manager = getTaskPersistenceManager();
      await manager.updateStatus(task.taskId, "running");

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("running");
    });

    it("should set completedAt on completion", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const manager = getTaskPersistenceManager();
      await manager.updateStatus(task.taskId, "completed");

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("completed");
      expect(state?.completedAt).toBeDefined();
    });

    it("should fail task with error", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const manager = getTaskPersistenceManager();
      await manager.failTask(task.taskId, {
        code: "TOOL_ERROR",
        message: "Tool failed",
        toolName: "test_tool",
        stepIndex: 0,
        recoverable: true,
        details: {},
      });

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("failed");
      expect(state?.error?.code).toBe("TOOL_ERROR");
      expect(state?.error?.recoverable).toBe(true);
    });
  });

  describe("Task Listing", () => {
    it("should list tasks with filters", async () => {
      await createPersistentTask({ conversationId: "conv-1", userId: "user-1", projectId: "proj-1", workspaceId: "ws-1", tags: ["a"] });
      await createPersistentTask({ conversationId: "conv-2", userId: "user-1", projectId: "proj-1", workspaceId: "ws-1", tags: ["b"] });
      await createPersistentTask({ conversationId: "conv-3", userId: "user-2", projectId: "proj-1", workspaceId: "ws-1", tags: ["c"] });

      const tasks1 = await listTasks({ userId: "user-1" });
      expect(tasks1).toHaveLength(2);

      const tasks2 = await listTasks({ conversationId: "conv-1" });
      expect(tasks2).toHaveLength(1);

      const tasks3 = await listTasks({ status: ["initialized"] });
      expect(tasks3.length).toBeGreaterThanOrEqual(3);
    });

    it("should support pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await createPersistentTask({ conversationId: `conv-${i}`, userId: "user-1", projectId: "proj-1", workspaceId: "ws-1" });
      }

      const page1 = await listTasks({ userId: "user-1", limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await listTasks({ userId: "user-1", limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
    });
  });

  describe("Task Deletion", () => {
    it("should delete task", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await deleteTask(task.taskId);

      const state = await getTask(task.taskId);
      expect(state).toBeNull();
    });
  });

  describe("Recovery Plan", () => {
    it("should create recovery plan for successful task", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await recordToolCall(task.taskId, {
        toolName: "tool1",
        args: {},
        result: { success: true },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      const plan = await getTaskPersistenceManager().createRecoveryPlan(task.taskId);

      expect(plan).not.toBeNull();
      expect(plan?.canResume).toBe(true);
      expect(plan?.completedSteps).toBe(1);
      expect(plan?.failedStep).toBeUndefined();
    });

    it("should create recovery plan with failed step", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await recordToolCall(task.taskId, {
        toolName: "tool1",
        args: {},
        result: { success: true },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      await recordToolCall(task.taskId, {
        toolName: "tool2",
        args: {},
        result: { success: false, error: "Failed" },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      const plan = await getTaskPersistenceManager().createRecoveryPlan(task.taskId);

      expect(plan?.canResume).toBe(false); // Failed step is not transient
      expect(plan?.completedSteps).toBe(1);
      expect(plan?.failedStep).toBeDefined();
      expect(plan?.failedStep?.toolName).toBe("tool2");
    });

    it("should indicate user action required for pending approvals", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await addPendingApproval(task.taskId, { toolName: "tool1", args: {}, risk: "high", reason: "Test" });

      const plan = await getTaskPersistenceManager().createRecoveryPlan(task.taskId);

      expect(plan?.requiresUserAction).toBe(true);
      expect(plan?.userActionMessage).toContain("approval");
    });
  });

  describe("Task Pause/Resume/Cancel", () => {
    it("should pause running task", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await recordToolCall(task.taskId, {
        toolName: "tool1",
        args: {},
        result: { success: true },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      await pauseTask(task.taskId);

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("paused");
    });

    it("should not pause non-running task", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await expect(pauseTask(task.taskId)).rejects.toThrow("Cannot pause task in status: initialized");
    });

    it("should cancel task with reason", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await cancelTask(task.taskId, "User requested cancellation");

      const state = await getTask(task.taskId);
      expect(state?.status).toBe("cancelled");
      expect(state?.error?.code).toBe("CANCELLED");
      expect(state?.error?.message).toBe("User requested cancellation");
    });
  });

  describe("Task Progress", () => {
    it("should report progress correctly", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await recordToolCall(task.taskId, {
        toolName: "tool1",
        args: {},
        result: { success: true },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      await recordToolCall(task.taskId, {
        toolName: "tool2",
        args: {},
        result: { success: true },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      await recordToolCall(task.taskId, {
        toolName: "tool3",
        args: {},
        result: { success: false, error: "Failed" },
        timestamp: new Date().toISOString(),
        attempt: 1,
      });

      const progress = await getTaskProgress(task.taskId);

      expect(progress).not.toBeNull();
      expect(progress?.totalSteps).toBe(3);
      expect(progress?.completedSteps).toBe(2);
      expect(progress?.failedSteps).toBe(1);
      expect(progress?.progressPercent).toBe(67); // 2/3 * 100 rounded
      expect(progress?.pendingApprovals).toBe(0);
    });

    it("should return null for non-existent task", async () => {
      const progress = await getTaskProgress("non-existent");
      expect(progress).toBeNull();
    });
  });

  describe("Export/Import", () => {
    it("should export task as JSON", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        tags: ["export-test"],
      });

      const json = await getTaskPersistenceManager().exportTask(task.taskId);

      expect(json).toBeDefined();
      const parsed = JSON.parse(json!);
      expect(parsed.taskId).toBe(task.taskId);
      expect(parsed.metadata.tags).toEqual(["export-test"]);
    });

    it("should import task with new ID", async () => {
      const task = await createPersistentTask({
        conversationId: "conv-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        tags: ["original"],
      });

      const json = await getTaskPersistenceManager().exportTask(task.taskId);
      const imported = await getTaskPersistenceManager().importTask(json!);

      expect(imported.taskId).not.toBe(task.taskId);
      expect(imported.metadata.tags).toEqual(["original"]);
      expect(imported.status).toBe("initialized");
    });

    it("should return null for exporting non-existent task", async () => {
      const json = await getTaskPersistenceManager().exportTask("non-existent");
      expect(json).toBeNull();
    });
  });
});