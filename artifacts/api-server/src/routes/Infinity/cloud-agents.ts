/**
 * Cloud Agent Runtime API Routes — Persistent Long-Running Agents
 *
 * Endpoints:
 * - POST /api/infinity/cloud-agents/tasks - Create a new cloud task
 * - GET /api/infinity/cloud-agents/tasks - List tasks
 * - GET /api/infinity/cloud-agents/tasks/:taskId - Get task details
 * - PATCH /api/infinity/cloud-agents/tasks/:taskId - Update task
 * - DELETE /api/infinity/cloud-agents/tasks/:taskId - Delete task
 * - POST /api/infinity/cloud-agents/tasks/:taskId/run - Run task manually
 * - POST /api/infinity/cloud-agents/tasks/:taskId/stop - Stop running task
 * - POST /api/infinity/cloud-agents/tasks/:taskId/pause - Pause running task
 * - POST /api/infinity/cloud-agents/tasks/:taskId/resume - Resume paused task
 * - POST /api/infinity/cloud-agents/tasks/:taskId/checkpoints - Create checkpoint
 * - POST /api/infinity/cloud-agents/tasks/:taskId/checkpoints/:checkpointId/restore - Restore checkpoint
 * - POST /api/infinity/cloud-agents/tasks/:taskId/triggers - Add trigger
 * - DELETE /api/infinity/cloud-agents/tasks/:taskId/triggers/:triggerId - Remove trigger
 * - POST /api/infinity/cloud-agents/tasks/:taskId/notifications - Add notification
 * - GET /api/infinity/cloud-agents/stats - Get statistics
 * - POST /api/infinity/cloud-agents/budget - Set budget
 * - GET /api/infinity/cloud-agents/budget/:projectId - Get budget
 * - GET /api/infinity/cloud-agents/cost/:projectId - Get project cost
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { CloudAgentRuntime, createCloudAgentRuntime, type CloudTask, type TriggerConfig, type NotificationConfig, type BudgetConfig, type TaskStatus } from "../../lib/cloud-agent-runtime";

const router = Router();

// In-memory runtime instance (in production, use singleton or dependency injection)
let runtime: CloudAgentRuntime | null = null;

async function getRuntime(): Promise<CloudAgentRuntime> {
  if (!runtime) {
    runtime = await createCloudAgentRuntime({ debug: true });
  }
  return runtime;
}

// Validation schemas
const createTaskSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  goal: z.string().min(1),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  agentConfig: z.object({
    maxIterations: z.number().positive().max(100).optional(),
    maxToolCalls: z.number().positive().max(500).optional(),
    enableOrchestration: z.boolean().optional(),
    enableMCP: z.boolean().optional(),
  }).optional(),
  llmModel: z.string().optional(),
  triggers: z.array(z.object({
    type: z.enum(["cron", "webhook", "pr_created", "pr_updated", "push", "manual", "schedule"]),
    enabled: z.boolean().optional(),
    config: z.object({
      cron: z.string().optional(),
      timezone: z.string().optional(),
      webhookUrl: z.string().url().optional(),
      webhookSecret: z.string().optional(),
      branches: z.array(z.string()).optional(),
      runAt: z.number().optional(),
      payload: z.record(z.unknown()).optional(),
    }).optional(),
  })).optional(),
  notifications: z.array(z.object({
    type: z.enum(["webhook", "email", "in-app", "slack", "discord"]),
    enabled: z.boolean().optional(),
    config: z.object({
      url: z.string().url().optional(),
      secret: z.string().optional(),
      to: z.array(z.string().email()).optional(),
      from: z.string().email().optional(),
      webhookUrl: z.string().url().optional(),
      channel: z.string().optional(),
      userIds: z.array(z.string()).optional(),
      events: z.array(z.enum(["started", "completed", "failed", "paused", "checkpoint", "approval_required"])).optional(),
      template: z.string().optional(),
    }).optional(),
  })).optional(),
  budget: z.object({
    dailyLimitUsd: z.number().positive().optional(),
    monthlyLimitUsd: z.number().positive().optional(),
    perTaskLimitUsd: z.number().positive().optional(),
    alertThresholdPercent: z.number().min(0).max(100).optional(),
    hardLimit: z.boolean().optional(),
  }).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateTaskSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  goal: z.string().min(1).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  agentConfig: z.object({
    maxIterations: z.number().positive().max(100).optional(),
    maxToolCalls: z.number().positive().max(500).optional(),
    enableOrchestration: z.boolean().optional(),
    enableMCP: z.boolean().optional(),
  }).optional(),
  llmModel: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const triggerSchema = z.object({
  type: z.enum(["cron", "webhook", "pr_created", "pr_updated", "push", "manual", "schedule"]),
  enabled: z.boolean().optional(),
  config: z.object({
    cron: z.string().optional(),
    timezone: z.string().optional(),
    webhookUrl: z.string().url().optional(),
    webhookSecret: z.string().optional(),
    branches: z.array(z.string()).optional(),
    runAt: z.number().optional(),
    payload: z.record(z.unknown()).optional(),
  }).optional(),
});

const notificationSchema = z.object({
  type: z.enum(["webhook", "email", "in-app", "slack", "discord"]),
  enabled: z.boolean().optional(),
  config: z.object({
    url: z.string().url().optional(),
    secret: z.string().optional(),
    to: z.array(z.string().email()).optional(),
    from: z.string().email().optional(),
    webhookUrl: z.string().url().optional(),
    channel: z.string().optional(),
    userIds: z.array(z.string()).optional(),
    events: z.array(z.enum(["started", "completed", "failed", "paused", "checkpoint", "approval_required"])).optional(),
    template: z.string().optional(),
  }).optional(),
});

const budgetSchema = z.object({
  projectId: z.string().min(1),
  dailyLimitUsd: z.number().positive().optional(),
  monthlyLimitUsd: z.number().positive().optional(),
  perTaskLimitUsd: z.number().positive().optional(),
  alertThresholdPercent: z.number().min(0).max(100).optional(),
  hardLimit: z.boolean().optional(),
});

/**
 * POST /api/infinity/cloud-agents/tasks
 * Create a new cloud task
 */
