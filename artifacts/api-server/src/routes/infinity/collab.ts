import { Router, Request, Response } from "express";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness.js";
import {
  initializeSession,
  getSession,
  addUser,
  removeUser,
  getSessionUsers,
  updateUserCursor,
  updateUserSelection,
  broadcastTerminalEvent,
  broadcastPreviewUpdate,
  getFileState,
  exportSessionState,
} from "../../lib/crdt";

const router = Router();

/**
 * Join a collaborative session
 * POST /collab/join
 * Body: { workspaceId, userId, userName }
 */
router.post("/collab/join", (req: Request, res: Response) => {
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);
  const userId = String(req.body?.userId || "anonymous").slice(0, 128);
  const userName = String(req.body?.userName || "Guest").slice(0, 128);

  try {
    const session = initializeSession(workspaceId);
    const awareness = addUser(workspaceId, req.ip || "unknown", userId, userName);

    res.json({
      ok: true,
      workspaceId,
      clientId: awareness.clientId,
      users: getSessionUsers(workspaceId).map((u) => ({
        clientId: u.clientId,
        userId: u.userId,
        userName: u.userName,
        color: u.color,
        cursor: u.cursor,
      })),
      awareness,
    });
  } catch (err) {
    req.log.error({ err }, "Collab join failed");
    res.status(500).json({ error: "Failed to join collaboration session" });
  }
});

/**
 * Leave a collaborative session
 * POST /collab/leave
 * Body: { workspaceId, clientId }
 */
router.post("/collab/leave", (req: Request, res: Response) => {
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);
  const clientId = String(req.body?.clientId || "").slice(0, 128);

  try {
    removeUser(workspaceId, clientId);
    const remainingUsers = getSessionUsers(workspaceId);

    res.json({
      ok: true,
      workspaceId,
      remainingUsers: remainingUsers.map((u) => ({
        clientId: u.clientId,
        userId: u.userId,
        userName: u.userName,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Collab leave failed");
    res.status(500).json({ error: "Failed to leave collaboration session" });
  }
});

/**
 * Get current session state and users
 * GET /collab/users
 * Query: { workspaceId }
 */
router.get("/collab/users", (req: Request, res: Response) => {
  const workspaceId = String(req.query.workspaceId || "default").slice(0, 64);

  try {
    const users = getSessionUsers(workspaceId);
    const state = exportSessionState(workspaceId);

    res.json({
      ok: true,
      workspaceId,
      users: users.map((u) => ({
        clientId: u.clientId,
        userId: u.userId,
        userName: u.userName,
        color: u.color,
        cursor: u.cursor,
        selection: u.selection,
        timestamp: u.timestamp,
      })),
      fileCount: state?.files ? Object.keys(state.files).length : 0,
    });
  } catch (err) {
    req.log.error({ err }, "Collab users query failed");
    res.status(500).json({ error: "Failed to fetch session users" });
  }
});

/**
 * Update user cursor position (for awareness)
 * POST /collab/cursor
 * Body: { workspaceId, clientId, file, line, column }
 */
router.post("/collab/cursor", (req: Request, res: Response) => {
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);
  const clientId = String(req.body?.clientId || "").slice(0, 128);
  const file = String(req.body?.file || "").slice(0, 256);
  const line = Math.max(0, Number(req.body?.line) || 0);
  const column = Math.max(0, Number(req.body?.column) || 0);

  try {
    updateUserCursor(workspaceId, clientId, file, line, column);

    res.json({
      ok: true,
      cursor: { file, line, column },
      users: getSessionUsers(workspaceId).map((u) => ({
        clientId: u.clientId,
        cursor: u.cursor,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Cursor update failed");
    res.status(500).json({ error: "Failed to update cursor" });
  }
});

/**
 * Update user selection range
 * POST /collab/selection
 * Body: { workspaceId, clientId, file, startLine, startColumn, endLine, endColumn }
 */
router.post("/collab/selection", (req: Request, res: Response) => {
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);
  const clientId = String(req.body?.clientId || "").slice(0, 128);
  const file = String(req.body?.file || "").slice(0, 256);
  const startLine = Math.max(0, Number(req.body?.startLine) || 0);
  const startColumn = Math.max(0, Number(req.body?.startColumn) || 0);
  const endLine = Math.max(0, Number(req.body?.endLine) || 0);
  const endColumn = Math.max(0, Number(req.body?.endColumn) || 0);

  try {
    updateUserSelection(workspaceId, clientId, file, startLine, startColumn, endLine, endColumn);

    res.json({
      ok: true,
      selection: { file, startLine, startColumn, endLine, endColumn },
      users: getSessionUsers(workspaceId).map((u) => ({
        clientId: u.clientId,
        selection: u.selection,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Selection update failed");
    res.status(500).json({ error: "Failed to update selection" });
  }
});

/**
 * Broadcast terminal event to session
 * POST /collab/terminal
 * Body: { workspaceId, type, data }
 */
router.post("/collab/terminal", (req: Request, res: Response) => {
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);
  const type = String(req.body?.type || "output").slice(0, 32);
  const data = String(req.body?.data || "").slice(0, 4096);

  try {
    if (!["output", "input", "error", "clear"].includes(type)) {
      return res.status(400).json({ error: "Invalid event type" });
    }

    broadcastTerminalEvent(workspaceId, { type: type as any, data, timestamp: Date.now() });

    return res.json({
      ok: true,
      event: { type, data, timestamp: Date.now() },
    });
  } catch (err) {
    req.log.error({ err }, "Terminal broadcast failed");
    return res.status(500).json({ error: "Failed to broadcast terminal event" });
  }
});

/**
 * Broadcast preview update
 * POST /collab/preview
 * Body: { workspaceId, key, value }
 */
router.post("/collab/preview", (req: Request, res: Response) => {
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);
  const key = String(req.body?.key || "state").slice(0, 256);
  const value = req.body?.value;

  try {
    broadcastPreviewUpdate(workspaceId, key, value);

    res.json({
      ok: true,
      key,
      value,
      timestamp: Date.now(),
    });
  } catch (err) {
    req.log.error({ err }, "Preview broadcast failed");
    res.status(500).json({ error: "Failed to broadcast preview update" });
  }
});

/**
 * Get file content from CRDT store
 * GET /collab/file
 * Query: { workspaceId, filePath }
 */
router.get("/collab/file", (req: Request, res: Response) => {
  const workspaceId = String(req.query.workspaceId || "default").slice(0, 64);
  const filePath = String(req.query.filePath || "").slice(0, 256);

  try {
    if (!filePath) {
      return res.status(400).json({ error: "filePath is required" });
    }

    const content = getFileState(workspaceId, filePath);

    return res.json({
      ok: true,
      workspaceId,
      filePath,
      content,
    });
  } catch (err) {
    req.log.error({ err }, "File fetch failed");
    return res.status(500).json({ error: "Failed to fetch file" });
  }
});

/**
 * Export entire session state (for debugging/persistence)
 * GET /collab/export
 * Query: { workspaceId }
 */
router.get("/collab/export", (req: Request, res: Response) => {
  const workspaceId = String(req.query.workspaceId || "default").slice(0, 64);

  try {
    const state = exportSessionState(workspaceId);

    res.json({
      ok: true,
      workspaceId,
      state: state || { files: {}, users: [] },
    });
  } catch (err) {
    req.log.error({ err }, "Session export failed");
    res.status(500).json({ error: "Failed to export session" });
  }
});

export default router;
