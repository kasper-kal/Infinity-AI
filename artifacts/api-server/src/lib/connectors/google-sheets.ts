import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, ConnectorConfig, NotificationPayload, CommandContext, SendResult } from "./base";

/**
 * Google Sheets Connector — Spreadsheet read/write and data automation
 * Supports: Read/Write ranges, Append rows, Batch updates, Named ranges, Webhooks (via Drive push notifications)
 * OAuth 2.0 with Google Sheets API + Google Drive API for webhooks
 */

interface GoogleSheetsConfig extends ConnectorConfig {
  /** OAuth access token */
  accessToken?: string;
  /** OAuth refresh token */
  refreshToken?: string;
  /** Client ID for token refresh */
  clientId?: string;
  /** Client secret for token refresh */
  clientSecret?: string;
  /** Default spreadsheet ID */
  defaultSpreadsheetId?: string;
  /** Default sheet/tab name */
  defaultSheetName?: string;
  /** Webhook channel ID for push notifications */
  webhookChannelId?: string;
  /** Webhook resource ID for push notifications */
  webhookResourceId?: string;
}

interface SheetRange {
  range: string;
  majorDimension: "ROWS" | "COLUMNS";
  values: any[][];
}

interface Spreadsheet {
  spreadsheetId: string;
  title: string;
  sheets: Array<{
    properties: {
      sheetId: number;
      title: string;
      index: number;
      gridProperties: { rowCount: number; columnCount: number };
    };
  }>;
}

interface ValueRange {
  range: string;
  majorDimension: "ROWS" | "COLUMNS";
  values: any[][];
}

interface BatchUpdateRequest {
  requests: Array<{
    updateCells?: any;
    appendCells?: any;
    deleteRange?: any;
    // ... other request types
  }>;
}

interface DriveWebhookPayload {
  kind: "api#channel";
  id: string;
  resourceId: string;
  resourceUri: string;
  token?: string;
  expiration?: string;
  type: "web_hook";
  address: string;
  params: { ttl: string };
  payload: boolean;
}

