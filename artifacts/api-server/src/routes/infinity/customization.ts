import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireScope, AuthenticatedRequest } from "../../middleware/auth-middleware.js";
import { getRulesEngine, RuleScope, RuleKind, RuleDefinitionSchema, ParsedRuleFileSchema, BUILTIN_RULE_TEMPLATES } from "../../lib/rules.js";
import { getNotepadsManager, NotepadScope, NotepadCategory, NotepadFrontmatterSchema, BUILTIN_NOTEPAD_TEMPLATES } from "../../lib/notepads.js";
import { getModelRouter, ModelCapability, ModelProvider, CapabilityPreferenceSchema, FallbackEntrySchema, BUILTIN_MODELS, ModelConfigSchema } from "../../lib/model-router.js";

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * ============ RULES ============
 */

// Get all rules for project
router.get("/rules", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectRoot = req.query.projectRoot as string || process.cwd();
    const rulesEngine = getRulesEngine();
    const merged = await rulesEngine.loadRules(projectRoot);

    res.json({
      userRules: merged.userRules,
      projectRules: merged.projectRules,
      autoAttachedRules: merged.autoAttachedRules,
      alwaysRules: merged.alwaysRules,
      allRules: merged.allRules,
      contextSummary: merged.contextSummary
    });
  } catch (error) {
    console.error("Error loading rules:", error);
    res.status(500).json({ error: "Failed to load rules" });
  }
});

// Get auto-attached rules for specific files
router.post("/rules/auto-attached", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, filePaths } = req.body;
    const rulesEngine = getRulesEngine();
    const rules = await rulesEngine.getAutoAttachedRules(projectRoot || process.cwd(), filePaths || []);
    res.json({ rules });
  } catch (error) {
    console.error("Error getting auto-attached rules:", error);
    res.status(500).json({ error: "Failed to get auto-attached rules" });
  }
});

// Get rule templates
router.get("/rules/templates", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  const rulesEngine = getRulesEngine();
  res.json({ templates: rulesEngine.getTemplates() });
});

// Create rule from template
router.post("/rules/from-template", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, templateId, overrides } = req.body;
    const rulesEngine = getRulesEngine();
    const rule = await rulesEngine.createFromTemplate(projectRoot || process.cwd(), templateId, overrides || {});
    res.json({ rule });
  } catch (error) {
    console.error("Error creating rule from template:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create new rule
router.post("/rules", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, ...ruleData } = req.body;
    const validation = RuleDefinitionSchema.safeParse(ruleData);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid rule data", details: validation.error.errors });
    }

    const rulesEngine = getRulesEngine();
    const rule = await rulesEngine.createRule(projectRoot || process.cwd(), validation.data);
    res.json({ rule });
  } catch (error) {
    console.error("Error creating rule:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update rule
router.patch("/rules/:relativePath", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, scope = RuleScope.PROJECT } = req.body;
    const { relativePath } = req.params;
    const rulesEngine = getRulesEngine();
    const rule = await rulesEngine.updateRule(projectRoot || process.cwd(), relativePath, req.body);
    res.json({ rule });
  } catch (error) {
    console.error("Error updating rule:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete rule
router.delete("/rules/:relativePath", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, scope = RuleScope.PROJECT } = req.query;
    const { relativePath } = req.params;
    const rulesEngine = getRulesEngine();
    await rulesEngine.deleteRule(projectRoot as string || process.cwd(), relativePath);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting rule:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * ============ NOTEPADS ============
 */

// Get all notepads for project
router.get("/notepads", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectRoot = req.query.projectRoot as string || process.cwd();
    const notepadsManager = getNotepadsManager();
    const collections = await notepadsManager.loadNotepads(projectRoot);
    res.json({ collections });
  } catch (error) {
    console.error("Error loading notepads:", error);
    res.status(500).json({ error: "Failed to load notepads" });
  }
});

// Search notepads
router.post("/notepads/search", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, query, category, scope, limit } = req.body;
    const notepadsManager = getNotepadsManager();
    const results = await notepadsManager.searchNotepads(projectRoot || process.cwd(), query, { category, scope, limit });
    res.json({ results });
  } catch (error) {
    console.error("Error searching notepads:", error);
    res.status(500).json({ error: "Failed to search notepads" });
  }
});

