import { db, projects, automations, automationLogs } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createConnector } from "./connectors/base";
import { logger } from "./logger";
import { NotificationChannel } from "./automation-parser";

/**
 * Notification Service — Unified dispatcher for multi-channel notifications.
 * Supports: email, push, Slack, Discord, webhook, in-app
 * Includes template system with variable substitution.
 */

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: NotificationChannel;
  subject?: string; // For email/push
  body: string; // Template with {{variables}}
  htmlBody?: string; // For email
}

export interface NotificationPayload {
  /** Target channels */
  channels: NotificationChannel[];
  /** Template ID or inline template */
  templateId?: string;
  inlineTemplate?: {
    subject?: string;
    body: string;
    htmlBody?: string;
  };
  /** Variables for template substitution */
  variables: Record<string, any>;
  /** Recipients (channel-specific) */
  recipients?: Record<NotificationChannel, string[]>;
  /** Project context */
  projectId: string;
  /** Automation context (optional) */
  automationId?: string;
  runId?: string;
  /** Priority */
  priority?: "low" | "normal" | "high" | "critical";
  /** Metadata */
  metadata?: Record<string, any>;
}

export interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  messageId?: string;
  error?: string;
  recipient?: string;
}

export interface SendNotificationResult {
  results: NotificationResult[];
  success: boolean;
  failedChannels: NotificationChannel[];
}

/**
 * Built-in notification templates
 */
export const BUILT_IN_TEMPLATES: NotificationTemplate[] = [
  {
    id: "automation_success",
    name: "Automation Completed Successfully",
    channel: NotificationChannel.IN_APP,
    subject: "✅ Automation Completed: {{automationName}}",
    body: "Automation **{{automationName}}** completed successfully in {{durationMs}}ms.\n\n**Output:** {{output}}",
  },
  {
    id: "automation_failed",
    name: "Automation Failed",
    channel: NotificationChannel.IN_APP,
    subject: "❌ Automation Failed: {{automationName}}",
    body: "Automation **{{automationName}}** failed after {{durationMs}}ms.\n\n**Error:** {{error}}\n\n**Run ID:** {{runId}}",
  },
  {
    id: "automation_started",
    name: "Automation Started",
    channel: NotificationChannel.IN_APP,
    subject: "🚀 Automation Started: {{automationName}}",
    body: "Automation **{{automationName}}** has been triggered.\n\n**Trigger:** {{triggerType}}\n**Run ID:** {{runId}}",
  },
  {
    id: "connector_event",
    name: "Connector Event Received",
    channel: NotificationChannel.IN_APP,
    subject: "📥 {{platform}} Event: {{eventType}}",
    body: "Received **{{eventType}}** event from **{{platform}}**.\n\nTriggered automation: **{{automationName}}**",
  },
  {
    id: "cron_triggered",
    name: "Cron Automation Triggered",
    channel: NotificationChannel.IN_APP,
    subject: "⏰ Scheduled Automation: {{automationName}}",
    body: "Scheduled automation **{{automationName}}** ran at {{scheduledAt}}.\n\n**Cron:** {{cronExpression}}",
  },
];

/**
 * Default channel configurations (can be overridden per project)
 */
const DEFAULT_CHANNEL_CONFIG: Record<NotificationChannel, any> = {
  [NotificationChannel.EMAIL]: {
    enabled: true,
    provider: "sendgrid", // or "mailgun", "ses", "nodemailer"
    fromEmail: "notifications@infinity.local",
    fromName: "Infinity Notifications",
  },
  [NotificationChannel.PUSH]: {
    enabled: true,
    provider: "webpush", // or "firebase", "onesignal"
    vapidKeys: {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    },
  },
  [NotificationChannel.SLACK]: {
    enabled: true,
    // Uses existing Slack connectors
  },
  [NotificationChannel.DISCORD]: {
    enabled: true,
    // Uses existing Discord connectors
  },
  [NotificationChannel.WEBHOOK]: {
    enabled: true,
    defaultUrl: process.env.DEFAULT_WEBHOOK_URL,
    timeoutMs: 10000,
  },
  [NotificationChannel.IN_APP]: {
    enabled: true,
    // Stored in database as automation_logs or separate notifications table
  },
};

/**
 * Template Engine — Simple variable substitution
 */
export class TemplateEngine {
  /**
   * Render template with variables
   */
  static render(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.getNestedValue(variables, path);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Render template with HTML escaping
   */
  static renderHtml(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.getNestedValue(variables, path);
      if (value === undefined) return match;
      return String(value)
        .replace(/&/g, "&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, """)
        .replace(/'/g, "&#039;");
    });
  }

  /**
   * Get nested value from object using dot notation
   */
  private static getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }
}

/**
 * In-App Notification Storage (using automation_logs table for now)
 * In production, consider a dedicated notifications table
 */
