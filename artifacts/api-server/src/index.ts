// ── Environment loading ──────────────────────────────────────────────
// Freebuff's Keys tab writes secrets to the REPO-ROOT `.env.local`, while
// this server's CWD dotenv only reads `artifacts/api-server/.env`. That
// mismatch silently dropped every key pasted in the Keys tab. Load BOTH
// explicitly, in priority order (first loaded wins for dotenv):
//   1. repo-root .env.local   ← Freebuff Keys tab
//   2. repo-root .env         ← workspace defaults
//   3. CWD .env               ← artifacts/api-server/.env (start-dev.sh copy)
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", ".."); // dist/ -> api-server/ -> artifacts/ -> repo root
loadEnv({ path: path.join(repoRoot, ".env.local") });
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(__dirname, "..", ".env") });

// These modules import @workspace/db. Load environment files first, then
// import them dynamically. Static ESM imports are evaluated before this file's
// body, which previously let the DB pool capture an empty DATABASE_URL before
// dotenv had a chance to load the Keys-tab values.
const [{ default: app }, { logger }, { ensureTables, ensureFilesTables }, { injectDbSecretsIntoEnv }, { handleExtensionUpgrade }] =
  await Promise.all([
    import("./app"),
    import("./lib/logger"),
    import("./lib/auto-migrate"),
    import("./routes/jarvis/secrets"),
    import("./routes/jarvis"),
  ]);

const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : 8080;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Auto-create all tables on first boot (idempotent, fast no-op on subsequent
// boots). NEVER gate app.listen on this: if the DB is down, the server must
// still boot so the health check can report db: disconnected and the frontend
// gets a real, actionable error instead of "server unreachable".
ensureTables().catch((err) => {
  logger.error({ err }, "Database migration skipped, DB unreachable. Server will still start; add DATABASE_URL to bring it online.");
});

// Files table lives in the separate files DB (DATABASE_URL_FILES, falls back
// to DATABASE_URL). Non-fatal: the server boots either way, and the file
// storage layer keeps working with the local-disk fallback.
ensureFilesTables().catch((err) => {
  logger.error({ err }, "Files table migration skipped, DB unreachable. File storage will use the local-disk fallback.");
});

// Create HTTP server
const server = createServer(app);

// Create WebSocket server for extension connections
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrades for extension connections
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);

  // Check if this is an extension WebSocket connection
  if (url.pathname === "/api/jarvis/extension/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    // Reject non-extension WebSocket connections
    socket.destroy();
  }
});

// Handle new WebSocket connections for extensions
wss.on("connection", (ws, req) => {
  // Create a minimal request-like object for the handler
  const request = {
    url: req.url,
    headers: req.headers,
  } as any;
  handleExtensionUpgrade(ws, request);
});

Promise.resolve().then(() => {
  // In-app API keys (Settings → API Keys) live in the DB, inject them into
  // process.env so every existing read site picks them up. DB values win.
  return injectDbSecretsIntoEnv();
}).catch((err) => {
  logger.error({ err }, "Secret injection failed (non-fatal)");
}).finally(() => {
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
    // NOTE: The Puppeteer browser is intentionally NOT launched at startup.
    // It is lazy-initialized on first browse/screenshot request (see getBrowser()
    // in routes/jarvis/browse.ts). Eagerly launching a full Chrome instance at
    // boot was pushing the sandbox over its memory limit, causing OOM restarts
    // that killed the API server mid-conversation (voice mode errors).
  });
  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });
});
