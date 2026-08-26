import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, type ConnectorConfig, type NotificationPayload, type SendResult, type CommandContext } from "./base";

/**
 * Spotify Connector — Music playback and library management.
 * Supports: Playback control, Search, Playlists, Tracks, User profile, Devices, Queue
 * Uses Spotify Web API with OAuth 2.0.
 */

interface SpotifyConfig extends ConnectorConfig {
  /** Spotify access token (from OAuth) */
  accessToken?: string;
  /** Spotify refresh token */
  refreshToken?: string;
  /** Client ID for token refresh */
  clientId?: string;
  /** Client secret for token refresh */
  clientSecret?: string;
  /** Default device ID for playback */
  deviceId?: string;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
  album: { id: string; name: string; images: Array<{ url: string }> };
  duration_ms: number;
  uri: string;
  external_urls: { spotify: string };
  preview_url: string | null;
  popularity: number;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  images: Array<{ url: string }>;
  tracks: { total: number };
  external_urls: { spotify: string };
  owner: { display_name: string };
}

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

interface SpotifyUser {
  id: string;
  display_name: string | null;
  email: string | null;
  images: Array<{ url: string }>;
  product: string;
  followers: { total: number };
}

export class SpotifyConnector extends BaseConnector {
  protected config: SpotifyConfig;
  private baseUrl = "https://api.spotify.com/v1";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as SpotifyConfig;
  }

  get platform() {
    return "spotify" as const;
  }

  getDisplayName(): string {
    return "Spotify";
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const accessToken = await this.ensureValidToken();
    if (!accessToken) {
      throw new Error("Spotify access token not available");
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
      // Token expired, try to refresh
      await this.refreshAccessToken();
      return this.request(endpoint, options); // Retry once
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Spotify API error (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    return data;
  }

  private async ensureValidToken(): Promise<string | null> {
    if (this.config.accessToken) {
      // In production, check expiry and refresh if needed
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

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
    }

    // Note: In production, update the config in database
    this.config.accessToken = data.access_token;
    if (data.refresh_token) {
      this.config.refreshToken = data.refresh_token;
    }
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.accessToken && (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret)) {
        return { valid: false, error: "Spotify access token or refresh credentials required" };
      }

      // Test connection by fetching user profile
      const data = await this.request("/me");

      if (!data?.id) {
        return { valid: false, error: "Invalid Spotify credentials" };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      // Spotify doesn't have a direct messaging API
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
        case "play":
        case "resume":
          await this.handlePlay(context);
          break;
        case "pause":
          await this.handlePause(context);
          break;
        case "next":
        case "skip":
          await this.handleNext(context);
          break;
        case "previous":
        case "prev":
          await this.handlePrevious(context);
          break;
        case "search":
          await this.handleSearch(context);
          break;
        case "playlists":
        case "list-playlists":
          await this.handleListPlaylists(context);
          break;
        case "tracks":
        case "saved-tracks":
          await this.handleSavedTracks(context);
          break;
        case "user":
        case "profile":
          await this.handleUserProfile(context);
          break;
        case "devices":
          await this.handleDevices(context);
          break;
        case "queue":
          await this.handleQueue(context);
          break;
        case "volume":
          await this.handleVolume(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "Spotify command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  // Action methods called from tool registry

  async play(params: { contextUri?: string; uris?: string[]; deviceId?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const deviceId = params.deviceId || this.config.deviceId;
      const body: any = {};
      if (params.contextUri) body.context_uri = params.contextUri;
      if (params.uris) body.uris = params.uris;
      if (deviceId) body.device_id = deviceId;

      await this.request("/me/player/play", {
        method: "PUT",
        body: JSON.stringify(body),
      });

      await logActivity(this.projectId, "agent_ran", "Started Spotify playback");
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Play failed";
      return { success: false, error };
    }
  }

  async pause(params: { deviceId?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const deviceId = params.deviceId || this.config.deviceId;
      const queryParams = deviceId ? `?device_id=${deviceId}` : "";

      await this.request(`/me/player/pause${queryParams}`, { method: "PUT" });

      await logActivity(this.projectId, "agent_ran", "Paused Spotify playback");
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Pause failed";
      return { success: false, error };
    }
  }

  async next(params: { deviceId?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const deviceId = params.deviceId || this.config.deviceId;
      const queryParams = deviceId ? `?device_id=${deviceId}` : "";

      await this.request(`/me/player/next${queryParams}`, { method: "POST" });
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Next track failed";
      return { success: false, error };
    }
  }

  async previous(params: { deviceId?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const deviceId = params.deviceId || this.config.deviceId;
      const queryParams = deviceId ? `?device_id=${deviceId}` : "";

      await this.request(`/me/player/previous${queryParams}`, { method: "POST" });
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Previous track failed";
      return { success: false, error };
    }
  }

  async search(params: { query: string; type?: "track" | "artist" | "album" | "playlist" | "show" | "episode"; limit?: number }): Promise<{
    success: boolean;
    tracks?: SpotifyTrack[];
    playlists?: SpotifyPlaylist[];
    artists?: any[];
    albums?: any[];
    error?: string;
  }> {
    try {
      const { query, type = "track", limit = 20 } = params;
      const queryParams = new URLSearchParams({
        q: query,
        type,
        limit: limit.toString(),
      });

      const result = await this.request(`/search?${queryParams}`) as any;

      if (type === "track") {
        return { success: true, tracks: result.tracks?.items || [] };
      } else if (type === "playlist") {
        return { success: true, playlists: result.playlists?.items || [] };
      } else if (type === "artist") {
        return { success: true, artists: result.artists?.items || [] };
      } else if (type === "album") {
        return { success: true, albums: result.albums?.items || [] };
      }

      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Search failed";
      return { success: false, error };
    }
  }

  async listPlaylists(params: { limit?: number; offset?: number }): Promise<{
    success: boolean;
    playlists?: SpotifyPlaylist[];
    error?: string;
  }> {
    try {
      const { limit = 20, offset = 0 } = params;
      const result = await this.request(`/me/playlists?limit=${limit}&offset=${offset}`) as { items: SpotifyPlaylist[] };
      return { success: true, playlists: result.items };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to list playlists";
      return { success: false, error };
    }
  }

  async getSavedTracks(params: { limit?: number; offset?: number }): Promise<{
    success: boolean;
    tracks?: SpotifyTrack[];
    error?: string;
  }> {
    try {
      const { limit = 20, offset = 0 } = params;
      const result = await this.request(`/me/tracks?limit=${limit}&offset=${offset}`) as { items: Array<{ track: SpotifyTrack }> };
      return { success: true, tracks: result.items.map(i => i.track) };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to get saved tracks";
      return { success: false, error };
    }
  }

  async getUserProfile(): Promise<{ success: boolean; user?: SpotifyUser; error?: string }> {
    try {
      const user = await this.request("/me") as SpotifyUser;
      return { success: true, user };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to get user profile";
      return { success: false, error };
    }
  }

  async getDevices(): Promise<{ success: boolean; devices?: SpotifyDevice[]; error?: string }> {
    try {
      const result = await this.request("/me/player/devices") as { devices: SpotifyDevice[] };
      return { success: true, devices: result.devices };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to get devices";
      return { success: false, error };
    }
  }

  async getQueue(): Promise<{ success: boolean; currentlyPlaying?: SpotifyTrack; queue?: SpotifyTrack[]; error?: string }> {
    try {
      const result = await this.request("/me/player/queue") as { currently_playing: SpotifyTrack; queue: SpotifyTrack[] };
      return { success: true, currentlyPlaying: result.currently_playing, queue: result.queue };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to get queue";
      return { success: false, error };
    }
  }

  async setVolume(params: { volumePercent: number; deviceId?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const { volumePercent, deviceId } = params;
      const queryParams = new URLSearchParams({
        volume_percent: volumePercent.toString(),
        ...(deviceId && { device_id: deviceId }),
      });

      await this.request(`/me/player/volume?${queryParams}`, { method: "PUT" });
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Set volume failed";
      return { success: false, error };
    }
  }

  // Command handlers
  private async handlePlay(context: CommandContext): Promise<void> {
    const { args } = context;
    const query = args.join(" ");

    let result;
    if (query) {
      // Search and play
      const searchResult = await this.search({ query, type: "track", limit: 1 });
      if (searchResult.success && searchResult.tracks && searchResult.tracks.length > 0) {
        result = await this.play({ uris: [searchResult.tracks[0].uri] });
      } else {
        await this.sendError(context, `No track found for "${query}"`);
        return;
      }
    } else {
      // Resume playback
      result = await this.play({});
    }

    if (result.success) {
      await this.sendCommandResponse(context, `▶️ Playing${query ? ` "${query}"` : ""}`);
    } else {
      await this.sendError(context, result.error || "Play failed");
    }
  }

  private async handlePause(context: CommandContext): Promise<void> {
    const result = await this.pause({});
    if (result.success) {
      await this.sendCommandResponse(context, `⏸️ Paused`);
    } else {
      await this.sendError(context, result.error || "Pause failed");
    }
  }

  private async handleNext(context: CommandContext): Promise<void> {
    const result = await this.next({});
    if (result.success) {
      await this.sendCommandResponse(context, `⏭️ Next track`);
    } else {
      await this.sendError(context, result.error || "Next failed");
    }
  }

  private async handlePrevious(context: CommandContext): Promise<void> {
    const result = await this.previous({});
    if (result.success) {
      await this.sendCommandResponse(context, `⏮️ Previous track`);
    } else {
      await this.sendError(context, result.error || "Previous failed");
    }
  }

  private async handleSearch(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity search <query> [track|artist|album|playlist]");
      return;
    }

    const type = (args[args.length - 1] as any) || "track";
    const validTypes = ["track", "artist", "album", "playlist", "show", "episode"];
    const searchType = validTypes.includes(type) ? type : "track";
    const query = validTypes.includes(type) ? args.slice(0, -1).join(" ") : args.join(" ");

    const result = await this.search({ query, type: searchType, limit: 10 });

    if (result.success) {
      if (searchType === "track" && result.tracks) {
        if (result.tracks.length === 0) {
          await this.sendCommandResponse(context, `No tracks found for "${query}".`);
          return;
        }
        const lines = result.tracks.map(t =>
          `• **${t.name}** — ${t.artists.map(a => a.name).join(", ")} (${t.album.name})`
        ).join("\n");
        await this.sendCommandResponse(context, `🔍 **Tracks for "${query}"**:\n${lines}`);
      } else if (searchType === "playlist" && result.playlists) {
        const lines = result.playlists.map(p =>
          `• **${p.name}** — ${p.owner.display_name} (${p.tracks.total} tracks)`
        ).join("\n");
        await this.sendCommandResponse(context, `🔍 **Playlists for "${query}"**:\n${lines}`);
      } else {
        await this.sendCommandResponse(context, `Search completed for "${query}" (${searchType})`);
      }
    } else {
      await this.sendError(context, result.error || "Search failed");
    }
  }

  private async handleListPlaylists(context: CommandContext): Promise<void> {
    const result = await this.listPlaylists({ limit: 20 });

    if (result.success && result.playlists) {
      if (result.playlists.length === 0) {
        await this.sendCommandResponse(context, "No playlists found.");
        return;
      }

      const lines = result.playlists.map(p =>
        `• **${p.name}** — ${p.tracks.total} tracks ${p.description ? `— ${p.description.slice(0, 50)}` : ""}`
      ).join("\n");

      await this.sendCommandResponse(context, `📋 **Your Playlists**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Failed to list playlists");
    }
  }

  private async handleSavedTracks(context: CommandContext): Promise<void> {
    const result = await this.getSavedTracks({ limit: 20 });

    if (result.success && result.tracks) {
      if (result.tracks.length === 0) {
        await this.sendCommandResponse(context, "No saved tracks found.");
        return;
      }

      const lines = result.tracks.map(t =>
        `• **${t.name}** — ${t.artists.map(a => a.name).join(", ")}`
      ).join("\n");

      await this.sendCommandResponse(context, `❤️ **Saved Tracks**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Failed to get saved tracks");
    }
  }

  private async handleUserProfile(context: CommandContext): Promise<void> {
    const result = await this.getUserProfile();

    if (result.success && result.user) {
      const u = result.user;
      await this.sendCommandResponse(context,
        `👤 **Spotify Profile**\n` +
        `**Name:** ${u.display_name || u.id}\n` +
        `**Email:** ${u.email || "Private"}\n` +
        `**Plan:** ${u.product}\n` +
        `**Followers:** ${u.followers.total.toLocaleString()}`
      );
    } else {
      await this.sendError(context, result.error || "Failed to get profile");
    }
  }

  private async handleDevices(context: CommandContext): Promise<void> {
    const result = await this.getDevices();

    if (result.success && result.devices) {
      if (result.devices.length === 0) {
        await this.sendCommandResponse(context, "No active devices found.");
        return;
      }

      const lines = result.devices.map(d =>
        `• **${d.name}** (${d.type}) — ${d.is_active ? "🟢 Active" : "⚪ Inactive"} ${d.volume_percent !== null ? `| Vol: ${d.volume_percent}%` : ""}`
      ).join("\n");

      await this.sendCommandResponse(context, `📱 **Available Devices**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Failed to get devices");
    }
  }

  private async handleQueue(context: CommandContext): Promise<void> {
    const result = await this.getQueue();

    if (result.success && result.currentlyPlaying) {
      const current = result.currentlyPlaying;
      const queue = result.queue || [];

      let response = `🎵 **Now Playing:** **${current.name}** — ${current.artists.map(a => a.name).join(", ")}\n\n`;

      if (queue.length > 0) {
        response += `⏭️ **Up Next:**\n`;
        response += queue.slice(0, 10).map((t, i) =>
          `${i + 1}. **${t.name}** — ${t.artists.map(a => a.name).join(", ")}`
        ).join("\n");
      } else {
        response += "Queue is empty";
      }

      await this.sendCommandResponse(context, response);
    } else {
      await this.sendError(context, result.error || "Failed to get queue");
    }
  }

  private async handleVolume(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity volume <0-100>");
      return;
    }

    const volume = parseInt(args[0]);
    if (isNaN(volume) || volume < 0 || volume > 100) {
      await this.sendError(context, "Volume must be between 0 and 100");
      return;
    }

    const result = await this.setVolume({ volumePercent: volume });

    if (result.success) {
      await this.sendCommandResponse(context, `🔊 Volume set to ${volume}%`);
    } else {
      await this.sendError(context, result.error || "Set volume failed");
    }
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    await this.sendCommandResponse(context,
      `🤖 **Spotify Commands**:\n` +
      `\`/infinity play [query]\` — Play/resume or search and play\n` +
      `\`/infinity pause\` — Pause playback\n` +
      `\`/infinity next\` — Next track\n` +
      `\`/infinity previous\` — Previous track\n` +
      `\`/infinity search <query> [type]\` — Search (track, artist, album, playlist)\n` +
      `\`/infinity playlists\` — List your playlists\n` +
      `\`/infinity tracks\` — List saved tracks\n` +
      `\`/infinity user\` — Show profile\n` +
      `\`/infinity devices\` — List available devices\n` +
      `\`/infinity queue\` — Show playback queue\n` +
      `\`/infinity volume <0-100>\` — Set volume`
    );
  }

  private async sendCommandResponse(context: CommandContext, text: string): Promise<void> {
    logger.info({ text, channelId: context.channelId }, "Spotify command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ ${error}`);
  }
}

export async function createSpotifyConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<SpotifyConnector> {
  return new SpotifyConnector(config, projectId, connectorId);
}