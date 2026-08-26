import { logger } from "../logger";

/**
 * Phase 14: Enterprise Single-Tenant Option
 * Isolated control plane + data plane per enterprise.
 * $0 budget — uses open-source infrastructure, Kubernetes namespaces, database schemas.
 */

export type SingleTenantStatus =
  | "provisioning"
  | "active"
  | "maintenance"
  | "deprovisioning"
  | "failed"
  | "suspended";

export type SingleTenantTier =
  | "standard"
  | "dedicated"
  | "isolated";

export interface SingleTenantConfig {
  /** Unique tenant ID */
  tenantId: string;
  /** Human-readable name */
  name: string;
  /** Tier of isolation */
  tier: SingleTenantTier;
  /** Kubernetes namespace for control plane */
  controlPlaneNamespace: string;
  /** Kubernetes namespace for data plane */
  dataPlaneNamespace: string;
  /** Database schema prefix */
  databaseSchema: string;
  /** Dedicated VPC configuration */
  vpcConfig?: {
    provider: "gcp" | "aws" | "azure";
    region: string;
    cidrBlock: string;
  };
  /** Static outbound IPs */
  staticOutboundIPs?: number;
  /** Custom domain */
  customDomain?: string;
  /** TLS certificate ARN/ID */
  tlsCertificateId?: string;
  /** Resource quotas */
  quotas?: {
    maxProjects?: number;
    maxBuildsPerHour?: number;
    maxConcurrentBuilds?: number;
    maxStorageGB?: number;
    maxApiCallsPerMinute?: number;
  };
  /** Feature flags */
  features?: {
    ssoEnabled?: boolean;
    scimEnabled?: boolean;
    vpcPeeringEnabled?: boolean;
    auditLogsEnabled?: boolean;
    customModelsEnabled?: boolean;
  };
  /** Maintenance window */
  maintenanceWindow?: {
    dayOfWeek: number; // 0-6
    startHour: number; // 0-23
    durationHours: number;
    timezone: string;
  };
  /** Backup configuration */
  backupConfig?: {
    enabled: boolean;
    schedule: string; // cron expression
    retentionDays: number;
    destination: "s3" | "gcs" | "azure-blob";
    bucket: string;
  };
  /** Monitoring configuration */
  monitoringConfig?: {
    enabled: boolean;
    prometheusEndpoint?: string;
    grafanaDashboardId?: string;
    alertWebhook?: string;
  };
  /** Compliance settings */
  compliance?: {
    dataResidency?: string; // e.g., "eu-west-1", "us-east-1"
    encryptionAtRest?: boolean;
    encryptionInTransit?: boolean;
    auditLoggingLevel?: "basic" | "detailed" | "full";
  };
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Created by user ID */
  createdBy: string;
}

export interface SingleTenantStatusInfo {
  tenantId: string;
  status: SingleTenantStatus;
  health: "healthy" | "degraded" | "unhealthy";
  lastHealthCheck: string;
  uptimePercentage: number;
  activeProjects: number;
  activeBuilds: number;
  storageUsedGB: number;
  apiCallsLastHour: number;
  currentVersion: string;
  pendingUpdates: number;
  issues: SingleTenantIssue[];
}

export interface SingleTenantIssue {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  detectedAt: string;
  resolvedAt?: string;
  autoResolvable: boolean;
}

export interface ProvisioningResult {
  success: boolean;
  tenantId?: string;
  controlPlaneUrl?: string;
  dataPlaneUrl?: string;
  adminCredentials?: {
    username: string;
    password: string;
  };
  error?: string;
  steps: ProvisioningStep[];
}

export interface ProvisioningStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Single Tenant Manager — handles provisioning, lifecycle, and management of single-tenant environments
 */
export class SingleTenantManager {
  private tenants: Map<string, SingleTenantConfig> = new Map();
  private statusCache: Map<string, SingleTenantStatusInfo> = new Map();
  private provisioningJobs: Map<string, ProvisioningResult> = new Map();

