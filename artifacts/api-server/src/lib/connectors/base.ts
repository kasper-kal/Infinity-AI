import { logger } from "../logger";
import { logActivity } from "../project-activity";

/**
 * Phase 10: Messaging Connectors — Base framework for Slack, Discord, Telegram.
 *
 * Each connector implements a common interface for sending notifications
 * and handling incoming commands. Connectors are per-project and stored
 * in the database with encrypted config.
 */

export type Platform = "slack" | "discord" | "telegram";

export interface ConnectorConfig {
  /** Webhook URL for incoming webhooks */
  webhookUrl?: string;
  /** Bot token for API calls */
  botToken?: string;
  /** Channel/Chat ID to send messages to */
  channelId?: string;
  /** Additional platform-specific options */
  [key: string]: unknown;
}

export interface NotificationPayload {
  /** Event type that triggered this notification */
  eventType: string;
  /** Human-readable title */
  title: string;
  /** Markdown-formatted message body */
  body: string;
  /** Optional URL to link to (e.g., build URL) */
  url?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface CommandContext {
  /** Platform-specific message/context object */
  raw: unknown;
  /** Parsed command (e.g., "build", "status", "cancel") */
  command: string;
  /** Command arguments */
  args: string[];
  /** User who sent the command */
  userId: string;
  /** User display name */
  userName: string;
  /** Channel ID (Slack/Discord) */
  channelId: string;
  /** Chat ID (Telegram) */
  chatId?: string;
  /** Project ID this connector belongs to */
  projectId: string;
  /** Connector ID */
  connectorId: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Abstract base class for all messaging connectors.
 * Each platform implements the platform-specific logic.
 */
export abstract class BaseConnector {
  protected config: ConnectorConfig;
  protected projectId: string;
  protected connectorId: string;

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    this.config = config;
    this.projectId = projectId;
    this.connectorId = connectorId;
  }

  /** Platform identifier */
  abstract get platform(): Platform;

  /** Send a notification message */
  abstract sendNotification(payload: NotificationPayload): Promise<SendResult>;

  /** Handle an incoming command from the platform */
  abstract handleCommand(context: CommandContext): Promise<void>;

  /** Validate connector configuration */
  abstract validateConfig(): Promise<{ valid: boolean; error?: string }>;

  /** Get connector display name */
  abstract getDisplayName(): string;

  /** Log a notification attempt */
  protected async logNotification(
    eventType: string,
    statusCode: number | undefined,
    error: string | undefined,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      // Import db dynamically to avoid circular deps
      const { db, connectorNotifications } = await import("@workspace/db");
      await db.insert(connectorNotifications).values({
        connectorId: this.connectorId,
        projectId: this.projectId,
        eventType,
        statusCode,
        error,
        payload: this.truncatePayload(payload),
      });
    } catch (err) {
      logger.warn({ err, connectorId: this.connectorId }, "Failed to log notification");
    }
  }

  /** Truncate payload for storage */
  private truncatePayload(payload: NotificationPayload): Record<string, unknown> {
    return {
      eventType: payload.eventType,
      title: payload.title,
      body: payload.body.slice(0, 2000),
      url: payload.url,
      metadata: payload.metadata,
    };
  }

  /** Log activity to project activity feed */
  protected async logActivity(type: string, description: string): Promise<void> {
    try {
      await logActivity(this.projectId, type as any, description);
    } catch { /* non-fatal */ }
  }
}

/**
 * Factory function to create connector instances from DB config.
 */
export async function createConnector(
  platform: Platform,
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<BaseConnector> {
  // Dynamic imports to avoid circular dependencies
  switch (platform) {
    case "slack": {
      const { SlackConnector } = await import("./slack");
      return new SlackConnector(config, projectId, connectorId);
    }
    case "discord": {
      const { DiscordConnector } = await import("./discord");
      return new DiscordConnector(config, projectId, connectorId);
    }
    case "telegram": {
      const { TelegramConnector } = await import("./telegram");
      return new TelegramConnector(config, projectId, connectorId);
    }
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Default event types that connectors can subscribe to.
 */
export const DEFAULT_NOTIFY_EVENTS = [
  "build_completed",
  "build_failed",
  "build_started",
  "research_completed",
  "research_failed",
  "scheduled_job_completed",
  "scheduled_job_failed",
  "deployment_completed",
  "deployment_failed",
] as const;

export type NotifyEventType = typeof DEFAULT_NOTIFY_EVENTS[number];

/**
 * Check if an event type should trigger a notification for a connector.
 */
export function shouldNotify(connectorNotifyOn: string[], eventType: string): boolean {
  return connectorNotifyOn.includes(eventType) || connectorNotifyOn.includes("*");
}