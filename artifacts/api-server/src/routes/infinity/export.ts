import { Router, Request, Response } from "express";
import { createRequire } from "node:module";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import type { Archiver } from "archiver";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as (format: string, options?: object) => Archiver;
import { listWorkspaceFiles, readWorkspaceFileText } from "../../lib/workspace";
import { cleanText } from "../../lib/text-utils";

const router = Router();

interface ExportManifest {
  timestamp: string;
  version: string;
  workspaceId: string;
  fileCount: number;
  totalSize: number;
  files: Array<{
    path: string;
    size: number;
    type: "file" | "directory";
    modified?: string;
  }>;
}

/**
 * GET /export/info - Get workspace export info
 */
router.get("/export/info", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";

    const entries = await listWorkspaceFiles(workspaceId);
    const files = entries.filter((entry) => entry.type === "file");

    let totalSize = 0;
    const fileList = [];

    for (const file of files) {
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

    const manifest: ExportManifest = {
      timestamp: new Date().toISOString(),
      version: "1.0",
      workspaceId,
      fileCount: fileList.length,
      totalSize,
      files: fileList,
    };

    res.json({ ok: true, manifest });
  } catch (err) {
    req.log.error({ err }, "Failed to get export info");
    res.status(500).json({ error: "Failed to get export info" });
  }
});

/**
 * POST /export/zip - Export workspace as ZIP archive
 */
router.post("/export/zip", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const includeNodeModules = req.body?.includeNodeModules === true;
    const includeGit = req.body?.includeGit === true;

    const entries = await listWorkspaceFiles(workspaceId);

    // Create archive
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Set response headers
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="workspace-${workspaceId}-${Date.now()}.zip"`);

    // Pipe archive to response
    archive.pipe(res);

    // Add files to archive
    for (const entry of entries) {
      if (entry.type === "dir") continue;

      // Skip node_modules unless explicitly included
      if (!includeNodeModules && entry.path.includes("node_modules")) continue;

      // Skip .git unless explicitly included
      if (!includeGit && entry.path.includes(".git")) continue;

      // Skip common build artifacts
      if (entry.path.match(/\/(dist|build|\.next|__pycache__|target|\.bundle)\//)) continue;

      const content = await readWorkspaceFileText(entry.path, workspaceId);
      if (content) archive.append(content, { name: entry.path });
    }

    // Add manifest
    const manifest: ExportManifest = {
      timestamp: new Date().toISOString(),
      version: "1.0",
      workspaceId,
      fileCount: entries.length,
      totalSize: 0,
      files: entries
        .filter((e) => e.type === "file")
        .map((e) => ({ path: e.path, size: 0, type: "file" as const })),
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: ".manifest.json" });

    // Finalize archive
    await archive.finalize();
  } catch (err) {
    req.log.error({ err }, "Failed to export workspace as ZIP");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export workspace" });
    }
  }
});

/**
 * POST /export/tar-gz - Export workspace as tar.gz archive
 */
router.post("/export/tar-gz", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const includeNodeModules = req.body?.includeNodeModules === true;
    const includeGit = req.body?.includeGit === true;

    const entries = await listWorkspaceFiles(workspaceId);

    // Create archive
    const archive = archiver("tar", {});
    const gzip = createGzip();

    // Set response headers
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="workspace-${workspaceId}-${Date.now()}.tar.gz"`);

    // Pipe archive through gzip to response
    archive.pipe(gzip).pipe(res);

    // Add files to archive
    for (const entry of entries) {
      if (entry.type === "dir") continue;

      // Skip node_modules unless explicitly included
      if (!includeNodeModules && entry.path.includes("node_modules")) continue;

      // Skip .git unless explicitly included
      if (!includeGit && entry.path.includes(".git")) continue;

      // Skip common build artifacts
      if (entry.path.match(/\/(dist|build|\.next|__pycache__|target|\.bundle)\//)) continue;

      const content = await readWorkspaceFileText(entry.path, workspaceId);
      if (content) archive.append(content, { name: entry.path });
    }

    // Add manifest
    const manifest: ExportManifest = {
      timestamp: new Date().toISOString(),
      version: "1.0",
      workspaceId,
      fileCount: entries.length,
      totalSize: 0,
      files: entries
        .filter((e) => e.type === "file")
        .map((e) => ({ path: e.path, size: 0, type: "file" as const })),
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: ".manifest.json" });

    // Finalize archive
    await archive.finalize();
  } catch (err) {
    req.log.error({ err }, "Failed to export workspace as tar.gz");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export workspace" });
    }
  }
});

/**
 * POST /export/github - Export to GitHub repo (requires GitHub credentials)
 */
router.post("/export/github", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const { repoUrl, branch } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: "Missing repoUrl" });
    }

    // This would require git credentials and push capability
    // For now, return a guide for manual push
    const guide = {
      steps: [
        "Initialize git: git init",
        "Add remote: git remote add origin " + repoUrl,
        `Checkout branch: git checkout -b ${branch || "main"}`,
        "Stage files: git add .",
        'Commit: git commit -m "Initial commit from Jarvis Build"',
        "Push: git push -u origin " + (branch || "main"),
      ],
      note: "Automated GitHub push requires authentication. Use the commands above or push manually.",
    };

    return res.json({ ok: true, guide });
  } catch (err) {
    req.log.error({ err }, "Failed to generate GitHub export guide");
    return res.status(500).json({ error: "Failed to generate GitHub export guide" });
  }
});

/**
 * POST /export/list-files - List files that will be exported
 */
router.post("/export/list-files", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const includeNodeModules = req.body?.includeNodeModules === true;
    const includeGit = req.body?.includeGit === true;

    const entries = await listWorkspaceFiles(workspaceId);

    const files = entries
      .filter((entry) => {
        if (entry.type === "dir") return false;
        if (!includeNodeModules && entry.path.includes("node_modules")) return false;
        if (!includeGit && entry.path.includes(".git")) return false;
        if (entry.path.match(/\/(dist|build|\.next|__pycache__|target|\.bundle)\//)) return false;
        return true;
      })
      .map((e) => ({ path: e.path, type: e.type }));

    res.json({ ok: true, fileCount: files.length, files: files.slice(0, 100) });
  } catch (err) {
    req.log.error({ err }, "Failed to list export files");
    res.status(500).json({ error: "Failed to list export files" });
  }
});

export default router;
