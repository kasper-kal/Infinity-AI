import { Router, Request, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../../middleware/auth-middleware";
import { auditLogger, AuditHelpers, DatadogAuditDestination, SplunkAuditDestination, CustomWebhookAuditDestination, SumoLogicAuditDestination, type AuditEventType } from "../../lib/enterprise/audit-logs";
import { SSOManager, SSOConfig, createSSOConfigWithProviders, initializeSSO, getSSOManager } from "../../lib/enterprise/sso";
import { VPCConfig, VPCManager, createStandardVPCConfig, vpcManager, TerraformOutput, VPCModuleGenerator } from "../../lib/enterprise/vpc";
import { SCIMServer, SCIMConfig, initializeSCIM, getSCIMServer, SCIMPatchRequest } from "../../lib/enterprise/scim";
import { RBACManager, RBACConfig, initializeRBAC, getRBACManager } from "../../lib/enterprise/rbac";
import { SingleTenantManager, SingleTenantConfig, initializeSingleTenant, getSingleTenantManager } from "../../lib/enterprise/single-tenant";

const router = Router();

// Audit destination type (inline to avoid esbuild export resolution issue)
type AuditDestinationType =
  | "clickhouse"
  | "bigquery"
  | "postgresql"
  | "elasticsearch"
  | "webhook"
  | "file"
  | "console"
  | "datadog"
  | "splunk"
  | "sumologic"
  | "custom-webhook";

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
// SCIM Provisioning Routes
// ============================================

/**
 * POST /api/infinity/enterprise/scim/configure
 * Configure SCIM provisioning
 */
router.post("/scim/configure", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = req.body as SCIMConfig;

    // Validate required fields
    if (!config.baseUrl || !config.bearerToken) {
      return res.status(400).json({ error: "baseUrl and bearerToken are required" });
    }

    const scimServer = initializeSCIM(config);

    res.json({
      success: true,
      message: "SCIM configuration updated",
      config: {
        baseUrl: config.baseUrl,
        enableUserProvisioning: config.enableUserProvisioning,
        enableGroupProvisioning: config.enableGroupProvisioning,
      },
    });
  } catch (err) {
    console.error("SCIM configure error:", err);
    res.status(500).json({ error: "Failed to configure SCIM" });
  }
});

/**
 * GET /api/infinity/enterprise/scim/config
 * Get current SCIM configuration status
 */
router.get("/scim/config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scimServer = getSCIMServer();

    if (!scimServer) {
      return res.json({
        configured: false,
        message: "SCIM not configured",
      });
    }

    res.json({
      configured: true,
      baseUrl: scimServer.config.baseUrl,
      enableUserProvisioning: scimServer.config.enableUserProvisioning,
      enableGroupProvisioning: scimServer.config.enableGroupProvisioning,
    });
  } catch (err) {
    console.error("SCIM config error:", err);
    res.status(500).json({ error: "Failed to get SCIM configuration" });
  }
});

/**
 * GET /api/infinity/enterprise/scim/ServiceProviderConfig
 * Get SCIM Service Provider Configuration
 */
router.get("/scim/ServiceProviderConfig", async (req: Request, res: Response) => {
  try {
    const scimServer = getSCIMServer();

    if (!scimServer) {
      return res.status(404).json({ error: "SCIM not configured" });
    }

    const config = await scimServer.getServiceProviderConfig();
    res.json(config);
  } catch (err) {
    console.error("SCIM ServiceProviderConfig error:", err);
    res.status(500).json({ error: "Failed to get service provider config" });
  }
});

/**
 * GET /api/infinity/enterprise/scim/ResourceTypes
 * Get SCIM Resource Types
 */
router.get("/scim/ResourceTypes", async (req: Request, res: Response) => {
  try {
    const scimServer = getSCIMServer();

    if (!scimServer) {
      return res.status(404).json({ error: "SCIM not configured" });
    }

    const types = await scimServer.getResourceTypes();
    res.json(types);
  } catch (err) {
    console.error("SCIM ResourceTypes error:", err);
    res.status(500).json({ error: "Failed to get resource types" });
  }
});

/**
 * GET /api/infinity/enterprise/scim/Schemas
 * Get SCIM Schemas
 */
