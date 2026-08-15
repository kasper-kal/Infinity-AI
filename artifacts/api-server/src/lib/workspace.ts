import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Jarvis Build workspace primitives.
 *
 * Every project gets a separate directory below WORKSPACE_ROOT/projects. The
 * legacy default workspace remains available for existing Jarvis callers.
 * Commands are capped and run with a deliberately small environment so API
 * credentials are not accidentally exposed by `env` in the terminal.
 */

export const WORKSPACE_ROOT = path.resolve(
  __dirname, "..", "..", "..", "..", "artifacts", "workspace",
);
export const WORKSPACE_URL = "/api/jarvis/workspace";

const PROJECT_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SESSIONS = new Map<string, string>();
const RUNNING = new Map<string, InteractiveTerminal>();
const MAX_COMMAND_LENGTH = 12_000;

export interface WorkspaceEntry { path: string; name: string; type: "file" | "dir"; size: number; }

export interface TerminalRun {
  stdout: string;
  stderr: string;
  cwd: string;
  exitCode: number;
  timedOut: boolean;
}

export interface InteractiveTerminal {
  id: string;
  workspaceId: string;
  sessionId: string;
  child: ChildProcess;
  cwd: string;
  output: string;
  startedAt: number;
  listeners: Set<(event: TerminalEvent) => void>;
  done: boolean;
  exitCode: number | null;
}

export interface TerminalEvent {
  type: "output" | "exit";
  stream?: "stdout" | "stderr";
  data?: string;
  exitCode?: number;
  cwd?: string;
}

const SAFE_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR",
  "NODE_PATH", "NPM_CONFIG_USERCONFIG", "PNPM_HOME", "HOSTNAME",
]);

function workspaceKey(workspaceId: string): string {
  const value = workspaceId || "default";
  if (!PROJECT_ID.test(value)) throw new Error("Invalid workspace id");
  return value;
}

function sessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceKey(workspaceId)}:${sessionId || "default"}`;
}

export function getWorkspaceRoot(workspaceId = "default"): string {
  const id = workspaceKey(workspaceId);
  return id === "default" ? WORKSPACE_ROOT : path.join(WORKSPACE_ROOT, "projects", id);
}

/** Safely resolve a workspace-relative path to an absolute path inside the root. */
export function safeWorkspacePath(relPath: string, workspaceId = "default"): string | null {
  const root = getWorkspaceRoot(workspaceId);
  const target = path.resolve(root, relPath);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

function resolveWorkspacePath(workspaceId: string, relPath: string): string | null {
  const root = getWorkspaceRoot(workspaceId);
  const target = path.resolve(root, relPath || ".");
  return target === root || target.startsWith(`${root}${path.sep}`) ? target : null;
}

function safeShellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getWorkspaceCommandEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.HOME = env.HOME || getWorkspaceRoot();
  env.TMPDIR = env.TMPDIR || path.join(getWorkspaceRoot(), ".tmp");
  return { ...env, ...extra };
}

/** Ensure a project workspace exists. */
export async function ensureWorkspace(workspaceId = "default"): Promise<string> {
  const root = getWorkspaceRoot(workspaceId);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, ".tmp"), { recursive: true });
  return root;
}

export function getSessionCwd(sessionId: string, workspaceId = "default"): string {
  return SESSIONS.get(sessionKey(workspaceId, sessionId)) ?? getWorkspaceRoot(workspaceId);
}

export async function resetSession(sessionId: string, workspaceId = "default"): Promise<void> {
  SESSIONS.delete(sessionKey(workspaceId, sessionId));
  await ensureWorkspace(workspaceId);
}

/** Run one capped command and preserve its working directory between calls. */
export function runTerminalCommand(
  sessionId: string,
  command: string,
  opts: { timeoutMs?: number; maxOutput?: number; workspaceId?: string; env?: Record<string, string> } = {},
): Promise<TerminalRun> {
  return new Promise((resolve) => {
    const workspaceId = opts.workspaceId ?? "default";
    const timeoutMs = Math.min(opts.timeoutMs ?? 15_000, 30_000);
    const maxOutput = Math.min(opts.maxOutput ?? 30_000, 100_000);
    const cwd = getSessionCwd(sessionId, workspaceId);
    const boundedCommand = command.slice(0, MAX_COMMAND_LENGTH);
    const script = `cd ${safeShellEscape(cwd)}; ${boundedCommand}; printf '\\n__CWD__=%s\\n' "$PWD"`;
    const child = execFile(
      "/bin/bash",
      ["-lc", script],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutput * 2,
        killSignal: "SIGKILL",
        env: getWorkspaceCommandEnvironment(opts.env),
      },
      (err, stdout, stderr) => {
        let out = stdout ?? "";
        const marker = out.match(/\n__CWD__=(.+)\n?$/);
        const newCwd = marker?.[1]?.trim();
        if (marker?.index !== undefined) out = out.slice(0, marker.index);
        const root = getWorkspaceRoot(workspaceId);
        if (newCwd && path.isAbsolute(newCwd) && (newCwd === root || newCwd.startsWith(`${root}${path.sep}`))) {
          SESSIONS.set(sessionKey(workspaceId, sessionId), newCwd);
        }
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: number | string }).code : 0;
        resolve({
          stdout: out.slice(-maxOutput),
          stderr: (stderr ?? "").slice(-maxOutput),
          cwd: SESSIONS.get(sessionKey(workspaceId, sessionId)) ?? root,
          exitCode: err ? (typeof code === "number" ? code : 1) : 0,
          timedOut: (err as { killed?: boolean } | null)?.killed === true,
        });
      },
    );
  });
}

/** Start a command that can be observed and stopped by the terminal UI. */
export async function startInteractiveTerminal(
  sessionId: string,
  command: string,
  opts: { workspaceId?: string; env?: Record<string, string> } = {},
): Promise<InteractiveTerminal> {
  const workspaceId = opts.workspaceId ?? "default";
  await ensureWorkspace(workspaceId);
  const key = sessionKey(workspaceId, sessionId);
  const existing = RUNNING.get(key);
  if (existing) stopInteractiveTerminal(existing.id);
  const cwd = getSessionCwd(sessionId, workspaceId);
  const id = randomUUID();
  const child = spawn("/bin/bash", ["-lc", command.slice(0, MAX_COMMAND_LENGTH)], {
    cwd,
    env: getWorkspaceCommandEnvironment(opts.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const terminal: InteractiveTerminal = {
    id, workspaceId, sessionId, child, cwd, output: "", startedAt: Date.now(),
    listeners: new Set(), done: false, exitCode: null,
  };
  RUNNING.set(key, terminal);
  const emit = (event: TerminalEvent) => {
    if (event.data) terminal.output = `${terminal.output}${event.data}`.slice(-100_000);
    for (const listener of terminal.listeners) listener(event);
  };
  child.stdout?.on("data", (chunk: Buffer) => emit({ type: "output", stream: "stdout", data: chunk.toString() }));
  child.stderr?.on("data", (chunk: Buffer) => emit({ type: "output", stream: "stderr", data: chunk.toString() }));
  child.on("exit", (code) => {
    terminal.done = true;
    terminal.exitCode = typeof code === "number" ? code : 1;
    SESSIONS.set(key, cwd);
    emit({ type: "exit", exitCode: terminal.exitCode, cwd });
    // Keep the completed session briefly so a fast command can still be
    // connected to by the SSE endpoint after the start response returns.
    setTimeout(() => { if (RUNNING.get(key)?.id === id) RUNNING.delete(key); }, 60_000);
  });
  return terminal;
}

export function findInteractiveTerminal(id: string): InteractiveTerminal | undefined {
  return [...RUNNING.values()].find((terminal) => terminal.id === id);
}

export function subscribeInteractiveTerminal(terminal: InteractiveTerminal, listener: (event: TerminalEvent) => void): () => void {
  terminal.listeners.add(listener);
  return () => terminal.listeners.delete(listener);
}

export function stopInteractiveTerminal(id: string): boolean {
  const terminal = findInteractiveTerminal(id);
  if (!terminal) return false;
  terminal.child.kill("SIGTERM");
  setTimeout(() => { if (!terminal.done) terminal.child.kill("SIGKILL"); }, 1500);
  return true;
}

/** List files under one project workspace, excluding generated internals. */
export async function listWorkspaceFiles(workspaceId = "default"): Promise<WorkspaceEntry[]> {
  const root = await ensureWorkspace(workspaceId);
  const out: WorkspaceEntry[] = [];
  async function walk(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".tmp") continue;
      const full = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push({ path: `${nextRel}/`, name: entry.name, type: "dir", size: 0 });
        await walk(full, nextRel);
      } else {
        const stat = await fs.stat(full);
        out.push({ path: nextRel, name: entry.name, type: "file", size: stat.size });
      }
      if (out.length >= 1_000) return;
    }
  }
  await walk(root, "");
  return out.slice(0, 1_000);
}

export async function readWorkspaceFile(relPath: string, maxChars = 100_000, workspaceId = "default"):
  Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const target = resolveWorkspacePath(workspaceId, relPath);
  if (!target || target === getWorkspaceRoot(workspaceId)) return { ok: false, error: "Path escapes the workspace." };
  try {
    const content = await fs.readFile(target, "utf8");
    return { ok: true, content: content.slice(0, maxChars) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Read failed." };
  }
}

/** Convenience wrapper: read a workspace file as text, returning "" when unreadable. */
export async function readWorkspaceFileText(relPath: string, workspaceId = "default"): Promise<string> {
  const result = await readWorkspaceFile(relPath, 100_000, workspaceId);
  return result.ok ? result.content : "";
}

export async function writeWorkspaceFile(relPath: string, content: string, workspaceId = "default"):
  Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const target = resolveWorkspacePath(workspaceId, relPath);
  if (!target || target === getWorkspaceRoot(workspaceId)) return { ok: false, error: "Path escapes the workspace." };
  if (content.length > 2_000_000) return { ok: false, error: "File is too large." };
  try {
    await ensureWorkspace(workspaceId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    return { ok: true, path: relPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Write failed." };
  }
}

export async function createWorkspaceDirectory(relPath: string, workspaceId = "default") {
  const target = resolveWorkspacePath(workspaceId, relPath);
  if (!target || target === getWorkspaceRoot(workspaceId)) return { ok: false as const, error: "Path escapes the workspace." };
  await fs.mkdir(target, { recursive: true });
  return { ok: true as const, path: relPath.replace(/\/+$/, "") + "/" };
}

export async function renameWorkspacePath(from: string, to: string, workspaceId = "default") {
  const source = resolveWorkspacePath(workspaceId, from);
  const target = resolveWorkspacePath(workspaceId, to);
  if (!source || !target || source === getWorkspaceRoot(workspaceId) || target === getWorkspaceRoot(workspaceId)) {
    return { ok: false as const, error: "Path escapes the workspace." };
  }
  await fs.rename(source, target);
  return { ok: true as const, path: to };
}

export async function deleteWorkspacePath(relPath: string, workspaceId = "default") {
  const target = resolveWorkspacePath(workspaceId, relPath);
  if (!target || target === getWorkspaceRoot(workspaceId)) return { ok: false as const, error: "Cannot delete workspace root." };
  await fs.rm(target, { recursive: true, force: false });
  return { ok: true as const };
}

/**
 * Phase 1.1 — Git Worktree Isolation.
 *
 * Each build project gets its own isolated git repository under
 * WORKSPACE_ROOT/worktrees/<project-id> so a build can be committed per
 * iteration and rolled back instantly without touching the host repo or any
 * other project. node_modules is symlinked to the global pnpm store so builds
 * resolve dependencies without a fresh install (0-euro, reuses on-disk deps).
 */
const WORKTREES_ROOT = path.resolve(WORKSPACE_ROOT, "worktrees");

export interface IsolatedWorkspace {
  projectId: string;
  worktreePath: string;
  branch: string;
  cleanup: () => Promise<void>;
}

/** Run a git command inside a worktree, capturing stdout/stderr. */
function runGit(worktreePath: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: worktreePath, env: getWorkspaceCommandEnvironment() });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => resolve({ ok: code === 0, stdout, stderr }));
    child.on("error", () => resolve({ ok: false, stdout, stderr }));
  });
}

/** True when a project already has an isolated worktree repo. */
export function hasIsolated(projectId: string): boolean {
  const id = workspaceKey(projectId);
  return fsSync.existsSync(path.join(WORKTREES_ROOT, id, ".git"));
}

export function isolatedPath(projectId: string): string {
  return path.join(WORKTREES_ROOT, workspaceKey(projectId));
}

/**
 * Create (or reconnect to) an isolated git worktree for a build project.
 * Returns the worktree path, its branch, and a cleanup fn that removes it.
 */
export async function createIsolated(projectId: string): Promise<IsolatedWorkspace> {
  const id = workspaceKey(projectId);
  const branch = `infinity/build/${id}`;
  const worktreePath = isolatedPath(id);
  await fs.mkdir(worktreePath, { recursive: true });

  if (!hasIsolated(id)) {
    // Fresh standalone repo with an initial empty commit so reset/rollback work.
    await runGit(worktreePath, ["init", "-q"]);
    await runGit(worktreePath, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
    await fs.writeFile(path.join(worktreePath, ".infinity"), `# Infinity build workspace for ${id}\n`);
    await runGit(worktreePath, ["add", "."]);
    await runGit(worktreePath, ["commit", "-q", "-m", "infinity: init workspace"]);
  } else {
    // Switch to (or create) the project branch.
    const { stdout } = await runGit(worktreePath, ["rev-parse", "--verify", branch]);
    if (stdout.trim()) {
      await runGit(worktreePath, ["checkout", "-q", branch]);
    } else {
      await runGit(worktreePath, ["checkout", "-q", "-b", branch]);
    }
  }

  // Symlink node_modules to the global pnpm store (best-effort, 0-euro reuse).
  const nmLink = path.join(worktreePath, "node_modules");
  try {
    if (!fsSync.existsSync(nmLink)) await fs.symlink("/workspaces/.pnpm-store/v10", nmLink, "dir");
  } catch { /* best-effort */ }

  const cleanup = async () => {
    try { await fs.rm(worktreePath, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { projectId: id, worktreePath, branch, cleanup };
}

/** Commit the current state as one iteration step: "infinity: step N/M - message". */
export async function commitIteration(projectId: string, stepNumber: number, totalSteps: number, message: string): Promise<boolean> {
  const worktreePath = isolatedPath(projectId);
  if (!hasIsolated(projectId)) return false;
  await runGit(worktreePath, ["add", "-A"]);
  const label = message.trim() || `step ${stepNumber}/${totalSteps}`;
  const { ok } = await runGit(worktreePath, ["commit", "-q", "-m", `infinity: step ${stepNumber}/${totalSteps} - ${label}`]);
  return ok;
}

/** Instant rollback to the previous iteration (git reset --hard HEAD~1). */
export async function rollbackIteration(projectId: string): Promise<boolean> {
  const worktreePath = isolatedPath(projectId);
  if (!hasIsolated(projectId)) return false;
  const { ok } = await runGit(worktreePath, ["reset", "--hard", "HEAD~1"]);
  return ok;
}
