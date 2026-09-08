/**
 * Notification Dispatcher — Multi-channel notification system for Safety Watcher
 *
 * Supports: Web Push (VAPID), Email (Resend/SendGrid), Slack, Discord, Webhooks, In-app SSE
 * Features: Template engine, batching, quiet hours, delivery tracking, retries
 * Budget: $0 — uses free tiers and local infrastructure only
 */

import { EventEmitter } from "events";
import { WebPushService } from "./web-push-service";
import { EmailService } from "./email-service";
import { WebhookService } from "./webhook-service";
import { InAppNotificationService } from "./in-app-notification-service";
import { db } from "@workspace/db";
import { safetyNotifications, notificationChannels, safetyRules } from "@workspace/db/schema/safety-watcher.js";
import { eq, and, desc, gte, lt, sql } from "drizzle-orm";

export interface NotificationTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  channels: NotificationChannelType[];
}

export type NotificationChannelType =
  | "webpush"
  | "email"
  | "slack"
  | "discord"
  | "webhook"
  | "inapp";

export interface NotificationChannel {
  id: string;
  projectId: string;
  type: NotificationChannelType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  severityFilter: ("info" | "warning" | "critical" | "emergency")[];
  quietHours?: { start: string; end: string; timezone: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationPayload {
  id?: string;
  projectId: string;
  ruleId?: string;
  severity: "info" | "warning" | "critical" | "emergency";
  title: string;
  message: string;
  details?: Record<string, unknown>;
  source: string;
  timestamp: Date;
  channels?: NotificationChannelType[];
  deduplicationKey?: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface DispatchResult {
  notificationId: string;
  channel: NotificationChannelType;
  success: boolean;
  error?: string;
  externalId?: string;
  deliveredAt?: Date;
}

export interface BatchConfig {
  maxBatchSize: number;
  maxWaitMs: number;
  groupBy: "rule" | "severity" | "source";
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string; // HH:MM 24h
  end: string;   // HH:MM 24h
  timezone: string; // IANA timezone
}

const DEFAULT_TEMPLATES: NotificationTemplate[] = [
  {
    id: "safety-default",
    name: "Safety Alert",
    subject: "{{severity | upper}}: {{title}}",
    body: `**{{severity | upper}} Alert**

**{{title}}**

{{message}}

**Source:** {{source}}
**Time:** {{timestamp | date}}
**Details:** {{#if details}}{{#each details}}{{@key}}: {{this}}
{{/each}}{{else}}None{{/if}}

{{#if actionUrl}}
[{{actionLabel}}]({{actionUrl}})
{{/if}}`,
    channels: ["webpush", "email", "slack", "discord", "webhook", "inapp"],
  },
  {
    id: "safety-runaway-loop",
    name: "Runaway Loop Detection",
    subject: "🔄 Runaway Loop Detected: {{title}}",
    body: `🔄 **Runaway Loop Detected**

**Agent:** {{details.agentId}}
**Iterations:** {{details.iterations}}
**Token Budget Used:** {{details.tokenBudgetPercent}}%
**Duration:** {{details.durationMs}}ms

{{message}}

[View Agent]({{actionUrl}})`,
    channels: ["webpush", "email", "slack", "inapp"],
  },
  {
    id: "safety-token-burn",
    name: "Token Burn Alert",
    subject: "💸 Token Budget Exceeded: {{title}}",
    body: `💸 **Token Budget Alert**

**Operation:** {{details.operation}}
**Estimated Cost:** ${{details.estimatedCost}}
**Model:** {{details.model}}
**Tokens:** {{details.tokens}}

{{message}}

[View Details]({{actionUrl}})`,
    channels: ["webpush", "email", "slack", "inapp"],
  },
  {
    id: "safety-deployment-failure",
    name: "Deployment Failure",
    subject: "🚨 Deployment Failed: {{title}}",
    body: `🚨 **Deployment Failure**

**Deployment:** {{details.deploymentId}}
**Provider:** {{details.provider}}
**Error:** {{details.error}}
**Rollback:** {{details.rollbackTriggered ? "Triggered" : "Not triggered"}}

{{message}}

[View Deployment]({{actionUrl}})`,
    channels: ["webpush", "email", "slack", "discord", "inapp"],
  },
];

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxBatchSize: 10,
  maxWaitMs: 5 * 60 * 1000, // 5 minutes
  groupBy: "rule",
};

export class NotificationDispatcher extends EventEmitter {
  private webPush: WebPushService;
  private email: EmailService;
  private webhook: WebhookService;
  private inApp: InAppNotificationService;
  private templates: Map<string, NotificationTemplate> = new Map();
  private batchQueues: Map<string, NotificationPayload[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private batchConfig: BatchConfig = DEFAULT_BATCH_CONFIG;
  private quietHours: QuietHoursConfig = {
    enabled: true,
    start: "22:00",
    end: "08:00",
    timezone: "UTC",
  };
  private initialized = false;

  constructor() {
    super();
    this.webPush = new WebPushService();
    this.email = new EmailService();
    this.webhook = new WebhookService();
    this.inApp = new InAppNotificationService();

    // Load default templates
    for (const template of DEFAULT_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  async initialize(projectId: string): Promise<void> {
    if (this.initialized) return;

    // Load project-specific channels
    await this.loadChannels(projectId);
    // Load custom templates
    await this.loadTemplates(projectId);
    // Initialize services
    await this.webPush.initialize(projectId);
    await this.email.initialize(projectId);
    await this.webhook.initialize(projectId);

    this.initialized = true;
    this.emit("initialized", { projectId });
  }

  private async loadChannels(projectId: string): Promise<void> {
    const channels = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.projectId, projectId));

    for (const channel of channels) {
      this.emit("channelLoaded", channel);
    }
  }

  private async loadTemplates(projectId: string): Promise<void> {
    // In a real implementation, load from database
    // For now, use defaults
  }

  /**
   * Send a notification through all appropriate channels
   */
  async send(
    payload: NotificationPayload,
    projectId: string
  ): Promise<DispatchResult[]> {
    const channels = await this.getEnabledChannels(projectId, payload.severity);
    const results: DispatchResult[] = [];

    // Check quiet hours
    if (this.isQuietHours(payload.severity)) {
      // For emergency, bypass quiet hours
      if (payload.severity !== "emergency") {
        return this.queueForLater(payload, projectId);
      }
    }

    // Check for deduplication
    if (payload.deduplicationKey) {
      const recent = await this.checkDeduplication(payload.deduplicationKey, projectId);
      if (recent) {
        return [{ notificationId: recent.id, channel: "deduplicated", success: true }];
      }
    }

    // Determine target channels
    const targetChannels = payload.channels?.length
      ? channels.filter((c) => payload.channels!.includes(c.type))
      : channels;

    // Send to each channel
    for (const channel of targetChannels) {
      try {
        let result: DispatchResult;

        switch (channel.type) {
          case "webpush":
            result = await this.sendWebPush(payload, channel);
            break;
          case "email":
            result = await this.sendEmail(payload, channel);
            break;
          case "slack":
            result = await this.sendSlack(payload, channel);
            break;
          case "discord":
            result = await this.sendDiscord(payload, channel);
            break;
          case "webhook":
            result = await this.sendWebhook(payload, channel);
            break;
          case "inapp":
            result = await this.sendInApp(payload, channel);
            break;
          default:
            result = {
              notificationId: payload.id || crypto.randomUUID(),
              channel: channel.type,
              success: false,
              error: `Unknown channel type: ${channel.type}`,
            };
        }

        results.push(result);

        // Store notification in database
        await this.storeNotification(payload, channel, result);

        this.emit("dispatched", { payload, channel, result });
      } catch (error) {
        const result: DispatchResult = {
          notificationId: payload.id || crypto.randomUUID(),
          channel: channel.type,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        results.push(result);
        this.emit("dispatchError", { payload, channel, error: result.error });
      }
    }

    return results;
  }

  /**
   * Send notification with batching support
   */
  async sendBatched(
    payload: NotificationPayload,
    projectId: string
  ): Promise<void> {
    const batchKey = this.getBatchKey(payload, projectId);
    const queue = this.batchQueues.get(batchKey) || [];
    queue.push(payload);
    this.batchQueues.set(batchKey, queue);

    // Clear existing timer
    if (this.batchTimers.has(batchKey)) {
      clearTimeout(this.batchTimers.get(batchKey)!);
    }

    // If queue is full, send immediately
    if (queue.length >= this.batchConfig.maxBatchSize) {
      await this.flushBatch(batchKey, projectId);
      return;
    }

    // Set timer to flush
    const timer = setTimeout(() => {
      this.flushBatch(batchKey, projectId);
    }, this.batchConfig.maxWaitMs);

    this.batchTimers.set(batchKey, timer);
  }

  private async flushBatch(batchKey: string, projectId: string): Promise<void> {
    const queue = this.batchQueues.get(batchKey);
    if (!queue || queue.length === 0) return;

    this.batchQueues.delete(batchKey);
    this.batchTimers.delete(batchKey);

    // Group by rule or severity
    const grouped = new Map<string, NotificationPayload[]>();
    for (const payload of queue) {
      const groupKey = payload.ruleId || payload.severity || "default";
      const group = grouped.get(groupKey) || [];
      group.push(payload);
      grouped.set(groupKey, group);
    }

    // Send each group as a batched notification
    for (const [groupKey, payloads] of grouped) {
      if (payloads.length === 1) {
        await this.send(payloads[0], projectId);
      } else {
        await this.sendBatchedGroup(payloads, projectId);
      }
    }
  }

  private async sendBatchedGroup(
    payloads: NotificationPayload[],
    projectId: string
  ): Promise<void> {
    const first = payloads[0];
    const batchedPayload: NotificationPayload = {
      ...first,
      id: crypto.randomUUID(),
      title: `${payloads.length} alerts: ${first.title}`,
      message: payloads.map((p) => `• ${p.message}`).join("\n"),
      details: {
        batched: true,
        count: payloads.length,
        items: payloads.map((p) => ({
          title: p.title,
          severity: p.severity,
          timestamp: p.timestamp,
          details: p.details,
        })),
      },
      deduplicationKey: `batch-${first.ruleId || first.source}-${Date.now()}`,
    };

    await this.send(batchedPayload, projectId);
  }

  private getBatchKey(payload: NotificationPayload, projectId: string): string {
    switch (this.batchConfig.groupBy) {
      case "rule":
        return `${projectId}:rule:${payload.ruleId || "none"}`;
      case "severity":
        return `${projectId}:severity:${payload.severity}`;
      case "source":
        return `${projectId}:source:${payload.source}`;
      default:
        return `${projectId}:default`;
    }
  }

  private async getEnabledChannels(
    projectId: string,
    severity: NotificationPayload["severity"]
  ): Promise<NotificationChannel[]> {
    const channels = await db
      .select()
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.projectId, projectId),
          eq(notificationChannels.enabled, true)
        )
      );

    return channels.filter((c) => c.severityFilter.includes(severity));
  }

  private isQuietHours(severity: NotificationPayload["severity"]): boolean {
    if (!this.quietHours.enabled || severity === "emergency") return false;

    const now = new Date();
    const userTime = new Date(
      now.toLocaleString("en-US", { timeZone: this.quietHours.timezone })
    );
    const currentHour = userTime.getHours();
    const currentMinute = userTime.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = this.quietHours.start.split(":").map(Number);
    const [endHour, endMinute] = this.quietHours.end.split(":").map(Number);
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime < endTime;
    } else {
      // Overnight quiet hours (e.g., 22:00 to 08:00)
      return currentTime >= startTime || currentTime < endTime;
    }
  }

