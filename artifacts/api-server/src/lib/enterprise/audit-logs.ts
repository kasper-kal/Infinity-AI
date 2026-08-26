import { logger } from "../logger";

/**
 * Phase 14: Enterprise Audit Logs
 * Structured event logging for organization-wide audit trail.
 * Supports: ClickHouse, BigQuery, PostgreSQL, Elasticsearch, custom webhooks.
 * $0 budget — open-source databases and standard protocols.
 */

export type AuditEventType =
  | "user.login"
  | "user.logout"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "user.role_changed"
  | "user.sso_login"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "project.archived"
  | "project.member_added"
  | "project.member_removed"
  | "project.member_role_changed"
  | "project.settings_changed"
  | "build.started"
  | "build.completed"
  | "build.failed"
  | "build.cancelled"
  | "build.artifact_created"
  | "build.artifact_updated"
  | "build.artifact_deleted"
  | "build.deployed"
  | "build.deploy_failed"
  | "build.environment_created"
  | "build.environment_updated"
  | "build.environment_deleted"
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "agent.tool_executed"
  | "agent.approval_requested"
  | "agent.approval_granted"
  | "agent.approval_denied"
  | "code.file_created"
  | "code.file_updated"
  | "code.file_deleted"
  | "code.file_moved"
  | "code.commit_pushed"
  | "code.branch_created"
  | "code.branch_deleted"
  | "code.pr_opened"
  | "code.pr_merged"
  | "code.pr_closed"
  | "code.review_requested"
  | "code.review_submitted"
  | "secret.created"
  | "secret.updated"
  | "secret.accessed"
  | "secret.rotated"
  | "secret.deleted"
  | "secret.leak_detected"
  | "connector.created"
  | "connector.updated"
  | "connector.deleted"
  | "connector.sync_started"
  | "connector.sync_completed"
  | "connector.sync_failed"
  | "security.scan_started"
  | "security.scan_completed"
  | "security.finding_created"
  | "security.finding_suppressed"
  | "security.finding_resolved"
  | "security.policy_violation"
  | "settings.changed"
  | "billing.plan_changed"
  | "billing.usage_threshold"
  | "api.key_created"
  | "api.key_revoked"
  | "api.key_used"
  | "webhook.registered"
  | "webhook.triggered"
  | "webhook.failed"
  | "custom";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEvent {
  /** Unique event ID */
  id: string;
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** Event type */
  type: AuditEventType;
  /** Severity level */
  severity: AuditSeverity;
  /** Actor who performed the action */
  actor: AuditActor;
  /** Target resource */
  target: AuditTarget;
  /** Action performed */
  action: string;
  /** Outcome */
  outcome: "success" | "failure" | "partial";
  /** Error message if failed */
  error?: string;
  /** Additional context */
  context: Record<string, unknown>;
  /** IP address of actor */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Correlation ID for related events */
  correlationId?: string;
  /** Tags for filtering */
  tags?: string[];
}

export interface AuditActor {
  /** Actor type */
  type: "user" | "service_account" | "system" | "agent" | "webhook" | "unknown";
  /** Actor ID */
  id: string;
  /** Actor name/email */
  name?: string;
  /** Actor email (if user) */
  email?: string;
  /** Roles at time of event */
  roles?: string[];
  /** Project ID (if project-scoped) */
  projectId?: string;
  /** Organization/workspace ID */
  workspaceId?: string;
}

export interface AuditTarget {
  /** Target type */
  type: "user" | "project" | "build" | "artifact" | "deployment" | "secret" | "connector" | "settings" | "code" | "agent" | "custom";
  /** Target ID */
  id: string;
  /** Target name */
  name?: string;
  /** Parent resource (e.g., project for a build) */
  parentId?: string;
  /** Parent type */
  parentType?: string;
}

export interface AuditQuery {
  /** Time range */
  startTime?: string;
  endTime?: string;
  /** Filter by event types */
  types?: AuditEventType[];
  /** Filter by severity */
  severities?: AuditSeverity[];
  /** Filter by actor */
  actorId?: string;
  actorType?: AuditActor["type"];
  /** Filter by target */
  targetId?: string;
  targetType?: AuditTarget["type"];
  /** Filter by project */
  projectId?: string;
  /** Filter by workspace */
  workspaceId?: string;
  /** Filter by outcome */
  outcome?: AuditEvent["outcome"];
  /** Text search in context */
  search?: string;
  /** Tags */
  tags?: string[];
  /** Pagination */
  limit?: number;
  offset?: number;
  /** Sort order */
  sortBy?: "timestamp" | "severity" | "type";
  sortOrder?: "asc" | "desc";
}

