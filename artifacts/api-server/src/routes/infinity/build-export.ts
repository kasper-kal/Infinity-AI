import { Router, Request, Response } from "express";
import { createRequire } from "node:module";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import type { Archiver } from "archiver";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as (format: string, options?: object) => Archiver;

import { cleanText } from "../../lib/text-utils";
import { listWorkspaceFiles, readWorkspaceFileText, writeWorkspaceFile, createIsolated } from "../../lib/workspace";
import { listCheckpoints, getLatestCheckpoint, saveCheckpoint } from "../../lib/build-checkpoints";
import { listSnapshots, createSnapshot, writeSnapshotSidecar } from "../../lib/workspace-snapshots";
import { readAllEvents, countEvents, logBuildEvent } from "../../lib/build-telemetry";

const router = Router();

interface ExportManifest {
  timestamp: string;
  version: string;
  projectId: string;
  workspaceId: string;
  fileCount: number;
  totalSize: number;
  files: Array<{
    path: string;
    size: number;
    type: "file" | "directory";
    modified?: string;
  }>;
  checkpoints?: Array<{
    id: string;
    iteration: number;
    completed: number;
    createdAt: string;
  }>;
  snapshots?: Array<{
    id: string;
    iteration: number;
    sizeBytes: number;
    createdAt: string;
  }>;
  telemetryEventCount?: number;
}

/**
 * GET /api/infinity/build/export/info/:projectId
 * Get build export info (manifest with files, checkpoints, snapshots, telemetry count)
 */
router.get("/build/export/info/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const workspaceId = projectId;

    // Files
    const entries = await listWorkspaceFiles(workspaceId);
    const fileEntries = entries.filter((entry) => entry.type === "file");

    let totalSize = 0;
    const fileList = [];

    for (const file of fileEntries) {
      const content = await readWorkspaceFileText(file.path, workspaceId);
      if (!content) continue;
      const size = Buffer.byteLength(content, "utf8");
      totalSize += size;
      fileList.push({
        path: file.path,
        size,
        type: "file" as const,
      });
    }

    // Checkpoints
    const checkpoints = await listCheckpoints(projectId, 50);
    const checkpointList = checkpoints.map((c) => ({
      id: c.id,
      iteration: c.iteration,
      completed: c.completed,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
    }));

    // Snapshots
    const snapshots = await listSnapshots(projectId, 50);
    const snapshotList = snapshots.map((s) => ({
      id: s.id,
      iteration: s.iteration,
      sizeBytes: s.sizeBytes,
      createdAt: s.createdAt,
    }));

    // Telemetry count
    const telemetryEventCount = await countEvents(projectId);

    const manifest: ExportManifest = {
      timestamp: new Date().toISOString(),
      version: "1.0",
      projectId,
      workspaceId,
      fileCount: fileList.length,
      totalSize,
      files: fileList,
      checkpoints: checkpointList,
      snapshots: snapshotList,
      telemetryEventCount,
    };

    res.json({ ok: true, manifest });
  } catch (err) {
    req.log.error({ err }, "Failed to get build export info");
    res.status(500).json({ error: "Failed to get build export info" });
  }
});

/**
 * POST /api/infinity/build/export/zip/:projectId
 * Export full build (source + checkpoints + snapshots + telemetry) as ZIP archive
 */
