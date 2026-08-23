import { Router, Request, Response } from "express";
import { Extract } from "unzipper";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { writeWorkspaceFile, listWorkspaceFiles, ensureWorkspace } from "../../lib/workspace";
import { cleanText } from "../../lib/text-utils";

const router = Router();
const execAsync = promisify(exec);

interface ImportManifest {
  timestamp: string;
  version: string;
  workspaceId: string;
  fileCount: number;
  totalSize: number;
  files: Array<{
    path: string;
    size: number;
    type: "file" | "directory";
  }>;
}

/**
 * POST /import/upload - Upload and extract ZIP/tar.gz archive
 */
router.post("/import/upload", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const merge = req.body?.merge === true; // If false, replace workspace

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Ensure workspace exists
    await ensureWorkspace(workspaceId);

    const filename = req.file.originalname || "archive";
    const isZip = filename.endsWith(".zip");
    const isTarGz = filename.endsWith(".tar.gz") || filename.endsWith(".tgz");

    if (!isZip && !isTarGz) {
      return res.status(400).json({ error: "Only ZIP and tar.gz archives are supported" });
    }

    let importedFiles = 0;
    let errors: string[] = [];

    if (isZip) {
      // Extract ZIP archive
      const stream = createReadStream(req.file.path);

      await pipeline(
        stream,
        Extract({ path: req.file.destination || "/tmp" }).on("entry", async (entry: any) => {
          if (entry.type === "File") {
            try {
              let filePath = entry.path;
              // Skip manifest file
              if (filePath === ".manifest.json") {
                entry.autodrain();
                return;
              }

              // Normalize path
              filePath = filePath.replace(/\\/g, "/");

              // Read file content
              const chunks: Buffer[] = [];
              for await (const chunk of entry) {
                chunks.push(chunk as Buffer);
              }
              const content = Buffer.concat(chunks).toString("utf8");

              // Write to workspace
              await writeWorkspaceFile(filePath, content, workspaceId);
              importedFiles++;
            } catch (err) {
              errors.push(`Failed to import ${entry.path}: ${(err as Error).message}`);
              entry.autodrain();
            }
          } else {
            entry.autodrain();
          }
        }),
      );
    } else if (isTarGz) {
      // Extract tar.gz archive using tar command
      try {
        const { stdout } = await execAsync(`cd /tmp && tar -tzf "${req.file.path}" | head -100`);
        const files = stdout.trim().split("\n").filter((f) => f && !f.endsWith("/"));

        for (const file of files) {
          if (file === ".manifest.json") continue;

          try {
            const { stdout: content } = await execAsync(`tar -xzOf "${req.file.path}" "${file}"`);
            await writeWorkspaceFile(file, content, workspaceId);
            importedFiles++;
          } catch (err) {
            errors.push(`Failed to import ${file}: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        return res.status(500).json({ error: "Failed to extract tar.gz archive" });
      }
    }

    return res.json({
      ok: true,
      message: `Imported ${importedFiles} files`,
      importedFiles,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to import workspace");
    return res.status(500).json({ error: "Failed to import workspace" });
  }
});

/**
 * POST /import/github - Clone from GitHub repository
 */
router.post("/import/github", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const { repoUrl, branch } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: "Missing repoUrl" });
    }

    // Ensure workspace exists
    await ensureWorkspace(workspaceId);

    const tmpDir = `/tmp/git-clone-${Date.now()}`;
    const branchFlag = branch ? `--branch ${branch}` : "";

    try {
      // Clone repository
      const { stderr: cloneOutput } = await execAsync(`git clone --depth 1 ${branchFlag} "${repoUrl}" "${tmpDir}" 2>&1`);

      // List files in cloned repo
      const { stdout: files } = await execAsync(`find "${tmpDir}" -type f | head -500`);
      const fileList = files.trim().split("\n").filter((f) => f);

      let importedFiles = 0;
      let errors: string[] = [];

      for (const file of fileList) {
        try {
          // Skip .git directory
          if (file.includes("/.git/")) continue;

          // Skip node_modules, dist, build, etc.
          if (file.match(/\/(node_modules|dist|build|\.next|__pycache__|target)\//)) continue;

          const relativePath = file.substring(tmpDir.length + 1);
          const { stdout: content } = await execAsync(`cat "${file}"`);
          await writeWorkspaceFile(relativePath, content, workspaceId);
          importedFiles++;
        } catch (err) {
          errors.push(`Failed to import ${file}: ${(err as Error).message}`);
        }
      }

      // Cleanup
      await execAsync(`rm -rf "${tmpDir}"`);

      return res.json({
        ok: true,
        message: `Imported ${importedFiles} files from ${repoUrl}`,
        importedFiles,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err) {
      return res.status(500).json({ error: `Failed to clone repository: ${(err as Error).message}` });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to import from GitHub");
    return res.status(500).json({ error: "Failed to import from GitHub" });
  }
});

/**
 * POST /import/template - Create workspace from built-in or community template
 */
router.post("/import/template", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.body?.workspaceId as string, 64) || "default";
    const { templateId, templateUrl } = req.body;

    if (!templateId && !templateUrl) {
      return res.status(400).json({ error: "Missing templateId or templateUrl" });
    }

    // Ensure workspace exists
    await ensureWorkspace(workspaceId);

    let importedFiles = 0;

    if (templateUrl) {
      // Import from URL
      try {
        const tmpDir = `/tmp/template-${Date.now()}`;
        const { stdout: files } = await execAsync(`curl -s "${templateUrl}" | tar -xz -C "${tmpDir}" 2>&1`);

        const { stdout: fileList } = await execAsync(`find "${tmpDir}" -type f | head -200`);
        const fileNames = fileList.trim().split("\n").filter((f) => f);

        for (const file of fileNames) {
          try {
            const relativePath = file.substring(tmpDir.length + 1);
            const { stdout: content } = await execAsync(`cat "${file}"`);
            await writeWorkspaceFile(relativePath, content, workspaceId);
            importedFiles++;
          } catch {
            // Skip problematic files
          }
        }

        await execAsync(`rm -rf "${tmpDir}"`);
      } catch (err) {
        return res.status(500).json({ error: `Failed to download template: ${(err as Error).message}` });
      }
    }

    return res.json({
      ok: true,
      message: `Imported ${importedFiles} files from template`,
      importedFiles,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to import template");
    return res.status(500).json({ error: "Failed to import template" });
  }
});

/**
 * GET /import/verify - Verify import compatibility
 */
router.get("/import/verify", async (req: Request, res: Response) => {
  try {
    const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";

    const entries = await listWorkspaceFiles(workspaceId);
    const hasPackageJson = entries.some((e) => e.path === "package.json");
    const hasRequirements = entries.some((e) => e.path === "requirements.txt");
    const hasGo = entries.some((e) => e.path === "go.mod");
    const hasRust = entries.some((e) => e.path === "Cargo.toml");
    const hasDotnet = entries.some((e) => e.path.endsWith(".csproj"));

    const compatibility = {
      nodejs: hasPackageJson,
      python: hasRequirements,
      go: hasGo,
      rust: hasRust,
      dotnet: hasDotnet,
    };

    res.json({
      ok: true,
      compatibility,
      fileCount: entries.length,
      warnings: entries.length > 1000 ? ["Large workspace: may take longer to process"] : [],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to verify import");
    res.status(500).json({ error: "Failed to verify import" });
  }
});

export default router;
