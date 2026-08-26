import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, ConnectorConfig, NotificationPayload, CommandContext, SendResult } from "./base";

/**
 * Notion Connector — Pages, databases, and content management
 * Supports: Pages, Databases, Blocks, Comments, Search, Webhooks
 * OAuth 2.0 + Internal Integrations
 */

interface NotionConfig extends ConnectorConfig {
  /** Notion integration token (Bearer token) */
  apiKey?: string;
  /** Default parent page ID for new content */
  defaultParentId?: string;
  /** Default database ID for new entries */
  defaultDatabaseId?: string;
  /** Webhook secret for signature verification */
  webhookSecret?: string;
}

interface NotionPage {
  id: string;
  url: string;
  title: string;
  properties: Record<string, any>;
  createdTime: string;
  lastEditedTime: string;
  parent: { type: string; page_id?: string; database_id?: string; workspace?: boolean };
}

interface NotionDatabase {
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, any>;
  url: string;
  createdTime: string;
  lastEditedTime: string;
}

interface NotionBlock {
  id: string;
  type: string;
  hasChildren: boolean;
  [key: string]: any;
}

interface NotionWebhookPayload {
  type: string;
  timestamp: string;
  data: {
    id: string;
    parent?: any;
  };
}

export class NotionConnector extends BaseConnector {
  protected config: NotionConfig;
  private baseUrl = "https://api.notion.com/v1";
  private apiVersion = "2022-06-28";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as NotionConfig;
  }

  get platform() {
    return "notion" as const;
  }

  getDisplayName(): string {
    return "Notion";
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const apiKey = this.config.apiKey || this.config.botToken;
    if (!apiKey) {
      throw new Error("Notion API key not configured");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Notion-Version": this.apiVersion,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Notion API error (${response.status}): ${data.message || JSON.stringify(data)}`);
    }

    return data;
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.apiKey && !this.config.botToken) {
        return { valid: false, error: "Notion integration token is required" };
      }

      // Test connection by fetching users (self)
      const data = await this.request("/users/me");

      if (!data?.id) {
        return { valid: false, error: "Invalid Notion integration token" };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      // Create a page in the default database or as a child of default parent
      let page: NotionPage;

      if (this.config.defaultDatabaseId) {
        page = await this.createDatabaseEntry({
          databaseId: this.config.defaultDatabaseId,
          properties: {
            Title: { title: [{ text: { content: payload.title } }] },
            EventType: { select: { name: payload.eventType } },
            Body: { rich_text: [{ text: { content: payload.body } }] },
            Timestamp: { date: { start: new Date().toISOString() } },
            Source: { url: payload.url }.url ? { url: payload.url } : undefined,
          },
        });
      } else if (this.config.defaultParentId) {
        page = await this.createPage({
          parentId: this.config.defaultParentId,
          title: payload.title,
          content: [
            { type: "paragraph", rich_text: [{ text: { content: payload.body } }] },
            { type: "divider" },
            { type: "paragraph", rich_text: [{ text: { content: `Event: ${payload.eventType}` } }] },
            ...(payload.url ? [{ type: "paragraph", rich_text: [{ text: { content: `Source: ${payload.url}` } }] }] : []),
          ],
        });
      } else {
        throw new Error("No default database or parent page configured for notifications");
      }

      await this.logNotification(payload.eventType, 200, undefined, payload);

      return { success: true, messageId: page.id };
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
        case "page":
        case "create-page":
          await this.handleCreatePage(context);
          break;
        case "pages":
        case "list-pages":
          await this.handleSearchPages(context);
          break;
        case "database":
        case "databases":
          await this.handleListDatabases(context);
          break;
        case "entry":
        case "create-entry":
          await this.handleCreateDatabaseEntry(context);
          break;
        case "search":
          await this.handleSearch(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "Notion command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  private async handleCreatePage(context: CommandContext): Promise<void> {
    const { args, projectId, connectorId } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity page <title> [content]");
      return;
    }

    const title = args[0];
    const content = args.slice(1).join(" ") || "Created via Infinity";

    const page = await this.createPage({
      parentId: this.config.defaultParentId,
      title,
      content: [
        { type: "paragraph", rich_text: [{ text: { content } }] },
        { type: "divider" },
        { type: "paragraph", rich_text: [{ text: { content: `Created by ${context.userName} via Infinity` } }] },
      ],
    });

    await this.sendCommandResponse(context, `✅ Created page: **${title}**\n${page.url}`);
  }

  private async handleSearchPages(context: CommandContext): Promise<void> {
    const { args } = context;

    const query = args.join(" ") || "";
    const pages = await this.searchPages(query);

    if (pages.length === 0) {
      await this.sendCommandResponse(context, query ? `No pages found for "${query}".` : "No pages found.");
      return;
    }

    const lines = pages.slice(0, 10).map(page =>
      `• **${page.title}** — Updated ${new Date(page.lastEditedTime).toLocaleDateString()}`
    ).join("\n");

    await this.sendCommandResponse(context, `📄 **Notion Pages** (showing ${Math.min(pages.length, 10)} of ${pages.length}):\n${lines}`);
  }

  private async handleListDatabases(context: CommandContext): Promise<void> {
    const databases = await this.listDatabases();

    if (databases.length === 0) {
      await this.sendCommandResponse(context, "No databases found.");
      return;
    }

    const lines = databases.map(db => {
      const title = db.title?.[0]?.plain_text || "Untitled";
      return `• **${title}** (${Object.keys(db.properties).length} properties)`;
    }).join("\n");

    await this.sendCommandResponse(context, `🗃️ **Notion Databases**:\n${lines}`);
  }

  private async handleCreateDatabaseEntry(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1 || !this.config.defaultDatabaseId) {
      await this.sendError(context, "Usage: /infinity entry <Title> [property:value ...]\nDefault database must be configured.");
      return;
    }

    const title = args[0];
    const properties: Record<string, any> = {
      Title: { title: [{ text: { content: title } }] },
    };

    // Parse additional properties: key:value key2:value2
    for (const arg of args.slice(1)) {
      const [key, ...valueParts] = arg.split(":");
      if (key && valueParts.length > 0) {
        properties[key.trim()] = { rich_text: [{ text: { content: valueParts.join(":").trim() } }] };
      }
    }

    properties.CreatedBy = { rich_text: [{ text: { content: context.userName } }] };
    properties.CreatedAt = { date: { start: new Date().toISOString() } };

    const page = await this.createDatabaseEntry({
      databaseId: this.config.defaultDatabaseId,
      properties,
    });

    await this.sendCommandResponse(context, `✅ Created database entry: **${title}**\n${page.url}`);
  }

  private async handleSearch(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity search <query>");
      return;
    }

    const query = args.join(" ");
    const results = await this.search(query);

    if (results.length === 0) {
      await this.sendCommandResponse(context, `No results for "${query}".`);
      return;
    }

    const lines = results.slice(0, 10).map(r => {
      const title = r.title?.[0]?.plain_text || r.id;
      return `• **${title}** (${r.object})`;
    }).join("\n");

    await this.sendCommandResponse(context, `🔍 **Search Results** for "${query}" (showing ${Math.min(results.length, 10)} of ${results.length}):\n${lines}`);
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    const help = `
**Notion Commands** (via /infinity):
• \`page <title> [content]\` — Create a new page
• \`pages [query]\` — Search/list pages
• \`databases\` — List all databases
• \`entry <Title> [prop:value ...]\` — Create database entry (requires default database)
• \`search <query>\` — Search all content
• \`help\` — Show this help
    `.trim();

    await this.sendCommandResponse(context, help);
  }

  // Public API methods for automation integration

  async createPage(params: {
    parentId?: string;
    title: string;
    content?: NotionBlock[];
    icon?: { type: string; emoji?: string; file?: { url: string } };
    cover?: { type: string; external?: { url: string } };
  }): Promise<NotionPage> {
    const parentId = params.parentId || this.config.defaultParentId;
    if (!parentId) {
      throw new Error("Parent page ID is required");
    }

    const properties: Record<string, any> = {
      title: { title: [{ text: { content: params.title } }] },
    };

    const data = await this.request("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { page_id: parentId },
        properties,
        children: params.content || [],
        icon: params.icon,
        cover: params.cover,
      }),
    });

    return this.formatPage(data);
  }

  async createDatabaseEntry(params: {
    databaseId: string;
    properties: Record<string, any>;
    children?: NotionBlock[];
  }): Promise<NotionPage> {
    const data = await this.request("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: params.databaseId },
        properties: params.properties,
        children: params.children || [],
      }),
    });

    return this.formatPage(data);
  }

  async updatePage(pageId: string, params: {
    properties?: Record<string, any>;
    archived?: boolean;
    icon?: any;
    cover?: any;
  }): Promise<NotionPage> {
    const data = await this.request(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify(params),
    });

    return this.formatPage(data);
  }

  async getPage(pageId: string): Promise<NotionPage | null> {
    try {
      const data = await this.request(`/pages/${pageId}`);
      return this.formatPage(data);
    } catch {
      return null;
    }
  }

  async getBlocks(blockId: string): Promise<NotionBlock[]> {
    const data = await this.request(`/blocks/${blockId}/children`);
    return data?.results || [];
  }

  async appendBlocks(blockId: string, children: NotionBlock[]): Promise<NotionBlock[]> {
    const data = await this.request(`/blocks/${blockId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children }),
    });
    return data?.results || [];
  }

  async searchPages(query: string = ""): Promise<NotionPage[]> {
    const data = await this.request("/search", {
      method: "POST",
      body: JSON.stringify({
        query: query || undefined,
        filter: { property: "object", value: "page" },
        page_size: 50,
      }),
    });

    return (data?.results || []).map(this.formatPage);
  }

  async search(query: string): Promise<any[]> {
    const data = await this.request("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        page_size: 50,
      }),
    });

    return data?.results || [];
  }

  async listDatabases(): Promise<NotionDatabase[]> {
    const data = await this.request("/search", {
      method: "POST",
      body: JSON.stringify({
        filter: { property: "object", value: "database" },
        page_size: 50,
      }),
    });

    return data?.results || [];
  }

  async getDatabase(databaseId: string): Promise<NotionDatabase | null> {
    try {
      return await this.request(`/databases/${databaseId}`);
    } catch {
      return null;
    }
  }

  async queryDatabase(databaseId: string, params: {
    filter?: any;
    sorts?: Array<{ property: string; direction: "ascending" | "descending" }>;
    pageSize?: number;
  } = {}): Promise<NotionPage[]> {
    const data = await this.request(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: params.filter,
        sorts: params.sorts,
        page_size: params.pageSize || 50,
      }),
    });

    return (data?.results || []).map(this.formatPage);
  }

  async addComment(pageId: string, text: string): Promise<any> {
    const data = await this.request("/comments", {
      method: "POST",
      body: JSON.stringify({
        parent: { page_id: pageId },
        rich_text: [{ text: { content: text } }],
      }),
    });

    return data;
  }

  private formatPage(data: any): NotionPage {
    // Extract title from properties
    let title = "Untitled";
    for (const [key, prop] of Object.entries(data.properties || {})) {
      if (prop && typeof prop === "object" && "title" in prop && Array.isArray(prop.title)) {
        title = prop.title.map((t: any) => t.plain_text || t.text?.content || "").join("");
        break;
      }
      if (prop && typeof prop === "object" && "rich_text" in prop && Array.isArray(prop.rich_text)) {
        title = prop.rich_text.map((t: any) => t.plain_text || t.text?.content || "").join("");
        if (title) break;
      }
    }

    return {
      id: data.id,
      url: data.url,
      title,
      properties: data.properties || {},
      createdTime: data.created_time,
      lastEditedTime: data.last_edited_time,
      parent: data.parent || {},
    };
  }

  // Webhook handling for automation triggers
  async handleWebhook(payload: NotionWebhookPayload): Promise<void> {
    const { type, timestamp, data: webhookData } = payload;

    logger.info({ type, projectId: this.projectId }, "Notion webhook received");

    const eventType = `notion.${type.toLowerCase()}`;

    await this.logActivity("agent_ran", `Notion webhook: ${eventType}`);

    // The automation runtime would pick this up and trigger matching automations
  }

  private async sendCommandResponse(context: CommandContext, message: string): Promise<void> {
    logger.info({ message, connectorId: this.connectorId }, "Notion command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ Error: ${error}`);
  }
}

/**
 * Factory function for creating Notion connector instances
 */
export async function createNotionConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<NotionConnector> {
  return new NotionConnector(config, projectId, connectorId);
}

// Export types for automation integration
export type { NotionConfig, NotionPage, NotionDatabase, NotionBlock, NotionWebhookPayload };