router.post("/tasks", async (req: Request, res: Response) => {
  try {
    const config = createTaskSchema.parse(req.body);
    const rt = await getRuntime();

    const task = await rt.createTask({
      projectId: config.projectId,
      projectRoot: config.projectRoot,
      name: config.name,
      description: config.description || "",
      goal: config.goal,
      priority: config.priority || "normal",
      agentConfig: config.agentConfig || {},
      llmModel: config.llmModel,
      triggers: (config.triggers || []).map(t => ({
        ...t,
        enabled: t.enabled ?? true,
        config: t.config || {},
        createdAt: Date.now(),
        id: `trg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      })),
      notifications: (config.notifications || []).map(n => ({
        ...n,
        enabled: n.enabled ?? true,
        config: n.config || {},
        createdAt: Date.now(),
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      })),
      budget: config.budget ? {
        projectId: config.projectId,
        ...config.budget,
        hardLimit: config.budget.hardLimit ?? false,
      } : undefined,
      maxIterations: config.agentConfig?.maxIterations || 20,
      metadata: config.metadata || {},
      tags: config.tags || [],
    });

    // Set budget if provided
    if (config.budget) {
      await rt.setBudget({
        projectId: config.projectId,
        ...config.budget,
        hardLimit: config.budget.hardLimit ?? false,
      });
    }

    res.json({ success: true, task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cloud Agents Create Task] Error:", error);
    res.status(500).json({ error: "Task creation failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cloud-agents/tasks
 * List tasks with filters
 */
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();

    const { projectId, status, tags, limit = 50, offset = 0 } = req.query;

    const tasks = rt.listTasks({
      projectId: projectId as string,
      status: status as TaskStatus,
      tags: tags ? (tags as string).split(",") : undefined,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      success: true,
      tasks,
      total: tasks.length,
    });
  } catch (error) {
    console.error("[Cloud Agents List Tasks] Error:", error);
    res.status(500).json({ error: "List tasks failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cloud-agents/tasks/:taskId
 * Get task details
 */
router.get("/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;

    const task = rt.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ success: true, task });
  } catch (error) {
    console.error("[Cloud Agents Get Task] Error:", error);
    res.status(500).json({ error: "Get task failed", message: String(error) });
  }
});

/**
 * PATCH /api/infinity/cloud-agents/tasks/:taskId
 * Update task
 */
router.patch("/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;
    const config = updateTaskSchema.parse(req.body);

    const task = await rt.updateTask(taskId, config);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ success: true, task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cloud Agents Update Task] Error:", error);
    res.status(500).json({ error: "Update task failed", message: String(error) });
  }
});

/**
 * DELETE /api/infinity/cloud-agents/tasks/:taskId
 * Delete task
 */
router.delete("/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;

    const deleted = await rt.deleteTask(taskId);
    if (!deleted) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    console.error("[Cloud Agents Delete Task] Error:", error);
    res.status(500).json({ error: "Delete task failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/run
 * Run task manually
 */
router.post("/tasks/:taskId/run", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;

    const result = await rt.runTask(taskId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("[Cloud Agents Run Task] Error:", error);
    res.status(500).json({ error: "Run task failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/stop
 * Stop running task
 */
router.post("/tasks/:taskId/stop", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;
    const { reason = "user_stopped" } = req.body;

    const stopped = await rt.stopTask(taskId, reason);
    if (!stopped) {
      return res.status(404).json({ error: "Task not found or not running" });
    }

    res.json({ success: true, message: "Task stopped" });
  } catch (error) {
    console.error("[Cloud Agents Stop Task] Error:", error);
    res.status(500).json({ error: "Stop task failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/pause
 * Pause running task
 */
router.post("/tasks/:taskId/pause", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;

    const paused = await rt.pauseTask(taskId);
    if (!paused) {
      return res.status(404).json({ error: "Task not found or not running" });
    }

    res.json({ success: true, message: "Task paused" });
  } catch (error) {
    console.error("[Cloud Agents Pause Task] Error:", error);
    res.status(500).json({ error: "Pause task failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/resume
 * Resume paused task
 */
router.post("/tasks/:taskId/resume", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;

    const result = await rt.resumeTask(taskId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("[Cloud Agents Resume Task] Error:", error);
    res.status(500).json({ error: "Resume task failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/checkpoints
 * Create checkpoint
 */
router.post("/tasks/:taskId/checkpoints", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;
    const { label = "manual" } = req.body;

    const checkpoint = await rt.createCheckpoint(taskId, label);
    if (!checkpoint) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ success: true, checkpoint });
  } catch (error) {
    console.error("[Cloud Agents Create Checkpoint] Error:", error);
    res.status(500).json({ error: "Create checkpoint failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/checkpoints/:checkpointId/restore
 * Restore from checkpoint
 */
router.post("/tasks/:taskId/checkpoints/:checkpointId/restore", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId, checkpointId } = req.params;

    const restored = await rt.restoreCheckpoint(taskId, checkpointId);
    if (!restored) {
      return res.status(404).json({ error: "Task or checkpoint not found" });
    }

    res.json({ success: true, message: "Checkpoint restored" });
  } catch (error) {
    console.error("[Cloud Agents Restore Checkpoint] Error:", error);
    res.status(500).json({ error: "Restore checkpoint failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/triggers
 * Add trigger to task
 */
router.post("/tasks/:taskId/triggers", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;
    const config = triggerSchema.parse(req.body);

    const trigger = await rt.addTrigger(taskId, config);
    res.json({ success: true, trigger });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cloud Agents Add Trigger] Error:", error);
    res.status(500).json({ error: "Add trigger failed", message: String(error) });
  }
});

/**
 * DELETE /api/infinity/cloud-agents/tasks/:taskId/triggers/:triggerId
 * Remove trigger from task
 */
router.delete("/tasks/:taskId/triggers/:triggerId", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId, triggerId } = req.params;

    const removed = await rt.removeTrigger(taskId, triggerId);
    if (!removed) {
      return res.status(404).json({ error: "Trigger not found" });
    }

    res.json({ success: true, message: "Trigger removed" });
  } catch (error) {
    console.error("[Cloud Agents Remove Trigger] Error:", error);
    res.status(500).json({ error: "Remove trigger failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/tasks/:taskId/notifications
 * Add notification to task
 */
router.post("/tasks/:taskId/notifications", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;
    const config = notificationSchema.parse(req.body);

    const notification = await rt.addNotification(taskId, config);
    res.json({ success: true, notification });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cloud Agents Add Notification] Error:", error);
    res.status(500).json({ error: "Add notification failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cloud-agents/stats
 * Get statistics
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { projectId } = req.query;

    const stats = rt.getStats(projectId as string);
    res.json({ success: true, stats });
  } catch (error) {
    console.error("[Cloud Agents Stats] Error:", error);
    res.status(500).json({ error: "Stats failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cloud-agents/budget
 * Set budget for project
 */
router.post("/budget", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const config = budgetSchema.parse(req.body);

    await rt.setBudget(config);
    res.json({ success: true, message: "Budget set", budget: config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cloud Agents Set Budget] Error:", error);
    res.status(500).json({ error: "Set budget failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cloud-agents/budget/:projectId
 * Get budget for project
 */
router.get("/budget/:projectId", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { projectId } = req.params;

    const budget = rt.getBudget(projectId);
    if (!budget) {
      return res.status(404).json({ error: "Budget not found" });
    }

    res.json({ success: true, budget });
  } catch (error) {
    console.error("[Cloud Agents Get Budget] Error:", error);
    res.status(500).json({ error: "Get budget failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cloud-agents/cost/:projectId
 * Get project cost
 */
router.get("/cost/:projectId", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { projectId } = req.params;
    const { since } = req.query;

    const cost = rt.getProjectCost(projectId, since ? Number(since) : undefined);
    res.json({ success: true, projectId, cost });
  } catch (error) {
    console.error("[Cloud Agents Get Cost] Error:", error);
    res.status(500).json({ error: "Get cost failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cloud-agents/tasks/:taskId/cost
 * Get task cost
 */
router.get("/tasks/:taskId/cost", async (req: Request, res: Response) => {
  try {
    const rt = await getRuntime();
    const { taskId } = req.params;

    const cost = rt.getTaskCost(taskId);
    if (!cost) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ success: true, cost });
  } catch (error) {
    console.error("[Cloud Agents Get Task Cost] Error:", error);
    res.status(500).json({ error: "Get task cost failed", message: String(error) });
  }
});

export default router;