/**
 * Infinity Terminal Bridge — WebSocket bridge to node-pty for real terminal in browser
 *
 * Runs locally on user's machine. Provides:
 * - Full shell (bash/zsh/fish) with inherited environment
 * - WebSocket server for browser frontend
 * - Session management (multiple tabs)
 * - MCP stdio transport bridge
 * - Zero-config: auto-generates secret, prints connection URL
 */

import { WebSocketServer, WebSocket } from "ws";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { createServer, IncomingMessage } from "http";
import { randomBytes, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Types
interface TerminalSession {
  id: string;
  pty: ChildProcessWithoutNullStreams;
  shell: string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  clients: Set<WebSocket>;
  buffer: string;
  maxBuffer: number;
  createdAt: number;
  lastActivity: number;
}

interface BridgeConfig {
  port: number;
  host: string;
  secret: string;
  shell: string;
  maxSessions: number;
  sessionTimeoutMs: number;
  bufferSize: number;
  allowedOrigins: string[];
  commandAllowlist?: string[];
  commandDenylist?: string[];
}

interface ClientMessage {
  type: "create" | "resize" | "input" | "close" | "signal" | "ping" | "mcp_connect" | "mcp_request";
  sessionId?: string;
  payload?: unknown;
}

interface ServerMessage {
  type: "created" | "output" | "closed" | "error" | "pong" | "mcp_response" | "mcp_error";
  sessionId?: string;
  payload?: unknown;
  timestamp: number;
}

// Default configuration
const DEFAULT_CONFIG: BridgeConfig = {
  port: 3001,
  host: "127.0.0.1",
  secret: "",
  shell: process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash",
  maxSessions: 10,
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  bufferSize: 10000,
  allowedOrigins: ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"],
  commandDenylist: ["rm -rf /", "format c:", ":(){ :|:& };:"],
};

// Secret file path
const SECRET_DIR = join(homedir(), ".infinity");
const SECRET_FILE = join(SECRET_DIR, "bridge-secret");

// Global state
const sessions = new Map<string, TerminalSession>();
let config: BridgeConfig = { ...DEFAULT_CONFIG };
let wss: WebSocketServer | null = null;
let httpServer: ReturnType<typeof createServer> | null = null;

/**
 * Load or generate secret
 */
function loadOrGenerateSecret(): string {
  if (!existsSync(SECRET_DIR)) {
    mkdirSync(SECRET_DIR, { recursive: true });
  }

  if (existsSync(SECRET_FILE)) {
    const secret = readFileSync(SECRET_FILE, "utf8").trim();
    if (secret) return secret;
  }

  // Generate new secret
  const secret = randomBytes(32).toString("hex");
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  console.log(`[Bridge] Generated new secret: ${secret}`);
  return secret;
}

/**
 * Verify client secret
 */
function verifySecret(clientSecret: string): boolean {
  return config.secret === clientSecret;
}

/**
 * Verify origin
 */
function verifyOrigin(origin: string): boolean {
  return config.allowedOrigins.some((allowed) => {
    if (allowed === "*") return true;
    try {
      const allowedUrl = new URL(allowed);
      const originUrl = new URL(origin);
      return allowedUrl.host === originUrl.host;
    } catch {
      return allowed === origin;
    }
  });
}

/**
 * Create a new terminal session
 */
function createSession(
  sessionId: string,
  shell?: string,
  cwd?: string,
  cols = 120,
  rows = 30,
  env?: Record<string, string>
): TerminalSession {
  const sessionShell = shell || config.shell;
  const sessionCwd = cwd || process.cwd();
  const sessionEnv = { ...process.env as Record<string, string>, ...env };

  // Spawn pty
  let pty: ChildProcessWithoutNullStreams;

  if (process.platform === "win32") {
    // Windows: use cmd.exe or powershell
    pty = spawn(sessionShell, [], {
      cwd: sessionCwd,
      env: sessionEnv,
      windowsVerbatimArguments: true,
    });
  } else {
    // Unix: use node-pty for proper pty support
    try {
      // Dynamic import for node-pty (optional dependency)
      const ptyModule = require("node-pty");
      pty = ptyModule.spawn(sessionShell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: sessionCwd,
        env: sessionEnv,
        encoding: "utf8",
      });
    } catch {
      // Fallback to regular spawn if node-pty not available
      console.warn("[Bridge] node-pty not available, falling back to spawn (limited functionality)");
      pty = spawn(sessionShell, [], {
        cwd: sessionCwd,
        env: sessionEnv,
      });
    }
  }

  const session: TerminalSession = {
    id: sessionId,
    pty,
    shell: sessionShell,
    cwd: sessionCwd,
    env: sessionEnv,
    cols,
    rows,
    clients: new Set(),
    buffer: "",
    maxBuffer: config.bufferSize,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  // Handle stdout
  pty.stdout.on("data", (data: Buffer) => {
    const output = data.toString();
    session.buffer += output;
    if (session.buffer.length > session.maxBuffer) {
      session.buffer = session.buffer.slice(-session.maxBuffer);
    }
    session.lastActivity = Date.now();
    broadcastToSession(sessionId, { type: "output", sessionId, payload: output, timestamp: Date.now() });
  });

  // Handle stderr
  pty.stderr.on("data", (data: Buffer) => {
    const output = data.toString();
    session.buffer += output;
    if (session.buffer.length > session.maxBuffer) {
      session.buffer = session.buffer.slice(-session.maxBuffer);
    }
    session.lastActivity = Date.now();
    broadcastToSession(sessionId, { type: "output", sessionId, payload: output, timestamp: Date.now() });
  });

  // Handle exit
  pty.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    console.log(`[Bridge] Session ${sessionId} exited with code ${code}, signal ${signal}`);
    broadcastToSession(sessionId, {
      type: "closed",
      sessionId,
      payload: { code, signal },
      timestamp: Date.now(),
    });
    // Clean up after a delay to allow clients to receive close message
    setTimeout(() => {
      sessions.delete(sessionId);
    }, 1000);
  });

  // Handle error
  pty.on("error", (err: Error) => {
    console.error(`[Bridge] Session ${sessionId} error:`, err);
    broadcastToSession(sessionId, {
      type: "error",
      sessionId,
      payload: err.message,
      timestamp: Date.now(),
    });
  });

  sessions.set(sessionId, session);
  console.log(`[Bridge] Created session ${sessionId} (${sessionShell} @ ${sessionCwd})`);

  return session;
}