router.get("/scim/Schemas", async (req: Request, res: Response) => {
  try {
    const scimServer = getSCIMServer();

    if (!scimServer) {
      return res.status(404).json({ error: "SCIM not configured" });
    }

    const schemas = await scimServer.getSchemas();
    res.json(schemas);
  } catch (err) {
    console.error("SCIM Schemas error:", err);
    res.status(500).json({ error: "Failed to get schemas" });
  }
});

/**
 * SCIM User Routes
 * All require Bearer token authentication
 */

function validateSCIMToken(req: Request, res: Response): SCIMServer | null {
  const scimServer = getSCIMServer();
  if (!scimServer) {
    res.status(404).json({ error: "SCIM not configured" });
    return null;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 401,
      detail: "Invalid or missing Bearer token",
    });
    return null;
  }

  const token = authHeader.substring(7);
  if (token !== scimServer.config.bearerToken) {
    res.status(401).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 401,
      detail: "Invalid Bearer token",
    });
    return null;
  }

  return scimServer;
}

/**
 * POST /api/infinity/enterprise/scim/Users
 * Create a new user
 */
router.post("/scim/Users", async (req: Request, res: Response) => {
  try {
    const scimServer = validateSCIMToken(req, res);
    if (!scimServer) return;

    const user = req.body as any;
    const authHeader = req.headers.authorization!;
    const result = await scimServer.createUser(user, authHeader);

    if ("error" in result) {
      return res.status(result.status).json(result.error);
    }

    res.status(result.status).json(result.user);
  } catch (err) {
    console.error("SCIM create user error:", err);
    res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 500,
      detail: "Failed to create user",
    });
  }
});

/**
 * GET /api/infinity/enterprise/scim/Users/:id
 * Get a user by ID
 */
router.get("/scim/Users/:id", async (req: Request, res: Response) => {
  try {
    const scimServer = validateSCIMToken(req, res);
    if (!scimServer) return;

    const { id } = req.params;
    const authHeader = req.headers.authorization!;
    const result = await scimServer.getUser(id, authHeader);

    if ("error" in result) {
      return res.status(result.status).json(result.error);
    }

    res.json(result.user);
  } catch (err) {
    console.error("SCIM get user error:", err);
    res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 500,
      detail: "Failed to get user",
    });
  }
});

/**
 * GET /api/infinity/enterprise/scim/Users
 * List users with pagination and filtering
 */
router.get("/scim/Users", async (req: Request, res: Response) => {
  try {
    const scimServer = validateSCIMToken(req, res);
    if (!scimServer) return;

    const authHeader = req.headers.authorization!;
    const params = {
      startIndex: parseInt(req.query.startIndex as string) || 1,
      count: parseInt(req.query.count as string) || 100,
      filter: req.query.filter as string,
      attributes: req.query.attributes as string,
      excludedAttributes: req.query.excludedAttributes as string,
    };

    const result = await scimServer.listUsers(authHeader, params);

    if ("error" in result) {
      return res.status(result.status).json(result.error);
    }

    res.json(result.response);
  } catch (err) {
    console.error("SCIM list users error:", err);
    res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 500,
      detail: "Failed to list users",
    });
  }
});

/**
 * PUT /api/infinity/enterprise/scim/Users/:id
 * Replace a user (full update)
 */
router.put("/scim/Users/:id", async (req: Request, res: Response) => {
  try {
    const scimServer = validateSCIMToken(req, res);
    if (!scimServer) return;

    const { id } = req.params;
    const user = req.body as any;
    const authHeader = req.headers.authorization!;
    const result = await scimServer.replaceUser(id, user, authHeader);

    if ("error" in result) {
      return res.status(result.status).json(result.error);
    }

    res.json(result.user);
  } catch (err) {
    console.error("SCIM replace user error:", err);
    res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 500,
      detail: "Failed to replace user",
    });
  }
});

/**
 * PATCH /api/infinity/enterprise/scim/Users/:id
 * Patch a user (partial update)
 */