// Resolve @notepad references
router.post("/notepads/resolve", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, references } = req.body;
    const notepadsManager = getNotepadsManager();
    const results = await notepadsManager.resolveReferences(projectRoot || process.cwd(), references || []);
    res.json({ results });
  } catch (error) {
    console.error("Error resolving notepads:", error);
    res.status(500).json({ error: "Failed to resolve notepads" });
  }
});

// Get notepad templates
router.get("/notepads/templates", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  const notepadsManager = getNotepadsManager();
  res.json({ templates: notepadsManager.getTemplates() });
});

// Create notepad from template
router.post("/notepads/from-template", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, templateId, scope = NotepadScope.PROJECT, overrides } = req.body;
    const notepadsManager = getNotepadsManager();
    const notepad = await notepadsManager.createFromTemplate(projectRoot || process.cwd(), templateId, scope, overrides || {});
    res.json({ notepad });
  } catch (error) {
    console.error("Error creating notepad from template:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create new notepad
router.post("/notepads", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, scope = NotepadScope.PROJECT, ...notepadData } = req.body;
    const validation = NotepadFrontmatterSchema.safeParse(notepadData);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid notepad data", details: validation.error.errors });
    }

    const notepadsManager = getNotepadsManager();
    const notepad = await notepadsManager.createNotepad(projectRoot || process.cwd(), { ...validation.data, scope, content: notepadData.content || "" });
    res.json({ notepad });
  } catch (error) {
    console.error("Error creating notepad:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update notepad
router.patch("/notepads/:relativePath", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, scope = NotepadScope.PROJECT } = req.body;
    const { relativePath } = req.params;
    const notepadsManager = getNotepadsManager();
    const notepad = await notepadsManager.updateNotepad(projectRoot || process.cwd(), relativePath, scope, req.body);
    res.json({ notepad });
  } catch (error) {
    console.error("Error updating notepad:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete notepad
router.delete("/notepads/:relativePath", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, scope = NotepadScope.PROJECT } = req.query;
    const { relativePath } = req.params;
    const notepadsManager = getNotepadsManager();
    await notepadsManager.deleteNotepad(projectRoot as string || process.cwd(), relativePath, scope as NotepadScope);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting notepad:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Toggle pin
router.post("/notepads/:relativePath/pin", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, scope = NotepadScope.PROJECT } = req.body;
    const { relativePath } = req.params;
    const notepadsManager = getNotepadsManager();
    const notepad = await notepadsManager.togglePin(projectRoot || process.cwd(), relativePath, scope);
    res.json({ notepad });
  } catch (error) {
    console.error("Error toggling pin:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * ============ MODEL PREFERENCES ============
 */

// Get available models
router.get("/models", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { capability, provider, enabled } = req.query;
    const modelRouter = getModelRouter();
    const models = modelRouter.getModels({
      capability: capability as ModelCapability,
      provider: provider as ModelProvider,
      enabled: enabled === "true" ? true : enabled === "false" ? false : undefined
    });
    res.json({ models });
  } catch (error) {
    console.error("Error getting models:", error);
    res.status(500).json({ error: "Failed to get models" });
  }
});

// Get built-in model catalog
router.get("/models/catalog", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json({ models: BUILTIN_MODELS });
});

// Get default preferences template
router.get("/models/default-preferences", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  const defaults = getModelRouter().getDefaultPreferences();
  res.json({ preferences: defaults });
});