export class InAppNotificationStore {
  static async create(data: {
    projectId: string;
    userId?: string;
    automationId?: string;
    runId?: string;
    title: string;
    body: string;
    type: "info" | "success" | "warning" | "error";
    metadata?: Record<string, any>;
  }): Promise<void> {
    // Store as a special log entry
    await db.insert(automationLogs).values({
      runId: data.runId || "in-app-notification",
      automationId: data.automationId || "system",
      projectId: data.projectId,
      actionId: "in-app-notification",
      actionType: "notification",
      actionName: "In-App Notification",
      level: data.type === "error" ? "error" : data.type === "warning" ? "warn" : "info",
      message: data.title,
      input: { body: data.body },
      output: { type: data.type },
      metadata: data.metadata,
      sequence: Date.now(),
    });
  }

  static async getForProject(projectId: string, limit = 50, unreadOnly = false): Promise<any[]> {
    // In production, query a dedicated notifications table
    // For now, return empty
    return [];
  }

  static async markAsRead(notificationIds: string[]): Promise<void> {
    // In production, update read status
  }
}

/**
 * Email Sender
 */
export class EmailSender {
  static async send(
    to: string | string[],
    subject: string,
    body: string,
    htmlBody?: string,
    config?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const recipients = Array.isArray(to) ? to : [to];

    // In production, integrate with SendGrid, Mailgun, SES, or Nodemailer
    // For now, log and return success
    logger.info({ to: recipients, subject }, "Sending email (mock)");

    // Example SendGrid integration:
    /*
    if (config?.provider === "sendgrid" && process.env.SENDGRID_API_KEY) {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      const msg = {
        to: recipients,
        from: { email: config.fromEmail, name: config.fromName },
        subject,
        text: body,
        html: htmlBody || body,
      };

      await sgMail.send(msg);
      return { success: true, messageId: "sendgrid-" + Date.now() };
    }
    */

    // Mock implementation
    return { success: true, messageId: `email-mock-${Date.now()}` };
  }
}

/**
 * Push Notification Sender
 */
export class PushSender {
  static async send(
    subscriptions: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>,
    title: string,
    body: string,
    data?: Record<string, any>,
    config?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }[]> {
    // In production, use web-push library with VAPID keys
    logger.info({ count: subscriptions.length, title }, "Sending push notifications (mock)");

    // Example web-push integration:
    /*
    const webpush = require("web-push");
    webpush.setVapidDetails(
      "mailto:notifications@infinity.local",
      config.vapidKeys.publicKey,
      config.vapidKeys.privateKey
    );

    const payload = JSON.stringify({ title, body, data });
    const results = await Promise.allSettled(
      subscriptions.map(sub => webpush.sendNotification(sub, payload))
    );

    return results.map((r, i) =>
      r.status === "fulfilled"
        ? { success: true, messageId: `push-${i}-${Date.now()}` }
        : { success: false, error: r.reason.message }
    );
    */

    // Mock implementation
    return subscriptions.map((_, i) => ({
      success: true,
      messageId: `push-mock-${i}-${Date.now()}`,
    }));
  }
}

/**
 * Slack Sender (uses existing connectors)
 */
export class SlackSender {
  static async send(
    projectId: string,
    channel: string,
    text: string,
    blocks?: any[],
    config?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Find Slack connector for project
      const connectors = await db.select().from(connectors).where(
        and(
          eq(connectors.projectId, projectId),
          eq(connectors.platform, "slack"),
          eq(connectors.enabled, true)
        )
      );

      if (connectors.length === 0) {
        return { success: false, error: "No Slack connector configured for project" };
      }

      // Use first available connector
      const connectorRecord = connectors[0];
      const connector = await createConnector(
        "slack",
        connectorRecord.config as Record<string, any>,
        projectId,
        connectorRecord.id
      );

      const result = await connector.sendMessage({
        channel,
        text,
        blocks,
      });

      return result;
    } catch (err) {
      logger.error({ err, projectId }, "Failed to send Slack notification");
      return { success: false, error: String(err) };
    }
  }
}

/**
 * Discord Sender (uses existing connectors)
 */
export class DiscordSender {
  static async send(
    projectId: string,
    channelId: string,
    content: string,
    embeds?: any[],
    config?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const connectors = await db.select().from(connectors).where(
        and(
          eq(connectors.projectId, projectId),
          eq(connectors.platform, "discord"),
          eq(connectors.enabled, true)
        )
      );

      if (connectors.length === 0) {
        return { success: false, error: "No Discord connector configured for project" };
      }

      const connectorRecord = connectors[0];
      const connector = await createConnector(
        "discord",
        connectorRecord.config as Record<string, any>,
        projectId,
        connectorRecord.id
      );

      const result = await connector.sendMessage({
        channelId,
        content,
        embeds,
      });

      return result;
    } catch (err) {
      logger.error({ err, projectId }, "Failed to send Discord notification");
      return { success: false, error: String(err) };
    }
  }
}