/**
 * Broadcast message to all clients in a session
 */
function broadcastToSession(sessionId: string, message: ServerMessage): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const data = JSON.stringify(message);
  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/**
 * Send message to specific client
 */
function sendToClient(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Handle incoming WebSocket message
 */
function handleMessage(ws: WebSocket, message: ClientMessage): void {
  const { type, sessionId, payload } = message;

  switch (type) {
    case "create": {
      const { shell, cwd, cols, rows, env, secret } = (payload as Record<string, unknown>) || {};
      if (!verifySecret(secret as string)) {
        sendToClient(ws, { type: "error", payload: "Invalid secret", timestamp: Date.now() });
        return;
      }

      if (sessions.size >= config.maxSessions) {
        sendToClient(ws, { type: "error", payload: "Max sessions reached", timestamp: Date.now() });
        return;
      }

      const newSessionId = sessionId || `session_${Date.now()}_${randomBytes(4).toString("hex")}`;
      const session = createSession(newSessionId, shell as string, cwd as string, cols as number, rows as number, env as Record<string, string>);
      session.clients.add(ws);

      sendToClient(ws, {
        type: "created",
        sessionId: newSessionId,
        payload: { buffer: session.buffer },
        timestamp: Date.now(),
      });
      break;
    }

    case "resize": {
      if (!sessionId) {
        sendToClient(ws, { type: "error", payload: "Missing sessionId", timestamp: Date.now() });
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        sendToClient(ws, { type: "error", payload: "Session not found", timestamp: Date.now() });
        return;
      }
      const { cols, rows } = (payload as Record<string, unknown>) || {};
      if (cols && rows) {
        session.cols = cols as number;
        session.rows = rows as number;
        try {
          // node-pty resize
          if ("resize" in session.pty) {
            (session.pty as { resize: (cols: number, rows: number) => void }).resize(cols as number, rows as number);
          }
        } catch (err) {
          console.error(`[Bridge] Resize error:`, err);
        }
      }
      break;
    }

    case "input": {
      if (!sessionId) {
        sendToClient(ws, { type: "error", payload: "Missing sessionId", timestamp: Date.now() });
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        sendToClient(ws, { type: "error", payload: "Session not found", timestamp: Date.now() });
        return;
      }
      const { data } = (payload as Record<string, unknown>) || {};
      if (data) {
        session.lastActivity = Date.now();
        try {
          session.pty.stdin.write(data as string);
        } catch (err) {
          console.error(`[Bridge] Input error:`, err);
        }
      }
      break;
    }

    case "close": {
      if (!sessionId) {
        sendToClient(ws, { type: "error", payload: "Missing sessionId", timestamp: Date.now() });
        return;
      }
      const session = sessions.get(sessionId);
      if (session) {
        session.clients.delete(ws);
        if (session.clients.size === 0) {
          // No more clients, kill the session after a grace period
          setTimeout(() => {
            const s = sessions.get(sessionId);
            if (s && s.clients.size === 0) {
              try {
                s.pty.kill("SIGTERM");
              } catch {}
            }
          }, 5000);
        }
      }
      break;
    }

    case "signal": {
      if (!sessionId) {
        sendToClient(ws, { type: "error", payload: "Missing sessionId", timestamp: Date.now() });
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        sendToClient(ws, { type: "error", payload: "Session not found", timestamp: Date.now() });
        return;
      }
      const { signal } = (payload as Record<string, unknown>) || {};
      if (signal) {
        try {
          session.pty.kill(signal as NodeJS.Signals);
        } catch (err) {
          console.error(`[Bridge] Signal error:`, err);
        }
      }
      break;
    }

    case "ping": {
      sendToClient(ws, { type: "pong", timestamp: Date.now() });
      break;
    }

    case "mcp_connect": {
      // MCP stdio bridge - connect to an MCP server via stdio
      handleMCPConnect(ws, sessionId, payload as Record<string, unknown>);
      break;
    }

    case "mcp_request": {
      // Forward MCP request to connected MCP server
      handleMCPRequest(ws, sessionId, payload as Record<string, unknown>);
      break;
    }

    default:
      sendToClient(ws, { type: "error", payload: `Unknown message type: ${type}`, timestamp: Date.now() });
  }
}

/**
 * Handle MCP stdio connection
 */
const mcpConnections = new Map<string, { process: ChildProcessWithoutNullStreams; sessionId: string }>();

function handleMCPConnect(ws: WebSocket, sessionId: string | undefined, payload: Record<string, unknown>): void {
  const { command, args, env, secret } = payload;
  if (!verifySecret(secret as string)) {
    sendToClient(ws, { type: "mcp_error", payload: "Invalid secret", timestamp: Date.now() });
    return;
  }
  if (!command) {
    sendToClient(ws, { type: "mcp_error", payload: "Missing command", timestamp: Date.now() });
    return;
  }

  const mcpId = `mcp_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const mcpEnv = { ...process.env, ...(env as Record<string, string>) };

  try {
    const proc = spawn(command as string, (args as string[]) || [], {
      cwd: process.cwd(),
      env: mcpEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    mcpConnections.set(mcpId, { process: proc, sessionId: sessionId || "" });

    proc.stdout.on("data", (data: Buffer) => {
      sendToClient(ws, {
        type: "mcp_response",
        sessionId: mcpId,
        payload: data.toString(),
        timestamp: Date.now(),
      });
    });

    proc.stderr.on("data", (data: Buffer) => {
      console.error(`[MCP ${mcpId}] stderr:`, data.toString());
    });

    proc.on("exit", (code: number | null) => {
      mcpConnections.delete(mcpId);
      sendToClient(ws, {
        type: "mcp_error",
        sessionId: mcpId,
        payload: `MCP server exited with code ${code}`,
        timestamp: Date.now(),
      });
    });

    proc.on("error", (err: Error) => {
      mcpConnections.delete(mcpId);
      sendToClient(ws, {
        type: "mcp_error",
        sessionId: mcpId,
        payload: err.message,
        timestamp: Date.now(),
      });
    });

    sendToClient(ws, {
      type: "mcp_response",
      sessionId: mcpId,
      payload: { connected: true, mcpId },
      timestamp: Date.now(),
    });
  } catch (err) {
    sendToClient(ws, {
      type: "mcp_error",
      payload: `Failed to start MCP server: ${err}`,
      timestamp: Date.now(),
    });
  }
}

function handleMCPRequest(ws: WebSocket, sessionId: string | undefined, payload: Record<string, unknown>): void {
  const { mcpId, request } = payload;
  if (!mcpId) {
    sendToClient(ws, { type: "mcp_error", payload: "Missing mcpId", timestamp: Date.now() });
    return;
  }

  const conn = mcpConnections.get(mcpId as string);
  if (!conn) {
    sendToClient(ws, { type: "mcp_error", payload: "MCP connection not found", timestamp: Date.now() });
    return;
  }

  try {
    conn.process.stdin.write(JSON.stringify(request) + "\n");
  } catch (err) {
    sendToClient(ws, { type: "mcp_error", payload: `Failed to send MCP request: ${err}`, timestamp: Date.now() });
  }
}

/**
 * Cleanup expired sessions
 */
function cleanupSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.lastActivity > config.sessionTimeoutMs) {
      console.log(`[Bridge] Cleaning up expired session ${sessionId}`);
      try {
        session.pty.kill("SIGTERM");
      } catch {}
      sessions.delete(sessionId);
    }
  }
}

/**
 * Start the bridge server
 */
export async function startBridge(customConfig?: Partial<BridgeConfig>): Promise<void> {
  config = { ...DEFAULT_CONFIG, ...customConfig };
  config.secret = config.secret || loadOrGenerateSecret();

  console.log(`[Bridge] Starting Infinity Terminal Bridge`);
  console.log(`[Bridge] Secret: ${config.secret}`);
  console.log(`[Bridge] Shell: ${config.shell}`);

  // Create HTTP server for WebSocket upgrade
  httpServer = createServer();

  // Handle WebSocket upgrades
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, socket: any, head: Buffer) => {
    // Verify origin
    const origin = request.headers.origin;
    if (origin && !verifyOrigin(origin)) {
      console.warn(`[Bridge] Rejected connection from origin: ${origin}`);
      socket.destroy();
      return;
    }

    // Verify secret from query params
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const secret = url.searchParams.get("secret");
    if (!verifySecret(secret || "")) {
      console.warn(`[Bridge] Rejected connection: invalid secret`);
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(request, socket, head, (ws) => {
      wss!.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    console.log(`[Bridge] New WebSocket connection`);

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        handleMessage(ws, message);
      } catch (err) {
        console.error("[Bridge] Failed to parse message:", err);
        sendToClient(ws, { type: "error", payload: "Invalid message format", timestamp: Date.now() });
      }
    });

    ws.on("close", () => {
      // Remove client from any session
      for (const session of sessions.values()) {
        session.clients.delete(ws);
      }
    });

    ws.on("error", (err) => {
      console.error("[Bridge] WebSocket error:", err);
    });

    // Send welcome
    sendToClient(ws, {
      type: "output",
      payload: `Welcome to Infinity Terminal Bridge\nSecret: ${config.secret}\nRun 'infinity-terminal-bridge --help' for options\n\n`,
      timestamp: Date.now(),
    });
  });

  // Start HTTP server
  return new Promise((resolve) => {
    httpServer!.listen(config.port, config.host, () => {
      console.log(`[Bridge] Server listening on ${config.host}:${config.port}`);
      console.log(`[Bridge] WebSocket endpoint: ws://${config.host}:${config.port}?secret=${config.secret}`);
      console.log(`[Bridge] Allowed origins: ${config.allowedOrigins.join(", ")}`);

      // Periodic cleanup
      setInterval(cleanupSessions, 60000);

      resolve();
    });
  });
}

