import { Router, Request, Response } from "express";
import { getModelRouter } from "../../lib/model-router";
import { requireAuth, AuthenticatedRequest } from "../../middleware/auth-middleware";

const router = Router();
const modelRouter = getModelRouter();

/**
 * GET /api/infinity-ai/model-router/build-modes
 * Get all build mode configurations
 */
router.get("/build-modes", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const modes = modelRouter.getAllBuildModes();
    res.json(modes);
  } catch (error) {
    console.error("Failed to get build modes:", error);
    res.status(500).json({ error: "Failed to get build modes" });
  }
});

/**
 * GET /api/infinity-ai/model-router/benchmarks
 * Get model benchmarks
 */
router.get("/benchmarks", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const benchmarks = modelRouter.getModelBenchmarks();
    res.json(benchmarks);
  } catch (error) {
    console.error("Failed to get benchmarks:", error);
    res.status(500).json({ error: "Failed to get benchmarks" });
  }
});

/**
 * GET /api/infinity-ai/model-router/models
 * Get all available models with optional filters
 */
router.get("/models", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const capability = req.query.capability as string;
    const provider = req.query.provider as string;
    const enabled = req.query.enabled === "true" ? true : req.query.enabled === "false" ? false : undefined;

    const models = modelRouter.getModels({
      capability: capability as any,
      provider: provider as any,
      enabled,
    });

    res.json(models);
  } catch (error) {
    console.error("Failed to get models:", error);
    res.status(500).json({ error: "Failed to get models" });
  }
});

/**
 * POST /api/infinity-ai/model-router/select-model
 * Select best model for task category and build mode
 */
router.post("/select-model", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taskCategory, buildMode, constraints } = req.body;
    const projectId = req.query.projectId as string || req.accountId;
    const userId = req.query.userId as string || req.accountId;

    if (!taskCategory) {
      return res.status(400).json({ error: "taskCategory is required" });
    }

    const result = await modelRouter.selectModel(
      taskCategory,
      buildMode || "balanced",
      { projectId, userId, constraints }
    );

    res.json(result);
  } catch (error) {
    console.error("Failed to select model:", error);
    res.status(500).json({ error: "Failed to select model" });
  }
});

/**
 * GET /api/infinity-ai/model-router/recommended
 * Get recommended models for task category and build mode
 */
router.get("/recommended", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const taskCategory = req.query.taskCategory as string;
    const buildMode = req.query.buildMode as string || "balanced";

    if (!taskCategory) {
      return res.status(400).json({ error: "taskCategory is required" });
    }

    const models = modelRouter.getRecommendedModels(
      taskCategory as any,
      buildMode as any
    );

    res.json(models);
  } catch (error) {
    console.error("Failed to get recommended models:", error);
    res.status(500).json({ error: "Failed to get recommended models" });
  }
});

/**
 * GET /api/infinity-ai/model-router/cost-summary
 * Get cost tracking summary for a project
 */
router.get("/cost-summary", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = req.query.projectId as string || req.accountId;
    const days = parseInt(req.query.days as string) || 30;

    const summary = await modelRouter.getCostSummary(projectId, days);
    res.json(summary);
  } catch (error) {
    console.error("Failed to get cost summary:", error);
    res.status(500).json({ error: "Failed to get cost summary" });
  }
});

/**
 * POST /api/infinity-ai/model-router/estimate-cost
 * Estimate cost for a request
 */
router.post("/estimate-cost", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { modelId, inputTokens, outputTokens } = req.body;

    if (!modelId || !inputTokens || !outputTokens) {
      return res.status(400).json({ error: "modelId, inputTokens, and outputTokens are required" });
    }

    const model = modelRouter.getModel(modelId);
    if (!model) {
      return res.status(404).json({ error: "Model not found" });
    }

    const estimate = modelRouter.estimateRequestCost(model, inputTokens, outputTokens);
    res.json(estimate);
  } catch (error) {
    console.error("Failed to estimate cost:", error);
    res.status(500).json({ error: "Failed to estimate cost" });
  }
});

/**
 * POST /api/infinity-ai/model-router/estimate-deep-research
 * Estimate cost for deep research
 */
router.post("/estimate-deep-research", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { modelId, steps } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: "modelId is required" });
    }

    const model = modelRouter.getModel(modelId);
    if (!model) {
      return res.status(404).json({ error: "Model not found" });
    }

    const estimate = modelRouter.estimateDeepResearchCost(model, steps || 5);
    res.json(estimate);
  } catch (error) {
    console.error("Failed to estimate deep research cost:", error);
    res.status(500).json({ error: "Failed to estimate deep research cost" });
  }
});

/**
 * GET /api/infinity-ai/model-router/capabilities
 * Get all available capabilities
 */
router.get("/capabilities", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ModelCapability } = await import("../../lib/model-router");
    const capabilities = Object.values(ModelCapability);
    res.json(capabilities);
  } catch (error) {
    console.error("Failed to get capabilities:", error);
    res.status(500).json({ error: "Failed to get capabilities" });
  }
});

/**
 * GET /api/infinity-ai/model-router/task-categories
 * Get all task categories
 */
router.get("/task-categories", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { TaskCategory } = await import("../../lib/model-router");
    const categories = Object.values(TaskCategory);
    res.json(categories);
  } catch (error) {
    console.error("Failed to get task categories:", error);
    res.status(500).json({ error: "Failed to get task categories" });
  }
});

/**
 * GET /api/infinity-ai/model-router/build-mode/:mode
 * Get specific build mode configuration
 */
router.get("/build-mode/:mode", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { BuildMode } = await import("../../lib/model-router");
    const mode = req.params.mode as any;

    if (!Object.values(BuildMode).includes(mode)) {
      return res.status(400).json({ error: "Invalid build mode" });
    }

    const config = modelRouter.getBuildModeConfig(mode);
    res.json(config);
  } catch (error) {
    console.error("Failed to get build mode:", error);
    res.status(500).json({ error: "Failed to get build mode" });
  }
});

/**
 * PATCH /api/infinity-ai/model-router/build-mode/custom
 * Update custom build mode configuration
 */
router.patch("/build-mode/custom", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { BuildMode } = await import("../../lib/model-router");
    const config = req.body;

    modelRouter.updateBuildModeConfig(BuildMode.CUSTOM, config);
    const updated = modelRouter.getBuildModeConfig(BuildMode.CUSTOM);
    res.json(updated);
  } catch (error) {
    console.error("Failed to update custom build mode:", error);
    res.status(500).json({ error: "Failed to update custom build mode" });
  }
});

export default router;