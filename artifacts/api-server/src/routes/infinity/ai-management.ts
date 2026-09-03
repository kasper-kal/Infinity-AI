import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { secrets, settings, settingChanges } from "@workspace/db/schema";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { buildErrorDetail } from "../../lib/error-detail";
import { secretManager } from "../../lib/secret-manager";
import { settingsManager, SETTING_DEFINITIONS, type SettingKey } from "../../lib/settings-manager";
import { z } from "zod";

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateSecretSchema = z.object({
  projectId: z.string().uuid().optional(),
  provider: z.string().min(1),
  model: z.string().optional(),
  key: z.string().min(1),
  name: z.string().min(1),
  priority: z.number().int().default(0),
  source: z.enum(["user-api", "project-pool", "global-pool"]).default("project-pool"),
  metadata: z.record(z.unknown()).optional(),
  accountId: z.string().uuid().optional(),
  scopes: z.array(z.string()).optional(),
});

const UpdateSecretSchema = z.object({
  name: z.string().optional(),
  priority: z.number().int().optional(),
  model: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const RotateSecretSchema = z.object({
  newKey: z.string().min(1).optional(), // If not provided, attempt provider rotation
  rotatedBy: z.enum(["ai", "user"]).default("user"),
  rotatedById: z.string().optional(),
});

const ProposeSettingSchema = z.object({
  key: z.string(),
  proposedValue: z.unknown(),
  reason: z.string().min(1),
  proposedById: z.string().min(1),
  userId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  expiresInMs: z.number().int().positive().optional(),
});

const ConfirmChangeSchema = z.object({
  changeId: z.string().min(1),
  confirmedBy: z.string().min(1),
});

const RejectChangeSchema = z.object({
  changeId: z.string().min(1),
  rejectedBy: z.string().min(1),
});

const SetSettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  userId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

// ============================================================================
// Helper: Get user/project context from request
// ============================================================================

function getContext(req: Request): { userId?: string; projectId?: string } {
  // In a real implementation, this would come from auth middleware
  // For now, use query params or headers
  return {
    userId: req.headers["x-user-id"] as string || undefined,
    projectId: req.headers["x-project-id"] as string || undefined,
  };
}

// ============================================================================
// SECRET MANAGEMENT (LLM API Keys)
// ============================================================================

/**
 * GET /api/infinity/ai-management/secrets
 * List all secrets (LLM keys) with optional filters
 */
router.get("/secrets", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { userId, projectId } = getContext(req);
    const { provider, health, source, onlyHealthy } = req.query;

    const secretsList = await secretManager.getKeys(projectId, {
      provider: provider as string,
      health: health as any,
      source: source as any,
      onlyHealthy: onlyHealthy === "true",
    });

    // Don't return decrypted keys in list
    const safeSecrets = secretsList.map(({ encryptedKey, ...rest }) => rest);

    res.json({ secrets: safeSecrets });
  } catch (err) {
    req.log.error({ err }, "Failed to list secrets");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to list secrets", detail });
  }
});

/**
 * GET /api/infinity/ai-management/secrets/:id
 * Get a specific secret (optionally with decrypted value)
 */
router.get("/secrets/:id", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { id } = req.params;
    const { includeDecrypted } = req.query;

    const secret = await secretManager.getKey(id, includeDecrypted === "true");

    if (!secret) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    // Never return decrypted key unless explicitly requested and authorized
    if (!includeDecrypted || !("decryptedKey" in secret)) {
      const { encryptedKey, ...safeSecret } = secret;
      res.json(safeSecret);
    } else {
      res.json(secret);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to get secret");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get secret", detail });
  }
});

/**
 * POST /api/infinity/ai-management/secrets
 * Create a new secret (LLM API key)
 */
router.post("/secrets", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { userId, projectId } = getContext(req);
    const parsed = CreateSecretSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    const secret = await secretManager.createKey({
      projectId: data.projectId || projectId,
      provider: data.provider,
      model: data.model,
      key: data.key,
      name: data.name,
      priority: data.priority,
      source: data.source,
      metadata: data.metadata,
    });

    const { encryptedKey, ...safeSecret } = secret;
    res.status(201).json(safeSecret);
  } catch (err) {
    req.log.error({ err }, "Failed to create secret");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to create secret", detail });
  }
});

/**
 * PATCH /api/infinity/ai-management/secrets/:id
 * Update secret metadata (not the key value)
 */