export class GoogleSheetsConnector extends BaseConnector {
  protected config: GoogleSheetsConfig;
  private sheetsBaseUrl = "https://sheets.googleapis.com/v4/spreadsheets";
  private driveBaseUrl = "https://www.googleapis.com/drive/v3";
  private tokenUrl = "https://oauth2.googleapis.com/token";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as GoogleSheetsConfig;
  }

  get platform() {
    return "google-sheets" as const;
  }

  getDisplayName(): string {
    return "Google Sheets";
  }

  private async ensureValidToken(): Promise<string> {
    if (this.config.accessToken) {
      // In production, check token expiry and refresh if needed
      return this.config.accessToken;
    }

    if (this.config.refreshToken && this.config.clientId && this.config.clientSecret) {
      const newToken = await this.refreshAccessToken();
      this.config.accessToken = newToken;
      // Persist the new token to database (would need DB update)
      return newToken;
    }

    throw new Error("No valid access token. Configure OAuth or provide access token.");
  }

  private async refreshAccessToken(): Promise<string> {
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
        refresh_token: this.config.refreshToken!,
        grant_type: "refresh_token",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
    }

    return data.access_token;
  }

  private async sheetsRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = await this.ensureValidToken();

    const response = await fetch(`${this.sheetsBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Sheets API error (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    return data;
  }

  private async driveRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = await this.ensureValidToken();

    const response = await fetch(`${this.driveBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Drive API error (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    return data;
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.accessToken && !this.config.botToken) {
        if (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret) {
          return { valid: false, error: "OAuth credentials required (access token or refresh token + client ID/secret)" };
        }
      }

      // Test connection by getting user's spreadsheets (limited)
      await this.sheetsRequest(`/${this.config.defaultSpreadsheetId || "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"}?fields=spreadsheetId,title`, {
        method: "GET",
      });

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      if (!this.config.defaultSpreadsheetId) {
        throw new Error("Default spreadsheet ID not configured");
      }

      const sheetName = this.config.defaultSheetName || "Notifications";
      const range = `'${sheetName}'!A:E`;

      // Ensure sheet exists
      await this.ensureSheetExists(sheetName);

      // Append notification as a new row
      const values = [[
        new Date().toISOString(),
        payload.eventType,
        payload.title,
        payload.body,
        payload.url || "",
      ]];

      await this.appendValues(range, values);

      await this.logNotification(payload.eventType, 200, undefined, payload);

      return { success: true, messageId: `${Date.now()}` };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      await this.logNotification(payload.eventType, 500, error, payload);
      return { success: false, error };
    }
  }

  async handleCommand(context: CommandContext): Promise<void> {
    const { command, args } = context;

    try {
      switch (command) {
        case "read":
        case "get":
          await this.handleRead(context);
          break;
        case "write":
        case "set":
          await this.handleWrite(context);
          break;
        case "append":
          await this.handleAppend(context);
          break;
        case "sheets":
        case "list-sheets":
          await this.handleListSheets(context);
          break;
        case "create-sheet":
          await this.handleCreateSheet(context);
          break;
        case "clear":
          await this.handleClear(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "Google Sheets command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  private async handleRead(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity read <range> (e.g., Sheet1!A1:D10)");
      return;
    }

    const range = args[0];
    const data = await this.getValues(range);

    if (!data.values || data.values.length === 0) {
      await this.sendCommandResponse(context, `No data in range ${range}`);
      return;
    }

    // Format as table
    const headers = data.values[0];
    const rows = data.values.slice(1);

    let output = `📊 **${data.range}** (${rows.length} rows)\n\n`;
    if (headers.length > 0) {
      output += "| " + headers.map(h => String(h || "")).join(" | ") + " |\n";
      output += "| " + headers.map(() => "---").join(" | ") + " |\n";
    }

    for (const row of rows.slice(0, 20)) {
      output += "| " + row.map(c => String(c || "")).join(" | ") + " |\n";
    }

    if (rows.length > 20) {
      output += `\n... and ${rows.length - 20} more rows`;
    }

    await this.sendCommandResponse(context, output);
  }

  private async handleWrite(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 2) {
      await this.sendError(context, "Usage: /infinity write <range> <values...> (values as comma-separated, rows separated by ;)");
      return;
    }

    const range = args[0];
    const valuesStr = args.slice(1).join(" ");

    // Parse values: "a,b,c; d,e,f" -> [["a","b","c"], ["d","e","f"]]
    const values = valuesStr.split(";").map(row =>
      row.split(",").map(c => c.trim())
    );

    await this.updateValues(range, values);

    await this.sendCommandResponse(context, `✅ Updated ${range} (${values.length} rows)`);
  }

  private async handleAppend(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity append <range> <values...>");
      return;
    }

    const range = args[0];
    const valuesStr = args.slice(1).join(" ");

    const values = valuesStr.split(";").map(row =>
      row.split(",").map(c => c.trim())
    );

    await this.appendValues(range, values);

    await this.sendCommandResponse(context, `✅ Appended ${values.length} rows to ${range}`);
  }

  private async handleListSheets(context: CommandContext): Promise<void> {
    if (!this.config.defaultSpreadsheetId) {
      await this.sendError(context, "No default spreadsheet configured");
      return;
    }

    const spreadsheet = await this.getSpreadsheet();

    const lines = spreadsheet.sheets.map(s =>
      `• **${s.properties.title}** (${s.properties.gridProperties.rowCount} rows × ${s.properties.gridProperties.columnCount} cols)`
    ).join("\n");

    await this.sendCommandResponse(context, `📑 **Sheets in "${spreadsheet.title}"**:\n${lines}`);
  }

  private async handleCreateSheet(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity create-sheet <title> [rows] [cols]");
      return;
    }

    const title = args[0];
    const rows = parseInt(args[1]) || 1000;
    const cols = parseInt(args[2]) || 26;

    await this.createSheet(title, rows, cols);

    await this.sendCommandResponse(context, `✅ Created sheet "${title}" (${rows} rows × ${cols} cols)`);
  }

  private async handleClear(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity clear <range>");
      return;
    }

    await this.clearValues(args[0]);

    await this.sendCommandResponse(context, `✅ Cleared ${args[0]}`);
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    const help = `
**Google Sheets Commands** (via /infinity):
• \`read <range>\` — Read values (e.g., Sheet1!A1:D10)
• \`write <range> <values>\` — Write values (rows separated by ;, cols by ,)
• \`append <range> <values>\` — Append rows to range
• \`sheets\` — List all sheets in spreadsheet
• \`create-sheet <title> [rows] [cols]\` — Create new sheet
• \`clear <range>\` — Clear values in range
• \`help\` — Show this help
    `.trim();

    await this.sendCommandResponse(context, help);
  }

  // Public API methods for automation integration

  async getSpreadsheet(spreadsheetId?: string): Promise<Spreadsheet> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    return this.sheetsRequest(`/${id}?fields=spreadsheetId,title,sheets(properties(sheetId,title,index,gridProperties))`);
  }

  async getValues(range: string, spreadsheetId?: string): Promise<ValueRange> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    return this.sheetsRequest(`/${id}/values/${encodeURIComponent(range)}`);
  }

  async updateValues(range: string, values: any[][], spreadsheetId?: string, valueInputOption: "RAW" | "USER_ENTERED" = "USER_ENTERED"): Promise<any> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    return this.sheetsRequest(`/${id}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`, {
      method: "PUT",
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    });
  }

  async appendValues(range: string, values: any[][], spreadsheetId?: string, valueInputOption: "RAW" | "USER_ENTERED" = "USER_ENTERED"): Promise<any> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    return this.sheetsRequest(`/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    });
  }

  async clearValues(range: string, spreadsheetId?: string): Promise<any> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    return this.sheetsRequest(`/${id}/values/${encodeURIComponent(range)}:clear`, {
      method: "POST",
    });
  }

  async batchUpdate(spreadsheetId: string, requests: any[]): Promise<any> {
    return this.sheetsRequest(`/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }

  async createSheet(title: string, rows = 1000, cols = 26, spreadsheetId?: string): Promise<number> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    const result = await this.batchUpdate(id, [{
      addSheet: {
        properties: {
          title,
          gridProperties: { rowCount: rows, columnCount: cols },
        },
      },
    }]);

    return result.replies[0].addSheet.properties.sheetId;
  }

  async deleteSheet(sheetId: number, spreadsheetId?: string): Promise<void> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    await this.batchUpdate(id, [{
      deleteSheet: { sheetId },
    }]);
  }

  async ensureSheetExists(sheetName: string): Promise<void> {
    const spreadsheet = await this.getSpreadsheet();
    const exists = spreadsheet.sheets.some(s => s.properties.title === sheetName);

    if (!exists) {
      await this.createSheet(sheetName);
      // Add header row
      await this.updateValues(`'${sheetName}'!A1:E1`, [["Timestamp", "Event Type", "Title", "Body", "URL"]]);
    }
  }

  async getSheetId(sheetName: string): Promise<number | null> {
    const spreadsheet = await this.getSpreadsheet();
    const sheet = spreadsheet.sheets.find(s => s.properties.title === sheetName);
    return sheet?.properties.sheetId || null;
  }

  // Named ranges for easier automation references
  async createNamedRange(name: string, range: string, spreadsheetId?: string): Promise<any> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    const sheetId = await this.getSheetId(range.split("!")[0].replace(/'/g, ""));
    if (!sheetId) throw new Error(`Sheet not found for range: ${range}`);

    return this.batchUpdate(id, [{
      addNamedRange: {
        namedRange: {
          name,
          range: { sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 26 },
        },
      },
    }]);
  }

  async listNamedRanges(spreadsheetId?: string): Promise<any[]> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    const data = await this.sheetsRequest(`/${id}?fields=namedRanges`);
    return data.namedRanges || [];
  }

  // Webhook handling for automation triggers (via Google Drive push notifications)
  async setupWebhook(webhookUrl: string, spreadsheetId?: string): Promise<{ channelId: string; resourceId: string }> {
    const id = spreadsheetId || this.config.defaultSpreadsheetId;
    if (!id) throw new Error("Spreadsheet ID required");

    const channelId = `infinity-${this.projectId}-${this.connectorId}-${Date.now()}`;

    const response = await this.driveRequest(`/files/${id}/watch`, {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        params: { ttl: "86400" }, // 24 hours
      }),
    });

    this.config.webhookChannelId = response.id;
    this.config.webhookResourceId = response.resourceId;

    // In production, persist these to database
    return { channelId: response.id, resourceId: response.resourceId };
  }

  async stopWebhook(): Promise<void> {
    if (this.config.webhookChannelId && this.config.webhookResourceId) {
      await this.driveRequest("/channels/stop", {
        method: "POST",
        body: JSON.stringify({
          id: this.config.webhookChannelId,
          resourceId: this.config.webhookResourceId,
        }),
      });
    }
  }

  async handleWebhook(payload: DriveWebhookPayload): Promise<void> {
    logger.info({ resourceId: payload.resourceId, projectId: this.projectId }, "Google Sheets/Drive webhook received");

    // Determine what changed - would need to fetch changes
    const eventType = "google-sheets.changed";

    await this.logActivity("agent_ran", `Google Sheets webhook: ${eventType}`);

    // The automation runtime would pick this up and trigger matching automations
  }

  private async sendCommandResponse(context: CommandContext, message: string): Promise<void> {
    logger.info({ message, connectorId: this.connectorId }, "Google Sheets command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ Error: ${error}`);
  }
}

/**
 * Factory function for creating Google Sheets connector instances
 */
export async function createGoogleSheetsConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<GoogleSheetsConnector> {
  return new GoogleSheetsConnector(config, projectId, connectorId);
}

// Export types for automation integration
export type { GoogleSheetsConfig, Spreadsheet, ValueRange, SheetRange, DriveWebhookPayload };