  private async queueForLater(
    payload: NotificationPayload,
    projectId: string
  ): Promise<DispatchResult[]> {
    // Store for later delivery when quiet hours end
    await db.insert(safetyNotifications).values({
      id: payload.id || crypto.randomUUID(),
      projectId,
      ruleId: payload.ruleId,
      severity: payload.severity,
      title: payload.title,
      message: payload.message,
      details: payload.details as any,
      source: payload.source,
      timestamp: payload.timestamp,
      status: "queued",
      queuedForQuietHours: true,
    });

    return [{
      notificationId: payload.id || crypto.randomUUID(),
      channel: "queued",
      success: true,
    }];
  }

  private async checkDeduplication(
    key: string,
    projectId: string
  ): Promise<{ id: string } | null> {
    const recent = await db
      .select({ id: safetyNotifications.id })
      .from(safetyNotifications)
      .where(
        and(
          eq(safetyNotifications.projectId, projectId),
          eq(safetyNotifications.deduplicationKey, key),
          gte(safetyNotifications.timestamp, new Date(Date.now() - 5 * 60 * 1000)) // 5 min
        )
      )
      .limit(1);

    return recent[0] || null;
  }

  private async storeNotification(
    payload: NotificationPayload,
    channel: NotificationChannel,
    result: DispatchResult
  ): Promise<void> {
    await db.insert(safetyNotifications).values({
      id: result.notificationId,
      projectId: payload.projectId,
      ruleId: payload.ruleId,
      severity: payload.severity,
      title: payload.title,
      message: payload.message,
      details: payload.details as any,
      source: payload.source,
      timestamp: payload.timestamp,
      channel: channel.type,
      status: result.success ? "delivered" : "failed",
      error: result.error,
      externalId: result.externalId,
      deliveredAt: result.deliveredAt,
      deduplicationKey: payload.deduplicationKey,
    });
  }

