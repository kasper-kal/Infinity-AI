import { Router, Request, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../../middleware/auth-middleware";
import { auditLogger, AuditHelpers } from "../../lib/enterprise/audit-logs";
import type { AuditEventType } from "../../lib/enterprise/audit-logs";
import { SSOManager, SSOConfig, createSSOConfigWithProviders, initializeSSO, getSSOManager } from "../../lib/enterprise/sso";
import { VPCConfig, VPCManager, createStandardVPCConfig, vpcManager, TerraformOutput, VPCModuleGenerator } from "../../lib/enterprise/vpc";

const router = Router();

// ============================================
// SSO / SAML / OIDC Routes
// ============================================

/**
 * GET /api/infinity/enterprise/sso/config
 * Get current SSO configuration
 */
router.get("/sso/config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ssoManager = getSSOManager();
    if (!ssoManager) {
      return res.status(404).json({ error: "SSO not configured" });
    }

    const providers = ssoManager.getProviders().map(p => ({
      type: p.type,
      name: p.name,
      isConfigured: p.isConfigured(),
    }));

    res.json({
      providers,
      configured: providers.length > 0,
    });
  } catch (err) {
    console.error("Get SSO config error:", err);
    res.status(500).json({ error: "Failed to get SSO configuration" });
  }
});

/**
 * POST /api/infinity/enterprise/sso/initiate
 * Initiate SSO login flow
 */
router.post("/sso/initiate", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { provider, redirectUri } = req.body;

    if (!provider || !redirectUri) {
      return res.status(400).json({ error: "provider and redirectUri are required" });
    }

    const ssoManager = getSSOManager();
    if (!ssoManager) {
      return res.status(404).json({ error: "SSO not configured" });
    }

    const result = await ssoManager.initiateLogin(
      provider as any,
      redirectUri,
      { ipAddress: req.ip, userAgent: req.get("user-agent") }
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    console.error("SSO initiate error:", err);
    res.status(500).json({ error: "Failed to initiate SSO login" });
  }
});

/**
 * POST /api/infinity/enterprise/sso/callback
 * Handle SSO callback
 */
router.post("/sso/callback", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { state, code } = req.body;

    if (!state || !code) {
      return res.status(400).json({ error: "state and code are required" });
    }

    const ssoManager = getSSOManager();
    if (!ssoManager) {
      return res.status(404).json({ error: "SSO not configured" });
    }

    const result = await ssoManager.handleCallback(state, code, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Audit log
    if (result.session) {
      await auditLogger.log(AuditHelpers.userSSOLogin(
        {
          type: "user",
          id: result.session.userId,
          name: result.session.name,
          email: result.session.email,
          roles: result.session.roles,
          workspaceId: result.session.projects[0]?.projectId,
        },
        result.session.provider,
        req.ip,
        result.session.id
      ));
    }

    res.json(result);
  } catch (err) {
    console.error("SSO callback error:", err);
    res.status(500).json({ error: "SSO callback failed" });
  }
});

/**
 * POST /api/infinity/enterprise/sso/logout
 * Handle SSO logout
 */
router.post("/sso/logout", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, redirectUri } = req.body;

    if (!sessionId || !redirectUri) {
      return res.status(400).json({ error: "sessionId and redirectUri are required" });
    }

    const ssoManager = getSSOManager();
    if (!ssoManager) {
      return res.status(404).json({ error: "SSO not configured" });
    }

    const logoutUrl = await ssoManager.logout(sessionId, redirectUri);

    res.json({ logoutUrl });
  } catch (err) {
    console.error("SSO logout error:", err);
    res.status(500).json({ error: "SSO logout failed" });
  }
});

/**
 * GET /api/infinity/enterprise/sso/session/:sessionId
 * Validate and get session
 */
router.get("/sso/session/:sessionId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;

    const ssoManager = getSSOManager();
    if (!ssoManager) {
      return res.status(404).json({ error: "SSO not configured" });
    }

    const session = await ssoManager.validateSession(sessionId);

    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    // Don't return tokens
    const { accessToken, refreshToken, idToken, ...safeSession } = session;
    res.json(safeSession);
  } catch (err) {
    console.error("SSO session validation error:", err);
    res.status(500).json({ error: "Session validation failed" });
  }
});

/**
 * POST /api/infinity/enterprise/sso/configure
 * Configure SSO providers (admin only)
 */
router.post("/sso/configure", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // In production, check admin role
    const config = req.body as SSOConfig;

    // Validate config
    if (!config.providers || !Array.isArray(config.providers)) {
      return res.status(400).json({ error: "providers array is required" });
    }

    // Initialize SSO manager with new config
    const ssoManager = initializeSSO(config);

    res.json({
      success: true,
      message: "SSO configuration updated",
      providers: ssoManager.getProviders().map(p => p.type),
    });
  } catch (err) {
    console.error("SSO configure error:", err);
    res.status(500).json({ error: "Failed to configure SSO" });
  }
});

/**
 * POST /api/infinity/enterprise/sso/configure-quick
 * Quick configure SSO with common providers
 */