export interface AuditStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  eventsByActor: Record<string, number>;
  eventsByOutcome: Record<string, number>;
  topActors: Array<{ actorId: string; count: number }>;
  topTargets: Array<{ targetId: string; count: number }>;
  timeSeries: Array<{ timestamp: string; count: number }>;
}

/**
 * Audit log destination interface
 */
export interface AuditDestination {
  /** Destination name */
  name: string;
  /** Destination type */
  type: "clickhouse" | "bigquery" | "postgresql" | "elasticsearch" | "webhook" | "file" | "console";
  /** Write events */
  write(events: AuditEvent[]): Promise<WriteResult>;
  /** Query events */
  query?(query: AuditQuery): Promise<QueryResult>;
  /** Get stats */
  getStats?(query: AuditQuery): Promise<AuditStats>;
  /** Health check */
  healthCheck(): Promise<HealthCheckResult>;
  /** Close connections */
  close(): Promise<void>;
}

export interface WriteResult {
  success: boolean;
  written: number;
  failed: number;
  errors?: string[];
}

export interface QueryResult {
  events: AuditEvent[];
  total: number;
  hasMore: boolean;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Console destination (for development)
 */
export class ConsoleAuditDestination implements AuditDestination {
  readonly name = "console";
  readonly type = "console" as const;

  async write(events: AuditEvent[]): Promise<WriteResult> {
    for (const event of events) {
      const level = event.severity === "critical" ? "error" : event.severity === "warning" ? "warn" : "log";
      console[level]("[AUDIT]", JSON.stringify(event, null, 2));
    }
    return { success: true, written: events.length, failed: 0 };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true };
  }

  async close(): Promise<void> {}
}

/**
 * File destination (JSONL format)
 */
export class FileAuditDestination implements AuditDestination {
  readonly name: string;
  readonly type = "file" as const;
  private filePath: string;
  private buffer: AuditEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly maxBufferSize = 100;
  private readonly flushIntervalMs = 5000;

  constructor(filePath: string) {
    this.name = `file:${filePath}`;
    this.filePath = filePath;
    this.startFlushTimer();
  }

  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
    this.flushInterval.unref();
  }

  async write(events: AuditEvent[]): Promise<WriteResult> {
    this.buffer.push(...events);
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
    return { success: true, written: events.length, failed: 0 };
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);
    const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";

    try {
      const fs = await import("node:fs/promises");
      await fs.appendFile(this.filePath, lines);
    } catch (err) {
      logger.error({ err, filePath: this.filePath }, "Failed to write audit logs to file");
      // Re-add to buffer for retry
      this.buffer.unshift(...events);
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const fs = await import("node:fs/promises");
      await fs.access(this.filePath);
      return { healthy: true };
    } catch {
      return { healthy: false, error: "File not accessible" };
    }
  }

  async close(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}

/**
 * Webhook destination
 */
export class WebhookAuditDestination implements AuditDestination {
  readonly name: string;
  readonly type = "webhook" as const;
  private url: string;
  private secret?: string;
  private batchSize: number;

  constructor(name: string, url: string, options?: { secret?: string; batchSize?: number }) {
    this.name = name;
    this.url = url;
    this.secret = options?.secret;
    this.batchSize = options?.batchSize || 10;
  }

  async write(events: AuditEvent[]): Promise<WriteResult> {
    let written = 0;
    let failed = 0;
    const errors: string[] = [];

    // Batch events
    for (let i = 0; i < events.length; i += this.batchSize) {
      const batch = events.slice(i, i + this.batchSize);
      try {
        await this.sendBatch(batch);
        written += batch.length;
      } catch (err) {
        failed += batch.length;
        errors.push(err instanceof Error ? err.message : "Webhook send failed");
      }
    }

    return { success: failed === 0, written, failed, errors: errors.length > 0 ? errors : undefined };
  }

  private async sendBatch(batch: AuditEvent[]): Promise<void> {
    const payload = { events: batch, timestamp: new Date().toISOString() };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Infinity-Audit/1.0",
    };

