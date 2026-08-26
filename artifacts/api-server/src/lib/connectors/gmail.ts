import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, type ConnectorConfig, type NotificationPayload, type SendResult, type CommandContext } from "./base";

/**
 * Gmail Connector — Email operations.
 * Supports: Send, List, Search, Labels, Drafts, Read, Trash, Archive
 * Uses Gmail API with OAuth 2.0.
 */

interface GmailConfig extends ConnectorConfig {
  /** Gmail API access token */
  accessToken?: string;
  /** Refresh token for token renewal */
  refreshToken?: string;
  /** Client ID for token refresh */
  clientId?: string;
  /** Client secret for token refresh */
  clientSecret?: string;
  /** User email address (for multi-account support) */
  userId?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: any[];
    body?: { data?: string; size: number };
    mimeType: string;
  };
  sizeEstimate: number;
}

interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
  snippet: string;
}

interface GmailLabel {
  id: string;
  name: string;
  messageListVisibility: string;
  labelListVisibility: string;
  type: "system" | "user";
  messagesTotal: number;
  messagesUnread: number;
  threadsTotal: number;
  threadsUnread: number;
}

interface GmailDraft {
  id: string;
  message: GmailMessage;
}

export class GmailConnector extends BaseConnector {
  protected config: GmailConfig;
  private baseUrl = "https://gmail.googleapis.com/gmail/v1/users";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as GmailConfig;
  }

  get platform() {
    return "gmail" as const;
  }

  getDisplayName(): string {
    return `Gmail (${this.config.userId || "me"})`;
  }

  private getUserId(): string {
    return this.config.userId || "me";
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const accessToken = await this.ensureValidToken();
    if (!accessToken) {
      throw new Error("Gmail access token not available");
    }

    const userId = this.getUserId();
    const response = await fetch(`${this.baseUrl}/${userId}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 401) {
      await this.refreshAccessToken();
      return this.request(endpoint, options); // Retry once
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Gmail API error (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    return data;
  }

  private async ensureValidToken(): Promise<string | null> {
    if (this.config.accessToken) {
      return this.config.accessToken;
    }
    return null;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret) {
      throw new Error("Cannot refresh token: missing refresh token or client credentials");
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
    }

    this.config.accessToken = data.access_token;
    if (data.refresh_token) {
      this.config.refreshToken = data.refresh_token;
    }
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.accessToken && (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret)) {
        return { valid: false, error: "Gmail access token or refresh credentials required" };
      }

      const data = await this.request("/profile");

      if (!data?.emailAddress) {
        return { valid: false, error: "Invalid Gmail credentials" };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      await this.logNotification(payload.eventType, 200, undefined, payload);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      await this.logNotification(payload.eventType, 500, error, payload);
      return { success: false, error };
    }
  }

  async handleCommand(context: CommandContext): Promise<void> {
    const { command, args, projectId, connectorId } = context;

    try {
      switch (command) {
        case "send":
        case "compose":
          await this.handleSend(context);
          break;
        case "list":
        case "inbox":
          await this.handleList(context);
          break;
        case "search":
          await this.handleSearch(context);
          break;
        case "labels":
        case "list-labels":
          await this.handleListLabels(context);
          break;
        case "drafts":
        case "list-drafts":
          await this.handleListDrafts(context);
          break;
        case "read":
        case "get":
          await this.handleRead(context);
          break;
        case "trash":
        case "delete":
          await this.handleTrash(context);
          break;
        case "archive":
          await this.handleArchive(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "Gmail command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  // Action methods for tool registry

  async send(params: { to: string; subject: string; body: string; cc?: string; bcc?: string; threadId?: string }): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const { to, subject, body, cc, bcc, threadId } = params;

      // Build raw email
      const emailLines = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `MIME-Version: 1.0`,
      ];

      if (cc) emailLines.splice(1, 0, `Cc: ${cc}`);
      if (bcc) emailLines.splice(1, 0, `Bcc: ${bcc}`);
      if (threadId) emailLines.splice(1, 0, `In-Reply-To: ${threadId}`, `References: ${threadId}`);

      emailLines.push("", body);

      const rawEmail = emailLines.join("\r\n");
      const base64Email = Buffer.from(rawEmail).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const result = await this.request("/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw: base64Email }),
      }) as { id: string; threadId: string };

      await logActivity(this.projectId, "agent_ran", `Sent email to ${to}: ${subject}`);

      return { success: true, messageId: result.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Send failed";
      return { success: false, error };
    }
  }

  async list(params: { labelIds?: string[]; q?: string; maxResults?: number; pageToken?: string }): Promise<{
    success: boolean;
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
    error?: string;
  }> {
    try {
      const { labelIds = ["INBOX"], q, maxResults = 20, pageToken } = params;
      const queryParams = new URLSearchParams({
        labelIds: labelIds.join(","),
        maxResults: maxResults.toString(),
        ...(q && { q }),
        ...(pageToken && { pageToken }),
      });

      const result = await this.request(`/messages?${queryParams}`) as {
        messages: Array<{ id: string; threadId: string }>;
        nextPageToken?: string;
      };

      return { success: true, messages: result.messages || [], nextPageToken: result.nextPageToken };
    } catch (err) {
      const error = err instanceof Error ? err.message : "List failed";
      return { success: false, error };
    }
  }

  async search(params: { q: string; maxResults?: number }): Promise<{
    success: boolean;
    messages?: Array<{ id: string; threadId: string }>;
    error?: string;
  }> {
    return this.list({ q: params.q, maxResults: params.maxResults || 20 });
  }

  async listLabels(): Promise<{
    success: boolean;
    labels?: GmailLabel[];
    error?: string;
  }> {
    try {
      const result = await this.request("/labels") as { labels: GmailLabel[] };
      return { success: true, labels: result.labels };
    } catch (err) {
      const error = err instanceof Error ? err.message : "List labels failed";
      return { success: false, error };
    }
  }

  async listDrafts(params: { maxResults?: number }): Promise<{
    success: boolean;
    drafts?: GmailDraft[];
    error?: string;
  }> {
    try {
      const { maxResults = 20 } = params;
      const result = await this.request(`/drafts?maxResults=${maxResults}`) as { drafts: GmailDraft[] };
      return { success: true, drafts: result.drafts || [] };
    } catch (err) {
      const error = err instanceof Error ? err.message : "List drafts failed";
      return { success: false, error };
    }
  }

  async read(params: { messageId: string; format?: "full" | "metadata" | "minimal" }): Promise<{
    success: boolean;
    message?: GmailMessage;
    error?: string;
  }> {
    try {
      const { messageId, format = "full" } = params;
      const message = await this.request(`/messages/${messageId}?format=${format}`) as GmailMessage;
      return { success: true, message };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Read failed";
      return { success: false, error };
    }
  }

  async trash(params: { messageId: string }): Promise<{ success: boolean; error?: string }> {
    try {
      await this.request(`/messages/${params.messageId}/trash`, { method: "POST" });
      await logActivity(this.projectId, "agent_ran", `Trashed message ${params.messageId}`);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Trash failed";
      return { success: false, error };
    }
  }

  async archive(params: { messageId: string }): Promise<{ success: boolean; error?: string }> {
    try {
      // Archive = remove INBOX label
      await this.request(`/messages/${params.messageId}/modify`, {
        method: "POST",
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      });
      await logActivity(this.projectId, "agent_ran", `Archived message ${params.messageId}`);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Archive failed";
      return { success: false, error };
    }
  }

  async createDraft(params: { to: string; subject: string; body: string; cc?: string; bcc?: string }): Promise<{
    success: boolean;
    draftId?: string;
    error?: string;
  }> {
    try {
      const { to, subject, body, cc, bcc } = params;

      const emailLines = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `MIME-Version: 1.0`,
      ];

      if (cc) emailLines.splice(1, 0, `Cc: ${cc}`);
      if (bcc) emailLines.splice(1, 0, `Bcc: ${bcc}`);

      emailLines.push("", body);

      const rawEmail = emailLines.join("\r\n");
      const base64Email = Buffer.from(rawEmail).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const result = await this.request("/drafts", {
        method: "POST",
        body: JSON.stringify({ message: { raw: base64Email } }),
      }) as { id: string };

      await logActivity(this.projectId, "agent_ran", `Created draft for ${to}: ${subject}`);

      return { success: true, draftId: result.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Create draft failed";
      return { success: false, error };
    }
  }

  // Command handlers
  private async handleSend(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 3) {
      await this.sendError(context, "Usage: /infinity send <to> <subject> <body>");
      return;
    }

    const to = args[0];
    const subject = args[1];
    const body = args.slice(2).join(" ");

    const result = await this.send({ to, subject, body });

    if (result.success) {
      await this.sendCommandResponse(context, `✅ Email sent to ${to}: ${subject}`);
    } else {
      await this.sendError(context, result.error || "Send failed");
    }
  }

  private async handleList(context: CommandContext): Promise<void> {
    const { args } = context;
    const label = args[0] || "INBOX";
    const query = args.slice(1).join(" ");

    const result = await this.list({ labelIds: [label], q: query || undefined, maxResults: 15 });

    if (result.success && result.messages) {
      if (result.messages.length === 0) {
        await this.sendCommandResponse(context, `No messages in ${label}${query ? ` matching "${query}"` : ""}.`);
        return;
      }

      // Get details for first few messages
      const details = await Promise.all(
        result.messages.slice(0, 10).map(m => this.read({ messageId: m.id, format: "metadata" }))
      );

      const lines = details.filter(d => d.success && d.message).map((d, i) => {
        const msg = d.message!;
        const subject = msg.payload.headers.find(h => h.name === "Subject")?.value || "(no subject)";
        const from = msg.payload.headers.find(h => h.name === "From")?.value || "(unknown)";
        const date = new Date(parseInt(msg.internalDate)).toLocaleDateString();
        return `• **${subject}** — ${from} (${date})`;
      }).join("\n");

      await this.sendCommandResponse(context, `📧 **Messages in ${label}**${query ? ` (search: "${query}")` : ""}:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "List failed");
    }
  }

  private async handleSearch(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity search <query>");
      return;
    }

    const query = args.join(" ");
    const result = await this.search({ q: query, maxResults: 15 });

    if (result.success && result.messages) {
      if (result.messages.length === 0) {
        await this.sendCommandResponse(context, `No messages found for "${query}".`);
        return;
      }

      const details = await Promise.all(
        result.messages.slice(0, 10).map(m => this.read({ messageId: m.id, format: "metadata" }))
      );

      const lines = details.filter(d => d.success && d.message).map(d => {
        const msg = d.message!;
        const subject = msg.payload.headers.find(h => h.name === "Subject")?.value || "(no subject)";
        const from = msg.payload.headers.find(h => h.name === "From")?.value || "(unknown)";
        const date = new Date(parseInt(msg.internalDate)).toLocaleDateString();
        return `• **${subject}** — ${from} (${date})`;
      }).join("\n");

      await this.sendCommandResponse(context, `🔍 **Search results for "${query}"**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Search failed");
    }
  }

  private async handleListLabels(context: CommandContext): Promise<void> {
    const result = await this.listLabels();

    if (result.success && result.labels) {
      const systemLabels = result.labels.filter(l => l.type === "system");
      const userLabels = result.labels.filter(l => l.type === "user");

      const sysLines = systemLabels.slice(0, 10).map(l =>
        `• ${l.name} (${l.messagesTotal} messages, ${l.messagesUnread} unread)`
      ).join("\n");

      const userLines = userLabels.slice(0, 10).map(l =>
        `• ${l.name} (${l.messagesTotal} messages)`
      ).join("\n");

      let response = `🏷️ **Gmail Labels**:\n\n**System Labels:**\n${sysLines}`;
      if (userLines) response += `\n\n**Custom Labels:**\n${userLines}`;

      await this.sendCommandResponse(context, response);
    } else {
      await this.sendError(context, result.error || "List labels failed");
    }
  }

  private async handleListDrafts(context: CommandContext): Promise<void> {
    const result = await this.listDrafts({ maxResults: 15 });

    if (result.success && result.drafts) {
      if (result.drafts.length === 0) {
        await this.sendCommandResponse(context, "No drafts found.");
        return;
      }

      const lines = result.drafts.map(d => {
        const subject = d.message.payload.headers.find(h => h.name === "Subject")?.value || "(no subject)";
        const to = d.message.payload.headers.find(h => h.name === "To")?.value || "";
        return `• **${subject}** — To: ${to}`;
      }).join("\n");

      await this.sendCommandResponse(context, `📝 **Drafts**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "List drafts failed");
    }
  }

  private async handleRead(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity read <message-id>");
      return;
    }

    const messageId = args[0];
    const result = await this.read({ messageId, format: "full" });

    if (result.success && result.message) {
      const msg = result.message;
      const subject = msg.payload.headers.find(h => h.name === "Subject")?.value || "(no subject)";
      const from = msg.payload.headers.find(h => h.name === "From")?.value || "(unknown)";
      const to = msg.payload.headers.find(h => h.name === "To")?.value || "(unknown)";
      const date = new Date(parseInt(msg.internalDate)).toLocaleString();

      // Extract body
      let body = msg.snippet;
      if (msg.payload.body?.data) {
        body = Buffer.from(msg.payload.body.data, "base64").toString("utf-8").slice(0, 2000);
      } else if (msg.payload.parts) {
        const textPart = msg.payload.parts.find((p: any) => p.mimeType === "text/plain");
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, "base64").toString("utf-8").slice(0, 2000);
        }
      }

      await this.sendCommandResponse(context,
        `📧 **Email**\n` +
        `**Subject:** ${subject}\n` +
        `**From:** ${from}\n` +
        `**To:** ${to}\n` +
        `**Date:** ${date}\n\n` +
        `**Body:**\n${body}${body.length >= 2000 ? "..." : ""}`
      );
    } else {
      await this.sendError(context, result.error || "Read failed");
    }
  }

  private async handleTrash(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity trash <message-id>");
      return;
    }

    const result = await this.trash({ messageId: args[0] });

    if (result.success) {
      await this.sendCommandResponse(context, `🗑️ Message moved to trash`);
    } else {
      await this.sendError(context, result.error || "Trash failed");
    }
  }

  private async handleArchive(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity archive <message-id>");
      return;
    }

    const result = await this.archive({ messageId: args[0] });

    if (result.success) {
      await this.sendCommandResponse(context, `📦 Message archived`);
    } else {
      await this.sendError(context, result.error || "Archive failed");
    }
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    await this.sendCommandResponse(context,
      `🤖 **Gmail Commands**:\n` +
      `\`/infinity send <to> <subject> <body>\` — Send email\n` +
      `\`/infinity list [label] [query]\` — List messages (default: INBOX)\n` +
      `\`/infinity search <query>\` — Search emails\n` +
      `\`/infinity labels\` — List all labels\n` +
      `\`/infinity drafts\` — List drafts\n` +
      `\`/infinity read <message-id>\` — Read full message\n` +
      `\`/infinity trash <message-id>\` — Move to trash\n` +
      `\`/infinity archive <message-id>\` — Archive (remove from inbox)`
    );
  }

  private async sendCommandResponse(context: CommandContext, text: string): Promise<void> {
    logger.info({ text, channelId: context.channelId }, "Gmail command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ ${error}`);
  }
}

export async function createGmailConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<GmailConnector> {
  return new GmailConnector(config, projectId, connectorId);
}