/**
 * Webhook Sender
 */
export class WebhookSender {
  static async send(
    url: string,
    payload: any,
    headers?: Record<string, string>,
    config?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const timeout = config?.timeoutMs || 10000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Infinity-Notifications/1.0",
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true, messageId: `webhook-${Date.now()}` };
    } catch (err) {
      logger.error({ err, url }, "Failed to send webhook notification");
      return { success: false, error: String(err) };
    }
  }
}

/**
 * Notification Service Main Class
 */
export class NotificationService {
  private templates: Map<string, NotificationTemplate> = new Map();
  private channelConfigs: Record<NotificationChannel, any> = { ...DEFAULT_CHANNEL_CONFIG };

  constructor() {
    // Register built-in templates
    for (const template of BUILT_IN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Register a custom template
   */
  registerTemplate(template: NotificationTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Get a template by ID
   */
  getTemplate(id: string): NotificationTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * List all templates
   */
  listTemplates(): NotificationTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Configure a channel
   */
  configureChannel(channel: NotificationChannel, config: any): void {
    this.channelConfigs[channel] = { ...this.channelConfigs[channel], ...config };
  }

  /**
   * Send notification using template or inline content
   */
  async send(payload: NotificationPayload): Promise<SendNotificationResult> {
    const results: NotificationResult[] = [];
    const failedChannels: NotificationChannel[] = [];

    // Resolve template
    let subject = "";
    let body = "";
    let htmlBody = "";

    if (payload.templateId) {
      const template = this.templates.get(payload.templateId);
      if (template) {
        subject = TemplateEngine.render(template.subject || "", payload.variables);
        body = TemplateEngine.render(template.body, payload.variables);
        htmlBody = template.htmlBody ? TemplateEngine.renderHtml(template.htmlBody, payload.variables) : undefined;
      }
    } else if (payload.inlineTemplate) {
      subject = TemplateEngine.render(payload.inlineTemplate.subject || "", payload.variables);
      body = TemplateEngine.render(payload.inlineTemplate.body, payload.variables);
      htmlBody = payload.inlineTemplate.htmlBody
        ? TemplateEngine.renderHtml(payload.inlineTemplate.htmlBody, payload.variables)
        : undefined;
    } else {
      throw new Error("Either templateId or inlineTemplate is required");
    }

    // Send to each channel
    for (const channel of payload.channels) {
      const channelConfig = this.channelConfigs[channel];
      if (!channelConfig?.enabled) {
        results.push({
          channel,
          success: false,
          error: `Channel ${channel} is not enabled`,
        });
        failedChannels.push(channel);
        continue;
      }

      const recipients = payload.recipients?.[channel] || [];

      try {
        let result: { success: boolean; messageId?: string; error?: string };

        switch (channel) {
          case NotificationChannel.EMAIL:
            if (recipients.length === 0) {
              result = { success: false, error: "No email recipients specified" };
            } else {
              result = await EmailSender.send(recipients, subject, body, htmlBody, channelConfig);
            }
            break;

          case NotificationChannel.PUSH:
            if (recipients.length === 0) {
              result = { success: false, error: "No push subscriptions specified" };
            } else {
              const pushResults = await PushSender.send(
                recipients.map(r => JSON.parse(r)),
                subject,
                body,
                payload.variables,
                channelConfig
              );
              result = pushResults[0]; // Take first result
              // Add all results
              for (let i = 0; i < pushResults.length; i++) {
                results.push({
                  channel,
                  success: pushResults[i].success,
                  messageId: pushResults[i].messageId,
                  error: pushResults[i].error,
                  recipient: recipients[i],
                });
              }
              continue; // Skip adding again below
            }
            break;

          case NotificationChannel.SLACK:
            if (recipients.length === 0) {
              result = { success: false, error: "No Slack channel specified" };
            } else {
              result = await SlackSender.send(payload.projectId, recipients[0], body, undefined, channelConfig);
            }
            break;

          case NotificationChannel.DISCORD:
            if (recipients.length === 0) {
              result = { success: false, error: "No Discord channel ID specified" };
            } else {
              result = await DiscordSender.send(payload.projectId, recipients[0], body, undefined, channelConfig);
            }
            break;

          case NotificationChannel.WEBHOOK:
            const webhookUrl = recipients[0] || channelConfig.defaultUrl;
            if (!webhookUrl) {
              result = { success: false, error: "No webhook URL specified" };
            } else {
              result = await WebhookSender.send(webhookUrl, {
                subject,
                body,
                htmlBody,
                variables: payload.variables,
                projectId: payload.projectId,
                automationId: payload.automationId,
                runId: payload.runId,
                metadata: payload.metadata,
              }, {}, channelConfig);
            }
            break;

          case NotificationChannel.IN_APP:
            await InAppNotificationStore.create({
              projectId: payload.projectId,
              automationId: payload.automationId,
              runId: payload.runId,
              title: subject,
              body,
              type: payload.priority === "critical" || payload.priority === "high" ? "error" : "info",
              metadata: payload.metadata,
            });
            result = { success: true, messageId: `in-app-${Date.now()}` };
            break;

          default:
            result = { success: false, error: `Unknown channel: ${channel}` };
        }

        results.push({
          channel,
          success: result.success,
          messageId: result.messageId,
          error: result.error,
          recipient: recipients[0],
        });

        if (!result.success) {
          failedChannels.push(channel);
        }
      } catch (err) {
        logger.error({ err, channel, projectId: payload.projectId }, "Notification channel error");
        results.push({
          channel,
          success: false,
          error: String(err),
        });
        failedChannels.push(channel);
      }
    }

    return {
      results,
      success: failedChannels.length === 0,
      failedChannels,
    };
  }

  /**
   * Convenience method for automation success notification
   */
  async notifyAutomationSuccess(data: {
    projectId: string;
    automationId: string;
    automationName: string;
    runId: string;
    durationMs: number;
    output?: any;
    channels?: NotificationChannel[];
    recipients?: Record<NotificationChannel, string[]>;
  }): Promise<SendNotificationResult> {
    return this.send({
      projectId: data.projectId,
      automationId: data.automationId,
      runId: data.runId,
      channels: data.channels || [NotificationChannel.IN_APP],
      recipients: data.recipients,
      templateId: "automation_success",
      variables: {
        automationName: data.automationName,
        durationMs: data.durationMs,
        output: JSON.stringify(data.output, null, 2),
        runId: data.runId,
      },
      priority: "normal",
    });
  }

  /**
   * Convenience method for automation failure notification
   */
  async notifyAutomationFailed(data: {
    projectId: string;
    automationId: string;
    automationName: string;
    runId: string;
    durationMs: number;
    error: string;
    channels?: NotificationChannel[];
    recipients?: Record<NotificationChannel, string[]>;
  }): Promise<SendNotificationResult> {
    return this.send({
      projectId: data.projectId,
      automationId: data.automationId,
      runId: data.runId,
      channels: data.channels || [NotificationChannel.IN_APP, NotificationChannel.SLACK],
      recipients: data.recipients,
      templateId: "automation_failed",
      variables: {
        automationName: data.automationName,
        durationMs: data.durationMs,
        error: data.error,
        runId: data.runId,
      },
      priority: "high",
    });
  }

  /**
   * Convenience method for automation started notification
   */
  async notifyAutomationStarted(data: {
    projectId: string;
    automationId: string;
    automationName: string;
    runId: string;
    triggerType: string;
    channels?: NotificationChannel[];
    recipients?: Record<NotificationChannel, string[]>;
  }): Promise<SendNotificationResult> {
    return this.send({
      projectId: data.projectId,
      automationId: data.automationId,
      runId: data.runId,
      channels: data.channels || [NotificationChannel.IN_APP],
      recipients: data.recipients,
      templateId: "automation_started",
      variables: {
        automationName: data.automationName,
        triggerType: data.triggerType,
        runId: data.runId,
      },
      priority: "low",
    });
  }

  /**
   * Convenience method for connector event notification
   */
  async notifyConnectorEvent(data: {
    projectId: string;
    automationId: string;
    automationName: string;
    platform: string;
    eventType: string;
    channels?: NotificationChannel[];
    recipients?: Record<NotificationChannel, string[]>;
  }): Promise<SendNotificationResult> {
    return this.send({
      projectId: data.projectId,
      automationId: data.automationId,
      channels: data.channels || [NotificationChannel.IN_APP],
      recipients: data.recipients,
      templateId: "connector_event",
      variables: {
        platform: data.platform,
        eventType: data.eventType,
        automationName: data.automationName,
      },
      priority: "normal",
    });
  }

  /**
   * Convenience method for cron trigger notification
   */
  async notifyCronTriggered(data: {
    projectId: string;
    automationId: string;
    automationName: string;
    cronExpression: string;
    scheduledAt: string;
    channels?: NotificationChannel[];
    recipients?: Record<NotificationChannel, string[]>;
  }): Promise<SendNotificationResult> {
    return this.send({
      projectId: data.projectId,
      automationId: data.automationId,
      channels: data.channels || [NotificationChannel.IN_APP],
      recipients: data.recipients,
      templateId: "cron_triggered",
      variables: {
        automationName: data.automationName,
        cronExpression: data.cronExpression,
        scheduledAt: data.scheduledAt,
      },
      priority: "low",
    });
  }
}

// Export singleton instance
export const notificationService = new NotificationService();