  constructor() {
    // Load from persistent storage in production
  }

  /**
   * Provision a new single-tenant environment
   */
  async provision(config: Omit<SingleTenantConfig, "createdAt" | "updatedAt">): Promise<ProvisioningResult> {
    const tenantId = config.tenantId || `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    const fullConfig: SingleTenantConfig = {
      ...config,
      tenantId,
      createdAt: now,
      updatedAt: now,
    };

    const steps: ProvisioningStep[] = [
      { name: "Validate configuration", status: "pending" },
      { name: "Create Kubernetes namespaces", status: "pending" },
      { name: "Provision database schema", status: "pending" },
      { name: "Configure VPC and networking", status: "pending" },
      { name: "Deploy control plane", status: "pending" },
      { name: "Deploy data plane", status: "pending" },
      { name: "Configure DNS and TLS", status: "pending" },
      { name: "Set up monitoring and alerting", status: "pending" },
      { name: "Configure backups", status: "pending" },
      { name: "Run health checks", status: "pending" },
      { name: "Generate admin credentials", status: "pending" },
    ];

    const result: ProvisioningResult = {
      success: false,
      tenantId,
      steps,
    };

    this.provisioningJobs.set(tenantId, result);

    try {
      // Step 1: Validate configuration
      result.steps[0].status = "running";
      result.steps[0].startedAt = new Date().toISOString();
      await this.validateConfig(fullConfig);
      result.steps[0].status = "completed";
      result.steps[0].completedAt = new Date().toISOString();

      // Step 2: Create Kubernetes namespaces
      result.steps[1].status = "running";
      result.steps[1].startedAt = new Date().toISOString();
      await this.createNamespaces(fullConfig);
      result.steps[1].status = "completed";
      result.steps[1].completedAt = new Date().toISOString();

      // Step 3: Provision database schema
      result.steps[2].status = "running";
      result.steps[2].startedAt = new Date().toISOString();
      await this.provisionDatabase(fullConfig);
      result.steps[2].status = "completed";
      result.steps[2].completedAt = new Date().toISOString();

      // Step 4: Configure VPC and networking
      result.steps[3].status = "running";
      result.steps[3].startedAt = new Date().toISOString();
      await this.configureNetworking(fullConfig);
      result.steps[3].status = "completed";
      result.steps[3].completedAt = new Date().toISOString();

      // Step 5: Deploy control plane
      result.steps[4].status = "running";
      result.steps[4].startedAt = new Date().toISOString();
      const controlPlaneUrl = await this.deployControlPlane(fullConfig);
      result.controlPlaneUrl = controlPlaneUrl;
      result.steps[4].status = "completed";
      result.steps[4].completedAt = new Date().toISOString();

      // Step 6: Deploy data plane
      result.steps[5].status = "running";
      result.steps[5].startedAt = new Date().toISOString();
      const dataPlaneUrl = await this.deployDataPlane(fullConfig);
      result.dataPlaneUrl = dataPlaneUrl;
      result.steps[5].status = "completed";
      result.steps[5].completedAt = new Date().toISOString();

      // Step 7: Configure DNS and TLS
      result.steps[6].status = "running";
      result.steps[6].startedAt = new Date().toISOString();
      await this.configureDNSAndTLS(fullConfig);
      result.steps[6].status = "completed";
      result.steps[6].completedAt = new Date().toISOString();

      // Step 8: Set up monitoring and alerting
      result.steps[7].status = "running";
      result.steps[7].startedAt = new Date().toISOString();
      await this.setupMonitoring(fullConfig);
      result.steps[7].status = "completed";
      result.steps[7].completedAt = new Date().toISOString();

      // Step 9: Configure backups
      result.steps[8].status = "running";
      result.steps[8].startedAt = new Date().toISOString();
      await this.configureBackups(fullConfig);
      result.steps[8].status = "completed";
      result.steps[8].completedAt = new Date().toISOString();

      // Step 10: Run health checks
      result.steps[9].status = "running";
      result.steps[9].startedAt = new Date().toISOString();
      await this.runHealthChecks(tenantId);
      result.steps[9].status = "completed";
      result.steps[9].completedAt = new Date().toISOString();

      // Step 11: Generate admin credentials
      result.steps[10].status = "running";
      result.steps[10].startedAt = new Date().toISOString();
      const adminCredentials = await this.generateAdminCredentials(fullConfig);
      result.adminCredentials = adminCredentials;
      result.steps[10].status = "completed";
      result.steps[10].completedAt = new Date().toISOString();

      // Save tenant config
      this.tenants.set(tenantId, fullConfig);

      // Initialize status
      this.statusCache.set(tenantId, {
        tenantId,
        status: "active",
        health: "healthy",
        lastHealthCheck: new Date().toISOString(),
        uptimePercentage: 100,
        activeProjects: 0,
        activeBuilds: 0,
        storageUsedGB: 0,
        apiCallsLastHour: 0,
        currentVersion: "1.0.0",
        pendingUpdates: 0,
        issues: [],
      });

      result.success = true;
      logger.info({ tenantId, name: config.name }, "Single tenant provisioned successfully");
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err, tenantId }, "Single tenant provisioning failed");

      // Mark current step as failed
      for (const step of steps) {
        if (step.status === "running") {
          step.status = "failed";
          step.error = error;
          step.completedAt = new Date().toISOString();
          break;
        }
      }

      result.success = false;
      result.error = error;
      return result;
    }
  }

  private async validateConfig(config: SingleTenantConfig): Promise<void> {
    // Validate tenant ID format
    if (!/^[a-z0-9-]+$/.test(config.tenantId)) {
      throw new Error("Tenant ID must be lowercase alphanumeric with hyphens only");
    }

    // Check for conflicts
    if (this.tenants.has(config.tenantId)) {
      throw new Error(`Tenant ${config.tenantId} already exists`);
    }

    // Validate tier-specific requirements
    if (config.tier === "isolated" && !config.vpcConfig) {
      throw new Error("Isolated tier requires VPC configuration");
    }

    // Validate quotas
    if (config.quotas) {
      if (config.quotas.maxProjects && config.quotas.maxProjects < 1) {
        throw new Error("maxProjects must be at least 1");
      }
      if (config.quotas.maxConcurrentBuilds && config.quotas.maxConcurrentBuilds < 1) {
        throw new Error("maxConcurrentBuilds must be at least 1");
      }
    }

    // Validate maintenance window
    if (config.maintenanceWindow) {
      if (config.maintenanceWindow.dayOfWeek < 0 || config.maintenanceWindow.dayOfWeek > 6) {
        throw new Error("maintenanceWindow.dayOfWeek must be 0-6");
      }
      if (config.maintenanceWindow.startHour < 0 || config.maintenanceWindow.startHour > 23) {
        throw new Error("maintenanceWindow.startHour must be 0-23");
      }
    }
  }

  private async createNamespaces(config: SingleTenantConfig): Promise<void> {
    // In production: kubectl create namespace for control plane and data plane
    // Apply network policies, resource quotas, limit ranges
    logger.info({ tenantId: config.tenantId }, "Creating Kubernetes namespaces");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
  }

  private async provisionDatabase(config: SingleTenantConfig): Promise<void> {
    // In production: CREATE SCHEMA, run migrations, set up row-level security
    logger.info({ tenantId: config.tenantId, schema: config.databaseSchema }, "Provisioning database schema");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
  }

  private async configureNetworking(config: SingleTenantConfig): Promise<void> {
    if (!config.vpcConfig) return;

    // In production: Use VPCModuleGenerator to create Terraform, apply
    // Set up VPC peering if enabled
    // Configure static outbound IPs (NAT gateways)
    // Set up private endpoints
    logger.info({ tenantId: config.tenantId, provider: config.vpcConfig.provider }, "Configuring VPC networking");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
  }

  private async deployControlPlane(config: SingleTenantConfig): Promise<string> {
    // In production: Helm install Infinity control plane
    // Configure ingress, secrets, configmaps
    // Return control plane URL
    const url = `https://${config.tenantId}-control.infinity-ai.example.com`;
    logger.info({ tenantId: config.tenantId, url }, "Control plane deployed");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
    return url;
  }