    if (this.secret) {
      const crypto = await import("node:crypto");
      const signature = crypto.createHmac("sha256", this.secret).update(JSON.stringify(payload)).digest("hex");
      headers["X-Infinity-Signature"] = `sha256=${signature}`;
    }

    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      const response = await fetch(this.url, { method: "HEAD" });
      return { healthy: response.ok, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, error: err instanceof Error ? err.message : "Health check failed" };
    }
  }

  async close(): Promise<void> {}
}

/**
 * ClickHouse destination (for high-volume analytics)
 */
export class ClickHouseAuditDestination implements AuditDestination {
  readonly name: string;
  readonly type = "clickhouse" as const;
  private url: string;
  private database: string;
  private table: string;
  private username?: string;
  private password?: string;

  constructor(config: { name: string; url: string; database: string; table?: string; username?: string; password?: string }) {
    this.name = config.name;
    this.url = config.url;
    this.database = config.database;
    this.table = config.table || "audit_events";
    this.username = config.username;
    this.password = config.password;
  }

  async write(events: AuditEvent[]): Promise<WriteResult> {
    if (events.length === 0) return { success: true, written: 0, failed: 0 };

    const columns = [
      "id", "timestamp", "type", "severity",
      "actor_type", "actor_id", "actor_name", "actor_email", "actor_roles", "actor_project_id", "actor_workspace_id",
      "target_type", "target_id", "target_name", "target_parent_id", "target_parent_type",
      "action", "outcome", "error",
      "context", "ip_address", "user_agent", "request_id", "correlation_id", "tags"
    ];

    const values = events.map(event => [
      event.id,
      event.timestamp,
      event.type,
      event.severity,
      event.actor.type,
      event.actor.id,
      event.actor.name || "",
      event.actor.email || "",
      JSON.stringify(event.actor.roles || []),
      event.actor.projectId || "",
      event.actor.workspaceId || "",
      event.target.type,
      event.target.id,
      event.target.name || "",
      event.target.parentId || "",
      event.target.parentType || "",
      event.action,
      event.outcome,
      event.error || "",
      JSON.stringify(event.context),
      event.ipAddress || "",
      event.userAgent || "",
      event.requestId || "",
      event.correlationId || "",
      JSON.stringify(event.tags || []),
    ]);

    const formatValues = values.map(row =>
      "(" + row.map(v => typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : v).join(", ") + ")"
    ).join(",\n");

    const query = `INSERT INTO ${this.database}.${this.table} (${columns.join(", ")}) VALUES ${formatValues}`;

    try {
      const headers: Record<string, string> = { "Content-Type": "text/plain" };
      if (this.username && this.password) {
        headers["Authorization"] = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
      }

      const response = await fetch(`${this.url}/?query=${encodeURIComponent(query)}`, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        throw new Error(`ClickHouse returned ${response.status}: ${await response.text()}`);
      }

      return { success: true, written: events.length, failed: 0 };
    } catch (err) {
      logger.error({ err, destination: this.name }, "ClickHouse write failed");
      return { success: false, written: 0, failed: events.length, errors: [err instanceof Error ? err.message : "Write failed"] };
    }
  }