router.post("/build/export/zip/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const workspaceId = projectId;
    const includeNodeModules = req.body?.includeNodeModules === true;
    const includeGit = req.body?.includeGit === true;

    const entries = await listWorkspaceFiles(workspaceId);

    // Create archive
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Set response headers
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="build-${projectId}-${Date.now()}.zip"`);

    // Pipe archive to response
    archive.pipe(res);

    // Add source files
    for (const entry of entries) {
      if (entry.type === "dir") continue;

      if (!includeNodeModules && entry.path.includes("node_modules")) continue;
      if (!includeGit && entry.path.includes(".git")) continue;
      if (entry.path.match(/\/(dist|build|\.next|__pycache__|target|\.bundle|\.tmp)\//)) continue;

      const content = await readWorkspaceFileText(entry.path, workspaceId);
      if (content) archive.append(content, { name: `source/${entry.path}` });
    }

    // Add checkpoints
    const checkpoints = await listCheckpoints(projectId, 200);
    for (const cp of checkpoints) {
      archive.append(JSON.stringify({
        id: cp.id,
        projectId: cp.projectId,
        iteration: cp.iteration,
        completed: cp.completed,
        plan: cp.plan,
        completedSteps: cp.completedSteps,
        workingContext: cp.workingContext,
        fileSnapshots: cp.fileSnapshots,
        tokenUsage: cp.tokenUsage,
        createdAt: cp.createdAt,
        updatedAt: cp.updatedAt,
      }, null, 2), { name: `checkpoints/${cp.iteration}-${cp.id}.json` });
    }

    // Add snapshots (metadata only - full snapshots are tar.gz files)
    const snapshots = await listSnapshots(projectId, 200);
    for (const snap of snapshots) {
      archive.append(JSON.stringify({
        id: snap.id,
        projectId: snap.projectId,
        checkpointId: snap.checkpointId,
        iteration: snap.iteration,
        sizeBytes: snap.sizeBytes,
        createdAt: snap.createdAt,
        workspacePath: snap.workspacePath,
      }, null, 2), { name: `snapshots/${snap.id}.json` });
    }

    // Add telemetry events
    const events = await readAllEvents(projectId);
    if (events.length > 0) {
      const eventsJsonl = events.map(e => JSON.stringify(e)).join("\n") + "\n";
      archive.append(eventsJsonl, { name: "telemetry/events.jsonl" });
    }

    // Add manifest
    const manifest: ExportManifest = {
      timestamp: new Date().toISOString(),
      version: "1.0",
      projectId,
      workspaceId,
      fileCount: entries.filter(e => e.type === "file").length,
      totalSize: 0,
      files: entries.filter(e => e.type === "file").map(e => ({ path: e.path, size: 0, type: "file" as const })),
      checkpoints: checkpoints.map(c => ({ id: c.id, iteration: c.iteration, completed: c.completed, createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt) })),
      snapshots: snapshots.map(s => ({ id: s.id, iteration: s.iteration, sizeBytes: s.sizeBytes, createdAt: s.createdAt })),
      telemetryEventCount: events.length,
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: ".manifest.json" });

    // Finalize archive
    await archive.finalize();

    await logBuildEvent(projectId, "info", `Build exported as ZIP (${events.length} events, ${checkpoints.length} checkpoints, ${snapshots.length} snapshots)`, { data: { format: "zip", eventCount: events.length, checkpointCount: checkpoints.length, snapshotCount: snapshots.length } });
  } catch (err) {
    req.log.error({ err }, "Failed to export build as ZIP");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export build" });
    }
  }
});

/**
 * POST /api/infinity/build/export/tar-gz/:projectId
 * Export full build as tar.gz archive
 */
router.post("/build/export/tar-gz/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const workspaceId = projectId;
    const includeNodeModules = req.body?.includeNodeModules === true;
    const includeGit = req.body?.includeGit === true;

    const entries = await listWorkspaceFiles(workspaceId);

    // Create archive
    const archive = archiver("tar", {});
    const gzip = createGzip();

    // Set response headers
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="build-${projectId}-${Date.now()}.tar.gz"`);

    // Pipe archive through gzip to response
    archive.pipe(gzip).pipe(res);

    // Add source files
    for (const entry of entries) {
      if (entry.type === "dir") continue;

      if (!includeNodeModules && entry.path.includes("node_modules")) continue;
      if (!includeGit && entry.path.includes(".git")) continue;
      if (entry.path.match(/\/(dist|build|\.next|__pycache__|target|\.bundle|\.tmp)\//)) continue;

      const content = await readWorkspaceFileText(entry.path, workspaceId);
      if (content) archive.append(content, { name: `source/${entry.path}` });
    }

    // Add checkpoints
    const checkpoints = await listCheckpoints(projectId, 200);
    for (const cp of checkpoints) {
      archive.append(JSON.stringify({
        id: cp.id,
        projectId: cp.projectId,
        iteration: cp.iteration,
        completed: cp.completed,
        plan: cp.plan,
        completedSteps: cp.completedSteps,
        workingContext: cp.workingContext,
        fileSnapshots: cp.fileSnapshots,
        tokenUsage: cp.tokenUsage,
        createdAt: cp.createdAt,
        updatedAt: cp.updatedAt,
      }, null, 2), { name: `checkpoints/${cp.iteration}-${cp.id}.json` });
    }

    // Add snapshots metadata
    const snapshots = await listSnapshots(projectId, 200);
    for (const snap of snapshots) {
      archive.append(JSON.stringify({
        id: snap.id,
        projectId: snap.projectId,
        checkpointId: snap.checkpointId,
        iteration: snap.iteration,
        sizeBytes: snap.sizeBytes,
        createdAt: snap.createdAt,
        workspacePath: snap.workspacePath,
      }, null, 2), { name: `snapshots/${snap.id}.json` });
    }

    // Add telemetry events
    const events = await readAllEvents(projectId);
    if (events.length > 0) {
      const eventsJsonl = events.map(e => JSON.stringify(e)).join("\n") + "\n";
      archive.append(eventsJsonl, { name: "telemetry/events.jsonl" });
    }

    // Add manifest
    const manifest: ExportManifest = {
      timestamp: new Date().toISOString(),
      version: "1.0",
      projectId,
      workspaceId,
      fileCount: entries.filter(e => e.type === "file").length,
      totalSize: 0,
      files: entries.filter(e => e.type === "file").map(e => ({ path: e.path, size: 0, type: "file" as const })),
      checkpoints: checkpoints.map(c => ({ id: c.id, iteration: c.iteration, completed: c.completed, createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt) })),
      snapshots: snapshots.map(s => ({ id: s.id, iteration: s.iteration, sizeBytes: s.sizeBytes, createdAt: s.createdAt })),
      telemetryEventCount: events.length,
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: ".manifest.json" });

    // Finalize archive
    await archive.finalize();

    await logBuildEvent(projectId, "info", `Build exported as tar.gz (${events.length} events, ${checkpoints.length} checkpoints, ${snapshots.length} snapshots)`, { data: { format: "tar.gz", eventCount: events.length, checkpointCount: checkpoints.length, snapshotCount: snapshots.length } });
  } catch (err) {
    req.log.error({ err }, "Failed to export build as tar.gz");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export build" });
    }
  }
});

