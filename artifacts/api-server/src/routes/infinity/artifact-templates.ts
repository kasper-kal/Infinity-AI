import { Router, Request, Response } from "express";
import { getTemplateRegistry, getTemplatesByArtifactType, searchTemplates, getFigmaTemplates, getTemplate } from "../../lib/artifact-templates";

const router = Router();

/**
 * Get all available artifact templates with filtering
 * GET /artifact-templates
 * Query: { artifactType?, category?, platform?, figmaOnly?, search? }
 */
router.get("/artifact-templates", async (req: Request, res: Response) => {
  try {
    const { artifactType, category, platform, figmaOnly, search } = req.query;

    let templates = getTemplateRegistry().templates;

    // Filter by artifact type
    if (artifactType && typeof artifactType === "string") {
      templates = getTemplatesByArtifactType(artifactType as any);
    }

    // Filter by category
    if (category && typeof category === "string" && category !== "all") {
      templates = templates.filter((t) => t.category === category);
    }

    // Filter by platform
    if (platform && typeof platform === "string" && platform !== "all") {
      templates = templates.filter((t) => t.platform === platform);
    }

    // Filter by Figma only
    if (figmaOnly === "true") {
      templates = getFigmaTemplates();
    }

    // Search
    if (search && typeof search === "string") {
      templates = searchTemplates(search);
    }

    res.json({
      ok: true,
      total: templates.length,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        icon: t.icon,
        category: t.category,
        platform: t.platform,
        artifactType: t.artifactType,
        framework: t.framework,
        figmaUrl: t.figmaUrl,
        figmaFileId: t.figmaFileId,
        figmaFileName: t.figmaFileName,
        installCommands: t.installCommands,
        devCommands: t.devCommands,
        preview: t.preview,
        tags: t.tags,
        difficulty: t.difficulty,
        setupTime: t.setupTime,
        author: t.author,
        isFigmaTemplate: t.isFigmaTemplate,
        colors: t.colors,
      })),
      categories: getTemplateRegistry().categories,
      platforms: getTemplateRegistry().platforms,
    });
  } catch (err) {
    console.error("Artifact templates list error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch templates" });
  }
});

/**
 * Get a specific template by ID
 * GET /artifact-templates/:id
 */
router.get("/artifact-templates/:id", async (req: Request, res: Response) => {
  try {
    const templateId = String(req.params.id);
    const template = getTemplate(templateId);

    if (!template) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    res.json({
      ok: true,
      template,
    });
  } catch (err) {
    console.error("Artifact template detail error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch template" });
  }
});

/**
 * Create project from artifact template
 * POST /artifact-templates/create
 * Body: { templateId, projectName, projectId, framework?, settings? }
 */
router.post("/artifact-templates/create", async (req: Request, res: Response) => {
  try {
    const { templateId, projectName, projectId, framework, settings } = req.body;

    if (!templateId || !projectName) {
      return res.status(400).json({ ok: false, error: "templateId and projectName are required" });
    }

    const template = getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    // Override framework if provided
    const finalFramework = framework ?? template.framework;

    // In a real implementation, this would write files to the workspace
    // For now, we return the template structure and artifact config for the orchestrator
    return res.json({
      ok: true,
      projectName,
      projectId: projectId ?? "default",
      template: {
        id: template.id,
        name: template.name,
        artifactType: template.artifactType,
        framework: finalFramework,
        platform: template.platform,
      },
      artifactConfig: {
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        projectId: projectId ?? "default",
        type: template.artifactType,
        name: projectName,
        slug: projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        description: `Generated from template: ${template.name}`,
        framework: finalFramework,
        deployTarget: [template.artifactType === "mobile-app" ? "expo" : "vercel"],
        settings: {
          ...template.files.reduce((acc: Record<string, unknown>, f) => {
            acc[f.path] = f.content;
            return acc;
          }, {}),
          ...settings,
        },
        sharedFoundation: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      templateFiles: template.files,
      installCommands: template.installCommands,
      devCommands: template.devCommands,
    });
  } catch (err) {
    console.error("Artifact template creation error:", err);
    res.status(500).json({ ok: false, error: "Failed to create project from template" });
  }
});

/**
 * Get available artifact types for the template selector
 * GET /artifact-templates/meta/artifact-types
 */
router.get("/artifact-templates/meta/artifact-types", async (req: Request, res: Response) => {
  try {
    const { getAllArtifactTypes } = await import("../../lib/artifact-types");
    const types = getAllArtifactTypes();

    res.json({
      ok: true,
      artifactTypes: types.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        defaultFramework: t.defaultFramework,
        defaultDeployTarget: t.defaultDeployTarget,
        frameworks: t.frameworks,
        deployTargets: t.deployTargets,
        sharedFoundationKeys: t.sharedFoundationKeys,
      })),
    });
  } catch (err) {
    console.error("Artifact types meta error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch artifact types" });
  }
});

export default router;