import { Router, Request, Response } from "express";
import {
  getProjectTypeRegistry,
  getProjectTypeRegistryWithPlugins,
  getProjectType,
  getProjectTypeWithPlugins,
  validateProjectType,
  validateProjectTypeWithPlugins,
  getAllProjectTypes,
  getAllProjectTypesWithPlugins,
  reloadPlugins,
  loadAllPlugins,
  watchPlugins,
  getPluginDirectory,
  createPluginTemplate,
  deletePlugin,
  type PluginManifest,
} from "../../lib/project-types.js";

const router = Router();

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

/**
 * GET /api/infinity/project-types
 * List all available project types (built-in + plugins)
 */
router.get("/", (_req: Request, res: Response) => {
  const registry = getProjectTypeRegistryWithPlugins();
  return res.json(registry);
});

/**
 * GET /api/infinity/project-types/:id
 * Get details for a specific project type (built-in or plugin)
 */
router.get("/:id", (req: Request, res: Response) => {
  const id = getIdParam(req);
  const type = getProjectTypeWithPlugins(id);

  if (!type) {
    return res.status(404).json({ error: "Project type not found" });
  }

  return res.json(type);
});

/**
 * POST /api/infinity/project-types/validate
 * Validate if a project type ID is valid (built-in or plugin)
 */
router.post("/validate", (req: Request, res: Response) => {
  const { typeId } = req.body as { typeId?: string };

  if (!typeId || typeof typeId !== "string") {
    return res.status(400).json({ error: "typeId is required" });
  }

  const isValid = validateProjectTypeWithPlugins(typeId);
  return res.json({ valid: isValid, type: isValid ? getProjectTypeWithPlugins(typeId) : null });
});

/**
 * GET /api/infinity/project-types/:id/tools
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
 * GET /api/infinity/project-types/:id/views
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
 * GET /api/infinity/project-types/:id/components
 * Get available components for a project type
 */
router.get("/:id/components", (req: Request, res: Response) => {
  const id = getIdParam(req);
  const type = getProjectTypeWithPlugins(id);

  if (!type) {
    return res.status(404).json({ error: "Project type not found" });
  }

  return res.json({
    typeId: id,
    components: type.components,
  });
});

/**
 * POST /api/infinity/project-types/plugins/reload
 * Reload all plugins from disk
 */
router.post("/plugins/reload", (_req: Request, res: Response) => {
  const result = reloadPlugins();
  return res.json({
    success: true,
    plugins: result.plugins,
    errors: result.errors,
    warnings: result.warnings,
  });
});

/**
 * GET /api/infinity/project-types/plugins/directory
 * Get the plugin directory path
 */
router.get("/plugins/directory", (_req: Request, res: Response) => {
  return res.json({
    directory: getPluginDirectory(),
  });
});

/**
 * POST /api/infinity/project-types/plugins/create
 * Create a new plugin template file
 */
router.post("/plugins/create", (req: Request, res: Response) => {
  const { id, name } = req.body as { id?: string; name?: string };

  if (!id || !name) {
    return res.status(400).json({ error: "id and name are required" });
  }

  try {
    const filePath = createPluginTemplate(id, name);
    return res.json({
      success: true,
      filePath,
      message: `Plugin template created at ${filePath}. Edit the file and call /plugins/reload to load it.`,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to create plugin: ${error instanceof Error ? error.message : String(error)}` });
  }
});

/**
 * DELETE /api/infinity/project-types/plugins/:id
 * Delete a custom plugin
 */
router.delete("/plugins/:id", (req: Request, res: Response) => {
  const id = getIdParam(req);

  // Don't allow deleting built-in types
  const builtinTypes = ["general", "book", "website", "company", "app", "research", "course"];
  if (builtinTypes.includes(id)) {
    return res.status(400).json({ error: "Cannot delete built-in project type" });
  }

  const deleted = deletePlugin(id);
  if (!deleted) {
    return res.status(404).json({ error: "Plugin not found" });
  }

  return res.json({
    success: true,
    message: `Plugin "${id}" deleted`,
  });
});

/**
 * GET /api/infinity/project-types/plugins
 * List all loaded plugins
 */
router.get("/plugins", (_req: Request, res: Response) => {
  const { plugins, errors, warnings } = loadAllPlugins();
  return res.json({ plugins, errors, warnings });
});

export default router;