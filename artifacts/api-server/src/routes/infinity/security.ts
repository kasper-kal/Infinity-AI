import { Router, Request, Response } from "express";
import {
  scanSecurity,
  checkDeploymentGate,
  scanChangedFiles,
  listRules,
  getRuleStats,
  addSuppression,
  getSuppressionLog,
  clearSuppression,
  auditDependencies,
  type ScanOptions,
  type SecuritySeverity,
  type SecurityFinding,
} from "../../lib/security-scanner";
import {
  createSecret,
  getSecretValue,
  listSecrets,
  updateSecretValue,
  deleteSecret,
  resolveSecretEnv,
  buildInjectionEnv,
  rotateSecret,
  getRotationProviders,
  scanForSecrets,
  detectSecrets,
  type CreateSecretInput,
  type SecretEnvironment,
  type DetectedSecret,
} from "../../lib/secrets-manager";

const router = Router();

// ============================================================================
// SECURITY SCANNER ROUTES
// ============================================================================

/**
 * POST /security/scan - Full security scan of workspace
 * Body: { workspaceId: string, options?: ScanOptions }
 */
router.post("/security/scan", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.body?.workspaceId as string | undefined;
    const options = req.body?.options as ScanOptions | undefined;

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required" });
    }

    const result = await scanSecurity(workspaceId, options);
    return res.json(result);
  } catch (err) {
    console.error("[security] Scan failed:", (err as Error).message);
    return res.status(500).json({ error: "Security scan failed" });
  }
});

/**
 * POST /security/scan/incremental - Incremental scan of changed files
 * Body: { workspaceId: string, changedFiles: string[] }
 */
router.post("/security/scan/incremental", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.body?.workspaceId as string | undefined;
    const changedFiles = req.body?.changedFiles as string[] | undefined;

    if (!workspaceId || !changedFiles || !Array.isArray(changedFiles)) {
      return res.status(400).json({ error: "workspaceId and changedFiles array required" });
    }

    const result = await scanChangedFiles(workspaceId, changedFiles);
    return res.json(result);
  } catch (err) {
    console.error("[security] Incremental scan failed:", (err as Error).message);
    return res.status(500).json({ error: "Incremental scan failed" });
  }
});

/**
 * POST /security/gate - Pre-deployment security gate
 * Body: { workspaceId: string, severityThreshold?: SecuritySeverity, environment?: string }
 */
router.post("/security/gate", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.body?.workspaceId as string | undefined;
    const severityThreshold = req.body?.severityThreshold as SecuritySeverity | undefined;
    const environment = req.body?.environment as string | undefined;

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required" });
    }

    const gate = await checkDeploymentGate(workspaceId, {
      severityThreshold,
      environment,
    });
    return res.json(gate);
  } catch (err) {
    console.error("[security] Deployment gate check failed:", (err as Error).message);
    return res.status(500).json({ error: "Deployment gate check failed" });
  }
});

/**
 * POST /security/dependencies - Audit npm/pnpm dependencies for vulnerabilities
 * Body: { workspaceId: string }
 */
router.post("/security/dependencies", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.body?.workspaceId as string | undefined;

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required" });
    }

    const result = await auditDependencies(workspaceId);
    return res.json(result);
  } catch (err) {
    console.error("[security] Dependency audit failed:", (err as Error).message);
    return res.status(500).json({ error: "Dependency audit failed" });
  }
});

/**
 * GET /security/rules - List all built-in security rules
 */
router.get("/security/rules", async (_req: Request, res: Response) => {
  try {
    const rules = listRules();
    return res.json({ rules });
  } catch (err) {
    console.error("[security] List rules failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to list rules" });
  }
});

/**
 * GET /security/rules/stats - Get rule statistics
 */
router.get("/security/rules/stats", async (_req: Request, res: Response) => {
  try {
    const stats = getRuleStats();
    return res.json(stats);
  } catch (err) {
    console.error("[security] Get rule stats failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to get rule stats" });
  }
});

