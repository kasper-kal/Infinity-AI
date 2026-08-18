import { logger } from "../logger";
import { BaseConnector, type ConnectorConfig, type NotificationPayload, type SendResult, type CommandContext } from "./base";

/**
 * Slack Connector — supports Incoming Webhooks and Bot Token API.
 *
 * Config options:
 * - webhookUrl: Incoming webhook URL (for simple notifications)
 * - botToken: Slack Bot User OAuth Token (for advanced features like slash commands)
 * - channelId: Channel ID to send to (overrides webhook default)
 * - signingSecret: Slack Signing Secret (for request verification)
 * - appId: Slack App ID
 */
export class SlackConnector extends BaseConnector {
  readonly platform = "slack" as const;

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
  }

  getDisplayName(): string {
    return `Slack (${this.config.channelId || "webhook"})`;
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.webhookUrl && !this.config.botToken) {
      return { valid: false, error: "Either webhookUrl or botToken is required" };
    }
    return { valid: true };
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    const { valid, error } = await this.validateConfig();
    if (!valid) {
      return { success: false, error };
    }

    try {
      // Use webhook if available, otherwise use bot token with chat.postMessage
      if (this.config.webhookUrl) {
        return this.sendViaWebhook(payload);
      } else if (this.config.botToken) {
        return this.sendViaBotToken(payload);
      }
      return { success: false, error: "No valid send method configured" };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      await this.logNotification(payload.eventType, undefined, error, payload);
      return { success: false, error };
    }
  }

  private async sendViaWebhook(payload: NotificationPayload): Promise<SendResult> {
    const webhookUrl = this.config.webhookUrl as string;
    const channelId = this.config.channelId as string | undefined;

    const blocks = this.buildBlocks(payload);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: channelId,
        blocks,
        text: `${payload.title}\n${payload.body}`, // fallback for notifications
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = `Webhook failed: ${response.status} ${errorText}`;
      await this.logNotification(payload.eventType, response.status, error, payload);
      return { success: false, error };
    }

    await this.logNotification(payload.eventType, response.status, undefined, payload);
    return { success: true };
  }

  private async sendViaBotToken(payload: NotificationPayload): Promise<SendResult> {
    const botToken = this.config.botToken as string;
    const channelId = this.config.channelId as string;

    if (!channelId) {
      const error = "channelId is required when using botToken";
      await this.logNotification(payload.eventType, undefined, error, payload);
      return { success: false, error };
    }

    const blocks = this.buildBlocks(payload);

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        blocks,
        text: `${payload.title}\n${payload.body}`,
      }),
    });

    const data = await response.json() as { ok?: boolean; error?: string; ts?: string; [key: string]: unknown };

    if (!data.ok) {
      const error = `Slack API error: ${data.error}`;
      await this.logNotification(payload.eventType, response.status, error, payload);
      return { success: false, error };
    }

    await this.logNotification(payload.eventType, response.status, undefined, payload);
    return { success: true, messageId: data.ts };
  }

  private buildBlocks(payload: NotificationPayload): unknown[] {
    const color = this.getColorForEvent(payload.eventType);
    const emoji = this.getEmojiForEvent(payload.eventType);

    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} ${payload.title}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: payload.body,
        },
      },
    ];

    if (payload.url) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Details",
              emoji: true,
            },
            url: payload.url,
            style: "primary",
          },
        ],
      });
    }

    // Add context with metadata
    if (payload.metadata) {
      const fields = Object.entries(payload.metadata).slice(0, 10).map(([key, value]) => ({
        type: "mrkdwn",
        text: `*${key}*\n${String(value).slice(0, 100)}`,
      }));

      if (fields.length > 0) {
        blocks.push({
          type: "section",
          fields,
        });
      }
    }

    // Add divider and footer
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Infinity • ${new Date().toLocaleString()} • ${payload.eventType}`,
          },
        ],
      }
    );

    return blocks;
  }

  private getColorForEvent(eventType: string): string {
    if (eventType.includes("failed") || eventType.includes("error")) return "#dc3545";
    if (eventType.includes("completed") || eventType.includes("success")) return "#28a745";
    if (eventType.includes("started")) return "#007bff";
    return "#6c757d";
  }

  private getEmojiForEvent(eventType: string): string {
    if (eventType.includes("build")) {
      if (eventType.includes("failed")) return "🔴";
      if (eventType.includes("completed")) return "🟢";
      return "🔵";
    }
    if (eventType.includes("research")) return "🔬";
    if (eventType.includes("scheduled")) return "⏰";
    if (eventType.includes("deployment")) return "🚀";
    return "📢";
  }

  async handleCommand(context: CommandContext): Promise<void> {
    const { command, args, channelId, userId, userName, projectId, connectorId } = context;

    logger.info({ command, args, projectId, connectorId }, "Slack command received");

    try {
      switch (command) {
        case "build":
          await this.handleBuildCommand(context);
          break;
        case "status":
          await this.handleStatusCommand(context);
          break;
        case "cancel":
          await this.handleCancelCommand(context);
          break;
        case "logs":
          await this.handleLogsCommand(context);
          break;
        case "help":
          await this.sendHelp(channelId);
          break;
        default:
          await this.sendMessage(channelId, `Unknown command: \`${command}\`. Type \`/infinity help\` for available commands.`);
      }
    } catch (err) {
      logger.error({ err, command, projectId }, "Slack command handler error");
      await this.sendMessage(channelId, `Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async handleBuildCommand(context: CommandContext): Promise<void> {
    const { args, channelId, projectId, connectorId } = context;

    if (args.length === 0) {
      await this.sendMessage(channelId, "Usage: `/infinity build <goal>`");
      return;
    }

    const goal = args.join(" ");

    try {
      // Import API functions dynamically
      const { runMultiAgentBuild } = await import("../build-orchestrator");
      const { ensureWorkspace } = await import("../workspace");
      const { setProjectGoal, refreshFileMap } = await import("../build-context");

      await ensureWorkspace(projectId);
      setProjectGoal(projectId, goal);
      await refreshFileMap(projectId, projectId);

      await this.sendMessage(channelId, `🔨 Starting build for project \`${projectId}\`...\nGoal: ${goal}`);

      const result = await runMultiAgentBuild({
        goal,
        projectId,
        workspaceId: projectId,
        toolContext: { projectId, workspaceId: projectId },
      });

      if (result.success) {
        await this.sendMessage(channelId, `✅ Build completed successfully!\nSummary: ${result.plan?.summary || "Done"}`);
      } else {
        await this.sendMessage(channelId, `❌ Build failed: ${result.error || "Unknown error"}`);
      }
    } catch (err) {
      await this.sendMessage(channelId, `❌ Build error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async handleStatusCommand(context: CommandContext): Promise<void> {
    const { channelId, projectId } = context;

    try {
      const { db, buildCheckpoints } = await import("@workspace/db");
      const { eq, desc } = await import("drizzle-orm");

      const [latest] = await db
        .select()
        .from(buildCheckpoints)
        .where(eq(buildCheckpoints.projectId, projectId))
        .orderBy(desc(buildCheckpoints.createdAt))
        .limit(1);

      if (!latest) {
        await this.sendMessage(channelId, "No builds found for this project.");
        return;
      }

      const status = latest.completed ? "completed" : "in-progress";
      const iteration = latest.iteration;
      const createdAt = latest.createdAt.toLocaleString();

      await this.sendMessage(channelId, `📊 *Build Status for ${projectId}*\nLatest: Iteration ${iteration} — ${status} (${createdAt})`);
    } catch (err) {
      await this.sendMessage(channelId, `Error fetching status: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async handleCancelCommand(context: CommandContext): Promise<void> {
    const { channelId } = context;
    await this.sendMessage(channelId, "Build cancellation via Slack not yet implemented. Use the web UI or API.");
  }

  private async handleLogsCommand(context: CommandContext): Promise<void> {
    const { channelId } = context;
    await this.sendMessage(channelId, "Log streaming via Slack not yet implemented. Use the web UI.");
  }

  private async sendHelp(channelId: string): Promise<void> {
    const help = `*Infinity Slack Commands*
\`/infinity build <goal>\` — Start a new build
\`/infinity status\` — Check latest build status
\`/infinity cancel\` — Cancel running build
\`/infinity logs\` — Stream build logs
\`/infinity help\` — Show this help`;

    await this.sendMessage(channelId, help);
  }

  private async sendMessage(channelId: string, text: string): Promise<void> {
    if (!this.config.botToken) {
      logger.warn("Cannot send message: botToken not configured");
      return;
    }

    try {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.botToken}`,
        },
        body: JSON.stringify({ channel: channelId, text }),
      });
    } catch (err) {
      logger.error({ err }, "Failed to send Slack message");
    }
  }
}