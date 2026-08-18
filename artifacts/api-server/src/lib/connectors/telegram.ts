import { logger } from "../logger";
import { BaseConnector, type ConnectorConfig, type NotificationPayload, type SendResult, type CommandContext } from "./base";

/**
 * Telegram Connector — supports Bot API with webhook and long polling.
 *
 * Config options:
 * - botToken: Telegram Bot Token (required)
 * - chatId: Chat ID to send messages to (required for notifications)
 * - webhookUrl: Webhook URL for receiving updates (optional, for self-hosted)
 * - secretToken: Secret token for webhook verification
 */
export class TelegramConnector extends BaseConnector {
  readonly platform = "telegram" as const;

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
  }

  getDisplayName(): string {
    return `Telegram (${this.config.chatId || "not configured"})`;
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.botToken) {
      return { valid: false, error: "botToken is required" };
    }
    if (!this.config.chatId) {
      return { valid: false, error: "chatId is required for notifications" };
    }
    return { valid: true };
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    const { valid, error } = await this.validateConfig();
    if (!valid) {
      return { success: false, error };
    }

    try {
      return await this.sendViaBotApi(payload);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      await this.logNotification(payload.eventType, undefined, error, payload);
      return { success: false, error };
    }
  }

  private async sendViaBotApi(payload: NotificationPayload): Promise<SendResult> {
    const botToken = this.config.botToken as string;
    const chatId = this.config.chatId as string;

    const message = this.buildMessage(payload);

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });

    const data = await response.json() as { ok?: boolean; description?: string; result?: { message_id?: number | string }; [key: string]: unknown };

    if (!data.ok) {
      const error = `Telegram API error: ${data.description}`;
      await this.logNotification(payload.eventType, response.status, error, payload);
      return { success: false, error };
    }

    await this.logNotification(payload.eventType, response.status, undefined, payload);
    return { success: true, messageId: data.result ? String(data.result.message_id) : undefined };
  }

  private buildMessage(payload: NotificationPayload): string {
    const emoji = this.getEmojiForEvent(payload.eventType);
    const escapedTitle = this.escapeMarkdown(payload.title);
    const escapedBody = this.escapeMarkdown(payload.body.slice(0, 3500));

    let message = `${emoji} *${escapedTitle}*\n\n${escapedBody}`;

    if (payload.metadata) {
      message += "\n\n*Details:*";
      for (const [key, value] of Object.entries(payload.metadata).slice(0, 10)) {
        const escapedKey = this.escapeMarkdown(key);
        const escapedValue = this.escapeMarkdown(String(value).slice(0, 200));
        message += `\n• ${escapedKey}: ${escapedValue}`;
      }
    }

    if (payload.url) {
      const escapedUrl = this.escapeMarkdown(payload.url);
      message += `\n\n[View Details](${escapedUrl})`;
    }

    message += `\n\n_Infinity • ${new Date().toLocaleString()} • ${payload.eventType}_`;

    return message;
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
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
    const { command, args, chatId, userId, userName, projectId, connectorId } = context;
    const targetChatId = chatId || "";

    logger.info({ command, args, projectId, connectorId }, "Telegram command received");

    if (!chatId) {
      logger.warn("Telegram command received without chatId");
      return;
    }

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
          await this.sendHelp(chatId);
          break;
        default:
          await this.sendMessage(chatId, `Unknown command: \`/${command}\`. Type \`/infinity help\` for available commands.`);
      }
    } catch (err) {
      logger.error({ err, command, projectId }, "Telegram command handler error");
      await this.sendMessage(chatId, `Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async handleBuildCommand(context: CommandContext): Promise<void> {
    const { args, chatId, projectId, connectorId } = context;
    const targetChatId = chatId ?? "";

    if (args.length === 0) {
      await this.sendMessage(targetChatId, "Usage: `/infinity build <goal>`");
      return;
    }

    const goal = args.join(" ");

    try {
      const { runMultiAgentBuild } = await import("../build-orchestrator");
      const { ensureWorkspace } = await import("../workspace");
      const { setProjectGoal, refreshFileMap } = await import("../build-context");

      await ensureWorkspace(projectId);
      setProjectGoal(projectId, goal);
      await refreshFileMap(projectId, projectId);

      await this.sendMessage(targetChatId, `🔨 Starting build for project \`${projectId}\`...\nGoal: ${goal}`);

      const result = await runMultiAgentBuild({
        goal,
        projectId,
        workspaceId: projectId,
        toolContext: { projectId, workspaceId: projectId },
      });

      if (result.success) {
        await this.sendMessage(targetChatId, `✅ Build completed successfully!\nSummary: ${result.plan?.summary || "Done"}`);
      } else {
        await this.sendMessage(targetChatId, `❌ Build failed: ${result.error || "Unknown error"}`);
      }
    } catch (err) {
      await this.sendMessage(targetChatId, `❌ Build error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async handleStatusCommand(context: CommandContext): Promise<void> {
    const { chatId, projectId } = context;
    const targetChatId = chatId ?? "";

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
        await this.sendMessage(targetChatId, "No builds found for this project.");
        return;
      }

      const status = latest.completed ? "completed" : "in-progress";
      const iteration = latest.iteration;
      const createdAt = latest.createdAt.toLocaleString();

      await this.sendMessage(targetChatId, `📊 *Build Status for ${projectId}*\nLatest: Iteration ${iteration} — ${status} (${createdAt})`);
    } catch (err) {
      await this.sendMessage(targetChatId, `Error fetching status: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async handleCancelCommand(context: CommandContext): Promise<void> {
    const { chatId } = context;
    const targetChatId = chatId ?? "";
    await this.sendMessage(targetChatId, "Build cancellation via Telegram not yet implemented. Use the web UI or API.");
  }

  private async handleLogsCommand(context: CommandContext): Promise<void> {
    const { chatId } = context;
    const targetChatId = chatId ?? "";
    await this.sendMessage(targetChatId, "Log streaming via Telegram not yet implemented. Use the web UI.");
  }

  private async sendHelp(chatId: string): Promise<void> {
    const help = `*Infinity Telegram Commands*
\`/infinity build <goal>\` — Start a new build
\`/infinity status\` — Check latest build status
\`/infinity cancel\` — Cancel running build
\`/infinity logs\` — Stream build logs
\`/infinity help\` — Show this help`;

    await this.sendMessage(chatId, help);
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.config.botToken) {
      logger.warn("Cannot send message: botToken not configured");
      return;
    }

    try {
      await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "MarkdownV2",
        }),
      });
    } catch (err) {
      logger.error({ err }, "Failed to send Telegram message");
    }
  }
}