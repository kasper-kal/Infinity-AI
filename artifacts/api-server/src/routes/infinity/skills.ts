/**
 * Skills API Routes
 * Handles skill definitions, marketplace, project scoping, and agent skill bindings
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { getSkillRegistry, getSkillLoader, getSkillMarketplace, initializeSkillsSystem, applySkillsToPrompt, getCombinedToolPreferences, getCombinedVerificationRules, getCombinedConventions, bindSkillsToAgent, getBoundSkills, unbindSkillsFromAgent, getProjectBindings, type SkillDefinition, type SkillToolPreference, type SkillVerificationRule, type SkillConvention, type AgentSkillBinding } from "../../lib/build-skills";
import { getWorkspaceRoot, safeWorkspacePath } from "../../lib/workspace";
import { promises as fs } from "node:fs";
import path from "node:path";

const router = Router();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const SkillDefinitionSchema = z.object({
  metadata: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string(),
    category: z.enum(["frontend", "backend", "database", "devops", "security", "performance", "debugging", "testing", "documentation", "architecture"]),
    author: z.string().optional(),
    license: z.string().default("MIT"),
    tags: z.array(z.string()).default([]),
    minInfinityVersion: z.string().optional(),
    dependencies: z.array(z.string()).default([]),
  }),
  instructions: z.string(),
  toolPreferences: z.array(z.object({
    name: z.string(),
    priority: z.enum(["required", "preferred", "discouraged", "forbidden"]),
    reason: z.string().optional(),
  })).default([]),
  verificationRules: z.array(z.object({
    name: z.string(),
    description: z.string(),
    check: z.enum(["always", "on-completion", "on-error", "manual"]),
    autoFix: z.boolean().default(false),
    fixPrompt: z.string().optional(),
  })).default([]),
  conventions: z.array(z.object({
    name: z.string(),
    description: z.string(),
    pattern: z.string().optional(),
    severity: z.enum(["error", "warning", "info"]).default("warning"),
  })).default([]),
  environment: z.object({
    requiredTools: z.array(z.string()).default([]),
    requiredPackages: z.array(z.string()).default([]),
    setupCommands: z.array(z.string()).default([]),
  }).default({}),
  roleBindings: z.array(z.enum(["planner", "coder", "reviewer", "fixer", "diagnostic", "human"])).default([]),
  extends: z.string().optional(),
});

const BindSkillsSchema = z.object({
  agentRole: z.enum(["planner", "coder", "reviewer", "fixer", "diagnostic"]),
  skillIds: z.array(z.string()),
  projectId: z.string(),
  priority: z.number().default(0),
  enabled: z.boolean().default(true),
});

const CustomInstructionsSchema = z.object({
  projectId: z.string(),
  instructions: z.string(),
  appendToSystemPrompt: z.boolean().default(true),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getProjectId(req: Request): string {
  // Extract projectId from query, body, or headers
  return (req.query.projectId as string) || (req.body?.projectId as string) || (req.headers["x-project-id"] as string) || "default";
}

async function getProjectSkillsDir(projectId: string): Promise<string | null> {
  const workspaceRoot = getWorkspaceRoot(projectId);
  const skillsDir = path.join(workspaceRoot, ".infinity", "skills");
  try {
    await fs.mkdir(skillsDir, { recursive: true });
    return skillsDir;
  } catch {
    return null;
  }
}

async function getProjectCustomInstructionsPath(projectId: string): Promise<string> {
  const workspaceRoot = getWorkspaceRoot(projectId);
  return path.join(workspaceRoot, ".infinity", "custom-instructions.md");
}

// ============================================================================
// SKILL CRUD ENDPOINTS
// ============================================================================

/**
 * GET /api/infinity/skills
 * List all skills with optional filtering
 */
router.get("/skills", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const registry = getSkillRegistry();
    const loader = getSkillLoader();

    // Initialize skills system if not already done
    await initializeSkillsSystem(projectId);

    const filter = {
      category: req.query.category as string,
      tags: (req.query.tags as string)?.split(","),
      role: req.query.role as string,
      query: req.query.query as string,
      source: req.query.source as "builtin" | "project" | "user" | "imported",
      projectId: req.query.projectId === "all" ? undefined : projectId,
    };

    const skills = registry.discover(filter);
    const stats = registry.getStats();

    res.json({
      skills,
      stats,
      total: skills.length,
    });
  } catch (error) {
    console.error("Error listing skills:", error);
    res.status(500).json({ error: "Failed to list skills" });
  }
});

