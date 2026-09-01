/**
 * Git Tools — Git operations as universal tools for agent integration
 * Part of Phase 30: Advanced Agent Capabilities (Cursor Agent Parity)
 */

import { registerTool, ToolExecutionContext, UniversalToolResult } from "./tool-registry";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  subject: string;
  body?: string;
}

export interface GitDiff {
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed" | "copied";
    oldPath?: string;
    additions: number;
    deletions: number;
    diff: string;
  }>;
  summary: string;
}

export interface GitBlameLine {
  line: number;
  commit: string;
  author: string;
  authorEmail: string;
  date: string;
  content: string;
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  branch: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
  lastCommit: GitCommit;
}

export interface GitRemote {
  name: string;
  url: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitConfig {
  projectRoot: string;
  projectId: string;
  maxLogEntries?: number;
  maxDiffLines?: number;
}

// ============================================================================
// Git Tools Manager
// ============================================================================

export class GitTools {
  private config: GitConfig;

  constructor(config: GitConfig) {
    this.config = {
      maxLogEntries: 100,
      maxDiffLines: 5000,
      ...config,
    };
  }

  private runGit(args: string[], cwd?: string): string {
    const workingDir = cwd || this.config.projectRoot;
    try {
      return execSync(`git ${args.join(" ")}`, {
        cwd: workingDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      }).trim();
    } catch (error: any) {
      const stderr = error.stderr?.toString() || "";
      const stdout = error.stdout?.toString() || "";
      throw new Error(`Git command failed: ${args.join(" ")}\n${stderr}\n${stdout}`);
    }
  }

  // ============================================================================
  // Repository Info
  // ============================================================================

  isGitRepo(cwd?: string): boolean {
    try {
      this.runGit(["rev-parse", "--git-dir"], cwd);
      return true;
    } catch {
      return false;
    }
  }

  getRootDir(cwd?: string): string {
    return this.runGit(["rev-parse", "--show-toplevel"], cwd);
  }

  // ============================================================================
  // Log & History
  // ============================================================================

  getLog(options: {
    limit?: number;
    since?: string;
    until?: string;
    author?: string;
    path?: string;
    oneline?: boolean;
    all?: boolean;
  } = {}): GitCommit[] {
    const args = ["log", "--pretty=format:%H|%h|%an|%ae|%ad|%s|%b", "--date=iso"];

    if (options.limit) args.push(`-${options.limit}`);
    if (options.since) args.push(`--since="${options.since}"`);
    if (options.until) args.push(`--until="${options.until}"`);
    if (options.author) args.push(`--author="${options.author}"`);
    if (options.path) args.push("--", options.path);
    if (options.all) args.push("--all");

    const output = this.runGit(args);
    if (!output) return [];

    return output.split("\n").map(line => {
      const [hash, shortHash, author, authorEmail, date, subject, body] = line.split("|");
      return {
        hash,
        shortHash,
        author,
        authorEmail,
        date,
        message: body ? `${subject}\n\n${body}` : subject,
        subject,
        body: body || undefined,
      };
    });
  }

  getCommit(hash: string): GitCommit | null {
    const args = ["show", "--pretty=format:%H|%h|%an|%ae|%ad|%s|%b", "--date=iso", "--no-patch", hash];
    const output = this.runGit(args);
    if (!output) return null;

    const [fullHash, shortHash, author, authorEmail, date, subject, body] = output.split("|");
    return {
      hash: fullHash,
      shortHash,
      author,
      authorEmail,
      date,
      message: body ? `${subject}\n\n${body}` : subject,
      subject,
      body: body || undefined,
    };
  }

  // ============================================================================
  // Diff
  // ============================================================================