router.post("/sso/configure-quick", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { okta, entraId, googleWorkspace, saml, customOIDC } = req.body;

    const config = createSSOConfigWithProviders({
      okta,
      entraId,
      googleWorkspace,
      saml,
      customOIDC,
    });

    const ssoManager = initializeSSO(config);

    res.json({
      success: true,
      message: "SSO configuration updated",
      providers: ssoManager.getProviders().map(p => p.type),
    });
  } catch (err) {
    console.error("SSO quick configure error:", err);
    res.status(500).json({ error: "Failed to configure SSO" });
  }
});

// ============================================
// VPC / Network Routes
// ============================================

/**
 * POST /api/infinity/enterprise/vpc/generate
 * Generate Terraform VPC configuration
 */
router.post("/vpc/generate", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = req.body as VPCConfig;

    // Validate required fields
    if (!config.provider || !config.region || !config.cidrBlock || !config.projectId || !config.environment) {
      return res.status(400).json({ error: "provider, region, cidrBlock, projectId, and environment are required" });
    }

    if (!["gcp", "aws", "azure"].includes(config.provider)) {
      return res.status(400).json({ error: "provider must be gcp, aws, or azure" });
    }

    const generator = new VPCModuleGenerator(config);
    const result = generator.generateTerraform();

    // Audit log
    await auditLogger.log({
      type: AuditEventType.DEPLOYMENT_CREATE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "vpc", id: config.projectId, name: `${config.projectId}-${config.environment}` },
      action: "generate_vpc_terraform",
      outcome: "success",
      metadata: { provider: config.provider, region: config.region, cidrBlock: config.cidrBlock },
      severity: "info",
    });

    res.json({
      success: true,
      terraform: result.files,
      outputs: {
        provider: result.provider,
        region: result.region,
        projectId: result.projectId,
      },
      warnings: [],
    });
  } catch (err) {
    console.error("VPC generate error:", err);
    res.status(500).json({ error: "Failed to generate VPC configuration" });
  }
});

/**
 * GET /api/infinity/enterprise/vpc/examples
 * Get example VPC configurations
 */
router.get("/vpc/examples", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const examples = {
      gcp: {
        provider: "gcp",
        region: "us-central1",
        vpcCidr: "10.0.0.0/16",
        name: "infinity-prod-vpc",
        subnets: [
          { name: "public-us-central1-a", region: "us-central1", zone: "us-central1-a", cidr: "10.0.1.0/24", type: "public" },
          { name: "private-us-central1-a", region: "us-central1", zone: "us-central1-a", cidr: "10.0.10.0/24", type: "private" },
          { name: "db-us-central1-a", region: "us-central1", zone: "us-central1-a", cidr: "10.0.20.0/24", type: "database" },
        ],
        enableNat: true,
        enablePrivateEndpoints: true,
        enableFirewall: true,
        enableDns: true,
        enableFlowLogs: true,
      },
      aws: {
        provider: "aws",
        region: "us-east-1",
        vpcCidr: "10.0.0.0/16",
        name: "infinity-prod-vpc",
        subnets: [
          { name: "public-us-east-1a", region: "us-east-1", zone: "us-east-1a", cidr: "10.0.1.0/24", type: "public" },
          { name: "private-us-east-1a", region: "us-east-1", zone: "us-east-1a", cidr: "10.0.10.0/24", type: "private" },
          { name: "db-us-east-1a", region: "us-east-1", zone: "us-east-1a", cidr: "10.0.20.0/24", type: "database" },
        ],
        enableNat: true,
        enablePrivateEndpoints: true,
        enableFirewall: true,
        enableDns: true,
        enableFlowLogs: true,
      },
      azure: {
        provider: "azure",
        region: "eastus",
        vpcCidr: "10.0.0.0/16",
        name: "infinity-prod-vnet",
        subnets: [
          { name: "public", region: "eastus", cidr: "10.0.1.0/24", type: "public" },
          { name: "private", region: "eastus", cidr: "10.0.10.0/24", type: "private" },
          { name: "database", region: "eastus", cidr: "10.0.20.0/24", type: "database" },
        ],
        enableNat: true,
        enablePrivateEndpoints: true,
        enableFirewall: true,
        enableDns: true,
        enableFlowLogs: true,
      },
    };

    res.json(examples);
  } catch (err) {
    console.error("VPC examples error:", err);
    res.status(500).json({ error: "Failed to get VPC examples" });
  }
});

// ============================================
// Audit Logs Routes
// ============================================

/**
 * GET /api/infinity/enterprise/audit-logs
 * Query audit logs with filters
 */