router.patch("/scim/Users/:id", async (req: Request, res: Response) => {
  try {
    const scimServer = validateSCIMToken(req, res);
    if (!scimServer) return;

    const { id } = req.params;
    const patch = req.body as SCIMPatchRequest;
    const authHeader = req.headers.authorization!;
    const result = await scimServer.patchUser(id, patch, authHeader);

    if ("error" in result) {
      return res.status(result.status).json(result.error);
    }

    res.json(result.user);
  } catch (err) {
    console.error("SCIM patch user error:", err);
    res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 500,
      detail: "Failed to patch user",
    });
  }
});

/**
 * DELETE /api/infinity/enterprise/scim/Users/:id
 * Delete a user
 */
router.delete("/scim/Users/:id", async (req: Request, res: Response) => {
  try {
    const scimServer = validateSCIMToken(req, res);
    if (!scimServer) return;

    const { id } = req.params;
    const authHeader = req.headers.authorization!;
    const result = await scimServer.deleteUser(id, authHeader);

    if ("error" in result) {
      return res.status(result.status).json(result.error);
    }

    res.status(204).send();
  } catch (err) {
    console.error("SCIM delete user error:", err);
    res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: 500,
      detail: "Failed to delete user",
    });
  }
});

/**
 * SCIM Group Routes (placeholder - not fully implemented)
 */

router.post("/scim/Groups", async (req: Request, res: Response) => {
  const scimServer = validateSCIMToken(req, res);
  if (!scimServer) return;
  res.status(501).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: 501,
    detail: "Group provisioning not yet implemented",
  });
});

router.get("/scim/Groups/:id", async (req: Request, res: Response) => {
  const scimServer = validateSCIMToken(req, res);
  if (!scimServer) return;
  res.status(501).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: 501,
    detail: "Group provisioning not yet implemented",
  });
});

router.get("/scim/Groups", async (req: Request, res: Response) => {
  const scimServer = validateSCIMToken(req, res);
  if (!scimServer) return;
  res.status(501).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: 501,
    detail: "Group provisioning not yet implemented",
  });
});

router.put("/scim/Groups/:id", async (req: Request, res: Response) => {
  const scimServer = validateSCIMToken(req, res);
  if (!scimServer) return;
  res.status(501).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: 501,
    detail: "Group provisioning not yet implemented",
  });
});

router.patch("/scim/Groups/:id", async (req: Request, res: Response) => {
  const scimServer = validateSCIMToken(req, res);
  if (!scimServer) return;
  res.status(501).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: 501,
    detail: "Group provisioning not yet implemented",
  });
});

router.delete("/scim/Groups/:id", async (req: Request, res: Response) => {
  const scimServer = validateSCIMToken(req, res);
  if (!scimServer) return;
  res.status(501).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: 501,
    detail: "Group provisioning not yet implemented",
  });
});

// ============================================
// Observability Export Routes
// ============================================

/**
 * GET /api/infinity/enterprise/observability/destinations
 * Get configured audit log destinations
 */
router.get("/observability/destinations", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // In production, fetch from database
    const destinations = [
      { type: AuditDestinationType.CLOUD_LOGGING, name: "Google Cloud Logging", enabled: true },
      { type: AuditDestinationType.CLOUDWATCH, name: "AWS CloudWatch", enabled: false },
      { type: AuditDestinationType.AZURE_MONITOR, name: "Azure Monitor", enabled: false },
      { type: AuditDestinationType.CLICKHOUSE, name: "ClickHouse", enabled: false },
      { type: AuditDestinationType.BIGQUERY, name: "BigQuery", enabled: false },
      { type: AuditDestinationType.SPLUNK_HEC, name: "Splunk HEC", enabled: false },
      { type: AuditDestinationType.DATADOG, name: "Datadog", enabled: false },
      { type: AuditDestinationType.SUMO_LOGIC, name: "Sumo Logic", enabled: false },
      { type: AuditDestinationType.CUSTOM_WEBHOOK, name: "Custom Webhook", enabled: false },
    ];

    res.json({ destinations });
  } catch (err) {
    console.error("Get observability destinations error:", err);
    res.status(500).json({ error: "Failed to get observability destinations" });
  }
});

/**
 * POST /api/infinity/enterprise/observability/destinations
 * Configure audit log destination
 */
