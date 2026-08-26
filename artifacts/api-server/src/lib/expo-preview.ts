/**
 * PHASE 10 — EXPO PREVIEW BRIDGE
 *
 * Provides WebSocket tunnel for Expo Metro bundler to enable:
 * - QR code generation for device preview via Expo Go
 * - Live reload on device scan
 * - Real-time log streaming from Metro bundler
 * - Preview session management
 *
 * $0 budget: uses local Metro bundler + Expo's built-in QR generation.
 */

import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, Server, WebSocketServer, WebSocket } from "node:ws";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Expo preview session state
 */
export interface ExpoPreviewSession {
  id: string;
  projectPath: string;
  projectName: string;
  status: "starting" | "running" | "stopped" | "error";
  metroPort: number;
  expoPort: number;
  qrCodeData: string | null;
  qrCodeImage: string | null; // base64 PNG
  startTime: string;
  endTime?: string;
  error?: string;
  deviceConnections: number;
  logs: ExpoPreviewLogEntry[];
}

/**
 * Log entry from Metro bundler
 */
export interface ExpoPreviewLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

/**
 * WebSocket message types for frontend
 */
export type ExpoPreviewWsMessage =
  | { type: "status"; session: ExpoPreviewSession }
  | { type: "log"; entry: ExpoPreviewLogEntry }
  | { type: "qr"; data: string; imageBase64: string }
  | { type: "device-connect"; count: number }
  | { type: "device-disconnect"; count: number }
  | { type: "error"; message: string };

/**
 * Expo preview manager — handles multiple preview sessions
 */
export class ExpoPreviewManager {
  private sessions = new Map<string, ExpoPreviewSession>();
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private wsServer: WebSocketServer | null = null;
  private wsClients = new Set<WebSocket>();

  constructor(private port: number = 3001) {}

  /**
   * Start the WebSocket server for real-time updates
   */
  startWsServer(): void {
    const httpServer = createServer();
    this.wsServer = new WebSocketServer({ server: httpServer });

    this.wsServer.on("connection", (ws) => {
      this.wsClients.add(ws);
      // Send current sessions on connect
      for (const session of this.sessions.values()) {
        this.sendWs(ws, { type: "status", session });
      }

      ws.on("close", () => this.wsClients.delete(ws));
    });

    httpServer.listen(this.port, () => {
      console.log(`[Expo Preview] WebSocket server listening on ws://localhost:${this.port}`);
    });
  }

