import { Router, Request, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth-middleware";
import {
  buildProjectMap,
  getProjectMap,
  updateProjectMapForFile,
  analyzeImpact,
  selectContextForGoal,
  saveProjectMap,
  loadProjectMap,
  type ProjectMap,
  type ImpactAnalysis,
  type SmartContextSelection,
} from "../../lib/build-project-map";

const router = Router();

// All routes require authentication
router.use(requireAuth);

function getParam(params: Record<string, unknown>, key: string): string {
  const val = params[key];
  return Array.isArray(val) ? val[0] : String(val);
}

function getQuery(req: AuthenticatedRequest, key: string): string | undefined {
  const val = req.query[key] as string | string[] | undefined;
  if (val === undefined) return undefined;
  if (Array.isArray(val)) return val[0];
  return val;
}

/**
 * GET /api/infinity/project-map/:projectId
 * Get the current project map for a project
 */
router.get("/:projectId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    const workspaceId = getQuery(req, "workspaceId") || projectId;

    const projectMap = await getProjectMap(projectId, workspaceId);
    res.json({ success: true, projectMap });
  } catch (error) {
    console.error("Error getting project map:", error);
    res.status(500).json({ success: false, error: "Failed to get project map" });
  }
});

/**
 * POST /api/infinity/project-map/:projectId/refresh
 * Force a full rebuild of the project map
 */
router.post("/:projectId/refresh", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    const workspaceId = (req.body.workspaceId as string) || projectId;

    const projectMap = await buildProjectMap(projectId, workspaceId);
    await saveProjectMap(projectId);

    res.json({ success: true, projectMap });
  } catch (error) {
    console.error("Error refreshing project map:", error);
    res.status(500).json({ success: false, error: "Failed to refresh project map" });
  }
});

/**
 * POST /api/infinity/project-map/:projectId/update-file
 * Update the project map for a specific file change
 */
router.post("/:projectId/update-file", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    const { filePath, workspaceId } = req.body;

    if (!filePath) {
      return res.status(400).json({ success: false, error: "filePath is required" });
    }

    const wsId = workspaceId || projectId;
    await updateProjectMapForFile(projectId, filePath, wsId);
    await saveProjectMap(projectId);

    return res.json({ success: true, message: `Updated project map for ${filePath}` });
  } catch (error) {
    console.error("Error updating project map for file:", error);
    return res.status(500).json({ success: false, error: "Failed to update project map for file" });
  }
});

/**
 * GET /api/infinity/project-map/:projectId/impact/:filePath
 * Analyze the impact of a file change
 */
router.get("/:projectId/impact/:filePath(*)", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    const filePath = getParam(req.params, "filePath");
    const workspaceId = getQuery(req, "workspaceId") || projectId;

    const impact = await analyzeImpact(projectId, filePath, workspaceId);
    res.json({ success: true, impact });
  } catch (error) {
    console.error("Error analyzing impact:", error);
    res.status(500).json({ success: false, error: "Failed to analyze impact" });
  }
});

/**
 * POST /api/infinity/project-map/:projectId/select-context
 * Select relevant files for a goal (smart context selection)
 */
router.post("/:projectId/select-context", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    const { goal, workspaceId, maxTokens } = req.body;

    if (!goal) {
      return res.status(400).json({ success: false, error: "goal is required" });
    }

    const wsId = workspaceId || projectId;
    const tokenLimit = maxTokens || 50000;

    const selection = await selectContextForGoal(projectId, goal, wsId, tokenLimit);
    return res.json({ success: true, selection });
  } catch (error) {
    console.error("Error selecting context for goal:", error);
    return res.status(500).json({ success: false, error: "Failed to select context" });
  }
});

/**
 * POST /api/infinity/project-map/:projectId/save
 * Save the current project map to disk
 */
router.post("/:projectId/save", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    await saveProjectMap(projectId);
    res.json({ success: true, message: "Project map saved" });
  } catch (error) {
    console.error("Error saving project map:", error);
    res.status(500).json({ success: false, error: "Failed to save project map" });
  }
});

/**
 * GET /api/infinity/project-map/:projectId/load
 * Load project map from disk (if exists)
 */
router.get("/:projectId/load", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    const projectMap = await loadProjectMap(projectId);

    if (!projectMap) {
      return res.status(404).json({ success: false, error: "No saved project map found" });
    }

    return res.json({ success: true, projectMap });
  } catch (error) {
    console.error("Error loading project map:", error);
    return res.status(500).json({ success: false, error: "Failed to load project map" });
  }
});

/**
 * GET /api/infinity/project-map/:projectId/summary
 * Get a summary of the project map for quick overview
 */
router.get("/:projectId/summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getParam(req.params, "projectId");
    const workspaceId = getQuery(req, "workspaceId") || projectId;

    const projectMap = await getProjectMap(projectId, workspaceId);

    const summary = {
      projectId: projectMap.projectId,
      generatedAt: projectMap.generatedAt,
      version: projectMap.version,
      framework: projectMap.framework,
      packageManager: projectMap.packageManager,
      architecture: projectMap.architecture,
      database: projectMap.database,
      testFramework: projectMap.testFramework,
      entryPoints: projectMap.entryPoints,
      fileCount: projectMap.fileMap.size,
      routeCount: projectMap.routes.length,
      componentCount: projectMap.components.length,
      configFiles: projectMap.configFiles.map(c => ({ path: c.path, type: c.type })),
      importantFiles: projectMap.importantFiles,
      metadata: projectMap.metadata,
    };

    res.json({ success: true, summary });
  } catch (error) {
    console.error("Error getting project map summary:", error);
    res.status(500).json({ success: false, error: "Failed to get project map summary" });
  }
});

export default router;