router.post("/observability/destinations", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, name, config, enabled } = req.body;

    if (!type || !name || !config) {
      return res.status(400).json({ error: "type, name, and config are required" });
    }

    // In production, validate and save to database
    // Test connection to destination

    await auditLogger.log({
      type: AuditEventType.SYSTEM_CONFIG_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "observability_destination", id: type, name },
      action: "configure_destination",
      outcome: "success",
      metadata: { type, enabled },
      severity: "info",
    });

    res.json({ success: true, message: "Observability destination configured" });
  } catch (err) {
    console.error("Configure observability destination error:", err);
    res.status(500).json({ error: "Failed to configure observability destination" });
  }
});

/**
 * POST /api/infinity/enterprise/observability/destinations/test
 * Test audit log destination
 */
router.post("/observability/destinations/test", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, config } = req.body;

    if (!type || !config) {
      return res.status(400).json({ error: "type and config are required" });
    }

    // In production, test the actual destination
    await auditLogger.log({
      type: AuditEventType.SYSTEM_CONFIG_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "observability_destination", id: type, name: "Test" },
      action: "test_destination",
      outcome: "success",
      metadata: { type },
      severity: "info",
    });

    res.json({ success: true, message: "Test event sent successfully" });
  } catch (err) {
    console.error("Test observability destination error:", err);
    res.status(500).json({ error: "Failed to test observability destination" });
  }
});

// ============================================
// RBAC Routes
// ============================================

/**
 * GET /api/infinity/enterprise/rbac/roles
 * Get all roles (system and custom)
 */
router.get("/rbac/roles", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const roles = rbacManager.getAllRoles();
    res.json({ roles });
  } catch (err) {
    console.error("Get RBAC roles error:", err);
    res.status(500).json({ error: "Failed to get RBAC roles" });
  }
});

/**
 * GET /api/infinity/enterprise/rbac/roles/:roleId
 * Get specific role details
 */
router.get("/rbac/roles/:roleId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { roleId } = req.params;
    const role = rbacManager.getRole(roleId);

    if (!role) {
      return res.status(404).json({ error: "Role not found" });
    }

    res.json({ role });
  } catch (err) {
    console.error("Get RBAC role error:", err);
    res.status(500).json({ error: "Failed to get RBAC role" });
  }
});

/**
 * POST /api/infinity/enterprise/rbac/roles
 * Create a custom role
 */
router.post("/rbac/roles", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { id, name, description, permissions, inherits, conditions } = req.body;

    if (!id || !name || !permissions || !Array.isArray(permissions)) {
      return res.status(400).json({ error: "id, name, and permissions array are required" });
    }

    const role = rbacManager.createCustomRole({
      id,
      name,
      description: description || "",
      permissions,
      inherits: inherits || [],
      conditions: conditions || [],
      isSystem: false,
    });

    await auditLogger.log({
      type: AuditEventType.ROLE_ASSIGNMENT_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "role", id, name },
      action: "create_custom_role",
      outcome: "success",
      metadata: { permissions, inherits },
      severity: "info",
    });

    res.status(201).json({ role });
  } catch (err) {
    console.error("Create RBAC role error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create role" });
  }
});

/**
 * PUT /api/infinity/enterprise/rbac/roles/:roleId
 * Update a custom role
 */
router.put("/rbac/roles/:roleId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { roleId } = req.params;
    const updates = req.body;

    const role = rbacManager.updateCustomRole(roleId, updates);

    await auditLogger.log({
      type: AuditEventType.ROLE_ASSIGNMENT_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "role", id: roleId },
      action: "update_custom_role",
      outcome: "success",
      metadata: updates,
      severity: "info",
    });

    res.json({ role });
  } catch (err) {
    console.error("Update RBAC role error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update role" });
  }
});

/**
 * DELETE /api/infinity/enterprise/rbac/roles/:roleId
 * Delete a custom role
 */
router.delete("/rbac/roles/:roleId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { roleId } = req.params;

    rbacManager.deleteCustomRole(roleId);

    await auditLogger.log({
      type: AuditEventType.ROLE_ASSIGNMENT_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "role", id: roleId },
      action: "delete_custom_role",
      outcome: "success",
      severity: "info",
    });

    res.status(204).send();
  } catch (err) {
    console.error("Delete RBAC role error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete role" });
  }
});

/**
 * GET /api/infinity/enterprise/rbac/permissions
 * Get all available permissions
 */