/**
 * POST /security/suppressions - Add a finding suppression
 * Body: { findingId: string, ruleId: string, reason: string, expiresAt?: number }
 */
router.post("/security/suppressions", async (req: Request, res: Response) => {
  try {
    const { findingId, ruleId, reason, expiresAt } = req.body as {
      findingId: string;
      ruleId: string;
      reason: string;
      expiresAt?: number;
    };

    if (!findingId || !ruleId || !reason) {
      return res.status(400).json({ error: "findingId, ruleId, and reason are required" });
    }

    addSuppression({ findingId, ruleId, reason, expiresAt });
    return res.json({ success: true });
  } catch (err) {
    console.error("[security] Add suppression failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to add suppression" });
  }
});

/**
 * GET /security/suppressions - List all suppressions
 */
router.get("/security/suppressions", async (_req: Request, res: Response) => {
  try {
    const suppressions = getSuppressionLog();
    return res.json({ suppressions });
  } catch (err) {
    console.error("[security] Get suppressions failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to get suppressions" });
  }
});

/**
 * DELETE /security/suppressions/:findingId - Remove a suppression
 */
router.delete("/security/suppressions/:findingId", async (req: Request, res: Response) => {
  try {
    const { findingId } = req.params;
    clearSuppression(findingId);
    return res.json({ success: true });
  } catch (err) {
    console.error("[security] Clear suppression failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to clear suppression" });
  }
});

// ============================================================================
// SECRETS MANAGER ROUTES
// ============================================================================

/**
 * POST /secrets - Create a new secret (encrypted)
 * Body: { projectId: string, key: string, value: string, environment?: SecretEnvironment, description?: string, category?: string }
 */
router.post("/secrets", async (req: Request, res: Response) => {
  try {
    const input = req.body as CreateSecretInput;

    if (!input.projectId || !input.key || !input.value) {
      return res.status(400).json({ error: "projectId, key, and value are required" });
    }

    const secret = await createSecret(input);
    return res.status(201).json(secret);
  } catch (err) {
    console.error("[secrets] Create failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to create secret" });
  }
});

/**
 * GET /secrets - List secrets for a project (without values)
 * Query: projectId, environment?
 */
router.get("/secrets", async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const environment = req.query.environment as SecretEnvironment | undefined;

    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const secrets = await listSecrets(projectId, environment);
    return res.json({ secrets });
  } catch (err) {
    console.error("[secrets] List failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to list secrets" });
  }
});

/**
 * GET /secrets/:secretId - Get a secret value (decrypted)
 * Query: projectId (for ownership check)
 */
router.get("/secrets/:secretId", async (req: Request, res: Response) => {
  try {
    const { secretId } = req.params;
    const projectId = req.query.projectId as string | undefined;

    if (!projectId) {
      return res.status(400).json({ error: "projectId query param required" });
    }

    const value = await getSecretValue(secretId, projectId);
    if (value === null) {
      return res.status(404).json({ error: "Secret not found" });
    }

    return res.json({ value });
  } catch (err) {
    console.error("[secrets] Get value failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to get secret value" });
  }
});

/**
 * PATCH /secrets/:secretId - Update secret value
 * Body: { projectId: string, value: string }
 */
router.patch("/secrets/:secretId", async (req: Request, res: Response) => {
  try {
    const { secretId } = req.params;
    const { projectId, value } = req.body as { projectId: string; value: string };

    if (!projectId || !value) {
      return res.status(400).json({ error: "projectId and value are required" });
    }

    await updateSecretValue(secretId, projectId, value);
    return res.json({ success: true });
  } catch (err) {
    console.error("[secrets] Update failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to update secret" });
  }
});

/**
 * DELETE /secrets/:secretId - Delete a secret
 * Query: projectId (for ownership check)
 */
