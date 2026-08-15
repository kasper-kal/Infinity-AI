import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { WORKSPACE_ROOT, isolatedPath, hasIsolated, getWorkspaceRoot } from "./workspace";
import { db } from "@workspace/db";
import { buildCheckpoints } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Phase 4.1 — Workspace Snapshots + One-Click Rollback.
 *
 * Each checkpoint optionally captures a tar.gz snapshot of the workspace state
 * (worktree or default root) so a build can be restored exactly. Snapshots are
 * stored in WORKSPACE_ROOT/snapshots/<project-id>/<checkpoint-id>.tar.gz and
 * linked to a checkpoint row. On restore, the archive is extracted back over
 * the worktree (or default workspace root).
 */

export interface SnapshotMetadata {
  id: string;
  projectId: string;
  checkpointId: string | null;
  iteration: number;
  path: string; // absolute path to .tar.gz
  sizeBytes: number;
  createdAt: string;
  workspacePath: string; // absolute path of workspace at snapshot time
}

const SNAPSHOTS_ROOT = path.resolve(WORKSPACE_ROOT, "snapshots");

/** Get the snapshot directory for a project. */
export async function getSnapshotDir(projectId: string): Promise<string> {
  const dir = path.join(SNAPSHOTS_ROOT, projectId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Create a tar.gz snapshot of the current workspace for a project. */
export async function createSnapshot(
  projectId: string,
  checkpointId: string | null,
  iteration = 1,
): Promise<SnapshotMetadata | null> {
  try {
    const workspacePath = hasIsolated(projectId)
      ? isolatedPath(projectId)
      : getWorkspaceRoot(projectId);
    const dir = await getSnapshotDir(projectId);
    const id = randomUUID();
    const tarPath = path.join(dir, `${id}.tar.gz`);

    // Use system tar to create the archive, excluding .git, node_modules,
    // .tmp, and existing snapshots to keep size bounded.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tar", [
        "-czf", tarPath,
        "--exclude=.git",
        "--exclude=node_modules",
        "--exclude=.tmp",
        "--exclude=snapshots",
        "-C", workspacePath,
        ".",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar failed (exit ${code}): ${stderr.slice(-500)}`));
      });
      child.on("error", reject);
    });

    const stat = await fs.stat(tarPath);
    if (stat.size === 0) {
      await fs.unlink(tarPath).catch(() => {});
      return null;
    }

    const meta: SnapshotMetadata = {
      id,
      projectId,
      checkpointId,
      iteration,
      path: tarPath,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
      workspacePath,
    };
    return meta;
  } catch (err) {
    console.error({ err, projectId, checkpointId }, "Failed to create workspace snapshot");
    return null;
  }
}

/** Restore a snapshot archive back over the workspace (overwrites current state). */
export async function restoreSnapshot(
  projectId: string,
  snapshotId: string,
): Promise<boolean> {
  try {
    const dir = await getSnapshotDir(projectId);
    const tarPath = path.join(dir, `${snapshotId}.tar.gz`);
    const workspacePath = hasIsolated(projectId)
      ? isolatedPath(projectId)
      : getWorkspaceRoot(projectId);

    // Verify archive exists
    await fs.access(tarPath);

    // Extract over the workspace, excluding snapshots dir (don't recurse into it)
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tar", [
        "-xzf", tarPath,
        "--exclude=snapshots",
        "-C", workspacePath,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar extract failed (exit ${code}): ${stderr.slice(-500)}`));
      });
      child.on("error", reject);
    });

    return true;
  } catch (err) {
    console.error({ err, projectId, snapshotId }, "Failed to restore workspace snapshot");
    return false;
  }
}

/** List snapshots for a project (newest first). */
export async function listSnapshots(projectId: string, limit = 20): Promise<SnapshotMetadata[]> {
  try {
    const dir = await getSnapshotDir(projectId);
    const files = await fs.readdir(dir);
    const snapshots: SnapshotMetadata[] = [];
    for (const file of files) {
      if (!file.endsWith(".tar.gz")) continue;
      const id = file.slice(0, -".tar.gz".length);
      const fullPath = path.join(dir, file);
      const stat = await fs.stat(fullPath);
      // Try to extract metadata from a sidecar JSON if present, else minimal
      const sidecarPath = path.join(dir, `${id}.json`);
      let meta: Partial<SnapshotMetadata> = {};
      try {
        const raw = await fs.readFile(sidecarPath, "utf8");
        meta = JSON.parse(raw);
      } catch { /* no sidecar */ }
      snapshots.push({
        id,
        projectId,
        checkpointId: meta.checkpointId ?? null,
        iteration: meta.iteration ?? 0,
        path: fullPath,
        sizeBytes: stat.size,
        createdAt: meta.createdAt ?? stat.mtime.toISOString(),
        workspacePath: meta.workspacePath ?? "",
      });
    }
    return snapshots
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Write a sidecar JSON with snapshot metadata for later listing. */
export async function writeSnapshotSidecar(meta: SnapshotMetadata): Promise<void> {
  try {
    const dir = await getSnapshotDir(meta.projectId);
    const sidecarPath = path.join(dir, `${meta.id}.json`);
    await fs.writeFile(sidecarPath, JSON.stringify({
      id: meta.id,
      projectId: meta.projectId,
      checkpointId: meta.checkpointId,
      iteration: meta.iteration,
      createdAt: meta.createdAt,
      workspacePath: meta.workspacePath,
    }, null, 2), "utf8");
  } catch { /* best-effort */ }
}

/** Delete a snapshot (archive + sidecar). */
export async function deleteSnapshot(projectId: string, snapshotId: string): Promise<boolean> {
  try {
    const dir = await getSnapshotDir(projectId);
    const tarPath = path.join(dir, `${snapshotId}.tar.gz`);
    const sidecarPath = path.join(dir, `${snapshotId}.json`);
    await fs.unlink(tarPath).catch(() => {});
    await fs.unlink(sidecarPath).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Auto-snapshot after checkpoint save (called from build route). */
export async function snapshotAfterCheckpoint(
  projectId: string,
  checkpointId: string,
  iteration: number,
): Promise<void> {
  try {
    const meta = await createSnapshot(projectId, checkpointId, iteration);
    if (meta) {
      await writeSnapshotSidecar(meta);
      // Link snapshot id to checkpoint row (append to tokenUsage metadata)
      const [row] = await db
        .select({ tokenUsage: buildCheckpoints.tokenUsage })
        .from(buildCheckpoints)
        .where(eq(buildCheckpoints.id, checkpointId))
        .limit(1);
      const existing = (row?.tokenUsage as Record<string, unknown>) ?? {};
      const snapshots = Array.isArray(existing.snapshots) ? existing.snapshots as string[] : [];
      snapshots.push(meta.id);
      await db
        .update(buildCheckpoints)
        .set({
          tokenUsage: { ...existing, snapshots },
          updatedAt: new Date(),
        })
        .where(eq(buildCheckpoints.id, checkpointId));
    }
  } catch (err) {
    console.error({ err, projectId, checkpointId }, "Auto-snapshot failed (non-fatal)");
  }
}