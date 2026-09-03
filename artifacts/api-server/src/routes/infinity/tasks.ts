/**
 * Phase 35: Dynamic Island / Live Task Display — API Routes
 *
 * SSE endpoint for real-time task updates + REST CRUD
 */

import { Router, Request, Response } from "express";
import { getTaskRegistry } from "@api-server/lib/task-registry";
import { requireAuth, AuthenticatedRequest } from "@api-server/middleware/auth-middleware";
import { db } from "@workspace/db";
import { tasks, taskEvents } from "@workspace/db/src/schema/tasks";
import { eq, and, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const router = Router();

/**
 * SSE endpoint for real-time task updates
 * GET /api/infinity/tasks/stream
 */
router.get("/stream", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const clientId = uuidv4();

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

  // Register client with task registry
  const registry = getTaskRegistry();
  registry.registerSSEClient(clientId, res);

  // Heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(heartbeatInterval);
    registry.registerSSEClient(clientId, res); // This will remove it since stream is closed
  });
});

/**
 * Get all tasks with optional filtering
 * GET /api/infinity/tasks
 */
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const filter = {
      type: req.query.type as string,
      status: req.query.status as string,
      parentId: req.query.parentId as string,
      tags: req.query.tags ? (req.query.tags as string).split(",") : undefined,
      createdBy: req.query.createdBy as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const taskList = registry.getTasks(filter);
    res.json({ success: true, data: taskList });
  } catch (error) {
    console.error("[Tasks API] Error fetching tasks:", error);
    res.status(500).json({ success: false, error: "Failed to fetch tasks" });
  }
});

/**
 * Get active tasks (running + pending)
 * GET /api/infinity/tasks/active
 */
router.get("/active", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const activeTasks = registry.getActiveTasks();
    res.json({ success: true, data: activeTasks });
  } catch (error) {
    console.error("[Tasks API] Error fetching active tasks:", error);
    res.status(500).json({ success: false, error: "Failed to fetch active tasks" });
  }
});

/**
 * Get primary task (highest priority active task)
 * GET /api/infinity/tasks/primary
 */
router.get("/primary", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const primaryTask = registry.getPrimaryTask();
    res.json({ success: true, data: primaryTask });
  } catch (error) {
    console.error("[Tasks API] Error fetching primary task:", error);
    res.status(500).json({ success: false, error: "Failed to fetch primary task" });
  }
});

/**
 * Get task counts by status
 * GET /api/infinity/tasks/counts
 */
router.get("/counts", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const counts = registry.getTaskCounts();
    res.json({ success: true, data: counts });
  } catch (error) {
    console.error("[Tasks API] Error fetching task counts:", error);
    res.status(500).json({ success: false, error: "Failed to fetch task counts" });
  }
});

/**
 * Get a specific task by ID
 * GET /api/infinity/tasks/:id
 */
router.get("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const task = registry.getTask(req.params.id);

    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    console.error("[Tasks API] Error fetching task:", error);
    res.status(500).json({ success: false, error: "Failed to fetch task" });
  }
});

/**
 * Create a new task
 * POST /api/infinity/tasks
 */
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const {
      type,
      title,
      description,
      priority = "normal",
      metadata = {},
      parentId,
      tags = [],
      eta,
    } = req.body;

    if (!type || !title || !description) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: type, title, description",
      });
    }

    const task = await registry.createTask({
      type,
      title,
      description,
      priority,
      metadata,
      parentId,
      tags,
      createdBy: "user",
      eta: eta ? new Date(eta) : undefined,
    });

    res.status(201).json({ success: true, data: task });
  } catch (error) {
    console.error("[Tasks API] Error creating task:", error);
    res.status(500).json({ success: false, error: "Failed to create task" });
  }
});

/**
 * Update a task
 * PATCH /api/infinity/tasks/:id
 */
router.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const { progress, status, description, eta, metadata, tags } = req.body;

    const updates: any = {};
    if (progress !== undefined) updates.progress = progress;
    if (status !== undefined) updates.status = status;
    if (description !== undefined) updates.description = description;
    if (eta !== undefined) updates.eta = eta ? new Date(eta) : undefined;
    if (metadata !== undefined) updates.metadata = metadata;
    if (tags !== undefined) updates.tags = tags;

    const task = await registry.updateTask(req.params.id, updates);

    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    console.error("[Tasks API] Error updating task:", error);
    res.status(500).json({ success: false, error: "Failed to update task" });
  }
});

/**
 * Delete a task
 * DELETE /api/infinity/tasks/:id
 */
router.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const success = await registry.deleteTask(req.params.id);

    if (!success) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    console.error("[Tasks API] Error deleting task:", error);
    res.status(500).json({ success: false, error: "Failed to delete task" });
  }
});

/**
 * Get task children
 * GET /api/infinity/tasks/:id/children
 */
router.get("/:id/children", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const children = registry.getDescendants(req.params.id);
    res.json({ success: true, data: children });
  } catch (error) {
    console.error("[Tasks API] Error fetching children:", error);
    res.status(500).json({ success: false, error: "Failed to fetch children" });
  }
});

/**
 * Pause a task
 * POST /api/infinity/tasks/:id/pause
 */
router.post("/:id/pause", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const task = await registry.updateTask(req.params.id, { status: "paused" });

    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    console.error("[Tasks API] Error pausing task:", error);
    res.status(500).json({ success: false, error: "Failed to pause task" });
  }
});

/**
 * Resume a paused task
 * POST /api/infinity/tasks/:id/resume
 */
router.post("/:id/resume", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = getTaskRegistry();
    const task = await registry.updateTask(req.params.id, { status: "running" });

    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    console.error("[Tasks API] Error resuming task:", error);
    res.status(500).json({ success: false, error: "Failed to resume task" });
  }
});

/**
 * Get persisted tasks from database (for history/recovery)
 * GET /api/infinity/tasks/history
 */
router.get("/history", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const status = req.query.status as string;
    const type = req.query.type as string;

    const conditions = [];
    if (status) conditions.push(eq(tasks.status, status));
    if (type) conditions.push(eq(tasks.type, type));

    const historyTasks = await db
      .select()
      .from(tasks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tasks.updatedAt))
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: historyTasks });
  } catch (error) {
    console.error("[Tasks API] Error fetching task history:", error);
    res.status(500).json({ success: false, error: "Failed to fetch task history" });
  }
});

export const tasksRouter = router;