import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, type ConnectorConfig, type NotificationPayload, type SendResult, type CommandContext } from "./base";

/**
 * Google Calendar Connector — Calendar operations.
 * Supports: Create, List, Search, Events, FreeBusy, Update, Delete
 * Uses Google Calendar API with OAuth 2.0.
 */

interface CalendarConfig extends ConnectorConfig {
  /** Google Calendar API access token */
  accessToken?: string;
  /** Refresh token for token renewal */
  refreshToken?: string;
  /** Client ID for token refresh */
  clientId?: string;
  /** Client secret for token refresh */
  clientSecret?: string;
  /** Default calendar ID (default: 'primary') */
  defaultCalendarId?: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus: string }>;
  organizer?: { email: string; displayName?: string };
  status: "confirmed" | "tentative" | "cancelled";
  htmlLink: string;
  created: string;
  updated: string;
  creator: { email: string; displayName?: string };
  recurringEventId?: string;
  recurrence?: string[];
  reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
}

interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  timeZone: string;
  primary?: boolean;
  accessRole: string;
  defaultReminders?: Array<{ method: string; minutes: number }>;
  foregroundColor?: string;
  backgroundColor?: string;
}

interface FreeBusyResponse {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

export class CalendarConnector extends BaseConnector {
  protected config: CalendarConfig;
  private baseUrl = "https://www.googleapis.com/calendar/v3";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as CalendarConfig;
  }

  get platform() {
    return "google-calendar" as const;
  }

  getDisplayName(): string {
    return `Google Calendar (${this.config.defaultCalendarId || "primary"})`;
  }