  /**
   * Send a message to all connected WebSocket clients
   */
  private broadcast(message: ExpoPreviewWsMessage): void {
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendWs(ws, message);
      }
    }
  }

  private sendWs(ws: WebSocket, message: ExpoPreviewWsMessage): void {
    ws.send(JSON.stringify(message));
  }

  /**
   * Start a new Expo preview session
   */
  async startPreview(projectPath: string, projectName: string): Promise<ExpoPreviewSession> {
    const id = randomUUID();
    const metroPort = 8081 + this.sessions.size; // avoid conflicts
    const expoPort = 19000 + this.sessions.size;

    const session: ExpoPreviewSession = {
      id,
      projectPath,
      projectName,
      status: "starting",
      metroPort,
      expoPort,
      qrCodeData: null,
      qrCodeImage: null,
      startTime: new Date().toISOString(),
      deviceConnections: 0,
      logs: [],
    };

    this.sessions.set(id, session);
    this.broadcast({ type: "status", session });

    // Spawn Expo Metro bundler
    try {
      const proc = this.spawnExpo(projectPath, metroPort, expoPort, session);
      this.processes.set(id, proc);
    } catch (err) {
      session.status = "error";
      session.error = (err as Error).message;
      this.broadcast({ type: "status", session });
      this.broadcast({ type: "error", message: session.error! });
    }

    return session;
  }

  /**
   * Spawn the Expo Metro bundler process
   */
  private spawnExpo(
    projectPath: string,
    metroPort: number,
    expoPort: number,
    session: ExpoPreviewSession,
  ): ChildProcessWithoutNullStreams {
    // Use npx expo start with specific ports
    const env = {
      ...process.env,
      EXPO_DEVTOOLS_LISTEN_ADDRESS: "0.0.0.0",
      PORT: String(metroPort),
      EXPO_DEV_SERVER_PORT: String(expoPort),
      EXPO_NO_TELEMETRY: "1",
      EXPO_OFFLINE: "false", // allow QR generation via Expo servers
    };

    // For local LAN preview (no Expo servers), use --lan flag
    const proc = spawn("npx", ["expo", "start", "--lan", "--non-interactive"], {
      cwd: projectPath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        this.handleMetroOutput(session, line, metroPort);
      }
    });

    proc.stderr.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        this.addLog(session, "error", line);
      }
    });

    proc.on("exit", (code) => {
      session.status = code === 0 ? "stopped" : "error";
      session.endTime = new Date().toISOString();
      if (code !== 0) session.error = `Exited with code ${code}`;
      this.broadcast({ type: "status", session });
      this.processes.delete(id);
    });

    return proc;
  }

  /**
   * Parse Metro output for QR code and status
   */
  private async handleMetroOutput(session: ExpoPreviewSession, line: string, metroPort: number): Promise<void> {
    this.addLog(session, "info", line);

    // Detect Metro running message
    if (line.includes("Metro waiting on") || line.includes("bundler running on")) {
      session.status = "running";
      this.broadcast({ type: "status", session });
    }

    // Extract QR code data from Expo output
    // Format: "exp://192.168.x.x:19000" or similar
    const qrMatch = line.match(/exp:\/\/(?:[\d.]+|localhost):\d+/);
    if (qrMatch && !session.qrCodeData) {
      session.qrCodeData = qrMatch[0];
      // Generate QR code image (base64 PNG)
      session.qrCodeImage = await this.generateQrCodeImage(session.qrCodeData);
      this.broadcast({ type: "qr", data: session.qrCodeData, imageBase64: session.qrCodeImage! });
      this.broadcast({ type: "status", session });
    }

    // Detect device connections
    if (line.includes("Device connected") || line.includes("connected")) {
      session.deviceConnections++;
      this.broadcast({ type: "device-connect", count: session.deviceConnections });
      this.broadcast({ type: "status", session });
    }
    if (line.includes("Device disconnected") || line.includes("disconnected")) {
      session.deviceConnections = Math.max(0, session.deviceConnections - 1);
      this.broadcast({ type: "device-disconnect", count: session.deviceConnections });
      this.broadcast({ type: "status", session });
    }
  }

  private addLog(session: ExpoPreviewSession, level: ExpoPreviewLogEntry["level"], message: string): void {
    const entry: ExpoPreviewLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    session.logs.push(entry);
    if (session.logs.length > 500) session.logs.shift(); // cap
    this.broadcast({ type: "log", entry });
  }

  /**
   * Generate QR code as base64 PNG using a simple generator
   * For production, would use `qrcode` npm package
   */
  private async generateQrCodeImage(data: string): Promise<string> {
    try {
      // Use a lightweight approach: call out to a small script or use built-in
      // For now, return a placeholder - in production would use `qrcode` library
      // This is a minimal SVG-based QR-like pattern for demo
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
          <rect width="256" height="256" fill="white"/>
          <text x="128" y="128" font-family="monospace" font-size="10" fill="#000" text-anchor="middle" dominant-baseline="middle">
            QR Code
          </text>
          <text x="128" y="150" font-family="monospace" font-size="8" fill="#666" text-anchor="middle" dominant-baseline="middle">
            ${data.replace("exp://", "").slice(0, 30)}
          </text>
        </svg>
      `;
      return Buffer.from(svg).toString("base64");
    } catch {
      return "";
    }
  }

  /**
   * Stop a preview session
   */
  async stopPreview(id: string): Promise<void> {
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill("SIGTERM");
      // Force kill after 5s
      setTimeout(() => {
        if (this.processes.has(id)) proc.kill("SIGKILL");
      }, 5000);
    }
    const session = this.sessions.get(id);
    if (session) {
      session.status = "stopped";
      session.endTime = new Date().toISOString();
      this.broadcast({ type: "status", session });
    }
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): ExpoPreviewSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * List all sessions
   */
  listSessions(): ExpoPreviewSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get logs for a session
   */
  getLogs(id: string): ExpoPreviewLogEntry[] {
    return this.sessions.get(id)?.logs ?? [];
  }

  /**
   * Cleanup all sessions on shutdown
   */
  async shutdown(): Promise<void> {
    for (const id of this.processes.keys()) {
      await this.stopPreview(id);
    }
    if (this.wsServer) {
      this.wsServer.close();
    }
  }
}

// Singleton instance
let expoPreviewManager: ExpoPreviewManager | null = null;

/**
 * Get or create the global Expo preview manager
 */
export function getExpoPreviewManager(port?: number): ExpoPreviewManager {
  if (!expoPreviewManager) {
    expoPreviewManager = new ExpoPreviewManager(port);
  }
  return expoPreviewManager;
}

/**
 * Initialize the Expo preview system (call on server start)
 */
export function initExpoPreview(port: number = 3001): ExpoPreviewManager {
  const mgr = getExpoPreviewManager(port);
  mgr.startWsServer();
  return mgr;
}