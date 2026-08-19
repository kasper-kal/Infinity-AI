import { Router, Request, Response } from "express";
import { getProjectTypeRegistry, getProjectType, validateProjectType, getAllProjectTypes } from "../../lib/project-types.js";

const router = Router();

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

/**
 * GET /api/jarvis/project-types
 * List all available project types
 */
router.get("/", (_req: Request, res: Response) => {
  const registry = getProjectTypeRegistry();
  return res.json(registry);
});

/**
 * GET /api/jarvis/project-types/:id
 * Get details for a specific project type
 */
router.get("/:id", (req: Request, res: Response) => {
  const id = getIdParam(req);
  const type = getProjectType(id);

  if (!type) {
    return res.status(404).json({ error: "Project type not found" });
  }

  return res.json(type);
});

/**
 * POST /api/jarvis/project-types/validate
 * Validate if a project type ID is valid
 */
router.post("/validate", (req: Request, res: Response) => {
  const { typeId } = req.body as { typeId?: string };

  if (!typeId || typeof typeId !== "string") {
    return res.status(400).json({ error: "typeId is required" });
  }

  const isValid = validateProjectType(typeId);
  return res.json({ valid: isValid, type: isValid ? getProjectType(typeId) : null });
});

/**
 * GET /api/jarvis/project-types/:id/tools
 * Get available tools for a project type (for Universal Tool Layer integration)
 */
router.get("/:id/tools", (req: Request, res: Response) => {
  const id = getIdParam(req);
  const type = getProjectType(id);

  if (!type) {
    return res.status(404).json({ error: "Project type not found" });
  }

  return res.json({
    typeId: id,
    tools: type.tools,
    namespaces: type.tools,
  });
});

/**
 * GET /api/jarvis/project-types/:id/views
 * Get default views for a project type
 */
router.get("/:id/views", (req: Request, res: Response) => {
  const id = getIdParam(req);
  const type = getProjectType(id);

  if (!type) {
    return res.status(404).json({ error: "Project type not found" });
  }

  return res.json({
    typeId: id,
    defaultViews: type.defaultViews,
  });
});

/**
 * GET /api/jarvis/project-types/:id/components
 * Get available components for a project type
 */
router.get("/:id/components", (req: Request, res: Response) => {
  const id = getIdParam(req);
  const type = getProjectType(id);

  if (!type) {
    return res.status(404).json({ error: "Project type not found" });
  }

  return res.json({
    typeId: id,
    components: type.components,
  });
});

export default router;