  private getCalendarId(): string {
    return this.config.defaultCalendarId || "primary";
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const accessToken = await this.ensureValidToken();
    if (!accessToken) {
      throw new Error("Google Calendar access token not available");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
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
      throw new Error(`Calendar API error (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
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
        return { valid: false, error: "Calendar access token or refresh credentials required" };
      }

      const data = await this.request(`/calendars/${this.getCalendarId()}`);

      if (!data?.id) {
        return { valid: false, error: "Invalid Calendar credentials" };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      // Could create a calendar event as notification
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
        case "create":
        case "add":
        case "new":
          await this.handleCreate(context);
          break;
        case "list":
        case "events":
        case "upcoming":
          await this.handleList(context);
          break;
        case "search":
        case "find":
          await this.handleSearch(context);
          break;
        case "freebusy":
        case "busy":
          await this.handleFreeBusy(context);
          break;
        case "update":
        case "edit":
          await this.handleUpdate(context);
          break;
        case "delete":
        case "remove":
          await this.handleDelete(context);
          break;
        case "calendars":
        case "list-calendars":
          await this.handleListCalendars(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "Calendar command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  // Action methods for tool registry

  async createEvent(params: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string; // ISO 8601
    endDateTime: string; // ISO 8601
    timeZone?: string;
    attendees?: string[]; // emails
    reminders?: Array<{ method: "email" | "popup"; minutes: number }>;
  }): Promise<{ success: boolean; event?: CalendarEvent; error?: string }> {
    try {
      const calendarId = this.getCalendarId();
      const timeZone = params.timeZone || "UTC";

      const event: any = {
        summary: params.summary,
        description: params.description,
        location: params.location,
        start: { dateTime: params.startDateTime, timeZone },
        end: { dateTime: params.endDateTime, timeZone },
      };

      if (params.attendees && params.attendees.length > 0) {
        event.attendees = params.attendees.map(email => ({ email }));
      }

      if (params.reminders) {
        event.reminders = { useDefault: false, overrides: params.reminders };
      } else {
        event.reminders = { useDefault: true };
      }

      const result = await this.request(`/calendars/${calendarId}/events`, {
        method: "POST",
        body: JSON.stringify(event),
      }) as CalendarEvent;

      await logActivity(this.projectId, "agent_ran", `Created calendar event: ${params.summary}`);

      return { success: true, event: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Create event failed";
      return { success: false, error };
    }
  }

  async listEvents(params: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    singleEvents?: boolean;
    orderBy?: "startTime" | "updated";
    q?: string;
  }): Promise<{ success: boolean; events?: CalendarEvent[]; error?: string }> {
    try {
      const calendarId = params.calendarId || this.getCalendarId();
      const queryParams = new URLSearchParams({
        maxResults: (params.maxResults || 20).toString(),
        singleEvents: (params.singleEvents !== false).toString(),
        orderBy: params.orderBy || "startTime",
        ...(params.timeMin && { timeMin: params.timeMin }),
        ...(params.timeMax && { timeMax: params.timeMax }),
        ...(params.q && { q: params.q }),
      });

      const result = await this.request(`/calendars/${calendarId}/events?${queryParams}`) as { items: CalendarEvent[] };

      return { success: true, events: result.items || [] };
    } catch (err) {
      const error = err instanceof Error ? err.message : "List events failed";
      return { success: false, error };
    }
  }

  async searchEvents(params: { query: string; maxResults?: number }): Promise<{
    success: boolean;
    events?: CalendarEvent[];
    error?: string;
  }> {
    return this.listEvents({ q: params.query, maxResults: params.maxResults || 20 });
  }

  async getFreeBusy(params: {
    timeMin: string;
    timeMax: string;
    calendars?: string[]; // calendar IDs
  }): Promise<{ success: boolean; freeBusy?: FreeBusyResponse; error?: string }> {
    try {
      const calendarIds = params.calendars || [this.getCalendarId()];

      const result = await this.request("/freeBusy", {
        method: "POST",
        body: JSON.stringify({
          timeMin: params.timeMin,
          timeMax: params.timeMax,
          items: calendarIds.map(id => ({ id })),
        }),
      }) as FreeBusyResponse;

      return { success: true, freeBusy: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : "FreeBusy failed";
      return { success: false, error };
    }
  }

  async updateEvent(params: {
    eventId: string;
    calendarId?: string;
    summary?: string;
    description?: string;
    location?: string;
    startDateTime?: string;
    endDateTime?: string;
    timeZone?: string;
  }): Promise<{ success: boolean; event?: CalendarEvent; error?: string }> {
    try {
      const calendarId = params.calendarId || this.getCalendarId();

      // Get existing event first
      const existing = await this.request(`/calendars/${calendarId}/events/${params.eventId}`) as CalendarEvent;

      const updates: any = {};
      if (params.summary !== undefined) updates.summary = params.summary;
      if (params.description !== undefined) updates.description = params.description;
      if (params.location !== undefined) updates.location = params.location;
      if (params.startDateTime) updates.start = { dateTime: params.startDateTime, timeZone: params.timeZone || existing.start.timeZone };
      if (params.endDateTime) updates.end = { dateTime: params.endDateTime, timeZone: params.timeZone || existing.end.timeZone };

      const result = await this.request(`/calendars/${calendarId}/events/${params.eventId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }) as CalendarEvent;

      await logActivity(this.projectId, "agent_ran", `Updated calendar event ${params.eventId}`);

      return { success: true, event: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Update event failed";
      return { success: false, error };
    }
  }

  async deleteEvent(params: { eventId: string; calendarId?: string; sendUpdates?: "all" | "externalOnly" | "none" }): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const calendarId = params.calendarId || this.getCalendarId();
      const sendUpdates = params.sendUpdates || "none";

      await this.request(`/calendars/${calendarId}/events/${params.eventId}?sendUpdates=${sendUpdates}`, {
        method: "DELETE",
      });

      await logActivity(this.projectId, "agent_ran", `Deleted calendar event ${params.eventId}`);

      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Delete event failed";
      return { success: false, error };
    }
  }

  async listCalendars(): Promise<{ success: boolean; calendars?: CalendarListEntry[]; error?: string }> {
    try {
      const result = await this.request("/users/me/calendarList") as { items: CalendarListEntry[] };
      return { success: true, calendars: result.items || [] };
    } catch (err) {
      const error = err instanceof Error ? err.message : "List calendars failed";
      return { success: false, error };
    }
  }

  // Command handlers
  private async handleCreate(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 3) {
      await this.sendError(context, "Usage: /infinity create <title> <start-time> <end-time> [description] [location]");
      return;
    }

    const summary = args[0];
    const startDateTime = args[1];
    const endDateTime = args[2];
    const description = args[3] || "";
    const location = args[4] || "";

    // Parse dates - accept ISO format or natural language
    let start: Date, end: Date;
    try {
      start = new Date(startDateTime);
      end = new Date(endDateTime);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error("Invalid date format");
      }
    } catch {
      await this.sendError(context, "Invalid date format. Use ISO 8601 (e.g., 2024-01-15T10:00:00)");
      return;
    }

    const result = await this.createEvent({
      summary,
      description,
      location,
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
    });

    if (result.success && result.event) {
      await this.sendCommandResponse(context,
        `✅ **Event Created**\n` +
        `**${result.event.summary}**\n` +
        `📅 ${new Date(result.event.start.dateTime || result.event.start.date!).toLocaleString()} — ${new Date(result.event.end.dateTime || result.event.end.date!).toLocaleString()}\n` +
        `${result.event.location ? `📍 ${result.event.location}` : ""}\n` +
        `${result.event.description ? `\n${result.event.description}` : ""}\n\n` +
        `🔗 [View in Calendar](${result.event.htmlLink})`
      );
    } else {
      await this.sendError(context, result.error || "Create failed");
    }
  }

  private async handleList(context: CommandContext): Promise<void> {
    const { args } = context;

    const timeMin = args[0] ? new Date(args[0]).toISOString() : new Date().toISOString();
    const timeMax = args[1] ? new Date(args[1]).toISOString() : undefined;
    const maxResults = parseInt(args[2]) || 20;

    const result = await this.listEvents({ timeMin, timeMax, maxResults });

    if (result.success && result.events) {
      if (result.events.length === 0) {
        await this.sendCommandResponse(context, "No upcoming events found.");
        return;
      }

      const lines = result.events.map(e => {
        const start = new Date(e.start.dateTime || e.start.date!);
        const end = new Date(e.end.dateTime || e.end.date!);
        const timeStr = e.start.dateTime
          ? `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : "All day";
        const dateStr = start.toLocaleDateString();
        return `• **${e.summary}** — ${dateStr} ${timeStr}${e.location ? ` @ ${e.location}` : ""}`;
      }).join("\n");

      await this.sendCommandResponse(context, `📅 **Upcoming Events**:\n${lines}`);
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
    const result = await this.searchEvents({ query, maxResults: 20 });

    if (result.success && result.events) {
      if (result.events.length === 0) {
        await this.sendCommandResponse(context, `No events found for "${query}".`);
        return;
      }

      const lines = result.events.map(e => {
        const start = new Date(e.start.dateTime || e.start.date!);
        return `• **${e.summary}** — ${start.toLocaleString()}${e.location ? ` @ ${e.location}` : ""}`;
      }).join("\n");

      await this.sendCommandResponse(context, `🔍 **Search results for "${query}"**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Search failed");
    }
  }

  private async handleFreeBusy(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 2) {
      await this.sendError(context, "Usage: /infinity freebusy <start-time> <end-time> [calendar-ids...]");
      return;
    }

    const timeMin = new Date(args[0]).toISOString();
    const timeMax = new Date(args[1]).toISOString();
    const calendars = args.slice(2);

    const result = await this.getFreeBusy({ timeMin, timeMax, calendars });

    if (result.success && result.freeBusy) {
      const lines = Object.entries(result.freeBusy.calendars).map(([calId, data]) => {
        if (data.busy.length === 0) {
          return `• ${calId}: 🟢 Free`;
        }
        const busyStr = data.busy.map(b =>
          `${new Date(b.start).toLocaleString()} – ${new Date(b.end).toLocaleString()}`
        ).join(", ");
        return `• ${calId}: 🔴 Busy (${busyStr})`;
      }).join("\n");

      await this.sendCommandResponse(context, `📊 **Free/Busy** (${new Date(timeMin).toLocaleString()} – ${new Date(timeMax).toLocaleString()}):\n${lines}`);
    } else {
      await this.sendError(context, result.error || "FreeBusy failed");
    }
  }

  private async handleUpdate(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 2) {
      await this.sendError(context, "Usage: /infinity update <event-id> <field=value> ...");
      return;
    }

    const eventId = args[0];
    const updates: any = {};

    for (const arg of args.slice(1)) {
      const [key, ...valueParts] = arg.split("=");
      if (key && valueParts.length > 0) {
        updates[key] = valueParts.join("=");
      }
    }

    // Map field names
    const mappedUpdates: any = {};
    if (updates.title) mappedUpdates.summary = updates.title;
    if (updates.summary) mappedUpdates.summary = updates.summary;
    if (updates.description) mappedUpdates.description = updates.description;
    if (updates.location) mappedUpdates.location = updates.location;
    if (updates.start) mappedUpdates.startDateTime = updates.start;
    if (updates.end) mappedUpdates.endDateTime = updates.end;

    const result = await this.updateEvent({ eventId, ...mappedUpdates });

    if (result.success) {
      await this.sendCommandResponse(context, `✏️ Event updated: ${result.event?.summary}`);
    } else {
      await this.sendError(context, result.error || "Update failed");
    }
  }

  private async handleDelete(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity delete <event-id>");
      return;
    }

    const result = await this.deleteEvent({ eventId: args[0] });

    if (result.success) {
      await this.sendCommandResponse(context, `🗑️ Event deleted`);
    } else {
      await this.sendError(context, result.error || "Delete failed");
    }
  }

  private async handleListCalendars(context: CommandContext): Promise<void> {
    const result = await this.listCalendars();

    if (result.success && result.calendars) {
      const lines = result.calendars.map(c =>
        `• **${c.summary}** (${c.id})${c.primary ? " ⭐ Primary" : ""} — ${c.accessRole}`
      ).join("\n");

      await this.sendCommandResponse(context, `📅 **Your Calendars**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "List calendars failed");
    }
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    await this.sendCommandResponse(context,
      `🤖 **Google Calendar Commands**:\n` +
      `\`/infinity create <title> <start> <end> [desc] [loc]\` — Create event (ISO 8601 times)\n` +
      `\`/infinity list [start] [end] [limit]\` — List upcoming events\n` +
      `\`/infinity search <query>\` — Search events\n` +
      `\`/infinity freebusy <start> <end> [calendars]\` — Check availability\n` +
      `\`/infinity update <event-id> <field=value>...\` — Update event\n` +
      `\`/infinity delete <event-id>\` — Delete event\n` +
      `\`/infinity calendars\` — List all calendars`
    );
  }

  private async sendCommandResponse(context: CommandContext, text: string): Promise<void> {
    logger.info({ text, channelId: context.channelId }, "Calendar command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ ${error}`);
  }
}

export async function createCalendarConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<CalendarConnector> {
  return new CalendarConnector(config, projectId, connectorId);
}