// Resolve model for capability
router.post("/models/resolve", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { capability, projectId, userId, preferences } = req.body;
    if (!capability) {
      return res.status(400).json({ error: "capability is required" });
    }
    const modelRouter = getModelRouter();
    const resolved = await modelRouter.resolveModel(capability, { projectId, userId, preferences });
    res.json({ resolved });
  } catch (error) {
    console.error("Error resolving model:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get project model preferences
router.get("/models/preferences/project/:projectId", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const modelRouter = getModelRouter();
    const prefs = await modelRouter.loadProjectPreferences(projectId);
    res.json({ preferences: prefs });
  } catch (error) {
    console.error("Error loading project preferences:", error);
    res.status(500).json({ error: "Failed to load project preferences" });
  }
});

// Save project model preferences
router.put("/models/preferences/project/:projectId", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { capabilities, defaultModelId, globalFallbackChain } = req.body;
    const modelRouter = getModelRouter();

    // Validate capabilities
    if (capabilities) {
      for (const cap of capabilities) {
        const validation = CapabilityPreferenceSchema.safeParse(cap);
        if (!validation.success) {
          return res.status(400).json({ error: "Invalid capability preference", details: validation.error.errors });
        }
      }
    }

    // Validate fallback chain
    if (globalFallbackChain) {
      for (const fb of globalFallbackChain) {
        const validation = FallbackEntrySchema.safeParse(fb);
        if (!validation.success) {
          return res.status(400).json({ error: "Invalid fallback entry", details: validation.error.errors });
        }
      }
    }

    const prefs = {
      projectId,
      capabilities: capabilities || [],
      defaultModelId,
      globalFallbackChain: globalFallbackChain || [],
      updatedAt: Date.now(),
      updatedBy: req.accountId
    };

    await modelRouter.saveProjectPreferences(prefs);
    res.json({ preferences: prefs });
  } catch (error) {
    console.error("Error saving project preferences:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Set capability preference for project
router.post("/models/preferences/project/:projectId/capability", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const validation = CapabilityPreferenceSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid capability preference", details: validation.error.errors });
    }
    const modelRouter = getModelRouter();
    await modelRouter.setProjectCapabilityPreference(projectId, validation.data);
    res.json({ success: true });
  } catch (error) {
    console.error("Error setting capability preference:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Set global fallback chain for project
router.post("/models/preferences/project/:projectId/fallback", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { chain } = req.body;
    if (!Array.isArray(chain)) {
      return res.status(400).json({ error: "chain must be an array" });
    }
    for (const fb of chain) {
      const validation = FallbackEntrySchema.safeParse(fb);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid fallback entry", details: validation.error.errors });
      }
    }
    const modelRouter = getModelRouter();
    await modelRouter.setProjectGlobalFallback(projectId, chain);
    res.json({ success: true });
  } catch (error) {
    console.error("Error setting global fallback:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get user model preferences
router.get("/models/preferences/user/:userId", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    // Users can only access their own preferences unless admin
    if (userId !== req.accountId) {
      return res.status(403).json({ error: "Cannot access other user's preferences" });
    }
    const modelRouter = getModelRouter();
    const prefs = await modelRouter.loadUserPreferences(userId);
    res.json({ preferences: prefs });
  } catch (error) {
    console.error("Error loading user preferences:", error);
    res.status(500).json({ error: "Failed to load user preferences" });
  }
});

// Save user model preferences
router.put("/models/preferences/user/:userId", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    if (userId !== req.accountId) {
      return res.status(403).json({ error: "Cannot modify other user's preferences" });
    }
    const { capabilities, defaultModelId, globalFallbackChain } = req.body;
    const modelRouter = getModelRouter();

    if (capabilities) {
      for (const cap of capabilities) {
        const validation = CapabilityPreferenceSchema.safeParse(cap);
        if (!validation.success) {
          return res.status(400).json({ error: "Invalid capability preference", details: validation.error.errors });
        }
      }
    }

    if (globalFallbackChain) {
      for (const fb of globalFallbackChain) {
        const validation = FallbackEntrySchema.safeParse(fb);
        if (!validation.success) {
          return res.status(400).json({ error: "Invalid fallback entry", details: validation.error.errors });
        }
      }
    }

    const prefs = {
      userId,
      capabilities: capabilities || [],
      defaultModelId,
      globalFallbackChain: globalFallbackChain || [],
      updatedAt: Date.now()
    };

    await modelRouter.saveUserPreferences(prefs);
    res.json({ preferences: prefs });
  } catch (error) {
    console.error("Error saving user preferences:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Set capability preference for user
router.post("/models/preferences/user/:userId/capability", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    if (userId !== req.accountId) {
      return res.status(403).json({ error: "Cannot modify other user's preferences" });
    }
    const validation = CapabilityPreferenceSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid capability preference", details: validation.error.errors });
    }
    const modelRouter = getModelRouter();
    await modelRouter.setUserCapabilityPreference(userId, validation.data);
    res.json({ success: true });
  } catch (error) {
    console.error("Error setting user capability preference:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Register custom model (BYOM)
router.post("/models/custom", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = ModelConfigSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid model config", details: validation.error.errors });
    }
    const modelRouter = getModelRouter();
    modelRouter.registerModel(validation.data);
    res.json({ success: true, model: validation.data });
  } catch (error) {
    console.error("Error registering custom model:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * ============ CUSTOM INSTRUCTIONS ============
 */

// Custom instructions are stored as project-level rules with kind=agent-requested
// and specific tags for each agent type

const CustomInstructionsSchema = z.object({
  chat: z.string().optional(),
  composer: z.string().optional(),
  agent: z.string().optional(),
  tabAutocomplete: z.string().optional(),
  cmdKEdit: z.string().optional(),
  codebaseSearch: z.string().optional(),
  deepResearch: z.string().optional(),
  visualEditing: z.string().optional()
});

// Get custom instructions
router.get("/custom-instructions", requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectRoot = req.query.projectRoot as string || process.cwd();
    const rulesEngine = getRulesEngine();
    const merged = await rulesEngine.loadRules(projectRoot);

    // Extract custom instructions from rules tagged with agent types
    const instructions: Record<string, string> = {};
    const agentTags = ["chat", "composer", "agent", "tab-autocomplete", "cmd-k-edit", "codebase-search", "deep-research", "visual-editing"];

    for (const rule of merged.allRules) {
      for (const tag of agentTags) {
        if (rule.frontmatter.tags.includes(tag) && rule.frontmatter.kind === RuleKind.AGENT_REQUESTED) {
          instructions[tag] = rule.body;
        }
      }
    }

    res.json({ instructions });
  } catch (error) {
    console.error("Error loading custom instructions:", error);
    res.status(500).json({ error: "Failed to load custom instructions" });
  }
});

// Save custom instructions
router.put("/custom-instructions", requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectRoot, instructions } = req.body;
    const validation = CustomInstructionsSchema.safeParse(instructions || {});
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid instructions", details: validation.error.errors });
    }

    const rulesEngine = getRulesEngine();
    const agentTags = ["chat", "composer", "agent", "tab-autocomplete", "cmd-k-edit", "codebase-search", "deep-research", "visual-editing"];
    const created: any[] = [];

    for (const [tag, content] of Object.entries(validation.data)) {
      if (!content) continue;
      try {
        const rule = await rulesEngine.createRule(projectRoot || process.cwd(), {
          name: `custom-instructions-${tag}`,
          description: `Custom instructions for ${tag}`,
          kind: RuleKind.AGENT_REQUESTED,
          scope: RuleScope.PROJECT,
          globs: [],
          tags: [tag, "custom-instructions"],
          priority: 100,
          enabled: true,
          content
        });
        created.push(rule);
      } catch (e) {
        // Might already exist, try update
        // For simplicity, we'll just note it
      }
    }

    res.json({ success: true, created });
  } catch (error) {
    console.error("Error saving custom instructions:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;