router.patch("/secrets/:id", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { id } = req.params;
    const parsed = UpdateSecretSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const secret = await secretManager.updateKey(id, parsed.data);

    if (!secret) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    const { encryptedKey, ...safeSecret } = secret;
    res.json(safeSecret);
  } catch (err) {
    req.log.error({ err }, "Failed to update secret");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to update secret", detail });
  }
});

/**
 * POST /api/infinity/ai-management/secrets/:id/rotate
 * Rotate a secret (replace with new key or provider rotation)
 */
router.post("/secrets/:id/rotate", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { id } = req.params;
    const { userId } = getContext(req);
    const parsed = RotateSecretSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { newKey, rotatedBy, rotatedById } = parsed.data;

    let result;
    if (newKey) {
      // Direct key replacement
      result = await secretManager.rotateKey(id, newKey, rotatedBy, rotatedById || userId);
    } else {
      // Attempt provider-specific rotation
      result = await secretManager.rotateKeyViaProvider(id, rotatedBy, rotatedById || userId);
    }

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, newKeyId: result.newKeyId, rotatedAt: result.rotatedAt });
  } catch (err) {
    req.log.error({ err }, "Failed to rotate secret");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to rotate secret", detail });
  }
});

/**
 * POST /api/infinity/ai-management/secrets/:id/health-check
 * Trigger a health check for a specific secret
 */
router.post("/secrets/:id/health-check", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { id } = req.params;

    const result = await secretManager.checkKeyHealth(id);

    res.json({ ...result, checkedAt: new Date() });
  } catch (err) {
    req.log.error({ err }, "Failed to check secret health");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to check secret health", detail });
  }
});

/**
 * POST /api/infinity/ai-management/secrets/health-check-all
 * Trigger health checks for all secrets
 */
router.post("/secrets/health-check-all", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { projectId } = getContext(req);

    const metrics = await secretManager.checkAllKeysHealth(projectId);

    res.json({ metrics, checkedAt: new Date() });
  } catch (err) {
    req.log.error({ err }, "Failed to check all secrets health");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to check all secrets health", detail });
  }
});

/**
 * GET /api/infinity/ai-management/secrets/health/metrics
 * Get health metrics for dashboard
 */
router.get("/secrets/health/metrics", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { projectId } = getContext(req);

    const metrics = await secretManager.getHealthMetrics(projectId);

    res.json({ metrics, generatedAt: new Date() });
  } catch (err) {
    req.log.error({ err }, "Failed to get health metrics");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get health metrics", detail });
  }
});

/**
 * GET /api/infinity/ai-management/secrets/:id/audit
 * Get audit log for a secret
 */
router.get("/secrets/:id/audit", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const auditLog = await secretManager.getAuditLog(id, limit);

    res.json({ auditLog });
  } catch (err) {
    req.log.error({ err }, "Failed to get audit log");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get audit log", detail });
  }
});

/**
 * DELETE /api/infinity/ai-management/secrets/:id
 * Delete a secret
 */
router.delete("/secrets/:id", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { id } = req.params;
    const { userId } = getContext(req);

    const success = await secretManager.deleteKey(id, "user", userId);

    if (!success) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete secret");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to delete secret", detail });
  }
});

// ============================================================================
// SETTINGS MANAGEMENT (UI Settings)
// ============================================================================

/**
 * GET /api/infinity/ai-management/settings
 * Get all settings definitions (for UI)
 */
router.get("/settings/definitions", async (_req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const definitions = settingsManager.getAllSettingDefinitions();
    res.json({ definitions });
  } catch (err) {
    req.log.error({ err }, "Failed to get setting definitions");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get setting definitions", detail });
  }
});

/**
 * GET /api/infinity/ai-management/settings
 * Get all setting values for current context
 */
router.get("/settings", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { userId, projectId } = getContext(req);

    const allSettings = await settingsManager.getAllSettings(userId, projectId);

    res.json({ settings: allSettings });
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get settings", detail });
  }
});

/**
 * GET /api/infinity/ai-management/settings/:key
 * Get a specific setting value
 */
router.get("/settings/:key", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { key } = req.params;
    const { userId, projectId } = getContext(req);

    const value = await settingsManager.getSetting(key as SettingKey, userId, projectId);

    res.json({ key, value });
  } catch (err) {
    req.log.error({ err }, "Failed to get setting");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get setting", detail });
  }
});

/**
 * PUT /api/infinity/ai-management/settings
 * Set a setting value directly (user action)
 */
