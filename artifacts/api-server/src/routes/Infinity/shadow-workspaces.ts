/**
 * Shadow Workspaces API Routes — Ephemeral Isolated Environments for Agent QA
 *
 * Endpoints:
 * - GET /api/infinity/shadow-workspaces - List workspaces
 * - POST /api/infinity/shadow-workspaces - Create workspace
 * - GET /api/infinity/shadow-workspaces/:workspaceId - Get workspace details
 * - POST /api/infinity/shadow-workspaces/:workspaceId/run - Run agent in workspace
 * - POST /api/infinity/shadow-workspaces/:workspaceId/stop - Stop running agent
 * - POST /api/infinity/shadow-workspaces/:workspaceId/cleanup - Cleanup workspace
 * - GET /api/infinity/shadow-workspaces/pool - Get warm pool status
 * - POST /api/infinity/shadow-workspaces/pool/resize - Resize warm pool
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { ShadowWorkspaceManager, createShadowWorkspaceManager, type ShadowWorkspaceConfig, type ShadowAgentTask, type ResourceLimits } from "../../lib/shadow-workspace";
import { createBestAdapter } from "../../lib/adapter-factory";
import { getWorktreeManager } from "../../lib/virtual-worktree";

const router = Router();

// In-memory stores (in production, use Redis or database)
const workspaceManagers: Map<string, ShadowWorkspaceManager> = new Map();

// Validation schemas
const createWorkspaceSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  baseCommit: z.string().optional(),
  baseSnapshot: z.record(z.string()).optional(),
  warmPoolSize: z.number().min(0).max(20).optional(),
  limits: z.object({
    cpuTimeMs: z.number().positive().optional(),
    memoryMb: z.number().positive().optional(),
    wallTimeMs: z.number().positive().optional(),
    maxNetworkRequests: z.number().positive().optional(),
    diskSpaceMb: z.number().positive().optional(),
  }).optional(),
  services: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  workingDir: z.string().optional(),
  debug: z.boolean().optional(),
});

const runAgentSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  prompt: z.string().min(1),
  agentConfig: z.object({
    maxIterations: z.number().positive().max(100).optional(),
    maxToolCalls: z.number().positive().max(500).optional(),
    enableOrchestration: z.boolean().optional(),
  }).optional(),
});

const resizePoolSchema = z.object({
  projectId: z.string().min(1),
  size: z.number().min(0).max(20),
});

/**
 * Get or create workspace manager for project
 */
async function getWorkspaceManager(projectId: string, projectRoot: string): Promise<ShadowWorkspaceManager> {
  let manager = workspaceManagers.get(projectId);
  if (!manager) {
    // Get base snapshot from git
    const worktreeManager = getWorktreeManager();
    await worktreeManager.init();

    // For now, use empty snapshot - in production would clone repo
    const baseSnapshot: Record<string, string> = {};
    const baseCommit = "HEAD";

    manager = await createShadowWorkspaceManager(baseSnapshot, baseCommit, {
      warmPoolSize: 3,
      debug: true,
    });
    workspaceManagers.set(projectId, manager);
  }
  return manager;
}

/**
 * GET /api/infinity/shadow-workspaces
 * List all workspaces for a project
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const manager = workspaceManagers.get(projectId);
    if (!manager) {
      return res.json({ workspaces: [], warmPool: { size: 0, targetSize: 0, workspaces: [] } });
    }

    const workspaces = manager.listWorkspaces();
    const warmPool = manager.getWarmPoolStatus();

    res.json({
      success: true,
      workspaces,
      warmPool,
    });
  } catch (error) {
    console.error("[Shadow Workspaces List] Error:", error);
    res.status(500).json({ error: "List workspaces failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/shadow-workspaces
 * Create a new workspace (or initialize manager with warm pool)
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const config = createWorkspaceSchema.parse(req.body);

    const manager = await getWorkspaceManager(config.projectId, config.projectRoot);

    // If warm pool size specified, resize
    if (config.warmPoolSize !== undefined) {
      await manager.resizeWarmPool(config.warmPoolSize);
    }

    // Create a new workspace
    const workspaceConfig: ShadowWorkspaceConfig = {
      baseSnapshot: config.baseSnapshot || {},
      baseCommit: config.baseCommit || "HEAD",
      limits: config.limits,
      services: config.services,
      env: config.env,
      workingDir: config.workingDir,
      debug: config.debug,
    };

    const workspace = await manager.createWorkspace(workspaceConfig);

    res.json({ success: true, workspace });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Shadow Workspaces Create] Error:", error);
    res.status(500).json({ error: "Create workspace failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/shadow-workspaces/:workspaceId
 * Get workspace details
 */