  getDiff(options: {
    staged?: boolean;
    cached?: boolean;
    nameOnly?: boolean;
    statOnly?: boolean;
    paths?: string[];
    base?: string; // compare against branch/commit
  } = {}): GitDiff {
    const args = ["diff"];

    if (options.staged || options.cached) args.push("--cached");
    if (options.nameOnly) args.push("--name-only");
    if (options.statOnly) args.push("--stat");
    if (options.base) args.push(options.base);

    if (options.paths && options.paths.length > 0) {
      args.push("--", ...options.paths);
    }

    let output = this.runGit(args);

    if (options.nameOnly) {
      const files = output.split("\n").filter(f => f).map(path => ({
        path,
        status: "modified" as const,
        additions: 0,
        deletions: 0,
        diff: "",
      }));
      return { files, summary: `${files.length} files changed` };
    }

    if (options.statOnly) {
      return { files: [], summary: output };
    }

    // Parse full diff
    const files = this.parseDiff(output);
    const additions = files.reduce((sum, f) => sum + f.additions, 0);
    const deletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      files,
      summary: `${files.length} files changed, ${additions} additions(+), ${deletions} deletions(-)`,
    };
  }

  private parseDiff(diff: string): GitDiff["files"] {
    const files: GitDiff["files"] = [];
    const fileDiffs = diff.split(/^diff --git /m).slice(1);

    for (const fileDiff of fileDiffs) {
      const lines = fileDiff.split("\n");
      const headerLine = lines[0];
      const pathMatch = headerLine.match(/a\/(.+?)\s+b\/(.+)/);
      if (!pathMatch) continue;

      const oldPath = pathMatch[1];
      const newPath = pathMatch[2];
      const isRename = oldPath !== newPath;

      let additions = 0;
      let deletions = 0;
      let status: GitDiff["files"][0]["status"] = "modified";

      // Check for new/deleted file
      const newFileMatch = fileDiff.match(/^new file mode/);
      const deletedFileMatch = fileDiff.match(/^deleted file mode/);
      if (newFileMatch) status = "added";
      else if (deletedFileMatch) status = "deleted";
      else if (isRename) status = "renamed";

      // Count additions/deletions
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }

      files.push({
        path: newPath,
        oldPath: isRename ? oldPath : undefined,
        status,
        additions,
        deletions,
        diff: fileDiff.substring(0, this.config.maxDiffLines),
      });
    }