router.delete("/secrets/:secretId", async (req: Request, res: Response) => {
  try {
    const { secretId } = req.params;
    const projectId = req.query.projectId as string | undefined;

    if (!projectId) {
      return res.status(400).json({ error: "projectId query param required" });
    }

    await deleteSecret(secretId, projectId);
    return res.json({ success: true });
  } catch (err) {
    console.error("[secrets] Delete failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to delete secret" });
  }
});

/**
 * POST /secrets/resolve - Resolve all secrets as env vars for build/runtime injection
 * Body: { projectId: string, environment?: SecretEnvironment }
 */
router.post("/secrets/resolve", async (req: Request, res: Response) => {
  try {
    const { projectId, environment } = req.body as {
      projectId: string;
      environment?: SecretEnvironment;
    };

    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const env = await resolveSecretEnv(projectId, environment);
    return res.json({ env });
  } catch (err) {
    console.error("[secrets] Resolve failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to resolve secrets" });
  }
});

/**
 * POST /secrets/inject - Build complete injection environment
 * Body: { projectId: string, environment: SecretEnvironment, additionalEnv?: Record<string, string> }
 */
router.post("/secrets/inject", async (req: Request, res: Response) => {
  try {
    const { projectId, environment, additionalEnv } = req.body as {
      projectId: string;
      environment: SecretEnvironment;
      additionalEnv?: Record<string, string>;
    };

    if (!projectId || !environment) {
      return res.status(400).json({ error: "projectId and environment are required" });
    }

    const env = await buildInjectionEnv({ projectId, environment, additionalEnv });
    return res.json({ env });
  } catch (err) {
    console.error("[secrets] Inject failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to build injection env" });
  }
});

/**
 * POST /secrets/rotate - Rotate a secret with a provider
 * Body: { secretId: string, projectId: string, provider: string }
 */
router.post("/secrets/rotate", async (req: Request, res: Response) => {
  try {
    const { secretId, projectId, provider } = req.body as {
      secretId: string;
      projectId: string;
      provider: string;
    };

    if (!secretId || !projectId || !provider) {
      return res.status(400).json({ error: "secretId, projectId, and provider are required" });
    }

    const newValue = await rotateSecret(secretId, projectId, provider);
    return res.json({ success: true, newValue });
  } catch (err) {
    console.error("[secrets] Rotate failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to rotate secret" });
  }
});

/**
 * GET /secrets/rotation/providers - List supported rotation providers
 */
router.get("/secrets/rotation/providers", async (_req: Request, res: Response) => {
  try {
    const providers = getRotationProviders();
    return res.json({ providers });
  } catch (err) {
    console.error("[secrets] Get rotation providers failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to get rotation providers" });
  }
});

/**
 * POST /secrets/detect - Detect secrets in file content
 * Body: { filePath: string, content: string }
 */
router.post("/secrets/detect", async (req: Request, res: Response) => {
  try {
    const { filePath, content } = req.body as { filePath: string; content: string };

    if (!filePath || !content) {
      return res.status(400).json({ error: "filePath and content are required" });
    }

    const detected = detectSecrets(filePath, content);
    return res.json({ detected });
  } catch (err) {
    console.error("[secrets] Detect failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to detect secrets" });
  }
});

/**
 * POST /secrets/scan - Scan workspace files for secrets
 * Body: { workspaceId: string, filePaths: string | string[] }
 */
router.post("/secrets/scan", async (req: Request, res: Response) => {
  try {
    const { workspaceId, filePaths } = req.body as {
      workspaceId: string;
      filePaths: string | string[];
    };

    if (!workspaceId || !filePaths) {
      return res.status(400).json({ error: "workspaceId and filePaths are required" });
    }

    const detected = await scanForSecrets(workspaceId, filePaths);
    return res.json({ detected });
  } catch (err) {
    console.error("[secrets] Scan failed:", (err as Error).message);
    return res.status(500).json({ error: "Failed to scan for secrets" });
  }
});

export default router;