router.get("/audit-logs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      startTime,
      endTime,
      types,
      actorIds,
      resourceTypes,
      outcomes,
      severities,
      workspaceIds,
      limit = "100",
      offset = "0",
    } = req.query;

    const filters: any = {};

    if (startTime) filters.startTime = new Date(startTime as string);
    if (endTime) filters.endTime = new Date(endTime as string);
    if (types) filters.types = (types as string).split(",") as AuditEventType[];
    if (actorIds) filters.actorIds = (actorIds as string).split(",");
    if (resourceTypes) filters.resourceTypes = (resourceTypes as string).split(",");
    if (outcomes) filters.outcomes = (outcomes as string).split(",");
    if (severities) filters.severities = (severities as string).split(",");
    if (workspaceIds) filters.workspaceIds = (workspaceIds as string).split(",");

    filters.limit = parseInt(limit as string, 10);
    filters.offset = parseInt(offset as string, 10);

    // In production, query from configured destination (ClickHouse, BigQuery, etc.)
    // For now, return mock data
    const logs = await auditLogger.query(filters);

    res.json({
      logs,
      total: logs.length,
      limit: filters.limit,
      offset: filters.offset,
    });
  } catch (err) {
    console.error("Audit logs query error:", err);
    res.status(500).json({ error: "Failed to query audit logs" });
  }
});

/**
 * GET /api/infinity/enterprise/audit-logs/export
 * Export audit logs
 */
router.get("/audit-logs/export", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      format = "json",
      startTime,
      endTime,
      types,
    } = req.query;

    const filters: any = {};
    if (startTime) filters.startTime = new Date(startTime as string);
    if (endTime) filters.endTime = new Date(endTime as string);
    if (types) filters.types = (types as string).split(",") as AuditEventType[];

    // In production, stream from destination
    const logs = await auditLogger.query(filters);

    if (format === "csv") {
      // Convert to CSV
      const headers = ["id", "timestamp", "type", "actorId", "actorType", "resourceId", "resourceType", "action", "outcome", "severity", "metadata"];
      const rows = logs.map(log => [
        log.id,
        log.timestamp.toISOString(),
        log.type,
        log.actor.id,
        log.actor.type,
        log.resource.id,
        log.resource.type,
        log.action,
        log.outcome,
        log.severity,
        JSON.stringify(log.metadata),
      ]);
      const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${Date.now()}.csv"`);
      return res.send(csv);
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${Date.now()}.json"`);
    res.json(logs);
  } catch (err) {
    console.error("Audit logs export error:", err);
    res.status(500).json({ error: "Failed to export audit logs" });
  }
});

/**
 * GET /api/infinity/enterprise/audit-logs/stats
 * Get audit log statistics
 */
router.get("/audit-logs/stats", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { startTime, endTime } = req.query;

    const filters: any = {};
    if (startTime) filters.startTime = new Date(startTime as string);
    if (endTime) filters.endTime = new Date(endTime as string);

    // In production, aggregate from destination
    const logs = await auditLogger.query({ ...filters, limit: 10000 });

    const stats = {
      total: logs.length,
      byType: {} as Record<string, number>,
      byOutcome: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      byActorType: {} as Record<string, number>,
      recentActivity: logs.slice(0, 10),
    };

    for (const log of logs) {
      stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
      stats.byOutcome[log.outcome] = (stats.byOutcome[log.outcome] || 0) + 1;
      stats.bySeverity[log.severity] = (stats.bySeverity[log.severity] || 0) + 1;
      stats.byActorType[log.actor.type] = (stats.byActorType[log.actor.type] || 0) + 1;
    }

    res.json(stats);
  } catch (err) {
    console.error("Audit logs stats error:", err);
    res.status(500).json({ error: "Failed to get audit log statistics" });
  }
});

/**
 * POST /api/infinity/enterprise/audit-logs/test
 * Test audit log destination
 */
router.post("/audit-logs/test", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { destination } = req.body;

    // In production, test the actual destination
    // For now, just log a test event
    await auditLogger.log({
      type: AuditEventType.SYSTEM_CONFIG_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "audit_log", id: "test", name: "Test Event" },
      action: "test_audit_destination",
      outcome: "success",
      metadata: { destination },
      severity: "info",
    });

    res.json({ success: true, message: "Test audit log sent successfully" });
  } catch (err) {
    console.error("Audit logs test error:", err);
    res.status(500).json({ error: "Failed to test audit log destination" });
  }
});

// ============================================
// Enterprise Dashboard Summary
// ============================================

/**
 * GET /api/infinity/enterprise/dashboard
 * Get enterprise dashboard summary
 */
router.get("/dashboard", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ssoManager = getSSOManager();

    const dashboard = {
      sso: {
        configured: !!ssoManager,
        providers: ssoManager?.getProviders().map(p => ({
          type: p.type,
          name: p.name,
          configured: p.isConfigured(),
        })) || [],
      },
      vpc: {
        // Would query from database in production
        environments: 0,
        pendingDeployments: 0,
      },
      auditLogs: {
        // Would query from destination in production
        totalEvents: 0,
        lastEvent: null,
      },
      security: {
        mfaEnabled: false,
        activeSessions: 0,
        failedLogins: 0,
      },
    };

    res.json(dashboard);
  } catch (err) {
    console.error("Enterprise dashboard error:", err);
    res.status(500).json({ error: "Failed to get enterprise dashboard" });
  }
});

export default router;