  // Channel-specific send methods
  private async sendWebPush(
    payload: NotificationPayload,
    channel: NotificationChannel
  ): Promise<DispatchResult> {
    const notificationId = payload.id || crypto.randomUUID();
    const rendered = this.renderTemplate(payload, "webpush");

    try {
      await this.webPush.send({
        projectId: payload.projectId,
        title: rendered.subject,
        body: rendered.body,
        icon: "/icons/notification-icon-192.png",
        badge: "/icons/notification-badge-72.png",
        tag: `safety-${payload.ruleId || "default"}`,
        data: {
          notificationId,
          severity: payload.severity,
          actionUrl: payload.actionUrl,
          source: payload.source,
        },
        actions: payload.actionUrl
          ? [{ action: "view", title: payload.actionLabel || "View" }]
          : undefined,
      });

      return {
        notificationId,
        channel: "webpush",
        success: true,
        deliveredAt: new Date(),
      };
    } catch (error) {
      return {
        notificationId,
        channel: "webpush",
        success: false,
        error: error instanceof Error ? error.message : "Web Push failed",
      };
    }
  }

  private async sendEmail(
    payload: NotificationPayload,
    channel: NotificationChannel
  ): Promise<DispatchResult> {
    const notificationId = payload.id || crypto.randomUUID();
    const rendered = this.renderTemplate(payload, "email");
    const config = channel.config as { to?: string; from?: string };

    try {
      await this.email.send({
        to: config.to || "user@example.com",
        from: config.from || "Infinity Safety Watcher <safety@infinity.local>",
        subject: rendered.subject,
        html: rendered.body,
        text: this.stripHtml(rendered.body),
      });

      return {
        notificationId,
        channel: "email",
        success: true,
        deliveredAt: new Date(),
      };
    } catch (error) {
      return {
        notificationId,
        channel: "email",
        success: false,
        error: error instanceof Error ? error.message : "Email failed",
      };
    }
  }