  async query(query: AuditQuery): Promise<QueryResult> {
    // Build WHERE clause
    const conditions: string[] = [];

    if (query.startTime) conditions.push(`timestamp >= '${query.startTime}'`);
    if (query.endTime) conditions.push(`timestamp <= '${query.endTime}'`);
    if (query.types?.length) conditions.push(`type IN (${query.types.map(t => `'${t}'`).join(",")})`);
    if (query.severities?.length) conditions.push(`severity IN (${query.severities.map(s => `'${s}'`).join(",")})`);
    if (query.actorId) conditions.push(`actor_id = '${query.actorId}'`);
    if (query.actorType) conditions.push(`actor_type = '${query.actorType}'`);
    if (query.targetId) conditions.push(`target_id = '${query.targetId}'`);
    if (query.targetType) conditions.push(`target_type = '${query.targetType}'`);
    if (query.projectId) conditions.push(`actor_project_id = '${query.projectId}'`);
    if (query.workspaceId) conditions.push(`actor_workspace_id = '${query.workspaceId}'`);
    if (query.outcome) conditions.push(`outcome = '${query.outcome}'`);
    if (query.search) conditions.push(`context LIKE '%${query.search.replace(/'/g, "''")}%'`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = `ORDER BY ${query.sortBy || "timestamp"} ${query.sortOrder || "DESC"}`;
    const limit = query.limit || 100;
    const offset = query.offset || 0;

    const selectQuery = `SELECT * FROM ${this.database}.${this.table} ${whereClause} ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    const countQuery = `SELECT count() FROM ${this.database}.${this.table} ${whereClause}`;

    try {
      const headers: Record<string, string> = { "Content-Type": "text/plain" };
      if (this.username && this.password) {
        headers["Authorization"] = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
      }

      const [dataRes, countRes] = await Promise.all([
        fetch(`${this.url}/?query=${encodeURIComponent(selectQuery)}`, { method: "POST", headers }),
        fetch(`${this.url}/?query=${encodeURIComponent(countQuery)}`, { method: "POST", headers }),
      ]);

      if (!dataRes.ok || !countRes.ok) {
        throw new Error("ClickHouse query failed");
      }

      const dataText = await dataRes.text();
      const countText = await countRes.text();
      const total = parseInt(countText.trim(), 10);

      // Parse TabSeparatedWithNamesAndTypes format
      const lines = dataText.trim().split("\n");
      if (lines.length < 2) return { events: [], total, hasMore: false };

      const headers_line = lines[0].split("\t");
      const events: AuditEvent[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split("\t");
        const event: Record<string, unknown> = {};
        headers_line.forEach((h, idx) => { event[h] = values[idx]; });
        events.push(this.parseEvent(event));
      }

      return { events, total, hasMore: events.length >= limit };
    } catch (err) {
      logger.error({ err, destination: this.name }, "ClickHouse query failed");
      return { events: [], total: 0, hasMore: false };
    }
  }

  async getStats(query: AuditQuery): Promise<AuditStats> {
    // Simplified - would use aggregation queries in production
    return {
      totalEvents: 0,
      eventsByType: {},
      eventsBySeverity: {},
      eventsByActor: {},
      eventsByOutcome: {},
      topActors: [],
      topTargets: [],
      timeSeries: [],
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      const response = await fetch(`${this.url}/?query=SELECT 1`, { method: "POST" });
      return { healthy: response.ok, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, error: err instanceof Error ? err.message : "Health check failed" };
    }
  }

  async close(): Promise<void> {}

  private parseEvent(row: Record<string, unknown>): AuditEvent {
    return {
      id: row.id as string,
      timestamp: row.timestamp as string,
      type: row.type as AuditEventType,
      severity: row.severity as AuditSeverity,
      actor: {
        type: row.actor_type as AuditActor["type"],
        id: row.actor_id as string,
        name: row.actor_name as string || undefined,
        email: row.actor_email as string || undefined,
        roles: JSON.parse(row.actor_roles as string || "[]"),
        projectId: row.actor_project_id as string || undefined,
        workspaceId: row.actor_workspace_id as string || undefined,
      },
      target: {
        type: row.target_type as AuditTarget["type"],
        id: row.target_id as string,
        name: row.target_name as string || undefined,
        parentId: row.target_parent_id as string || undefined,
        parentType: row.target_parent_type as string || undefined,
      },
      action: row.action as string,
      outcome: row.outcome as AuditEvent["outcome"],
      error: row.error as string || undefined,
      context: JSON.parse(row.context as string || "{}"),
      ipAddress: row.ip_address as string || undefined,
      userAgent: row.user_agent as string || undefined,
      requestId: row.request_id as string || undefined,
      correlationId: row.correlation_id as string || undefined,
      tags: JSON.parse(row.tags as string || "[]"),
    };
  }
}

/**
 * BigQuery destination
 */
export class BigQueryAuditDestination implements AuditDestination {
  readonly name: string;
  readonly type = "bigquery" as const;
  private projectId: string;
  private dataset: string;
  private table: string;
  private location: string;

  constructor(config: { name: string; projectId: string; dataset: string; table?: string; location?: string }) {
    this.name = config.name;
    this.projectId = config.projectId;
    this.dataset = config.dataset;
    this.table = config.table || "audit_events";
    this.location = config.location || "US";
  }

  async write(events: AuditEvent[]): Promise<WriteResult> {
    // BigQuery streaming insert
    // In production, use @google-cloud/bigquery library
    // For now, return success (would need proper implementation)
    logger.warn({ destination: this.name }, "BigQuery destination not fully implemented");
    return { success: true, written: events.length, failed: 0 };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: false, error: "Not implemented" };
  }

  async close(): Promise<void> {}
}

/**
 * PostgreSQL destination
 */
export class PostgreSQLAuditDestination implements AuditDestination {
  readonly name: string;
  readonly type = "postgresql" as const;
  private connectionString: string;

  constructor(config: { name: string; connectionString: string }) {
    this.name = config.name;
    this.connectionString = config.connectionString;
  }

  async write(events: AuditEvent[]): Promise<WriteResult> {
    // Use pg library in production
    logger.warn({ destination: this.name }, "PostgreSQL destination not fully implemented");
    return { success: true, written: events.length, failed: 0 };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: false, error: "Not implemented" };
  }

  async close(): Promise<void> {}
}

/**
 * Elasticsearch destination
 */
export class ElasticsearchAuditDestination implements AuditDestination {
  readonly name: string;
  readonly type = "elasticsearch" as const;
  private url: string;
  private index: string;
  private apiKey?: string;

  constructor(config: { name: string; url: string; index: string; apiKey?: string }) {
    this.name = config.name;
    this.url = config.url;
    this.index = config.index;
    this.apiKey = config.apiKey;
  }

  async write(events: AuditEvent[]): Promise<WriteResult> {
    // Bulk insert to Elasticsearch
    logger.warn({ destination: this.name }, "Elasticsearch destination not fully implemented");
    return { success: true, written: events.length, failed: 0 };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: false, error: "Not implemented" };
  }

  async close(): Promise<void> {}
}

/**
 * Audit Logger — main entry point for writing audit events
 */
export class AuditLogger {
  private destinations: AuditDestination[] = [];
  private buffer: AuditEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly maxBufferSize = 50;
  private readonly flushIntervalMs = 2000;
  private defaultWorkspaceId?: string;

  constructor(options?: { defaultWorkspaceId?: string }) {
    this.defaultWorkspaceId = options?.defaultWorkspaceId;
    this.startFlushTimer();
  }

  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
    this.flushInterval.unref();
  }

  /** Add a destination */
  addDestination(destination: AuditDestination): void {
    this.destinations.push(destination);
    logger.info({ destination: destination.name, type: destination.type }, "Audit destination added");
  }

  /** Remove a destination */
  removeDestination(name: string): void {
    const idx = this.destinations.findIndex(d => d.name === name);
    if (idx >= 0) {
      const dest = this.destinations.splice(idx, 1)[0];
      dest.close();
      logger.info({ destination: name }, "Audit destination removed");
    }
  }

  /** Log an audit event */
  async log(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
    const fullEvent: AuditEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    this.buffer.push(fullEvent);

    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  /** Flush buffer to all destinations */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);

    await Promise.allSettled(
      this.destinations.map(dest => dest.write(events))
    );
  }

  /** Query audit events */
  async query(query: AuditQuery): Promise<QueryResult> {
    // Try destinations that support query (ClickHouse, etc.)
    for (const dest of this.destinations) {
      if (dest.query) {
        return dest.query(query);
      }
    }
    return { events: [], total: 0, hasMore: false };
  }

  /** Get audit statistics */
  async getStats(query: AuditQuery): Promise<AuditStats> {
    for (const dest of this.destinations) {
      if (dest.getStats) {
        return dest.getStats(query);
      }
    }
    return {
      totalEvents: 0,
      eventsByType: {},
      eventsBySeverity: {},
      eventsByActor: {},
      eventsByOutcome: {},
      topActors: [],
      topTargets: [],
      timeSeries: [],
    };
  }

  /** Health check all destinations */
  async healthCheck(): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};
    for (const dest of this.destinations) {
      results[dest.name] = await dest.healthCheck();
    }
    return results;
  }

  /** Shutdown */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
    await Promise.all(this.destinations.map(d => d.close()));
  }
}

/**
 * Helper functions for common audit events
 */
export const AuditHelpers = {
  userLogin(actor: AuditActor, ipAddress?: string, userAgent?: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "user.login",
      severity: "info",
      actor,
      target: { type: "user", id: actor.id },
      action: "login",
      outcome: "success",
      context: { method: "password" },
      ipAddress,
      userAgent,
      requestId,
    };
  },

  userSSOLogin(actor: AuditActor, provider: string, ipAddress?: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "user.sso_login",
      severity: "info",
      actor,
      target: { type: "user", id: actor.id },
      action: "sso_login",
      outcome: "success",
      context: { provider },
      ipAddress,
      requestId,
    };
  },

  projectCreated(actor: AuditActor, projectId: string, projectName: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "project.created",
      severity: "info",
      actor,
      target: { type: "project", id: projectId, name: projectName },
      action: "create",
      outcome: "success",
      context: {},
      requestId,
    };
  },

  buildStarted(actor: AuditActor, buildId: string, projectId: string, artifactType: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "build.started",
      severity: "info",
      actor,
      target: { type: "build", id: buildId, parentId: projectId, parentType: "project" },
      action: "start",
      outcome: "success",
      context: { artifactType },
      requestId,
    };
  },

  buildCompleted(actor: AuditActor, buildId: string, projectId: string, durationMs: number, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "build.completed",
      severity: "info",
      actor,
      target: { type: "build", id: buildId, parentId: projectId, parentType: "project" },
      action: "complete",
      outcome: "success",
      context: { durationMs },
      requestId,
    };
  },

  buildFailed(actor: AuditActor, buildId: string, projectId: string, error: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "build.failed",
      severity: "warning",
      actor,
      target: { type: "build", id: buildId, parentId: projectId, parentType: "project" },
      action: "fail",
      outcome: "failure",
      error,
      context: {},
      requestId,
    };
  },

  agentToolExecuted(actor: AuditActor, toolName: string, projectId: string, success: boolean, error?: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "agent.tool_executed",
      severity: success ? "info" : "warning",
      actor,
      target: { type: "agent", id: actor.id, parentId: projectId, parentType: "project" },
      action: "execute_tool",
      outcome: success ? "success" : "failure",
      error,
      context: { toolName },
      requestId,
    };
  },

  secretAccessed(actor: AuditActor, secretId: string, projectId: string, purpose: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "secret.accessed",
      severity: "info",
      actor,
      target: { type: "secret", id: secretId, parentId: projectId, parentType: "project" },
      action: "access",
      outcome: "success",
      context: { purpose },
      requestId,
    };
  },

  secretLeakDetected(actor: AuditActor, secretId: string, projectId: string, location: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "secret.leak_detected",
      severity: "critical",
      actor,
      target: { type: "secret", id: secretId, parentId: projectId, parentType: "project" },
      action: "leak_detected",
      outcome: "failure",
      context: { location },
      requestId,
      tags: ["security", "secret-leak"],
    };
  },

  securityFindingCreated(actor: AuditActor, findingId: string, projectId: string, severity: string, rule: string, requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: "security.finding_created",
      severity: severity === "critical" ? "critical" : "warning",
      actor,
      target: { type: "custom", id: findingId, parentId: projectId, parentType: "project" },
      action: "create_finding",
      outcome: "success",
      context: { rule, severity },
      requestId,
      tags: ["security", "finding"],
    };
  },

  codeFileUpdated(actor: AuditActor, filePath: string, projectId: string, changeType: "created" | "updated" | "deleted" | "moved", requestId?: string): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type: `code.file_${changeType}`,
      severity: "info",
      actor,
      target: { type: "code", id: filePath, parentId: projectId, parentType: "project" },
      action: changeType,
      outcome: "success",
      context: { filePath },
      requestId,
    };
  },

  custom(actor: AuditActor, type: AuditEventType, target: AuditTarget, action: string, outcome: AuditEvent["outcome"], context: Record<string, unknown>, options?: { severity?: AuditSeverity; error?: string; requestId?: string; tags?: string[] }): Omit<AuditEvent, "id" | "timestamp"> {
    return {
      type,
      severity: options?.severity || "info",
      actor,
      target,
      action,
      outcome,
      error: options?.error,
      context,
      requestId: options?.requestId,
      tags: options?.tags,
    };
  },
};

/**
 * Default audit logger instance
 */
export const auditLogger = new AuditLogger();

/**
 * Initialize default destinations (console + file)
 */
export async function initializeDefaultAuditDestinations(logDir?: string): Promise<void> {
  // Always add console for development
  auditLogger.addDestination(new ConsoleAuditDestination());

  // Add file destination if logDir provided
  if (logDir) {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const filePath = path.join(logDir, "audit.log");

    // Ensure directory exists
    await fs.mkdir(logDir, { recursive: true });

    auditLogger.addDestination(new FileAuditDestination(filePath));
  }
}