  private async deployDataPlane(config: SingleTenantConfig): Promise<string> {
    // In production: Helm install Infinity data plane (build runners, agent executors)
    // Configure auto-scaling, resource limits
    // Return data plane URL
    const url = `https://${config.tenantId}-data.infinity-ai.example.com`;
    logger.info({ tenantId: config.tenantId, url }, "Data plane deployed");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
    return url;
  }

  private async configureDNSAndTLS(config: SingleTenantConfig): Promise<void> {
    if (!config.customDomain) return;

    // In production: Create DNS records, provision TLS cert (Let's Encrypt or custom)
    // Configure ingress with TLS
    logger.info({ tenantId: config.tenantId, domain: config.customDomain }, "Configuring DNS and TLS");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
  }

  private async setupMonitoring(config: SingleTenantConfig): Promise<void> {
    if (!config.monitoringConfig?.enabled) return;

    // In production: Deploy Prometheus rules, Grafana dashboards, alerting
    logger.info({ tenantId: config.tenantId }, "Setting up monitoring");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
  }

  private async configureBackups(config: SingleTenantConfig): Promise<void> {
    if (!config.backupConfig?.enabled) return;

    // In production: Set up cron jobs, configure backup destination, test restore
    logger.info({ tenantId: config.tenantId }, "Configuring backups");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
  }