    return files;
  }

  // ============================================================================
  // Blame
  // ============================================================================

  getBlame(file: string, options: { startLine?: number; endLine?: number } = {}): GitBlameLine[] {
    const args = ["blame", "--line-porcelain", file];

    if (options.startLine && options.endLine) {
      args.push(`-L${options.startLine},${options.endLine}`);
    } else if (options.startLine) {
      args.push(`-L${options.startLine},+${options.endLine || 50}`);
    }

    const output = this.runGit(args);
    return this.parseBlame(output);
  }

  private parseBlame(output: string): GitBlameLine[] {
    const lines: GitBlameLine[] = [];
    const entries = output.split("\n\n").filter(e => e.trim());

    for (const entry of entries) {
      const entryLines = entry.split("\n");
      const header = entryLines[0].split(" ");
      const commit = header[0];
      const lineNum = parseInt(header[1], 10);
      const content = entryLines[entryLines.length - 1];

      let author = "";
      let authorEmail = "";
      let date = "";

      for (const line of entryLines) {
        if (line.startsWith("author ")) author = line.substring(7);
        else if (line.startsWith("author-mail ")) authorEmail = line.substring(12).replace(/[<>]/g, "");
        else if (line.startsWith("author-time ")) date = new Date(parseInt(line.substring(12), 10) * 1000).toISOString();
      }

      lines.push({ line: lineNum, commit, author, authorEmail, date, content });
    }

    return lines.sort((a, b) => a.line - b.line);
  }

  // ============================================================================
  // Status
  // ============================================================================

  getStatus(): GitStatus {
    const output = this.runGit(["status", "--porcelain=v1", "--branch"]);
    const lines = output.split("\n");

    const status: GitStatus = {
      staged: [],
      unstaged: [],
      untracked: [],
      ahead: 0,
      behind: 0,
      branch: "",
    };

    for (const line of lines) {
      if (line.startsWith("## ")) {
        // Branch info
        const branchLine = line.substring(3);
        const match = branchLine.match(/^(\S+)(?:\.\.\.(\S+))?(?: \[ahead (\d+), behind (\d+)\])?/);
        if (match) {
          status.branch = match[1];
          status.ahead = parseInt(match[3] || "0", 10);
          status.behind = parseInt(match[4] || "0", 10);
        }
      } else if (line.startsWith("??")) {
        status.untracked.push(line.substring(3));
      } else {
        const statusCode = line.substring(0, 2);
        const filePath = line.substring(3);
        if (statusCode[0] !== " " && statusCode[0] !== "?") {
          status.staged.push(filePath);
        }
        if (statusCode[1] !== " ") {
          status.unstaged.push(filePath);
        }
      }
    }

    return status;
  }

  // ============================================================================
  // Branches
  // ============================================================================

  getBranches(options: { all?: boolean; remote?: boolean } = {}): GitBranch[] {
    const args = ["branch", "-v"];
    if (options.all) args.push("-a");
    if (options.remote) args.push("-r");

    const output = this.runGit(args);
    const lines = output.split("\n").filter(l => l.trim());

    return lines.map(line => {
      const current = line.startsWith("* ");
      const cleanLine = current ? line.substring(2) : line.trim();
      const parts = cleanLine.split(/\s+/);
      const name = parts[0];
      const commitHash = parts[1];
      const remote = parts[2]?.replace(/[\[\]]/g, "");

      const commit = this.getCommit(commitHash);
      return {
        name,
        current,
        remote,
        lastCommit: commit || {
          hash: commitHash,
          shortHash: commitHash.substring(0, 7),
          author: "",
          authorEmail: "",
          date: "",
          message: "",
          subject: "",
        },
      };
    });
  }

  getCurrentBranch(): string {
    return this.runGit(["branch", "--show-current"]);
  }

  // ============================================================================
  // Remotes
  // ============================================================================

  getRemotes(): GitRemote[] {
    const output = this.runGit(["remote", "-v"]);
    const lines = output.split("\n").filter(l => l.trim());

    const remotes: Map<string, GitRemote> = new Map();

    for (const line of lines) {
      const [name, url, type] = line.split(/\s+/);
      if (!remotes.has(name)) {
        remotes.set(name, { name, url, fetchUrl: "", pushUrl: "" });
      }
      const remote = remotes.get(name)!;
      if (type === "(fetch)") remote.fetchUrl = url;
      if (type === "(push)") remote.pushUrl = url;
    }

    return Array.from(remotes.values());
  }

  // ============================================================================
  // Commit Operations
  // ============================================================================

  commit(message: string, options: { all?: boolean; amend?: boolean; noVerify?: boolean } = {}): string {
    const args = ["commit"];

    if (options.all) args.push("-a");
    if (options.amend) args.push("--amend", "--no-edit");
    if (options.noVerify) args.push("--no-verify");
    args.push("-m", message);

    this.runGit(args);
    return this.runGit(["rev-parse", "HEAD"]);
  }

  stage(paths: string[]): void {
    this.runGit(["add", ...paths]);
  }

  unstage(paths: string[]): void {
    this.runGit(["reset", "HEAD", "--", ...paths]);
  }

  // ============================================================================
  // Push/Pull/Fetch
  // ============================================================================

  push(options: { remote?: string; branch?: string; force?: boolean; tags?: boolean } = {}): string {
    const args = ["push"];
    if (options.force) args.push("--force-with-lease");
    if (options.tags) args.push("--tags");
    if (options.remote) args.push(options.remote);
    if (options.branch) args.push(options.branch);
    return this.runGit(args);
  }

  pull(options: { remote?: string; branch?: string; rebase?: boolean } = {}): string {
    const args = ["pull"];
    if (options.rebase) args.push("--rebase");
    if (options.remote) args.push(options.remote);
    if (options.branch) args.push(options.branch);
    return this.runGit(args);
  }

  fetch(options: { remote?: string; all?: boolean; prune?: boolean } = {}): string {
    const args = ["fetch"];
    if (options.all) args.push("--all");
    if (options.prune) args.push("--prune");
    if (options.remote) args.push(options.remote);
    return this.runGit(args);
  }

  // ============================================================================
  // Stash
  // ============================================================================

  stash(message?: string): string {
    const args = ["stash", "push"];
    if (message) args.push("-m", message);
    return this.runGit(args);
  }

  stashList(): Array<{ index: number; message: string; branch: string; commit: string }> {
    const output = this.runGit(["stash", "list", "--pretty=format:%gd|%gs|%gD|%h"]);
    return output.split("\n").filter(l => l).map((line, index) => {
      const [ref, message, branch, commit] = line.split("|");
      return { index, message, branch: branch.replace(/refs\/stash@\{(\d+)\}/, "$1"), commit };
    });
  }

  stashPop(index?: number): void {
    const args = ["stash", "pop"];
    if (index !== undefined) args.push(`stash@{${index}}`);
    this.runGit(args);
  }

  stashApply(index?: number): void {
    const args = ["stash", "apply"];
    if (index !== undefined) args.push(`stash@{${index}}`);
    this.runGit(args);
  }

  stashDrop(index?: number): void {
    const args = ["stash", "drop"];
    if (index !== undefined) args.push(`stash@{${index}}`);
    this.runGit(args);
  }

  // ============================================================================
  // Tags
  // ============================================================================

  getTags(): Array<{ name: string; commit: string; date: string; message: string }> {
    const output = this.runGit(["tag", "-l", "--format=%(refname:short)|%(objectname:short)|%(creatordate:iso)|%(contents:subject)"]);
    return output.split("\n").filter(l => l).map(line => {
      const [name, commit, date, message] = line.split("|");
      return { name, commit, date, message };
    });
  }

  createTag(name: string, message?: string, commit?: string): void {
    const args = ["tag"];
    if (message) {
      args.push("-a", name, "-m", message);
    } else {
      args.push(name);
    }
    if (commit) args.push(commit);
    this.runGit(args);
  }

  // ============================================================================
  // PR/Remote Operations (GitHub/GitLab specific)
  // ============================================================================

  getRemoteUrl(remote = "origin"): string {
    return this.runGit(["config", "--get", `remote.${remote}.url`]);
  }

  // Get PR info from commit messages (GitHub style)
  getPRInfo(): Array<{ number: number; title: string; branch: string; base: string }> {
    const output = this.runGit(["log", "--all", "--grep=Merge pull request", "--grep=Merge branch", "--pretty=format:%s|%H|%b", "-20"]);
    const prs: Array<{ number: number; title: string; branch: string; base: string }> = [];

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [subject, hash, body] = line.split("|");
      // Match "Merge pull request #123 from branch-name"
      const match = subject.match(/Merge pull request #(\d+) from (.+)/);
      if (match) {
        prs.push({
          number: parseInt(match[1], 10),
          title: body?.split("\n")[0] || subject,
          branch: match[2],
          base: "main", // default
        });
      }
    }

    return prs;
  }

  // ============================================================================
  // Conflict Resolution
  // ============================================================================

  getConflicts(): string[] {
    const status = this.getStatus();
    return status.unstaged.filter(f => {
      try {
        const content = fs.readFileSync(path.join(this.config.projectRoot, f), "utf-8");
        return content.includes("<<<<<<<") && content.includes(">>>>>>>");
      } catch {
        return false;
      }
    });
  }

  // ============================================================================
  // Stats & Analysis
  // ============================================================================

  getStats(options: { since?: string; author?: string } = {}): { files: number; insertions: number; deletions: number; commits: number } {
    const args = ["shortlog", "-sn", "--all"];
    if (options.since) args.push(`--since="${options.since}"`);
    if (options.author) args.push(`--author="${options.author}"`);

    const output = this.runGit(args);
    const commits = output.split("\n").filter(l => l).length;

    const statArgs = ["log", "--shortstat", "--pretty=format:"];
    if (options.since) statArgs.push(`--since="${options.since}"`);
    if (options.author) statArgs.push(`--author="${options.author}"`);

    const statOutput = this.runGit(statArgs);
    let insertions = 0;
    let deletions = 0;
    let files = 0;

    for (const line of statOutput.split("\n")) {
      const fileMatch = line.match(/(\d+) files? changed/);
      const insMatch = line.match(/(\d+) insertions?/);
      const delMatch = line.match(/(\d+) deletions?/);

      if (fileMatch) files += parseInt(fileMatch[1], 10);
      if (insMatch) insertions += parseInt(insMatch[1], 10);
      if (delMatch) deletions += parseInt(delMatch[1], 10);
    }

    return { files, insertions, deletions, commits };
  }

  // ============================================================================
  // Worktree
  // ============================================================================

  listWorktrees(): Array<{ path: string; branch: string; commit: string; bare: boolean }> {
    const output = this.runGit(["worktree", "list", "--porcelain"]);
    const worktrees: Array<{ path: string; branch: string; commit: string; bare: boolean }> = [];
    let current: Partial<{ path: string; branch: string; commit: string; bare: boolean }> = {};

    for (const line of output.split("\n")) {
      if (!line.trim()) {
        if (current.path) worktrees.push(current as any);
        current = {};
        continue;
      }
      if (line.startsWith("worktree ")) current.path = line.substring(9);
      else if (line.startsWith("branch ")) current.branch = line.substring(7);
      else if (line.startsWith("HEAD ")) current.commit = line.substring(5);
      else if (line === "bare") current.bare = true;
    }
    if (current.path) worktrees.push(current as any);

    return worktrees;
  }

  createWorktree(path: string, branch: string): void {
    this.runGit(["worktree", "add", path, branch]);
  }

  removeWorktree(path: string): void {
    this.runGit(["worktree", "remove", path]);
  }
}

