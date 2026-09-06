import { Router, Request, Response } from "express";
import { getModelRouter } from "../../lib/model-router";
import { requireAuth, AuthenticatedRequest } from "../../middleware/auth-middleware";
import { storage } from "../../storage";

const router = Router();
const modelRouter = getModelRouter();

/**
 * GET /api/infinity-ai/llm-keys
 * Get all LLM keys for the authenticated user
 */
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const keys = await storage.getLLMKeys(userId);
    // Never return encrypted keys
    const safeKeys = keys.map(key => ({
      ...key,
      encryptedKey: undefined,
      // Mask key for display
      maskedKey: key.encryptedKey ? `${key.provider.toUpperCase()}_****${key.encryptedKey.slice(-4)}` : undefined,
    }));
    res.json(safeKeys);
  } catch (error) {
    console.error("Failed to get LLM keys:", error);
    res.status(500).json({ error: "Failed to get LLM keys" });
  }
});

/**
 * POST /api/infinity-ai/llm-keys
 * Create a new LLM key
 */
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const { label, provider, encryptedKey, modelAccess, rateLimit, budget, isDefault, failoverChain } = req.body;

    if (!label || !provider || !encryptedKey) {
      return res.status(400).json({ error: "label, provider, and encryptedKey are required" });
    }

    // Validate provider
    const validProviders = ["openai", "anthropic", "google", "ollama", "openrouter", "lmstudio", "custom"];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }

    // Validate model access against known models
    if (modelAccess && Array.isArray(modelAccess)) {
      const knownModels = modelRouter.getModels({ enabled: true }).map(m => m.id);
      const invalidModels = modelAccess.filter((m: string) => !knownModels.includes(m));
      if (invalidModels.length > 0) {
        return res.status(400).json({ error: `Unknown models: ${invalidModels.join(", ")}` });
      }
    }

    const key = await storage.createLLMKey({
      userId,
      label,
      provider,
      encryptedKey,
      modelAccess: modelAccess || [],
      rateLimit: rateLimit || { requestsPerMinute: 60, tokensPerMinute: 100000 },
      budget: budget || { monthlyLimit: 100, alertThresholds: [0.5, 0.8, 0.95] },
      isDefault: isDefault || false,
      failoverChain: failoverChain || [],
      isActive: true,
    });

    res.status(201).json({
      ...key,
      encryptedKey: undefined,
      maskedKey: `${provider.toUpperCase()}_****${encryptedKey.slice(-4)}`,
    });
  } catch (error) {
    console.error("Failed to create LLM key:", error);
    res.status(500).json({ error: "Failed to create LLM key" });
  }
});

/**
 * GET /api/infinity-ai/llm-keys/:keyId
 * Get a specific LLM key
 */
router.get("/:keyId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const key = await storage.getLLMKey(req.params.keyId);

    if (!key || key.userId !== userId) {
      return res.status(404).json({ error: "LLM key not found" });
    }

    res.json({
      ...key,
      encryptedKey: undefined,
      maskedKey: `${key.provider.toUpperCase()}_****${key.encryptedKey.slice(-4)}`,
    });
  } catch (error) {
    console.error("Failed to get LLM key:", error);
    res.status(500).json({ error: "Failed to get LLM key" });
  }
});

/**
 * PATCH /api/infinity-ai/llm-keys/:keyId
 * Update an LLM key
 */
router.patch("/:keyId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const key = await storage.getLLMKey(req.params.keyId);

    if (!key || key.userId !== userId) {
      return res.status(404).json({ error: "LLM key not found" });
    }

    const { label, modelAccess, rateLimit, budget, isDefault, failoverChain, isActive } = req.body;

    // Validate model access if provided
    if (modelAccess && Array.isArray(modelAccess)) {
      const knownModels = modelRouter.getModels({ enabled: true }).map(m => m.id);
      const invalidModels = modelAccess.filter((m: string) => !knownModels.includes(m));
      if (invalidModels.length > 0) {
        return res.status(400).json({ error: `Unknown models: ${invalidModels.join(", ")}` });
      }
    }

    // If setting as default, unset other defaults
    if (isDefault && !key.isDefault) {
      await storage.setDefaultLLMKey(userId, req.params.keyId);
    }

    const updated = await storage.updateLLMKey(req.params.keyId, {
      label,
      modelAccess,
      rateLimit,
      budget,
      isDefault,
      failoverChain,
      isActive,
    });

    res.json({
      ...updated,
      encryptedKey: undefined,
      maskedKey: `${updated.provider.toUpperCase()}_****${updated.encryptedKey.slice(-4)}`,
    });
  } catch (error) {
    console.error("Failed to update LLM key:", error);
    res.status(500).json({ error: "Failed to update LLM key" });
  }
});

/**
 * DELETE /api/infinity-ai/llm-keys/:keyId
 * Delete an LLM key
 */
router.delete("/:keyId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const key = await storage.getLLMKey(req.params.keyId);

    if (!key || key.userId !== userId) {
      return res.status(404).json({ error: "LLM key not found" });
    }

    await storage.deleteLLMKey(req.params.keyId);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete LLM key:", error);
    res.status(500).json({ error: "Failed to delete LLM key" });
  }
});