  private async runHealthChecks(tenantId: string): Promise<void> {
    // In production: Check all components, verify connectivity, run smoke tests
    logger.info({ tenantId }, "Running health checks");
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate
  }

  private async generateAdminCredentials(config: SingleTenantConfig): Promise<{ username: string; password: string }> {
    // In production: Create initial admin user, generate secure password
    const username = `admin@${config.tenantId}`;
    const password = generateSecurePassword(32);
    logger.info({ tenantId: config.tenantId, username }, "Generated admin credentials");
    return { username, password };
  }

  /**
   * Get tenant configuration
   */
  getTenant(tenantId: string): SingleTenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  /**
   * List all tenants
   */
  listTenants(): SingleTenantConfig[] {
    return Array.from(this.tenants.values());
  }

  /**
   * Get tenant status
   */
  getStatus(tenantId: string): SingleTenantStatusInfo | undefined {
    return this.statusCache.get(tenantId);
  }

  /**
   * Update tenant configuration
   */
  updateTenant(tenantId: string, updates: Partial<Omit<SingleTenantConfig, "tenantId" | "createdAt" | "createdBy">>): SingleTenantConfig | null {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;

    const updated: SingleTenantConfig = {
      ...tenant,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.tenants.set(tenantId, updated);
    logger.info({ tenantId }, "Tenant configuration updated");
    return updated;
  }

  /**
   * Suspend a tenant
   */
  async suspend(tenantId: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    // In production: Scale down deployments, pause cron jobs, disable ingress
    const status = this.statusCache.get(tenantId);
    if (status) {
      status.status = "suspended";
      this.statusCache.set(tenantId, status);
    }

    logger.info({ tenantId }, "Tenant suspended");
    return true;
  }

  /**
   * Resume a suspended tenant
   */
  async resume(tenantId: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    // In production: Scale up deployments, resume cron jobs, enable ingress
    const status = this.statusCache.get(tenantId);
    if (status) {
      status.status = "active";
      this.statusCache.set(tenantId, status);
    }

    logger.info({ tenantId }, "Tenant resumed");
    return true;
  }

  /**
   * Deprovision a tenant
   */
  async deprovision(tenantId: string, force = false): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    const status = this.statusCache.get(tenantId);
    if (status) {
      status.status = "deprovisioning";
      this.statusCache.set(tenantId, status);
    }

    // In production: Drain workloads, delete resources, remove namespaces, drop schema, delete backups
    // Only proceed if force=true or no active projects

    this.tenants.delete(tenantId);
    this.statusCache.delete(tenantId);
    this.provisioningJobs.delete(tenantId);

    logger.info({ tenantId }, "Tenant deprovisioned");
    return true;
  }