// ============================================================================
// Register Git Tools in Universal Tool Registry
// ============================================================================

export function registerGitTools(projectRoot: string, projectId: string): void {
  const gitTools = new GitTools({ projectRoot, projectId });

  // Git log
  registerTool({
    name: "git.log",
    description: "Get git commit history",
    category: "git",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max commits to return", default: 20 },
        since: { type: "string", description: "Show commits since date (ISO)" },
        until: { type: "string", description: "Show commits until date (ISO)" },
        author: { type: "string", description: "Filter by author" },
        path: { type: "string", description: "Filter by file path" },
        oneline: { type: "boolean", description: "One line per commit" },
        all: { type: "boolean", description: "Show all branches" },
      },
    },
    execute: async (args, ctx) => {
      const commits = gitTools.getLog(args);
      return { success: true, data: commits, summary: `${commits.length} commits` };
    },
  });

  // Git show commit
  registerTool({
    name: "git.show",
    description: "Show a specific commit",
    category: "git",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        hash: { type: "string", description: "Commit hash" },
      },
      required: ["hash"],
    },
    execute: async (args, ctx) => {
      const commit = gitTools.getCommit(args.hash as string);
      return commit
        ? { success: true, data: commit, summary: `Commit ${commit.shortHash}: ${commit.subject}` }
        : { success: false, error: "Commit not found" };
    },
  });

  // Git diff
  registerTool({
    name: "git.diff",
    description: "Get git diff",
    category: "git",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes" },
        cached: { type: "boolean", description: "Same as staged" },
        nameOnly: { type: "boolean", description: "Only show file names" },
        statOnly: { type: "boolean", description: "Only show stats" },
        paths: { type: "array", items: { type: "string" }, description: "Specific paths" },
        base: { type: "string", description: "Compare against branch/commit" },
      },
    },
    execute: async (args, ctx) => {
      const diff = gitTools.getDiff(args);
      return { success: true, data: diff, summary: diff.summary };
    },
  });

  // Git blame
  registerTool({
    name: "git.blame",
    description: "Get git blame for a file",
    category: "git",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path" },
        startLine: { type: "number", description: "Start line" },
        endLine: { type: "number", description: "End line" },
      },
      required: ["file"],
    },
    execute: async (args, ctx) => {
      const blame = gitTools.getBlame(args.file as string, {
        startLine: args.startLine as number,
        endLine: args.endLine as number,
      });
      return { success: true, data: blame, summary: `${blame.length} lines` };
    },
  });

  // Git status
  registerTool({
    name: "git.status",
    description: "Get git status",
    category: "git",
    risk: "READ",
    execute: async (args, ctx) => {
      const status = gitTools.getStatus();
      return {
        success: true,
        data: status,
        summary: `Branch: ${status.branch} (ahead ${status.ahead}, behind ${status.behind}), Staged: ${status.staged.length}, Unstaged: ${status.unstaged.length}, Untracked: ${status.untracked.length}`,
      };
    },
  });

  // Git branches
  registerTool({
    name: "git.branches",
    description: "List git branches",
    category: "git",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        all: { type: "boolean", description: "Show all branches (including remote)" },
        remote: { type: "boolean", description: "Show only remote branches" },
      },
    },
    execute: async (args, ctx) => {
      const branches = gitTools.getBranches(args);
      return { success: true, data: branches, summary: `${branches.length} branches` };
    },
  });

  // Git remotes
  registerTool({
    name: "git.remotes",
    description: "List git remotes",
    category: "git",
    risk: "READ",
    execute: async (args, ctx) => {
      const remotes = gitTools.getRemotes();
      return { success: true, data: remotes, summary: `${remotes.length} remotes` };
    },
  });

  // Git commit
  registerTool({
    name: "git.commit",
    description: "Create a commit",
    category: "git",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
        all: { type: "boolean", description: "Stage all modified files" },
        amend: { type: "boolean", description: "Amend previous commit" },
        noVerify: { type: "boolean", description: "Skip hooks" },
      },
      required: ["message"],
    },
    execute: async (args, ctx) => {
      const hash = gitTools.commit(args.message as string, args);
      return { success: true, data: { hash }, summary: `Committed ${hash.substring(0, 7)}` };
    },
  });

  // Git stage
  registerTool({
    name: "git.stage",
    description: "Stage files for commit",
    category: "git",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Files to stage" },
      },
      required: ["paths"],
    },
    execute: async (args, ctx) => {
      gitTools.stage(args.paths as string[]);
      return { success: true, summary: `Staged ${(args.paths as string[]).length} files` };
    },
  });

  // Git unstage
  registerTool({
    name: "git.unstage",
    description: "Unstage files",
    category: "git",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Files to unstage" },
      },
      required: ["paths"],
    },
    execute: async (args, ctx) => {
      gitTools.unstage(args.paths as string[]);
      return { success: true, summary: `Unstaged ${(args.paths as string[]).length} files` };
    },
  });

  // Git push
  registerTool({
    name: "git.push",
    description: "Push to remote",
    category: "git",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        remote: { type: "string", description: "Remote name" },
        branch: { type: "string", description: "Branch name" },
        force: { type: "boolean", description: "Force push with lease" },
        tags: { type: "boolean", description: "Push tags" },
      },
    },
    execute: async (args, ctx) => {
      const output = gitTools.push(args);
      return { success: true, data: { output }, summary: "Pushed" };
    },
  });

  // Git pull
  registerTool({
    name: "git.pull",
    description: "Pull from remote",
    category: "git",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        remote: { type: "string", description: "Remote name" },
        branch: { type: "string", description: "Branch name" },
        rebase: { type: "boolean", description: "Rebase instead of merge" },
      },
    },
    execute: async (args, ctx) => {
      const output = gitTools.pull(args);
      return { success: true, data: { output }, summary: "Pulled" };
    },
  });

  // Git fetch
  registerTool({
    name: "git.fetch",
    description: "Fetch from remote",
    category: "git",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        remote: { type: "string", description: "Remote name" },
        all: { type: "boolean", description: "Fetch all remotes" },
        prune: { type: "boolean", description: "Prune deleted branches" },
      },
    },
    execute: async (args, ctx) => {
      const output = gitTools.fetch(args);
      return { success: true, data: { output }, summary: "Fetched" };
    },
  });

  // Git stash
  registerTool({
    name: "git.stash",
    description: "Stash changes",
    category: "git",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Stash message" },
      },
    },
    execute: async (args, ctx) => {
      const output = gitTools.stash(args.message as string);
      return { success: true, data: { output }, summary: "Stashed changes" };
    },
  });

  // Git stash list
  registerTool({
    name: "git.stashList",
    description: "List stashes",
    category: "git",
    risk: "READ",
    execute: async (args, ctx) => {
      const stashes = gitTools.stashList();
      return { success: true, data: stashes, summary: `${stashes.length} stashes` };
    },
  });

  // Git stash pop
  registerTool({
    name: "git.stashPop",
    description: "Pop latest stash",
    category: "git",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        index: { type: "number", description: "Stash index" },
      },
    },
    execute: async (args, ctx) => {
      gitTools.stashPop(args.index as number);
      return { success: true, summary: "Popped stash" };
    },
  });

  // Git tags
  registerTool({
    name: "git.tags",
    description: "List tags",
    category: "git",
    risk: "READ",
    execute: async (args, ctx) => {
      const tags = gitTools.getTags();
      return { success: true, data: tags, summary: `${tags.length} tags` };
    },
  });

  // Git create tag
  registerTool({
    name: "git.createTag",
    description: "Create a tag",
    category: "git",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tag name" },
        message: { type: "string", description: "Tag message (annotated)" },
        commit: { type: "string", description: "Commit to tag" },
      },
      required: ["name"],
    },
    execute: async (args, ctx) => {
      gitTools.createTag(args.name as string, args.message as string, args.commit as string);
      return { success: true, summary: `Created tag ${args.name}` };
    },
  });

  // Git conflicts
  registerTool({
    name: "git.conflicts",
    description: "Get conflicted files",
    category: "git",
    risk: "READ",
    execute: async (args, ctx) => {
      const conflicts = gitTools.getConflicts();
      return { success: true, data: conflicts, summary: `${conflicts.length} conflicted files` };
    },
  });

  // Git stats
  registerTool({
    name: "git.stats",
    description: "Get repository statistics",
    category: "git",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        since: { type: "string", description: "Since date (ISO)" },
        author: { type: "string", description: "Filter by author" },
      },
    },
    execute: async (args, ctx) => {
      const stats = gitTools.getStats(args);
      return { success: true, data: stats, summary: `${stats.commits} commits, ${stats.insertions} insertions, ${stats.deletions} deletions across ${stats.files} files` };
    },
  });

  // Git worktrees
  registerTool({
    name: "git.worktrees",
    description: "List git worktrees",
    category: "git",
    risk: "READ",
    execute: async (args, ctx) => {
      const worktrees = gitTools.listWorktrees();
      return { success: true, data: worktrees, summary: `${worktrees.length} worktrees` };
    },
  });

  // Git create worktree
  registerTool({
    name: "git.createWorktree",
    description: "Create a git worktree",
    category: "git",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Worktree path" },
        branch: { type: "string", description: "Branch name" },
      },
      required: ["path", "branch"],
    },
    execute: async (args, ctx) => {
      gitTools.createWorktree(args.path as string, args.branch as string);
      return { success: true, summary: `Created worktree at ${args.path} for branch ${args.branch}` };
    },
  });
}

export { GitTools };
export type { GitCommit, GitDiff, GitBlameLine, GitStatus, GitBranch, GitRemote, GitConfig };