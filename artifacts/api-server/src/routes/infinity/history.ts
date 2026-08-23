import { Router, Request, Response } from "express";
import { listWorkspaceFiles, readWorkspaceFileText, writeWorkspaceFile } from "../../lib/workspace";
import { cleanText } from "../../lib/text-utils";

const router = Router();

interface Snapshot {
  id: string;
  timestamp: string;
  label: string;
  description: string;
  fileCount: number;
  totalSize: number;
  trigger: "manual" | "auto" | "save" | "terminal" | "llm";
  files: Map<string, string>;
}

interface HistoryEntry {
  id: string;
  timestamp: string;
  action: "file-change" | "terminal-run" | "llm-generation" | "snapshot" | "restore";
  details: string;
  affectedFiles: string[];
}

// Store snapshots and history per workspace
const workspaceSnapshots = new Map<string, Snapshot[]>();
const workspaceHistory = new Map<string, HistoryEntry[]>();

/**
 * Create a snapshot of current workspace state
 */
async function createSnapshot(
  workspaceId: string,
  label: string,
  description: string,
  trigger: Snapshot["trigger"],
): Promise<Snapshot> {
  const entries = await listWorkspaceFiles(workspaceId);
  const files = new Map<string, string>();
  let totalSize = 0;

  for (const entry of entries) {
    if (entry.type === "file") {
      const content = await readWorkspaceFileText(entry.path, workspaceId);
      if (!content) continue;
      files.set(entry.path, content);
      totalSize += Buffer.byteLength(content, "utf8");
    }
  }

  const snapshot: Snapshot = {
    id: `snapshot-${Date.now()}`,
    timestamp: new Date().toISOString(),
    label,
    description,
    fileCount: files.size,
    totalSize,
    trigger,
    files,
  };

  if (!workspaceSnapshots.has(workspaceId)) {
    workspaceSnapshots.set(workspaceId, []);
  }

  const snapshots = workspaceSnapshots.get(workspaceId)!;
  snapshots.push(snapshot);

  // Keep only last 50 snapshots
  if (snapshots.length > 50) {
    snapshots.shift();
  }

  return snapshot;
}

/**
 * POST /history/snapshot - Create manual snapshot
 */
router.post("/history/snapshot", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const label = cleanText(req.body?.label as string, 100) || "Manual snapshot";
    const description = cleanText(req.body?.description as string, 500) || "";

    const snapshot = await createSnapshot(workspaceId, label, description, "manual");

    // Add to history
    if (!workspaceHistory.has(workspaceId)) {
      workspaceHistory.set(workspaceId, []);
    }
    workspaceHistory.get(workspaceId)!.push({
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      action: "snapshot",
      details: label,
      affectedFiles: Array.from(snapshot.files.keys()),
    });

    res.json({
      ok: true,
      snapshot: {
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        label: snapshot.label,
        description: snapshot.description,
        fileCount: snapshot.fileCount,
        totalSize: snapshot.totalSize,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create snapshot");
    res.status(500).json({ error: "Failed to create snapshot" });
  }
});

/**
 * GET /history/snapshots - List all snapshots
 */
router.get("/history/snapshots", (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
    const snapshots = workspaceSnapshots.get(workspaceId) || [];

    const list = snapshots.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      label: s.label,
      description: s.description,
      fileCount: s.fileCount,
      totalSize: s.totalSize,
      trigger: s.trigger,
    }));

    return res.json({ ok: true, snapshots: list });
  } catch (err) {
    req.log.error({ err }, "Failed to list snapshots");
    return res.status(500).json({ error: "Failed to list snapshots" });
  }
});

/**
 * GET /history/snapshots/:snapshotId - Get snapshot details
 */