  /**
   * Get provisioning job status
   */
  getProvisioningStatus(tenantId: string): ProvisioningResult | undefined {
    return this.provisioningJobs.get(tenantId);
  }

  /**
   * Upgrade tenant version
   */
  async upgrade(tenantId: string, targetVersion: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    const status = this.statusCache.get(tenantId);
    if (status) {
      status.status = "maintenance";
      status.pendingUpdates = 1;
      this.statusCache.set(tenantId, status);
    }

    // In production: Blue-green deployment, run migrations, health checks, switch traffic
    logger.info({ tenantId, targetVersion }, "Upgrading tenant");

    // Simulate upgrade
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (status) {
      status.status = "active";
      status.currentVersion = targetVersion;
      status.pendingUpdates = 0;
      this.statusCache.set(tenantId, status);
    }

    logger.info({ tenantId, version: targetVersion }, "Tenant upgraded");
    return true;
  }
}

/**
 * Generate a secure random password
 */
function generateSecurePassword(length: number): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

/**
 * Default single-tenant configuration template
 */
export function createDefaultSingleTenantConfig(overrides: Partial<SingleTenantConfig> = {}): Omit<SingleTenantConfig, "tenantId" | "createdAt" | "updatedAt" | "createdBy"> {
  return {
    name: overrides.name || "Enterprise Tenant",
    tier: overrides.tier || "dedicated",
    controlPlaneNamespace: `infinity-cp-${overrides.tenantId || "default"}`,
    dataPlaneNamespace: `infinity-dp-${overrides.tenantId || "default"}`,
    databaseSchema: `infinity_${overrides.tenantId || "default"}`,
    vpcConfig: overrides.vpcConfig,
    staticOutboundIPs: overrides.staticOutboundIPs || 2,
    customDomain: overrides.customDomain,
    quotas: {
      maxProjects: 100,
      maxBuildsPerHour: 1000,
      maxConcurrentBuilds: 10,
      maxStorageGB: 500,
      maxApiCallsPerMinute: 10000,
      ...overrides.quotas,
    },
    features: {
      ssoEnabled: true,
      scimEnabled: true,
      vpcPeeringEnabled: true,
      auditLogsEnabled: true,
      customModelsEnabled: true,
      ...overrides.features,
    },
    maintenanceWindow: {
      dayOfWeek: 0, // Sunday
      startHour: 2, // 2 AM
      durationHours: 4,
      timezone: "UTC",
      ...overrides.maintenanceWindow,
    },
    backupConfig: {
      enabled: true,
      schedule: "0 3 * * *", // Daily at 3 AM
      retentionDays: 30,
      destination: "s3",
      bucket: `infinity-backups-${overrides.tenantId || "default"}`,
      ...overrides.backupConfig,
    },
    monitoringConfig: {
      enabled: true,
      ...overrides.monitoringConfig,
    },
    compliance: {
      dataResidency: "us-east-1",
      encryptionAtRest: true,
      encryptionInTransit: true,
      auditLoggingLevel: "detailed",
      ...overrides.compliance,
    },
  };
}

/**
 * Single Tenant Manager instance
 */
export let singleTenantManager: SingleTenantManager | null = null;

/**
 * Initialize Single Tenant Manager
 */
export function initializeSingleTenant(): SingleTenantManager {
  singleTenantManager = new SingleTenantManager();
  return singleTenantManager;
}

/**
 * Get Single Tenant Manager instance
 */
export function getSingleTenantManager(): SingleTenantManager | null {
  return singleTenantManager;
}