router.get("/rbac/permissions", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const permissions = rbacManager.getAllPermissions();
    res.json({ permissions });
  } catch (err) {
    console.error("Get RBAC permissions error:", err);
    res.status(500).json({ error: "Failed to get RBAC permissions" });
  }
});

/**
 * POST /api/infinity/enterprise/rbac/assignments
 * Assign role to principal
 */
router.post("/rbac/assignments", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { principalId, principalType, roleId, resourceType, resourceId, expiresAt } = req.body;

    if (!principalId || !principalType || !roleId) {
      return res.status(400).json({ error: "principalId, principalType, and roleId are required" });
    }

    const assignment = rbacManager.assignRole(principalId, principalType, roleId, {
      resourceType,
      resourceId,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      assignedBy: req.accountId!,
    });

    await auditLogger.log({
      type: AuditEventType.ROLE_ASSIGNMENT_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "role_assignment", id: assignment.id },
      action: "assign_role",
      outcome: "success",
      metadata: { principalId, principalType, roleId, resourceType, resourceId },
      severity: "info",
    });

    res.status(201).json({ assignment });
  } catch (err) {
    console.error("Assign RBAC role error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to assign role" });
  }
});

/**
 * GET /api/infinity/enterprise/rbac/assignments
 * List role assignments
 */
router.get("/rbac/assignments", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { principalId, roleId, resourceType, resourceId } = req.query;

    const assignments = rbacManager.getAssignments({
      principalId: principalId as string,
      roleId: roleId as string,
      resourceType: resourceType as string,
      resourceId: resourceId as string,
    });

    res.json({ assignments });
  } catch (err) {
    console.error("List RBAC assignments error:", err);
    res.status(500).json({ error: "Failed to list role assignments" });
  }
});

/**
 * DELETE /api/infinity/enterprise/rbac/assignments/:assignmentId
 * Revoke role assignment
 */
router.delete("/rbac/assignments/:assignmentId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { assignmentId } = req.params;

    rbacManager.revokeAssignment(assignmentId, req.accountId!);

    await auditLogger.log({
      type: AuditEventType.ROLE_ASSIGNMENT_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "role_assignment", id: assignmentId },
      action: "revoke_role_assignment",
      outcome: "success",
      severity: "info",
    });

    res.status(204).send();
  } catch (err) {
    console.error("Revoke RBAC assignment error:", err);
    res.status(500).json({ error: "Failed to revoke role assignment" });
  }
});

/**
 * POST /api/infinity/enterprise/rbac/check
 * Check permission for principal
 */
router.post("/rbac/check", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { principalId, permission, resourceType, resourceId, context } = req.body;

    if (!principalId || !permission) {
      return res.status(400).json({ error: "principalId and permission are required" });
    }

    const result = rbacManager.checkPermission(principalId, permission, {
      resourceType,
      resourceId,
      context,
    });

    res.json({ allowed: result.allowed, reason: result.reason, matchedRoles: result.matchedRoles });
  } catch (err) {
    console.error("Check RBAC permission error:", err);
    res.status(500).json({ error: "Failed to check permission" });
  }
});

/**
 * GET /api/infinity/enterprise/rbac/audit
 * Get RBAC audit log
 */
router.get("/rbac/audit", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rbacManager = getRBACManager();
    if (!rbacManager) {
      return res.status(404).json({ error: "RBAC not initialized" });
    }

    const { limit = "100", offset = "0" } = req.query;
    const auditLog = rbacManager.getAuditLog(parseInt(limit as string), parseInt(offset as string));

    res.json({ auditLog });
  } catch (err) {
    console.error("Get RBAC audit log error:", err);
    res.status(500).json({ error: "Failed to get RBAC audit log" });
  }
});

/**
 * POST /api/infinity/enterprise/rbac/initialize
 * Initialize RBAC with default configuration
 */
router.post("/rbac/initialize", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = req.body as any;

    const rbacManager = initializeRBAC(config);

    res.json({
      success: true,
      message: "RBAC initialized",
      roles: rbacManager.getAllRoles().length,
      permissions: rbacManager.getAllPermissions().length,
    });
  } catch (err) {
    console.error("Initialize RBAC error:", err);
    res.status(500).json({ error: "Failed to initialize RBAC" });
  }
});