router.get("/history/snapshots/:snapshotId", (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
    const snapshotId = cleanText(req.params.snapshotId as string, 64);

    const snapshots = workspaceSnapshots.get(workspaceId) || [];
    const snapshot = snapshots.find((s) => s.id === snapshotId);

    if (!snapshot) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    return res.json({
      ok: true,
      snapshot: {
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        label: snapshot.label,
        description: snapshot.description,
        fileCount: snapshot.fileCount,
        totalSize: snapshot.totalSize,
        trigger: snapshot.trigger,
        files: Array.from(snapshot.files.keys()),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get snapshot");
    return res.status(500).json({ error: "Failed to get snapshot" });
  }
});

router.get("/history/snapshots/:snapshotId/file", (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
    const snapshotId = cleanText(req.params.snapshotId as string, 64);
    const filePath = cleanText(req.query.path as string, 500);
    const snapshot = (workspaceSnapshots.get(workspaceId) || []).find((item) => item.id === snapshotId);
    if (!snapshot || !filePath) return res.status(404).json({ error: "Snapshot file not found" });
    const content = snapshot.files.get(filePath);
    if (content === undefined) return res.status(404).json({ error: "Snapshot file not found" });
    return res.json({ ok: true, path: filePath, content });
  } catch (err) {
    req.log.error({ err }, "Failed to read snapshot file");
    return res.status(500).json({ error: "Failed to read snapshot file" });
  }
});

/**
 * POST /history/restore - Restore from snapshot
 */
router.post("/history/restore", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const snapshotId = cleanText(req.body?.snapshotId as string, 64);

    if (!snapshotId) {
      return res.status(400).json({ error: "Missing snapshotId" });
    }

    const snapshots = workspaceSnapshots.get(workspaceId) || [];
    const snapshot = snapshots.find((s) => s.id === snapshotId);

    if (!snapshot) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    // First, create a backup snapshot before restoring
    await createSnapshot(workspaceId, "Pre-restore backup", `Before restoring from ${snapshot.label}`, "auto");

    // Restore files from snapshot
    let restoredCount = 0;
    for (const [filePath, content] of snapshot.files) {
      try {
        await writeWorkspaceFile(filePath, content, workspaceId);
        restoredCount++;
      } catch {
        // Skip files that can't be written
      }
    }

    // Add to history
    if (!workspaceHistory.has(workspaceId)) {
      workspaceHistory.set(workspaceId, []);
    }
    workspaceHistory.get(workspaceId)!.push({
      id: `restore-${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "restore",
      details: `Restored from snapshot: ${snapshot.label}`,
      affectedFiles: Array.from(snapshot.files.keys()),
    });

    return res.json({
      ok: true,
      message: `Restored ${restoredCount} files from snapshot`,
      restoredCount,
      snapshotId: snapshot.id,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to restore snapshot");
    return res.status(500).json({ error: "Failed to restore snapshot" });
  }
});

/**
 * DELETE /history/snapshots/:snapshotId - Delete snapshot
 */
router.delete("/history/snapshots/:snapshotId", (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
    const snapshotId = cleanText(req.params.snapshotId as string, 64);

    const snapshots = workspaceSnapshots.get(workspaceId) || [];
    const index = snapshots.findIndex((s) => s.id === snapshotId);

    if (index === -1) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    snapshots.splice(index, 1);

    return res.json({ ok: true, message: "Snapshot deleted" });
  } catch (err) {
    req.log.error({ err }, "Failed to delete snapshot");
    return res.status(500).json({ error: "Failed to delete snapshot" });
  }
});

/**
 * GET /history/entries - Get action history
 */
router.get("/history/entries", (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
    const limit = Math.min(100, Number(req.query.limit) || 50);

    const entries = (workspaceHistory.get(workspaceId) || []).slice(-limit);

    return res.json({ ok: true, entries });
  } catch (err) {
    req.log.error({ err }, "Failed to get history");
    return res.status(500).json({ error: "Failed to get history" });
  }
});

/**
 * POST /history/add-entry - Add history entry (called internally)
 */
router.post("/history/add-entry", (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const action = req.body?.action as HistoryEntry["action"];
    const details = cleanText(req.body?.details as string, 500) || "";
    const affectedFiles = Array.isArray(req.body?.affectedFiles) ? req.body.affectedFiles : [];

    if (!action) {
      return res.status(400).json({ error: "Missing action" });
    }

    if (!workspaceHistory.has(workspaceId)) {
      workspaceHistory.set(workspaceId, []);
    }

    const entry: HistoryEntry = {
      id: `entry-${Date.now()}`,
      timestamp: new Date().toISOString(),
      action,
      details,
      affectedFiles: affectedFiles.slice(0, 10),
    };

    workspaceHistory.get(workspaceId)!.push(entry);

    // Keep only last 500 entries
    const history = workspaceHistory.get(workspaceId)!;
    if (history.length > 500) {
      history.shift();
    }

    return res.json({ ok: true, entry });
  } catch (err) {
    req.log.error({ err }, "Failed to add history entry");
    return res.status(500).json({ error: "Failed to add history entry" });
  }
});

/**
 * POST /history/auto-snapshot - Trigger auto snapshot (e.g., on file save)
 */
router.post("/history/auto-snapshot", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const trigger = req.body?.trigger || "auto";

    const snapshot = await createSnapshot(workspaceId, `Auto snapshot (${trigger})`, "", trigger);

    return res.json({ ok: true, snapshotId: snapshot.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create auto snapshot");
    return res.status(500).json({ error: "Failed to create auto snapshot" });
  }
});

export default router;
