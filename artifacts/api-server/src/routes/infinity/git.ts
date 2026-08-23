import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runTerminalCommand, getWorkspaceRoot } from "../../lib/workspace";

const router = Router();

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
  conflicted: string[];
}

interface GitLog {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface GitDiff {
  file: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * Initialize git repository if not already initialized.
 */
async function ensureGitRepo(workspaceId: string): Promise<boolean> {
  try {
    const gitDir = path.join(getWorkspaceRoot(workspaceId), ".git");
    await fs.access(gitDir);
    return true; // Already initialized
  } catch {
    // Initialize if not present
    try {
      const result = await runTerminalCommand("default", "git init && git config user.email 'jarvis@local' && git config user.name 'Jarvis'", {
        workspaceId,
        timeoutMs: 10000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}

/**
 * Get current git status.
 */
async function getGitStatus(workspaceId: string): Promise<GitStatus | null> {
  try {
    if (!(await ensureGitRepo(workspaceId))) return null;

    const result = await runTerminalCommand("default", "git status --porcelain --branch", { workspaceId });
    if (result.exitCode !== 0) return null;

    const lines = result.stdout.split("\n").filter((l) => l);
    const status: GitStatus = {
      branch: "",
      ahead: 0,
      behind: 0,
      modified: [],
      staged: [],
      untracked: [],
      conflicted: [],
    };

    for (const line of lines) {
      if (line.startsWith("##")) {
        const branchMatch = line.match(/## ([\w-]+)/);
        if (branchMatch) status.branch = branchMatch[1];
        const aheadMatch = line.match(/ahead (\d+)/);
        if (aheadMatch) status.ahead = parseInt(aheadMatch[1], 10);
        const behindMatch = line.match(/behind (\d+)/);
        if (behindMatch) status.behind = parseInt(behindMatch[1], 10);
      } else {
        const stageIndex = line.charAt(0);
        const workingIndex = line.charAt(1);
        const filePath = line.slice(3);

        if (stageIndex === "U" || workingIndex === "U" || (stageIndex === "D" && workingIndex === "D")) {
          status.conflicted.push(filePath);
        } else if (stageIndex === "?" && workingIndex === "?") {
          status.untracked.push(filePath);
        } else if (stageIndex !== " ") {
          status.staged.push(filePath);
        } else if (workingIndex !== " ") {
          status.modified.push(filePath);
        }
      }
    }

    return status;
  } catch {
    return null;
  }
}

/**
 * Get git commit history.
 */
async function getGitLog(workspaceId: string, limit: number = 20): Promise<GitLog[]> {
  try {
    if (!(await ensureGitRepo(workspaceId))) return [];

    const format = "%H%n%an%n%ai%n%s%n---END---";
    const result = await runTerminalCommand("default", `git log --format='${format}' -${limit}`, { workspaceId });
    if (result.exitCode !== 0) return [];

    const entries: GitLog[] = [];
    const blocks = result.stdout.split("---END---").filter((b) => b.trim());

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length >= 4) {
        entries.push({
          hash: lines[0],
          author: lines[1],
          date: lines[2],
          message: lines[3],
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Stage files for commit.
 */
async function stageFiles(workspaceId: string, files: string[]): Promise<boolean> {
  if (!files.length) return false;
  try {
    const escapedFiles = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(" ");
    const result = await runTerminalCommand("default", `git add ${escapedFiles}`, { workspaceId });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Unstage files.
 */
async function unstageFiles(workspaceId: string, files: string[]): Promise<boolean> {
  if (!files.length) return false;
  try {
    const escapedFiles = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(" ");
    const result = await runTerminalCommand("default", `git reset HEAD ${escapedFiles}`, { workspaceId });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * GET /git/status - Get current git status.
 */
router.get("/git/status", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";

  try {
    const status = await getGitStatus(workspaceId);
    if (!status) {
      res.status(400).json({ error: "Git repository not found or failed to read status" });
      return;
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get git status" });
  }
});

/**
 * GET /git/log - Get commit history.
 */
router.get("/git/log", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  try {
    const log = await getGitLog(workspaceId, limit);
    res.json({ commits: log });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get git log" });
  }
});

/**
 * POST /git/stage - Stage files.
 */
router.post("/git/stage", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const files: string[] = Array.isArray(req.body?.files)
    ? req.body.files.filter((f: unknown): f is string => typeof f === "string")
    : [];
  const stageAll = req.body?.all === true;

  try {
    let success = false;
    if (stageAll) {
      const result = await runTerminalCommand("default", "git add -A", { workspaceId });
      success = result.exitCode === 0;
    } else {
      success = await stageFiles(workspaceId, files);
    }

    if (!success) {
      res.status(400).json({ error: "Failed to stage files" });
      return;
    }

    const status = await getGitStatus(workspaceId);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to stage files" });
  }
});

/**
 * POST /git/unstage - Unstage files.
 */
router.post("/git/unstage", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const files: string[] = Array.isArray(req.body?.files)
    ? req.body.files.filter((f: unknown): f is string => typeof f === "string")
    : [];

  try {
    const success = await unstageFiles(workspaceId, files);
    if (!success) {
      res.status(400).json({ error: "Failed to unstage files" });
      return;
    }

    const status = await getGitStatus(workspaceId);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to unstage files" });
  }
});

/**
 * POST /git/commit - Create a commit.
 */
router.post("/git/commit", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 500) : "";

  if (!message.trim()) {
    res.status(400).json({ error: "Commit message is required" });
    return;
  }

  try {
    const escapedMessage = message.replace(/'/g, "'\\''");
    const result = await runTerminalCommand("default", `git commit -m '${escapedMessage}'`, { workspaceId });

    if (result.exitCode !== 0) {
      res.status(400).json({ error: result.stderr || "Commit failed" });
      return;
    }

    const status = await getGitStatus(workspaceId);
    const log = await getGitLog(workspaceId, 1);

    res.json({
      ok: true,
      message,
      commit: log[0] || null,
      status,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Commit failed" });
  }
});

/**
 * POST /git/discard - Discard changes in files.
 */
router.post("/git/discard", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const files: string[] = Array.isArray(req.body?.files)
    ? req.body.files.filter((f: unknown): f is string => typeof f === "string")
    : [];

  if (!files.length) {
    res.status(400).json({ error: "No files specified" });
    return;
  }

  try {
    const escapedFiles = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(" ");
    const result = await runTerminalCommand("default", `git checkout -- ${escapedFiles}`, { workspaceId });

    if (result.exitCode !== 0) {
      res.status(400).json({ error: "Failed to discard changes" });
      return;
    }

    const status = await getGitStatus(workspaceId);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to discard changes" });
  }
});

/**
 * GET /git/diff - Get diff for a file.
 */
router.get("/git/diff", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";
  const file = typeof req.query.file === "string" ? req.query.file : "";

  if (!file) {
    res.status(400).json({ error: "File path is required" });
    return;
  }

  try {
    const escapedFile = `'${file.replace(/'/g, "'\\''")}'`;
    const result = await runTerminalCommand("default", `git diff ${escapedFile}`, { workspaceId, maxOutput: 100000 });

    res.json({
      file,
      diff: result.stdout,
      exitCode: result.exitCode,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get diff" });
  }
});

/**
 * POST /git/branch - Create or switch branches.
 */
router.post("/git/branch", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const branchName = typeof req.body?.branch === "string" ? req.body.branch.slice(0, 100) : "";
  const action = req.body?.action === "create" ? "create" : "switch";

  if (!branchName.trim() || !/^[a-zA-Z0-9._\-/]+$/.test(branchName)) {
    res.status(400).json({ error: "Invalid branch name" });
    return;
  }

  try {
    const cmd = action === "create" ? `git checkout -b ${branchName}` : `git checkout ${branchName}`;
    const result = await runTerminalCommand("default", cmd, { workspaceId });

    if (result.exitCode !== 0) {
      res.status(400).json({ error: result.stderr || `Failed to ${action} branch` });
      return;
    }

    const status = await getGitStatus(workspaceId);
    res.json({ ok: true, branch: branchName, action, status });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : `Failed to ${action} branch` });
  }
});

/**
 * GET /git/branches - List all branches.
 */
router.get("/git/branches", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";

  try {
    if (!(await ensureGitRepo(workspaceId))) {
      res.json({ branches: [], current: null });
      return;
    }

    const result = await runTerminalCommand("default", "git branch --list", { workspaceId });
    if (result.exitCode !== 0) {
      res.json({ branches: [], current: null });
      return;
    }

    const branches: string[] = [];
    let current = null;

    for (const line of result.stdout.split("\n")) {
      if (!line.trim()) continue;
      if (line.startsWith("*")) {
        current = line.slice(2).trim();
        branches.push(current);
      } else {
        branches.push(line.trim());
      }
    }

    res.json({ branches, current });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list branches" });
  }
});

export default router;
export { getGitStatus, getGitLog, stageFiles, unstageFiles, ensureGitRepo };