// ============================================
// Single Tenant Routes
// ============================================

/**
 * POST /api/infinity/enterprise/single-tenant/provision
 * Provision a new single-tenant environment
 */
router.post("/single-tenant/provision", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const config = req.body as Omit<SingleTenantConfig, "createdAt" | "updatedAt" | "createdBy">;

    if (!config.name || !config.tier) {
      return res.status(400).json({ error: "name and tier are required" });
    }

    const fullConfig: Omit<SingleTenantConfig, "createdAt" | "updatedAt" | "createdBy"> = {
      ...config,
      tenantId: config.tenantId || `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };

    const result = await singleTenantManager.provision(fullConfig);

    await auditLogger.log({
      type: AuditEventType.DEPLOYMENT_CREATE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "single_tenant", id: result.tenantId, name: config.name },
      action: "provision_single_tenant",
      outcome: result.success ? "success" : "failure",
      metadata: { tier: config.tier, error: result.error },
      severity: result.success ? "info" : "error",
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error("Provision single tenant error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to provision single tenant" });
  }
});

/**
 * GET /api/infinity/enterprise/single-tenant
 * List all single-tenant environments
 */
router.get("/single-tenant", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const tenants = singleTenantManager.listTenants();

    res.json({ tenants });
  } catch (err) {
    console.error("List single tenants error:", err);
    res.status(500).json({ error: "Failed to list single tenants" });
  }
});

/**
 * GET /api/infinity/enterprise/single-tenant/:tenantId
 * Get single-tenant configuration
 */
router.get("/single-tenant/:tenantId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const tenant = singleTenantManager.getTenant(tenantId);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    res.json({ tenant });
  } catch (err) {
    console.error("Get single tenant error:", err);
    res.status(500).json({ error: "Failed to get single tenant" });
  }
});

/**
 * GET /api/infinity/enterprise/single-tenant/:tenantId/status
 * Get single-tenant status
 */
router.get("/single-tenant/:tenantId/status", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const status = singleTenantManager.getStatus(tenantId);

    if (!status) {
      return res.status(404).json({ error: "Tenant status not found" });
    }

    res.json({ status });
  } catch (err) {
    console.error("Get single tenant status error:", err);
    res.status(500).json({ error: "Failed to get single tenant status" });
  }
});

/**
 * PUT /api/infinity/enterprise/single-tenant/:tenantId
 * Update single-tenant configuration
 */
router.put("/single-tenant/:tenantId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const updates = req.body;

    const tenant = singleTenantManager.updateTenant(tenantId, updates);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    await auditLogger.log({
      type: AuditEventType.SYSTEM_CONFIG_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "single_tenant", id: tenantId },
      action: "update_single_tenant",
      outcome: "success",
      metadata: updates,
      severity: "info",
    });

    res.json({ tenant });
  } catch (err) {
    console.error("Update single tenant error:", err);
    res.status(500).json({ error: "Failed to update single tenant" });
  }
});

/**
 * POST /api/infinity/enterprise/single-tenant/:tenantId/suspend
 * Suspend a single-tenant environment
 */
router.post("/single-tenant/:tenantId/suspend", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const success = await singleTenantManager.suspend(tenantId);

    if (!success) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    await auditLogger.log({
      type: AuditEventType.SYSTEM_CONFIG_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "single_tenant", id: tenantId },
      action: "suspend_single_tenant",
      outcome: "success",
      severity: "warning",
    });

    res.json({ success: true, message: "Tenant suspended" });
  } catch (err) {
    console.error("Suspend single tenant error:", err);
    res.status(500).json({ error: "Failed to suspend single tenant" });
  }
});

/**
 * POST /api/infinity/enterprise/single-tenant/:tenantId/resume
 * Resume a suspended single-tenant environment
 */
router.post("/single-tenant/:tenantId/resume", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const success = await singleTenantManager.resume(tenantId);

    if (!success) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    await auditLogger.log({
      type: AuditEventType.SYSTEM_CONFIG_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "single_tenant", id: tenantId },
      action: "resume_single_tenant",
      outcome: "success",
      severity: "info",
    });

    res.json({ success: true, message: "Tenant resumed" });
  } catch (err) {
    console.error("Resume single tenant error:", err);
    res.status(500).json({ error: "Failed to resume single tenant" });
  }
});

/**
 * POST /api/infinity/enterprise/single-tenant/:tenantId/deprovision
 * Deprovision a single-tenant environment
 */
router.post("/single-tenant/:tenantId/deprovision", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const { force = false } = req.body;

    const success = await singleTenantManager.deprovision(tenantId, force);

    if (!success) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    await auditLogger.log({
      type: AuditEventType.DEPLOYMENT_DELETE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "single_tenant", id: tenantId },
      action: "deprovision_single_tenant",
      outcome: "success",
      metadata: { force },
      severity: "warning",
    });

    res.json({ success: true, message: "Tenant deprovisioned" });
  } catch (err) {
    console.error("Deprovision single tenant error:", err);
    res.status(500).json({ error: "Failed to deprovision single tenant" });
  }
});

/**
 * GET /api/infinity/enterprise/single-tenant/:tenantId/provisioning
 * Get provisioning job status
 */
router.get("/single-tenant/:tenantId/provisioning", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const provisioning = singleTenantManager.getProvisioningStatus(tenantId);

    if (!provisioning) {
      return res.status(404).json({ error: "Provisioning status not found" });
    }

    res.json({ provisioning });
  } catch (err) {
    console.error("Get provisioning status error:", err);
    res.status(500).json({ error: "Failed to get provisioning status" });
  }
});

/**
 * POST /api/infinity/enterprise/single-tenant/:tenantId/upgrade
 * Upgrade single-tenant version
 */
router.post("/single-tenant/:tenantId/upgrade", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singleTenantManager = getSingleTenantManager();
    if (!singleTenantManager) {
      return res.status(404).json({ error: "Single Tenant not initialized" });
    }

    const { tenantId } = req.params;
    const { targetVersion } = req.body;

    if (!targetVersion) {
      return res.status(400).json({ error: "targetVersion is required" });
    }

    const success = await singleTenantManager.upgrade(tenantId, targetVersion);

    if (!success) {
      return res.status(404).json({ error: "Tenant not found or upgrade failed" });
    }

    await auditLogger.log({
      type: AuditEventType.SYSTEM_CONFIG_CHANGE,
      actor: { type: "user", id: req.accountId!, email: req.userEmail },
      resource: { type: "single_tenant", id: tenantId },
      action: "upgrade_single_tenant",
      outcome: "success",
      metadata: { targetVersion },
      severity: "info",
    });

    res.json({ success: true, message: `Tenant upgraded to ${targetVersion}` });
  } catch (err) {
    console.error("Upgrade single tenant error:", err);
    res.status(500).json({ error: "Failed to upgrade single tenant" });
  }
});

/**
 * POST /api/infinity/enterprise/single-tenant/initialize
 * Initialize Single Tenant manager
 */
router.post("/single-tenant/initialize", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    initializeSingleTenant();

    res.json({ success: true, message: "Single Tenant manager initialized" });
  } catch (err) {
    console.error("Initialize Single Tenant error:", err);
    res.status(500).json({ error: "Failed to initialize Single Tenant" });
  }
});

/**
 * GET /api/infinity/enterprise/single-tenant/default-config
 * Get default single-tenant configuration template
 */
router.get("/single-tenant/default-config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { createDefaultSingleTenantConfig } = await import("../../lib/enterprise/single-tenant");
    const config = createDefaultSingleTenantConfig();

    res.json({ config });
  } catch (err) {
    console.error("Get default single tenant config error:", err);
    res.status(500).json({ error: "Failed to get default configuration" });
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
    const scimServer = getSCIMServer();

    const dashboard = {
      sso: {
        configured: !!ssoManager,
        providers: ssoManager?.getProviders().map(p => ({
          type: p.type,
          name: p.name,
          configured: p.isConfigured(),
        })) || [],
      },
      scim: {
        configured: !!scimServer,
        baseUrl: scimServer?.config.baseUrl || null,
        enableUserProvisioning: scimServer?.config.enableUserProvisioning || false,
        enableGroupProvisioning: scimServer?.config.enableGroupProvisioning || false,
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