/**
 * POST /api/infinity-ai/llm-keys/:keyId/test
 * Test an LLM key
 */
router.post("/:keyId/test", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const key = await storage.getLLMKey(req.params.keyId);

    if (!key || key.userId !== userId) {
      return res.status(404).json({ error: "LLM key not found" });
    }

    // Test the key by making a simple request
    const testResult = await modelRouter.testKey(key);

    // Update last tested timestamp
    await storage.updateLLMKey(req.params.keyId, { lastTested: new Date() });

    res.json(testResult);
  } catch (error) {
    console.error("Failed to test LLM key:", error);
    res.status(500).json({ error: "Failed to test LLM key", success: false, message: String(error) });
  }
});

/**
 * POST /api/infinity-ai/llm-keys/:keyId/set-default
 * Set an LLM key as default
 */
router.post("/:keyId/set-default", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const key = await storage.getLLMKey(req.params.keyId);

    if (!key || key.userId !== userId) {
      return res.status(404).json({ error: "LLM key not found" });
    }

    await storage.setDefaultLLMKey(userId, req.params.keyId);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to set default LLM key:", error);
    res.status(500).json({ error: "Failed to set default LLM key" });
  }
});

/**
 * GET /api/infinity-ai/llm-keys/default
 * Get the default LLM key for the user
 */
router.get("/default", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const key = await storage.getDefaultLLMKey(userId);

    if (!key) {
      return res.status(404).json({ error: "No default LLM key found" });
    }

    res.json({
      ...key,
      encryptedKey: undefined,
      maskedKey: `${key.provider.toUpperCase()}_****${key.encryptedKey.slice(-4)}`,
    });
  } catch (error) {
    console.error("Failed to get default LLM key:", error);
    res.status(500).json({ error: "Failed to get default LLM key" });
  }
});

/**
 * GET /api/infinity-ai/llm-keys/providers
 * Get all supported providers
 */
router.get("/providers", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const providers = [
      { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"], supportsLocal: false },
      { id: "anthropic", name: "Anthropic", models: ["claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus", "claude-3-sonnet"], supportsLocal: false },
      { id: "google", name: "Google", models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"], supportsLocal: false },
      { id: "ollama", name: "Ollama (Local)", models: ["llama3.1:70b", "llama3.1:8b", "codellama:34b", "mistral:7b"], supportsLocal: true },
      { id: "openrouter", name: "OpenRouter", models: ["openrouter/auto", "openrouter/free"], supportsLocal: false },
      { id: "lmstudio", name: "LM Studio (Local)", models: ["any local model"], supportsLocal: true },
      { id: "custom", name: "Custom/OpenAI-Compatible", models: ["any compatible model"], supportsLocal: false },
    ];
    res.json(providers);
  } catch (error) {
    console.error("Failed to get providers:", error);
    res.status(500).json({ error: "Failed to get providers" });
  }
});

/**
 * GET /api/infinity-ai/llm-keys/models
 * Get all available models from the model router
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
 * POST /api/infinity-ai/llm-keys/validate-model-access
 * Validate model access for a key
 */
router.post("/validate-model-access", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { keyId, modelIds } = req.body;

    if (!keyId || !modelIds || !Array.isArray(modelIds)) {
      return res.status(400).json({ error: "keyId and modelIds array are required" });
    }

    const userId = req.accountId;
    const key = await storage.getLLMKey(keyId);

    if (!key || key.userId !== userId) {
      return res.status(404).json({ error: "LLM key not found" });
    }

    const knownModels = modelRouter.getModels({ enabled: true }).map(m => m.id);
    const validModels = modelIds.filter((m: string) => knownModels.includes(m));
    const invalidModels = modelIds.filter((m: string) => !knownModels.includes(m));
    const notInKeyAccess = modelIds.filter((m: string) => key.modelAccess.length > 0 && !key.modelAccess.includes(m));

    res.json({
      valid: invalidModels.length === 0 && notInKeyAccess.length === 0,
      validModels,
      invalidModels,
      notInKeyAccess,
      allModelsKnown: invalidModels.length === 0,
    });
  } catch (error) {
    console.error("Failed to validate model access:", error);
    res.status(500).json({ error: "Failed to validate model access" });
  }
});

/**
 * GET /api/infinity-ai/llm-keys/stats
 * Get usage stats for all keys
 */
router.get("/stats", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.accountId;
    const keys = await storage.getLLMKeys(userId);
    const stats = await Promise.all(
      keys.map(async (key) => {
        const usage = await storage.getLLMKeyUsage(key.id, 30);
        const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
        const totalRequests = usage.length;
        return {
          keyId: key.id,
          label: key.label,
          provider: key.provider,
          isDefault: key.isDefault,
          isActive: key.isActive,
          totalCost,
          totalRequests,
          budgetUsed: key.budget.monthlyLimit > 0 ? (totalCost / key.budget.monthlyLimit) * 100 : 0,
          lastUsed: key.lastUsed,
        };
      })
    );
    res.json(stats);
  } catch (error) {
    console.error("Failed to get LLM key stats:", error);
    res.status(500).json({ error: "Failed to get LLM key stats" });
  }
});

export default router;