router.put("/settings", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { userId, projectId } = getContext(req);
    const parsed = SetSettingSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { key, value, userId: bodyUserId, projectId: bodyProjectId } = parsed.data;

    const result = await settingsManager.setSetting(
      key as SettingKey,
      value,
      "user",
      bodyUserId || userId,
      bodyProjectId || projectId
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, key, value });
  } catch (err) {
    req.log.error({ err }, "Failed to set setting");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to set setting", detail });
  }
});

/**
 * DELETE /api/infinity/ai-management/settings/:key
 * Reset a setting to default
 */
router.delete("/settings/:key", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { key } = req.params;
    const { userId, projectId } = getContext(req);

    const result = await settingsManager.resetSetting(key as SettingKey, userId, projectId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, key });
  } catch (err) {
    req.log.error({ err }, "Failed to reset setting");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to reset setting", detail });
  }
});

/**
 * POST /api/infinity/ai-management/settings/propose
 * AI proposes a setting change (requires user confirmation)
 */
router.post("/settings/propose", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { userId, projectId } = getContext(req);
    const parsed = ProposeSettingSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { key, proposedValue, reason, proposedById, userId: bodyUserId, projectId: bodyProjectId, expiresInMs } = parsed.data;

    const result = await settingsManager.proposeSettingChange(
      key as SettingKey,
      proposedValue,
      reason,
      proposedById,
      bodyUserId || userId,
      bodyProjectId || projectId,
      expiresInMs
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({ success: true, changeId: result.changeId });
  } catch (err) {
    req.log.error({ err }, "Failed to propose setting change");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to propose setting change", detail });
  }
});

/**
 * GET /api/infinity/ai-management/settings/proposals
 * Get all pending proposals for current context
 */
router.get("/settings/proposals", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { userId, projectId } = getContext(req);

    const proposals = await settingsManager.getPendingProposals(userId, projectId);

    res.json({ proposals });
  } catch (err) {
    req.log.error({ err }, "Failed to get proposals");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get proposals", detail });
  }
});

/**
 * GET /api/infinity/ai-management/settings/proposals/:changeId
 * Get a specific proposal
 */
router.get("/settings/proposals/:changeId", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { changeId } = req.params;

    const proposal = await settingsManager.getProposal(changeId);

    if (!proposal) {
      res.status(404).json({ error: "Proposal not found" });
      return;
    }

    res.json({ proposal });
  } catch (err) {
    req.log.error({ err }, "Failed to get proposal");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get proposal", detail });
  }
});

/**
 * POST /api/infinity/ai-management/settings/proposals/:changeId/confirm
 * User confirms a proposed change
 */
router.post("/settings/proposals/:changeId/confirm", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { changeId } = req.params;
    const parsed = ConfirmChangeSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { confirmedBy } = parsed.data;

    const result = await settingsManager.confirmChange(changeId, confirmedBy);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, changeId: result.changeId, appliedValue: result.appliedValue });
  } catch (err) {
    req.log.error({ err }, "Failed to confirm proposal");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to confirm proposal", detail });
  }
});

/**
 * POST /api/infinity/ai-management/settings/proposals/:changeId/reject
 * User rejects a proposed change
 */
router.post("/settings/proposals/:changeId/reject", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { changeId } = req.params;
    const parsed = RejectChangeSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { rejectedBy } = parsed.data;

    const result = await settingsManager.rejectChange(changeId, rejectedBy);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reject proposal");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to reject proposal", detail });
  }
});

/**
 * GET /api/infinity/ai-management/settings/:key/audit
 * Get audit log for a setting
 */
router.get("/settings/:key/audit", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { key } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const auditLog = await settingsManager.getSettingAuditLog(key as SettingKey, limit);

    res.json({ auditLog });
  } catch (err) {
    req.log.error({ err }, "Failed to get setting audit log");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get setting audit log", detail });
  }
});

// ============================================================================
// COMBINED DASHBOARD DATA
// ============================================================================

/**
 * GET /api/infinity/ai-management/dashboard
 * Get combined dashboard data for AI Management tab
 */
router.get("/dashboard", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const { userId, projectId } = getContext(req);

    const [secretsList, settingsValues, proposals, healthMetrics] = await Promise.all([
      secretManager.getKeys(projectId),
      settingsManager.getAllSettings(userId, projectId),
      settingsManager.getPendingProposals(userId, projectId),
      secretManager.getHealthMetrics(projectId),
    ]);

    // Safe secrets (no encrypted keys)
    const safeSecrets = secretsList.map(({ encryptedKey, ...rest }) => rest);

    res.json({
      secrets: safeSecrets,
      settings: settingsValues,
      proposals,
      healthMetrics,
      generatedAt: new Date(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard data");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get dashboard data", detail });
  }
});

export default router;