/**
 * GET /api/infinity/skills/:id
 * Get a specific skill by ID
 */
router.get("/skills/:id", async (req: Request, res: Response) => {
  try {
    const registry = getSkillRegistry();
    const skill = registry.get(req.params.id);

    if (!skill) {
      return res.status(404).json({ error: "Skill not found" });
    }

    res.json({ skill });
  } catch (error) {
    console.error("Error getting skill:", error);
    res.status(500).json({ error: "Failed to get skill" });
  }
});

/**
 * POST /api/infinity/skills
 * Create a new skill (project-scoped)
 */
router.post("/skills", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const parsed = SkillDefinitionSchema.parse(req.body);

    const registry = getSkillRegistry();
    const loader = getSkillLoader();

    // Initialize skills system
    await initializeSkillsSystem(projectId);

    // Resolve inheritance and register
    const resolved = await loader.resolveSkill(parsed);
    loader["registry"].register(resolved, "project", projectId);

    // Save to project skills directory
    const skillsDir = await getProjectSkillsDir(projectId);
    if (skillsDir) {
      const filePath = path.join(skillsDir, `${parsed.metadata.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(parsed, null, 2));
    }

    res.status(201).json({ skill: resolved });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid skill definition", details: error.errors });
    }
    console.error("Error creating skill:", error);
    res.status(500).json({ error: "Failed to create skill" });
  }
});

/**
 * PUT /api/infinity/skills/:id
 * Update an existing skill
 */
router.put("/skills/:id", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const skillId = req.params.id;
    const parsed = SkillDefinitionSchema.parse(req.body);

    if (parsed.metadata.id !== skillId) {
      return res.status(400).json({ error: "Skill ID mismatch" });
    }

    const registry = getSkillRegistry();
    const existing = registry.get(skillId);

    if (!existing) {
      return res.status(404).json({ error: "Skill not found" });
    }

    // Check if skill is project-scoped (can't modify builtins)
    const entry = (registry as any).skills?.get(skillId);
    if (entry?.source === "builtin") {
      return res.status(403).json({ error: "Cannot modify built-in skills" });
    }

    const loader = getSkillLoader();
    const resolved = await loader.resolveSkill(parsed);
    loader["registry"].register(resolved, "project", projectId);

    // Save to project skills directory
    const skillsDir = await getProjectSkillsDir(projectId);
    if (skillsDir) {
      const filePath = path.join(skillsDir, `${skillId}.json`);
      await fs.writeFile(filePath, JSON.stringify(parsed, null, 2));
    }

    res.json({ skill: resolved });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid skill definition", details: error.errors });
    }
    console.error("Error updating skill:", error);
    res.status(500).json({ error: "Failed to update skill" });
  }
});

/**
 * DELETE /api/infinity/skills/:id
 * Delete a skill (project-scoped only)
 */
router.delete("/skills/:id", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const skillId = req.params.id;

    const registry = getSkillRegistry();
    const entry = (registry as any).skills?.get(skillId);

    if (!entry) {
      return res.status(404).json({ error: "Skill not found" });
    }

    if (entry.source === "builtin") {
      return res.status(403).json({ error: "Cannot delete built-in skills" });
    }

    if (entry.projectId !== projectId) {
      return res.status(403).json({ error: "Cannot delete skills from other projects" });
    }

    registry.unregister(skillId);

    // Delete from project skills directory
    const skillsDir = await getProjectSkillsDir(projectId);
    if (skillsDir) {
      const filePath = path.join(skillsDir, `${skillId}.json`);
      try {
        await fs.unlink(filePath);
      } catch {
        // File might not exist
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting skill:", error);
    res.status(500).json({ error: "Failed to delete skill" });
  }
});

/**
 * POST /api/infinity/skills/initialize
 * Initialize skills system for a project
 */
router.post("/skills/initialize", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    await initializeSkillsSystem(projectId);

    const registry = getSkillRegistry();
    const stats = registry.getStats();

    res.json({ success: true, stats });
  } catch (error) {
    console.error("Error initializing skills:", error);
    res.status(500).json({ error: "Failed to initialize skills system" });
  }
});

/**
 * GET /api/infinity/skills/project/:projectId
 * Get all skills available for a project (builtin + project)
 */
router.get("/skills/project/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const registry = getSkillRegistry();
    await initializeSkillsSystem(projectId);

    const skills = registry.getForProject(projectId);
    const stats = registry.getStats();

    res.json({ skills, stats });
  } catch (error) {
    console.error("Error getting project skills:", error);
    res.status(500).json({ error: "Failed to get project skills" });
  }
});

// ============================================================================
// AGENT SKILL BINDING ENDPOINTS
// ============================================================================

/**
 * POST /api/infinity/skills/bind
 * Bind skills to an agent role for a project
 */
router.post("/skills/bind", async (req: Request, res: Response) => {
  try {
    const parsed = BindSkillsSchema.parse(req.body);
    bindSkillsToAgent(parsed);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid bind request", details: error.errors });
    }
    console.error("Error binding skills:", error);
    res.status(500).json({ error: "Failed to bind skills" });
  }
});

/**
 * GET /api/infinity/skills/bind/:projectId/:agentRole
 * Get skills bound to an agent role for a project
 */
router.get("/skills/bind/:projectId/:agentRole", async (req: Request, res: Response) => {
  try {
    const { projectId, agentRole } = req.params;
    const skillIds = getBoundSkills(projectId, agentRole as AgentSkillBinding["agentRole"]);

    const registry = getSkillRegistry();
    const skills = skillIds.map(id => registry.get(id)).filter(Boolean);

    res.json({ skillIds, skills });
  } catch (error) {
    console.error("Error getting bound skills:", error);
    res.status(500).json({ error: "Failed to get bound skills" });
  }
});

/**
 * DELETE /api/infinity/skills/bind/:projectId/:agentRole
 * Unbind skills from an agent role for a project
 */
router.delete("/skills/bind/:projectId/:agentRole", async (req: Request, res: Response) => {
  try {
    const { projectId, agentRole } = req.params;
    unbindSkillsFromAgent(projectId, agentRole as AgentSkillBinding["agentRole"]);

    res.json({ success: true });
  } catch (error) {
    console.error("Error unbinding skills:", error);
    res.status(500).json({ error: "Failed to unbind skills" });
  }
});

/**
 * GET /api/infinity/skills/bindings/:projectId
 * Get all skill bindings for a project
 */
router.get("/skills/bindings/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const bindings = getProjectBindings(projectId);

    res.json({ bindings });
  } catch (error) {
    console.error("Error getting project bindings:", error);
    res.status(500).json({ error: "Failed to get project bindings" });
  }
});

// ============================================================================
// SKILL APPLICATION ENDPOINTS
// ============================================================================

/**
 * POST /api/infinity/skills/apply
 * Apply skills to a base prompt (for agent system prompts)
 */
router.post("/skills/apply", async (req: Request, res: Response) => {
  try {
    const { basePrompt, skillIds, projectId } = req.body;

    if (!basePrompt || !skillIds || !Array.isArray(skillIds)) {
      return res.status(400).json({ error: "basePrompt and skillIds array required" });
    }

    const registry = getSkillRegistry();
    await initializeSkillsSystem(projectId);

    const prompt = applySkillsToPrompt(basePrompt, skillIds, registry);
    const toolPreferences = getCombinedToolPreferences(skillIds, registry);
    const verificationRules = getCombinedVerificationRules(skillIds, registry);
    const conventions = getCombinedConventions(skillIds, registry);

    res.json({
      prompt,
      toolPreferences,
      verificationRules,
      conventions,
    });
  } catch (error) {
    console.error("Error applying skills:", error);
    res.status(500).json({ error: "Failed to apply skills" });
  }
});

/**
 * GET /api/infinity/skills/combined/:projectId/:agentRole
 * Get combined skill config for an agent role in a project
 */
router.get("/skills/combined/:projectId/:agentRole", async (req: Request, res: Response) => {
  try {
    const { projectId, agentRole } = req.params;
    const registry = getSkillRegistry();
    await initializeSkillsSystem(projectId);

    const skillIds = getBoundSkills(projectId, agentRole as AgentSkillBinding["agentRole"]);
    const skills = skillIds.map(id => registry.get(id)).filter(Boolean);

    const toolPreferences = getCombinedToolPreferences(skillIds, registry);
    const verificationRules = getCombinedVerificationRules(skillIds, registry);
    const conventions = getCombinedConventions(skillIds, registry);

    res.json({
      skillIds,
      skills,
      toolPreferences,
      verificationRules,
      conventions,
    });
  } catch (error) {
    console.error("Error getting combined skills:", error);
    res.status(500).json({ error: "Failed to get combined skills" });
  }
});

// ============================================================================
// CUSTOM INSTRUCTIONS ENDPOINTS
// ============================================================================

/**
 * GET /api/infinity/skills/custom-instructions/:projectId
 * Get custom instructions for a project
 */
router.get("/skills/custom-instructions/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const filePath = await getProjectCustomInstructionsPath(projectId);

    try {
      const instructions = await fs.readFile(filePath, "utf-8");
      res.json({ instructions });
    } catch {
      res.json({ instructions: "" });
    }
  } catch (error) {
    console.error("Error getting custom instructions:", error);
    res.status(500).json({ error: "Failed to get custom instructions" });
  }
});

/**
 * PUT /api/infinity/skills/custom-instructions/:projectId
 * Set custom instructions for a project
 */
router.put("/skills/custom-instructions/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { instructions, appendToSystemPrompt } = CustomInstructionsSchema.parse(req.body);

    const filePath = await getProjectCustomInstructionsPath(projectId);
    await fs.writeFile(filePath, instructions, "utf-8");

    res.json({ success: true, instructions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("Error setting custom instructions:", error);
    res.status(500).json({ error: "Failed to set custom instructions" });
  }
});

/**
 * DELETE /api/infinity/skills/custom-instructions/:projectId
 * Delete custom instructions for a project
 */
router.delete("/skills/custom-instructions/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const filePath = await getProjectCustomInstructionsPath(projectId);

    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting custom instructions:", error);
    res.status(500).json({ error: "Failed to delete custom instructions" });
  }
});

// ============================================================================
// SKILL MARKETPLACE ENDPOINTS
// ============================================================================

/**
 * GET /api/infinity/skills/marketplace
 * Search/list marketplace packages
 */
router.get("/skills/marketplace", async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || "";
    const marketplace = getSkillMarketplace();
    const packages = marketplace.search(query);

    res.json({ packages, total: packages.length });
  } catch (error) {
    console.error("Error searching marketplace:", error);
    res.status(500).json({ error: "Failed to search marketplace" });
  }
});

/**
 * GET /api/infinity/skills/marketplace/:skillId
 * Get a specific marketplace package
 */
router.get("/skills/marketplace/:skillId", async (req: Request, res: Response) => {
  try {
    const marketplace = getSkillMarketplace();
    const packages = marketplace.getPackages();
    const pkg = packages.find(p => p.skill.metadata.id === req.params.skillId);

    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }

    res.json({ package: pkg });
  } catch (error) {
    console.error("Error getting marketplace package:", error);
    res.status(500).json({ error: "Failed to get package" });
  }
});

/**
 * POST /api/infinity/skills/marketplace/install
 * Install a skill from local package path
 */
router.post("/skills/marketplace/install", async (req: Request, res: Response) => {
  try {
    const { packagePath, projectId } = req.body;

    if (!packagePath) {
      return res.status(400).json({ error: "packagePath required" });
    }

    const marketplace = getSkillMarketplace();
    const pkg = await marketplace.installFromLocal(packagePath);

    if (!pkg) {
      return res.status(400).json({ error: "Failed to install package" });
    }

    // If projectId provided, also register in project
    if (projectId) {
      const registry = getSkillRegistry();
      const loader = getSkillLoader();
      await initializeSkillsSystem(projectId);
      loader["registry"].register(pkg.skill, "imported", projectId);
    }

    res.json({ package: pkg });
  } catch (error) {
    console.error("Error installing package:", error);
    res.status(500).json({ error: "Failed to install package" });
  }
});

/**
 * POST /api/infinity/skills/marketplace/publish
 * Publish a skill to local marketplace
 */
router.post("/skills/marketplace/publish", async (req: Request, res: Response) => {
  try {
    const { skill, outputDir } = req.body;

    if (!skill || !outputDir) {
      return res.status(400).json({ error: "skill and outputDir required" });
    }

    const parsed = SkillDefinitionSchema.parse(skill);
    const marketplace = getSkillMarketplace();
    await marketplace.publishLocally(parsed, outputDir);

    res.json({ success: true, outputDir });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid skill definition", details: error.errors });
    }
    console.error("Error publishing skill:", error);
    res.status(500).json({ error: "Failed to publish skill" });
  }
});

// ============================================================================
// SKILL TEMPLATES / BUILT-INS
// ============================================================================

/**
 * GET /api/infinity/skills/templates
 * Get available skill templates (built-in skills)
 */
router.get("/skills/templates", async (req: Request, res: Response) => {
  try {
    const registry = getSkillRegistry();
    await initializeSkillsSystem();

    const builtins = registry.discover({ source: "builtin" });

    // Group by category
    const templates = builtins.map(skill => ({
      id: skill.metadata.id,
      name: skill.metadata.name,
      description: skill.metadata.description,
      category: skill.metadata.category,
      tags: skill.metadata.tags,
      version: skill.metadata.version,
    }));

    res.json({ templates });
  } catch (error) {
    console.error("Error getting templates:", error);
    res.status(500).json({ error: "Failed to get templates" });
  }
});

/**
 * POST /api/infinity/skills/from-template
 * Create a skill from a template
 */
router.post("/skills/from-template", async (req: Request, res: Response) => {
  try {
    const { templateId, projectId, customizations } = req.body;

    if (!templateId || !projectId) {
      return res.status(400).json({ error: "templateId and projectId required" });
    }

    const registry = getSkillRegistry();
    await initializeSkillsSystem(projectId);

    const template = registry.get(templateId);
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    // Create new skill based on template with customizations
    const newSkill: SkillDefinition = {
      ...template,
      metadata: {
        ...template.metadata,
        id: customizations?.id || `${template.metadata.id}-custom-${Date.now()}`,
        name: customizations?.name || `${template.metadata.name} (Custom)`,
        description: customizations?.description || template.metadata.description,
        author: customizations?.author,
      },
      instructions: customizations?.instructions || template.instructions,
      toolPreferences: customizations?.toolPreferences || template.toolPreferences,
      verificationRules: customizations?.verificationRules || template.verificationRules,
      conventions: customizations?.conventions || template.conventions,
      environment: customizations?.environment || template.environment,
      roleBindings: customizations?.roleBindings || template.roleBindings,
      extends: template.metadata.id, // Extends the template
    };

    const loader = getSkillLoader();
    const resolved = await loader.resolveSkill(newSkill);
    loader["registry"].register(resolved, "project", projectId);

    // Save to project skills directory
    const skillsDir = await getProjectSkillsDir(projectId);
    if (skillsDir) {
      const filePath = path.join(skillsDir, `${newSkill.metadata.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(newSkill, null, 2));
    }

    res.status(201).json({ skill: resolved });
  } catch (error) {
    console.error("Error creating skill from template:", error);
    res.status(500).json({ error: "Failed to create skill from template" });
  }
});