/**
 * Stop the bridge server
 */
export async function stopBridge(): Promise<void> {
  // Close all sessions
  for (const session of sessions.values()) {
    try {
      session.pty.kill("SIGTERM");
    } catch {}
  }
  sessions.clear();

  // Close MCP connections
  for (const conn of mcpConnections.values()) {
    try {
      conn.process.kill("SIGTERM");
    } catch {}
  }
  mcpConnections.clear();

  // Close WebSocket server
  if (wss) {
    wss.close();
    wss = null;
  }

  // Close HTTP server
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
  }

  console.log("[Bridge] Stopped");
}

/**
 * Get status
 */
export function getStatus(): { sessions: number; mcpConnections: number; config: BridgeConfig } {
  return {
    sessions: sessions.size,
    mcpConnections: mcpConnections.size,
    config: { ...config, secret: "[REDACTED]" },
  };
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Infinity Terminal Bridge — Local terminal bridge for Infinity

Usage: infinity-terminal-bridge [options]

Options:
  --port, -p <number>     Port to listen on (default: 3001)
  --host <string>         Host to bind to (default: 127.0.0.1)
  --secret <string>       Shared secret (auto-generated if not provided)
  --shell <string>        Shell to use (default: $SHELL or bash)
  --max-sessions <number> Maximum concurrent sessions (default: 10)
  --help, -h              Show this help

Environment:
  INFINITY_BRIDGE_PORT     Same as --port
  INFINITY_BRIDGE_HOST     Same as --host
  INFINITY_BRIDGE_SECRET   Same as --secret
  INFINITY_BRIDGE_SHELL    Same as --shell

Examples:
  infinity-terminal-bridge
  infinity-terminal-bridge --port 3001 --secret mysecret
  INFINITY_BRIDGE_PORT=3001 infinity-terminal-bridge
`);
    process.exit(0);
  }

  // Parse CLI args
  const cliConfig: Partial<BridgeConfig> = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
      case "-p":
        cliConfig.port = parseInt(args[++i], 10);
        break;
      case "--host":
        cliConfig.host = args[++i];
        break;
      case "--secret":
        cliConfig.secret = args[++i];
        break;
      case "--shell":
        cliConfig.shell = args[++i];
        break;
      case "--max-sessions":
        cliConfig.maxSessions = parseInt(args[++i], 10);
        break;
    }
  }

  // Environment variable overrides
  if (process.env.INFINITY_BRIDGE_PORT) cliConfig.port = parseInt(process.env.INFINITY_BRIDGE_PORT, 10);
  if (process.env.INFINITY_BRIDGE_HOST) cliConfig.host = process.env.INFINITY_BRIDGE_HOST;
  if (process.env.INFINITY_BRIDGE_SECRET) cliConfig.secret = process.env.INFINITY_BRIDGE_SECRET;
  if (process.env.INFINITY_BRIDGE_SHELL) cliConfig.shell = process.env.INFINITY_BRIDGE_SHELL;

  // Start bridge
  startBridge(cliConfig).catch((err) => {
    console.error("[Bridge] Failed to start:", err);
    process.exit(1);
  });

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\n[Bridge] Shutting down...");
    await stopBridge();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await stopBridge();
    process.exit(0);
  });
}