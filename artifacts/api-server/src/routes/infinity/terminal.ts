import { Router } from "express";
import {
  ensureWorkspace,
  findInteractiveTerminal,
  startInteractiveTerminal,
  resetSession,
  runTerminalCommand,
  stopInteractiveTerminal,
  subscribeInteractiveTerminal,
} from "../../lib/workspace";

const router = Router();

function bodyValue(req: { body?: unknown }, key: string): unknown {
  return req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>)[key] : undefined;
}

function cleanId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : "default";
}

router.post("/terminal", async (req, res) => {
  const command = bodyValue(req, "command");
  const sessionId = cleanId(bodyValue(req, "sessionId"));
  const workspaceId = cleanId(bodyValue(req, "workspaceId"));
  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }
  try {
    await ensureWorkspace(workspaceId);
    const result = await runTerminalCommand(sessionId, command, { workspaceId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Terminal failed" });
  }
});

router.post("/terminal/start", async (req, res) => {
  const command = bodyValue(req, "command");
  const sessionId = cleanId(bodyValue(req, "sessionId"));
  const workspaceId = cleanId(bodyValue(req, "workspaceId"));
  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }
  try {
    const terminal = await startInteractiveTerminal(sessionId, command, { workspaceId });
    res.status(201).json({ id: terminal.id, sessionId, workspaceId, cwd: terminal.cwd, startedAt: terminal.startedAt });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not start terminal" });
  }
});

router.get("/terminal/stream", async (req, res) => {
  const id = typeof req.query.id === "string" ? req.query.id : "";
  const terminal = findInteractiveTerminal(id);
  if (!terminal) {
    res.status(404).json({ error: "Terminal session not found" });
    return;
  }
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (event: unknown) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client disconnected */ }
  };
  send({ type: "snapshot", output: terminal.output, done: terminal.done, exitCode: terminal.exitCode });
  const unsubscribe = subscribeInteractiveTerminal(terminal, (event) => { send(event); if (event.type === "exit") res.end(); });
  req.on("close", unsubscribe);
});

router.post("/terminal/stop", (req, res) => {
  const id = bodyValue(req, "id");
  if (typeof id !== "string" || !id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  res.json({ ok: stopInteractiveTerminal(id) });
});

router.post("/terminal/reset", async (req, res) => {
  await resetSession(cleanId(bodyValue(req, "sessionId")), cleanId(bodyValue(req, "workspaceId")));
  res.json({ ok: true });
});

export default router;