// ============================================================================
// SKILL ANALYTICS ENDPOINTS
// ============================================================================

/**
 * GET /api/infinity/skills/analytics/:projectId
 * Get skill usage analytics for a project
 */
router.get("/skills/analytics/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const registry = getSkillRegistry();
    await initializeSkillsSystem(projectId);

    const bindings = getProjectBindings(projectId);
    const skills = registry.getForProject(projectId);

    // Mock analytics data - in production this would come from telemetry
    const analytics = {
      totalSkills: skills.length,
      byCategory: skills.reduce((acc, s) => {
        acc[s.metadata.category] = (acc[s.metadata.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byRole: bindings.reduce((acc, b) => {
        acc[b.agentRole] = (acc[b.agentRole] || 0) + b.skillIds.length;
        return acc;
      }, {} as Record<string, number>),
      mostUsed: skills.slice(0, 5).map(s => ({
        id: s.metadata.id,
        name: s.metadata.name,
        usageCount: Math.floor(Math.random() * 100), // Mock
      })),
      totalInvocations: Math.floor(Math.random() * 10000),
      averageSuccessRate: 0.85 + Math.random() * 0.1,
      averageTokenCost: Math.floor(Math.random() * 5000),
    };

    res.json({ analytics });
  } catch (error) {
    console.error("Error getting skill analytics:", error);
    res.status(500).json({ error: "Failed to get skill analytics" });
  }
});

export default router;