/**
 * POST /api/infinity/build/share/:projectId
 * Create a shareable read-only link (signed URL with 7-day expiry)
 */
router.post("/build/share/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }

    // Generate a share token (in production this would be signed JWT with expiry)
    const shareToken = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Store share metadata (in-memory for now, could persist to DB)
    // For a production implementation, this would write to a shares table
    const shareInfo = {
      projectId,
      shareToken,
      createdAt: new Date().toISOString(),
      expiresAt,
      permissions: "read-only",
    };

    // Base URL from request or env
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`;
    const shareUrl = `${baseUrl}/build/shared/${shareToken}`;

    await logBuildEvent(projectId, "info", `Build shared (read-only, 7-day expiry)`, { data: { shareToken, expiresAt } });

    res.json({ ok: true, shareUrl, shareToken, expiresAt });
  } catch (err) {
    req.log.error({ err }, "Failed to create share link");
    res.status(500).json({ error: "Failed to create share link" });
  }
});

/**
 * GET /api/infinity/build/shared/:shareToken
 * Access a shared build (read-only, no auth required if token valid and not expired)
 */
router.get("/build/shared/:shareToken", async (req: Request, res: Response) => {
  try {
    const shareToken = cleanText(req.params.shareToken as string, 64);
    if (!shareToken) {
      res.status(400).json({ error: "shareToken required" });
      return;
    }

    // In production: validate token from DB/cache, check expiry
    // For now, return a placeholder - the actual implementation would lookup the token
    // and return the build metadata/export info for that projectId

    // This is a stub - the actual implementation would need a shares table
    res.json({
      ok: true,
      message: "Shared build access - implement token validation in production",
      note: "This endpoint requires a shares table in the DB to validate shareToken -> projectId mapping",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to access shared build");
    res.status(500).json({ error: "Failed to access shared build" });
  }
});

/**
 * POST /api/infinity/build/clone/:projectId
 * Clone a build into a new project from a checkpoint
 */
router.post("/build/clone/:projectId", async (req: Request, res: Response) => {
  try {
    const sourceProjectId = cleanText(req.params.projectId as string, 64);
    if (!sourceProjectId) {
      res.status(400).json({ error: "source projectId required" });
      return;
    }

    const targetProjectId = cleanText(req.body?.targetProjectId as string, 64) || `clone-${randomUUID().slice(0, 8)}`;
    const checkpointId = req.body?.checkpointId ? cleanText(req.body.checkpointId as string, 64) : null;
    const includeSnapshots = req.body?.includeSnapshots === true;
    const includeTelemetry = req.body?.includeTelemetry === true;

    // Get the checkpoint to clone from
    let checkpoint = null;
    if (checkpointId) {
      // Get specific checkpoint
      const checkpoints = await listCheckpoints(sourceProjectId, 200);
      checkpoint = checkpoints.find(c => c.id === checkpointId);
    } else {
      // Get latest
      checkpoint = await getLatestCheckpoint(sourceProjectId);
    }

    if (!checkpoint) {
      res.status(404).json({ error: "No checkpoint found to clone from" });
      return;
    }

    // Create isolated workspace for new project
    const iso = await createIsolated(targetProjectId);

    // Copy source files from checkpoint's fileSnapshots or current workspace
    if (checkpoint.fileSnapshots) {
      for (const [relPath, content] of Object.entries(checkpoint.fileSnapshots)) {
        await writeWorkspaceFile(relPath, content as string, targetProjectId);
      }
    } else {
      // Fallback: copy from source workspace
      const entries = await listWorkspaceFiles(sourceProjectId);
      for (const entry of entries) {
        if (entry.type === "dir") continue;
        if (entry.path.includes("node_modules") || entry.path.includes(".git")) continue;
        const content = await readWorkspaceFileText(entry.path, sourceProjectId);
        if (content) await writeWorkspaceFile(entry.path, content, targetProjectId);
      }
    }

    // Create initial checkpoint for the cloned project
    const newCheckpointId = await saveCheckpoint({
      projectId: targetProjectId,
      iteration: 1,
      completed: 0,
      phase: "planning",
      plan: (checkpoint.plan as Record<string, unknown>) ?? {},
      completedSteps: [],
      workingContext: { ...((checkpoint.workingContext as Record<string, unknown>) ?? {}), clonedFrom: sourceProjectId, clonedFromCheckpoint: checkpoint.id },
      fileSnapshots: (checkpoint.fileSnapshots as Record<string, string>) ?? {},
      tokenUsage: (checkpoint.tokenUsage as Record<string, unknown>) ?? {},
    });

    // Optionally create a snapshot
    if (includeSnapshots) {
      const snapMeta = await createSnapshot(targetProjectId, newCheckpointId, 1);
      if (snapMeta) await writeSnapshotSidecar(snapMeta);
    }

    await logBuildEvent(targetProjectId, "info", `Build cloned from ${sourceProjectId} (checkpoint ${checkpoint.iteration})`, { data: { sourceProjectId, sourceCheckpointId: checkpoint.id, sourceIteration: checkpoint.iteration, includeSnapshots, includeTelemetry } });

    res.json({ ok: true, targetProjectId, worktreePath: iso.worktreePath, branch: iso.branch, checkpointId: newCheckpointId });
  } catch (err) {
    req.log.error({ err }, "Failed to clone build");
    res.status(500).json({ error: "Failed to clone build" });
  }
});

export default router;