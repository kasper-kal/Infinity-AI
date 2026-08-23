import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import {
  getWorkspaceRoot,
  startInteractiveTerminal,
  stopInteractiveTerminal,
  findInteractiveTerminal,
  subscribeInteractiveTerminal,
  type InteractiveTerminal,
} from "../../lib/workspace";

const router = Router();

// Map of workspaceId -> { watcher: FSWatcher, terminals: Map<sessionId, InteractiveTerminal> }
const watchers = new Map<string, { watcher: FSWatcher | null; watchers: Set<string>; config: FileWatchConfig }>();

export interface FileWatchConfig {
  autoReload: boolean;
  ignoredPatterns: string[];
  debounceMs: number;
  extensionsToWatch: string[];
}

const DEFAULT_WATCH_CONFIG: FileWatchConfig = {
  autoReload: true,
  ignoredPatterns: ["node_modules", ".git", ".tmp", "dist", "build", ".next", ".nuxt"],
  debounceMs: 1000,
  extensionsToWatch: [
    ".js", ".ts", ".jsx", ".tsx", ".json",
    ".py", ".go", ".rs", ".rb", ".php", ".java",
    ".html", ".css", ".scss", ".vue", ".svelte",
    ".yaml", ".yml", ".toml", ".md",
  ],
};

/**
 * Initialize file watcher for a workspace.
 */
async function initializeWatcher(
  workspaceId: string,
  config: Partial<FileWatchConfig> = {},
): Promise<FSWatcher> {
  const root = getWorkspaceRoot(workspaceId);
  const finalConfig: FileWatchConfig = { ...DEFAULT_WATCH_CONFIG, ...config };

  const ignored = [
    "**/node_modules/**",
    "**/.git/**",
    "**/.tmp/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/*.infinity.env.json",
    "**/.*",
    ...finalConfig.ignoredPatterns.map((p) => `**/${p}/**`),
  ];

  const watcher = watch(root, {
    ignored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: finalConfig.debounceMs,
      pollInterval: 100,
    },
  });

  // Track watcher lifecycle
  const watcherEntry = watchers.get(workspaceId) || { watcher: null, watchers: new Set(), config: finalConfig };
  watcherEntry.watcher = watcher;
  watchers.set(workspaceId, watcherEntry);

  return watcher;
}

/**
 * Stop watching a workspace directory.
 */
async function stopWatcher(workspaceId: string): Promise<void> {
  const entry = watchers.get(workspaceId);
  if (entry?.watcher) {
    await entry.watcher.close();
  }
  watchers.delete(workspaceId);
}

/**
 * Set up hot reload triggers for a terminal session.
 * When files change, restart the associated preview process.
 */
async function setupHotReload(
  workspaceId: string,
  sessionId: string,
  terminal: InteractiveTerminal,
  onReloadTrigger?: (event: { file: string; type: "add" | "change" | "unlink" }) => void,
): Promise<() => void> {
  let entry = watchers.get(workspaceId);
  if (!entry) {
    const watcher = await initializeWatcher(workspaceId);
    entry = { watcher, watchers: new Set(), config: DEFAULT_WATCH_CONFIG };
    watchers.set(workspaceId, entry);
  } else if (!entry.watcher) {
    const watcher = await initializeWatcher(workspaceId);
    entry.watcher = watcher;
  }

  const watcher = entry.watcher!;
  const config = entry.config;

  // Track watchers for cleanup
  entry.watchers.add(`${workspaceId}:${sessionId}`);

  // Set up file change listeners
  const handleFileChange = (eventType: "add" | "change" | "unlink", filePath: string) => {
    const ext = path.extname(filePath);
    if (!config.extensionsToWatch.includes(ext)) return;

    onReloadTrigger?.({ file: filePath, type: eventType });
  };

  watcher.on("change", (filePath) => handleFileChange("change", filePath));
  watcher.on("add", (filePath) => handleFileChange("add", filePath));
  watcher.on("unlink", (filePath) => handleFileChange("unlink", filePath));

  // Return cleanup function
  return () => {
    entry!.watchers.delete(`${workspaceId}:${sessionId}`);
    if (entry!.watchers.size === 0) {
      stopWatcher(workspaceId).catch(console.error);
    }
  };
}

/**
 * Enable auto-reload: watch files and restart the preview on changes.
 */
router.post("/hot-reload/enable", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "default";
  const config = typeof req.body?.config === "object" && req.body.config ? req.body.config : {};

  try {
    // Initialize watcher
    const watcher = await initializeWatcher(workspaceId, config as Partial<FileWatchConfig>);
    res.json({ ok: true, workspaceId, watching: true, config: DEFAULT_WATCH_CONFIG });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to enable hot reload" });
  }
});

/**
 * Disable auto-reload for a workspace.
 */
router.post("/hot-reload/disable", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";

  try {
    await stopWatcher(workspaceId);
    res.json({ ok: true, workspaceId, watching: false });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to disable hot reload" });
  }
});

/**
 * Stream file change events (server-sent events).
 */
router.get("/hot-reload/events", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";

  try {
    // Initialize watcher if not already
    let entry = watchers.get(workspaceId);
    if (!entry || !entry.watcher) {
      const watcher = await initializeWatcher(workspaceId);
      entry = { watcher, watchers: new Set(), config: DEFAULT_WATCH_CONFIG };
      watchers.set(workspaceId, entry);
    }

    const watcher = entry.watcher!;

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    const send = (event: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* client disconnected */
      }
    };

    const handleChange = (filePath: string) => {
      send({
        type: "change",
        file: path.relative(getWorkspaceRoot(workspaceId), filePath),
        timestamp: Date.now(),
      });
    };

    const handleAdd = (filePath: string) => {
      send({
        type: "add",
        file: path.relative(getWorkspaceRoot(workspaceId), filePath),
        timestamp: Date.now(),
      });
    };

    const handleUnlink = (filePath: string) => {
      send({
        type: "unlink",
        file: path.relative(getWorkspaceRoot(workspaceId), filePath),
        timestamp: Date.now(),
      });
    };

    watcher.on("change", handleChange);
    watcher.on("add", handleAdd);
    watcher.on("unlink", handleUnlink);

    req.on("close", () => {
      watcher.off("change", handleChange);
      watcher.off("add", handleAdd);
      watcher.off("unlink", handleUnlink);
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to stream events" });
  }
});

/**
 * Restart preview on demand (manually triggered reload).
 */
router.post("/hot-reload/restart", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "default";
  const command = typeof req.body?.command === "string" ? req.body.command : "npm run dev";

  try {
    // Stop existing terminal if any
    const existingKey = `${workspaceId}:${sessionId}`;

    // Start new terminal with the command
    const terminal = await startInteractiveTerminal(sessionId, command, { workspaceId });

    res.status(201).json({
      ok: true,
      id: terminal.id,
      sessionId,
      workspaceId,
      cwd: terminal.cwd,
      startedAt: terminal.startedAt,
      message: "Preview restarted",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to restart preview" });
  }
});

export default router;
export { initializeWatcher, stopWatcher, setupHotReload };