  private async sendSlack(
    payload: NotificationPayload,
    channel: NotificationChannel
  ): Promise<DispatchResult> {
    const notificationId = payload.id || crypto.randomUUID();
    const config = channel.config as { webhookUrl: string; channel?: string };
    const rendered = this.renderTemplate(payload, "slack");

    try {
      await this.webhook.sendSlack(config.webhookUrl, {
        channel: config.channel,
        username: "Infinity Safety Watcher",
        icon_emoji: this.getSeverityEmoji(payload.severity),
        text: rendered.subject,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: rendered.body,
            },
          },
          ...(payload.actionUrl
            ? [{
              type: "actions",
              elements: [{
                type: "button",
                text: { type: "plain_text", text: payload.actionLabel || "View Details" },
                url: payload.actionUrl,
                style: payload.severity === "emergency" ? "danger" : "primary",
              }],
            }]
            : []),
        ],
      });

      return {
        notificationId,
        channel: "slack",
        success: true,
        deliveredAt: new Date(),
      };
    } catch (error) {
      return {
        notificationId,
        channel: "slack",
        success: false,
        error: error instanceof Error ? error.message : "Slack failed",
      };
    }
  }

  private async sendDiscord(
    payload: NotificationPayload,
    channel: NotificationChannel
  ): Promise<DispatchResult> {
    const notificationId = payload.id || crypto.randomUUID();
    const config = channel.config as { webhookUrl: string };
    const rendered = this.renderTemplate(payload, "discord");

    try {
      await this.webhook.sendDiscord(config.webhookUrl, {
        username: "Infinity Safety Watcher",
        avatar_url: "https://infinity.local/icon.png",
        embeds: [{
          title: rendered.subject,
          description: rendered.body,
          color: this.getSeverityColor(payload.severity),
          timestamp: payload.timestamp.toISOString(),
          fields: [
            { name: "Severity", value: payload.severity.toUpperCase(), inline: true },
            { name: "Source", value: payload.source, inline: true },
            ...(payload.details
              ? Object.entries(payload.details).map(([k, v]) => ({
                  name: k,
                  value: String(v),
                  inline: true,
                }))
              : []),
          ],
          ...(payload.actionUrl
            ? { url: payload.actionUrl }
            : {}),
        }],
      });

      return {
        notificationId,
        channel: "discord",
        success: true,
        deliveredAt: new Date(),
      };
    } catch (error) {
      return {
        notificationId,
        channel: "discord",
        success: false,
        error: error instanceof Error ? error.message : "Discord failed",
      };
    }
  }

  private async sendWebhook(
    payload: NotificationPayload,
    channel: NotificationChannel
  ): Promise<DispatchResult> {
    const notificationId = payload.id || crypto.randomUUID();
    const config = channel.config as { url: string; headers?: Record<string, string>; secret?: string };

    try {
      await this.webhook.send(config.url, {
        ...payload,
        notificationId,
      }, config.headers, config.secret);

      return {
        notificationId,
        channel: "webhook",
        success: true,
        deliveredAt: new Date(),
      };
    } catch (error) {
      return {
        notificationId,
        channel: "webhook",
        success: false,
        error: error instanceof Error ? error.message : "Webhook failed",
      };
    }
  }

  private async sendInApp(
    payload: NotificationPayload,
    channel: NotificationChannel
  ): Promise<DispatchResult> {
    const notificationId = payload.id || crypto.randomUUID();

    try {
      await this.inApp.create({
        projectId: payload.projectId,
        notificationId,
        severity: payload.severity,
        title: payload.title,
        message: payload.message,
        details: payload.details,
        source: payload.source,
        actionUrl: payload.actionUrl,
        actionLabel: payload.actionLabel,
        timestamp: payload.timestamp,
      });

      return {
        notificationId,
        channel: "inapp",
        success: true,
        deliveredAt: new Date(),
      };
    } catch (error) {
      return {
        notificationId,
        channel: "inapp",
        success: false,
        error: error instanceof Error ? error.message : "In-app failed",
      };
    }
  }

  private renderTemplate(
    payload: NotificationPayload,
    channel: NotificationChannelType
  ): { subject: string; body: string } {
    // Find appropriate template
    let template = this.templates.get(`safety-${payload.ruleId}`) || this.templates.get("safety-default");

    // Simple template rendering (in production, use Handlebars or similar)
    const context = {
      ...payload,
      timestamp: payload.timestamp.toISOString(),
      severity: payload.severity,
      upper: (str: string) => str.toUpperCase(),
      date: (date: Date) => new Date(date).toLocaleString(),
    };

    let subject = template!.subject;
    let body = template!.body;

    // Replace {{variable}} patterns
    const replaceVars = (str: string): string => {
      return str.replace(/\{\{(\w+)(?:\s*\|\s*(\w+))?\}\}/g, (match, varName, filter) => {
        const value = context[varName as keyof typeof context];
        if (typeof value === "function") {
          return value(match.replace(/\{\{|\}\}/g, "").split("|")[0].trim());
        }
        return value !== undefined ? String(value) : match;
      });
    };

    subject = replaceVars(subject);
    body = replaceVars(body);

    return { subject, body };
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").replace(/\n\s+/g, "\n").trim();
  }

  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case "emergency": return "🚨";
      case "critical": return "⚠️";
      case "warning": return "⚡";
      case "info": return "ℹ️";
      default: return "📢";
    }
  }

  private getSeverityColor(severity: string): number {
    switch (severity) {
      case "emergency": return 0xff0000; // Red
      case "critical": return 0xff8c00;  // Dark Orange
      case "warning": return 0xffd700;   // Gold
      case "info": return 0x00bfff;      // Deep Sky Blue
      default: return 0x808080;          // Gray
    }
  }

  // Configuration methods
  setBatchConfig(config: Partial<BatchConfig>): void {
    this.batchConfig = { ...this.batchConfig, ...config };
  }

  setQuietHours(config: QuietHoursConfig): void {
    this.quietHours = config;
  }

  addTemplate(template: NotificationTemplate): void {
    this.templates.set(template.id, template);
  }

  removeTemplate(id: string): void {
    this.templates.delete(id);
  }

  // Channel management
  async addChannel(channel: Omit<NotificationChannel, "id" | "createdAt" | "updatedAt">): Promise<NotificationChannel> {
    const newChannel: NotificationChannel = {
      ...channel,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(notificationChannels).values(newChannel as any);
    this.emit("channelAdded", newChannel);
    return newChannel;
  }

  async updateChannel(id: string, updates: Partial<NotificationChannel>): Promise<NotificationChannel | null> {
    const result = await db
      .update(notificationChannels)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(notificationChannels.id, id))
      .returning();

    if (result[0]) {
      this.emit("channelUpdated", result[0]);
      return result[0];
    }
    return null;
  }

  async deleteChannel(id: string): Promise<boolean> {
    const result = await db.delete(notificationChannels).where(eq(notificationChannels.id, id));
    this.emit("channelDeleted", { id });
    return (result.rowCount || 0) > 0;
  }

  async getChannels(projectId: string): Promise<NotificationChannel[]> {
    return db.select().from(notificationChannels).where(eq(notificationChannels.projectId, projectId));
  }

  // History and analytics
  async getHistory(
    projectId: string,
    options: { limit?: number; offset?: number; severity?: string; channel?: string; since?: Date } = {}
  ): Promise<any[]> {
    let query = db
      .select()
      .from(safetyNotifications)
      .where(eq(safetyNotifications.projectId, projectId))
      .orderBy(desc(safetyNotifications.timestamp))
      .limit(options.limit || 100)
      .offset(options.offset || 0);

    if (options.severity) {
      query = query.where(eq(safetyNotifications.severity, options.severity as any));
    }
    if (options.channel) {
      query = query.where(eq(safetyNotifications.channel, options.channel as any));
    }
    if (options.since) {
      query = query.where(gte(safetyNotifications.timestamp, options.since));
    }

    return query;
  }

  async getStats(projectId: string, since?: Date): Promise<Record<string, number>> {
    const where = eq(safetyNotifications.projectId, projectId);
    const timeWhere = since ? gte(safetyNotifications.timestamp, since) : undefined;

    const results = await db
      .select({
        severity: safetyNotifications.severity,
        channel: safetyNotifications.channel,
        status: safetyNotifications.status,
        count: sql<number>`count(*)`,
      })
      .from(safetyNotifications)
      .where(timeWhere ? and(where, timeWhere) : where)
      .groupBy(safetyNotifications.severity, safetyNotifications.channel, safetyNotifications.status);

    const stats: Record<string, number> = {};
    for (const row of results) {
      const key = `${row.severity}.${row.channel}.${row.status}`;
      stats[key] = Number(row.count);
    }
    return stats;
  }

  // Test notification
  async sendTestNotification(
    projectId: string,
    channelType: NotificationChannelType,
    severity: NotificationPayload["severity"] = "info"
  ): Promise<DispatchResult> {
    const payload: NotificationPayload = {
      id: crypto.randomUUID(),
      projectId,
      severity,
      title: "Test Notification",
      message: `This is a test ${severity} notification from the Safety Watcher.`,
      details: { test: true, channel: channelType },
      source: "safety-watcher-test",
      timestamp: new Date(),
      channels: [channelType],
    };

    const results = await this.send(payload, projectId);
    return results.find((r) => r.channel === channelType) || results[0];
  }

  // Cleanup
  async flushAllBatches(): Promise<void> {
    for (const batchKey of this.batchQueues.keys()) {
      await this.flushBatch(batchKey, "");
    }
  }

  destroy(): void {
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();
    this.batchQueues.clear();
    this.webPush.destroy();
    this.email.destroy();
    this.webhook.destroy();
    this.inApp.destroy();
    this.removeAllListeners();
  }
}

// Singleton instance
let dispatcherInstance: NotificationDispatcher | null = null;

export function getNotificationDispatcher(): NotificationDispatcher {
  if (!dispatcherInstance) {
    dispatcherInstance = new NotificationDispatcher();
  }
  return dispatcherInstance;
}

export function resetNotificationDispatcher(): void {
  if (dispatcherInstance) {
    dispatcherInstance.destroy();
    dispatcherInstance = null;
  }
}