router.get("/:workspaceId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    const { workspaceId } = req.params;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const manager = workspaceManagers.get(projectId);
    if (!manager) {
      return res.status(404).json({ error: "Workspace manager not found" });
    }

    const workspace = manager.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    res.json({ success: true, workspace });
  } catch (error) {
    console.error("[Shadow Workspaces Get] Error:", error);
    res.status(500).json({ error: "Get workspace failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/shadow-workspaces/:workspaceId/run
 * Run an agent task in the workspace
 */
router.post("/:workspaceId/run", async (req: Request, res: Response) => {
  try {
    const { projectId, projectRoot } = req.query;
    const { workspaceId } = req.params;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!projectRoot || typeof projectRoot !== "string") {
      return res.status(400).json({ error: "projectRoot is required" });
    }

    const config = runAgentSchema.parse(req.body);

    const manager = workspaceManagers.get(projectId);
    if (!manager) {
      return res.status(404).json({ error: "Workspace manager not found" });
    }

    const workspace = manager.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    // Get LLM adapter
    const llm = await createBestAdapter();

    // Prepare agent context
    const worktreeManager = getWorktreeManager();
    const worktree = await worktreeManager.getWorktree(workspace.worktreeId);

    const agentContext = {
      worktreeId: workspace.worktreeId,
      worktreeManager,
      projectId,
      projectRoot,
      sharedContext: undefined,
      agentIndex: 0,
    };

    // Run agent
    const task: ShadowAgentTask = {
      prompt: config.prompt,
      agentConfig: config.agentConfig,
      context: agentContext,
      llm,
    };

    const result = await manager.runAgent(workspaceId, task);

    res.json({ success: true, result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Shadow Workspaces Run Agent] Error:", error);
    res.status(500).json({ error: "Run agent failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/shadow-workspaces/:workspaceId/stop
 * Stop a running agent in the workspace
 */
router.post("/:workspaceId/stop", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    const { workspaceId } = req.params;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const manager = workspaceManagers.get(projectId);
    if (!manager) {
      return res.status(404).json({ error: "Workspace manager not found" });
    }

    // Note: The current implementation doesn't support stopping mid-run
    // This would require tracking the running agent and aborting it
    // For now, return success
    res.json({ success: true, message: "Stop requested (not fully implemented)" });
  } catch (error) {
    console.error("[Shadow Workspaces Stop] Error:", error);
    res.status(500).json({ error: "Stop failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/shadow-workspaces/:workspaceId/cleanup
 * Cleanup a workspace
 */
router.post("/:workspaceId/cleanup", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    const { workspaceId } = req.params;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const manager = workspaceManagers.get(projectId);
    if (!manager) {
      return res.status(404).json({ error: "Workspace manager not found" });
    }

    await manager.cleanupWorkspace(workspaceId);

    res.json({ success: true, message: "Workspace cleaned up" });
  } catch (error) {
    console.error("[Shadow Workspaces Cleanup] Error:", error);
    res.status(500).json({ error: "Cleanup failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/shadow-workspaces/pool
 * Get warm pool status
 */
router.get("/pool", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const manager = workspaceManagers.get(projectId);
    if (!manager) {
      return res.json({ size: 0, targetSize: 0, workspaces: [] });
    }

    const warmPool = manager.getWarmPoolStatus();
    res.json({ success: true, ...warmPool });
  } catch (error) {
    console.error("[Shadow Workspaces Pool] Error:", error);
    res.status(500).json({ error: "Get pool failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/shadow-workspaces/pool/resize
 * Resize warm pool
 */
router.post("/pool/resize", async (req: Request, res: Response) => {
  try {
    const config = resizePoolSchema.parse(req.body);

    const manager = workspaceManagers.get(config.projectId);
    if (!manager) {
      return res.status(404).json({ error: "Workspace manager not found" });
    }

    await manager.resizeWarmPool(config.size);
    const warmPool = manager.getWarmPoolStatus();

    res.json({ success: true, ...warmPool });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Shadow Workspaces Resize Pool] Error:", error);
    res.status(500).json({ error: "Resize pool failed", message: String(error) });
  }
});

/**
 * DELETE /api/infinity/shadow-workspaces
 * Shutdown workspace manager (cleanup all)
 */
router.delete("/", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const manager = workspaceManagers.get(projectId);
    if (manager) {
      await manager.shutdown();
      workspaceManagers.delete(projectId);
    }

    res.json({ success: true, message: "Workspace manager shut down" });
  } catch (error) {
    console.error("[Shadow Workspaces Shutdown] Error:", error);
    res.status(500).json({ error: "Shutdown failed", message: String(error) });
  }
});

export default router;