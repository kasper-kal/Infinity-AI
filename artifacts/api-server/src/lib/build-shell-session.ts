/**
 * Interactive Shell Sessions — streaming, stdin-capable, interruptible.
 *
 * Phase 0 FIX for run_command: replaces blind execFile (no streaming, no
 * stdin, no interactive support) with a real terminal the agent can drive.
 *
 * Design (zero native dependencies — no node-pty / node-gyp build):
 *   - One persistent interactive bash shell per workspace, hosted inside a
 *     genuine PTY allocated by util-linux `script` (preinstalled on Linux and
 *     macOS). Plain-bash fallback when `script` is unavailable.
 *   - Commands are written to the shell's stdin. A completion marker
 *     (`__INFY_DONE_<token>__:<exit>`) is echoed after each command so callers
 *     know exactly when output for a command is finished and what it exited
 *     with — no guessing from silence.
 *   - Output streams into a bounded buffer; callers poll for the *increment*
 *     since their last read, so a long `npm install` or `vercel --prod` is
 *     visible turn-by-turn instead of one blob at the end.
 *   - stdin is writable (answer prompts), Ctrl+C is delivered as the INTR
 *     byte (\x03) on the PTY (real SIGINT to the foreground process), and
 *     interactive apps (vim, top) run on a real TTY.
 *   - ANSI escape codes are stripped so the model reads clean text.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { getWorkspaceRoot, getWorkspaceCommandEnvironment } from "./workspace";

// ============================================
// Session State
// ============================================

export interface ShellSession {
  id: string;
  workspaceId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  child: ChildProcess;
  pty: boolean; // true when running under util-linux `script`
  /** Normalized, ANSI-stripped output since spawn (bounded tail). */
  buffer: string;
  /** Char offset into `buffer` already returned to the caller. */
  delivered: number;
  alive: boolean;
  spawnedAt: number;
  lastActivityAt: number;
}

const sessions = new Map<string, ShellSession>(); // keyed by workspaceId (one shell per workspace)
const MAX_BUFFER_CHARS = 256 * 1024;
const MAX_SESSIONS = 8;
const GLOBAL_LIFETIME_MS = 6 * 60 * 60 * 1000;

// ============================================
// Small utilities
// ============================================

/** Strip ANSI CSI/OSC/other escape sequences and normalize CRLF. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "") // CSI sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[@-Z\\-_]/g, "") // single-char escapes
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function closeShellSession(session: ShellSession): void {
  if (!session.alive) return;
  session.alive = false;
  try {
    session.child.stdin?.end();
  } catch {
    /* already closed */
  }
  try {
    session.child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  if (sessions.get(session.workspaceId) === session) {
    sessions.delete(session.workspaceId);
  }
}

function sweepExpired(): void {
  const now = Date.now();
  if (sessions.size > MAX_SESSIONS) {
    // evict oldest OLD sessions (not the newest), keeping newest
    const oldest = [...sessions.entries()]
      .sort((a, b) => a[1].spawnedAt - b[1].spawnedAt)
      .slice(0, sessions.size - MAX_SESSIONS);
    for (const [, s] of oldest) closeShellSession(s);
    return;
  }
  for (const [, s] of sessions) {
    if (now - s.lastActivityAt > GLOBAL_LIFETIME_MS) closeShellSession(s);
  }
}

function isShellCommandLineAlive(child: ChildProcess | null): boolean {
  if (!child) return false;
  return child.exitCode === null && child.signalCode === null && child.pid !== undefined;
}

// ============================================
// Spawn the persistent shell for a workspace
// ============================================

let scriptAvailable: boolean | null = null;
async function haveScript(): Promise<boolean> {
  if (scriptAvailable !== null) return scriptAvailable;
  // Try the standard absolute locations first (the worker PATH can leave
  // /usr/bin out, e.g. under vitest's isolated worker env), then a PATH probe.
  const candidates = ["/usr/bin/script", "/bin/script", "/usr/local/bin/script"];
  for (const bin of candidates) {
    try {
      const { access } = await import("node:fs/promises");
      await access(bin);
      scriptAvailable = true;
      return true;
    } catch { /* try next */ }
  }
  scriptAvailable = await new Promise<boolean>((resolve) => {
    const probe = spawn("script", ["-V"], {
      // Make sure PATH is sane for the probe even if the worker stripped it.
      env: { ...process.env, PATH: `${process.env.PATH || ""}:/usr/bin:/bin` },
    });
    probe.on("error", () => resolve(false));
    probe.on("exit", (code) => resolve(code === 0));
  });
  return scriptAvailable;
}

export interface EnsureShellOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function ensureShellSession(
  workspaceId: string,
  options: EnsureShellOptions = {}
): Promise<ShellSession> {
  sweepExpired();

  const existing = sessions.get(workspaceId);
  if (existing && isShellCommandLineAlive(existing.child)) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  if (existing) closeShellSession(existing);

  const workspaceRoot = getWorkspaceRoot(workspaceId);
  const cwd = options.cwd ? path.resolve(workspaceRoot, options.cwd) : workspaceRoot;
  if (!cwd.startsWith(workspaceRoot)) {
    throw new Error("Working directory escapes the workspace");
  }
  // The workspace may not be provisioned yet (agent cd's into a subdir it is
  // about to scaffold) — create it, mirroring `mkdir -p`.
  await mkdir(cwd, { recursive: true });

  const env = { ...getWorkspaceCommandEnvironment(), ...(options.env || {}) };
  // `stty -echo` turns off input echo so the buffer carries program output,
  // not the typed command echoed back (bash's readline may also echo on a PTY,
  // which produced doubled lines). Completion is still unambiguous via the
  // marker line, and interactive apps (vim, top) set their own modes anyway.
  const internal = `stty -echo 2>/dev/null; PS1= PS2= PS4= PROMPT_COMMAND= TERM=xterm-256color bash --norc -i`;

  const usePty = await haveScript();
  const id = `${workspaceId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const child = usePty
    ? spawn("script", ["-qfc", internal, "/dev/null"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    : spawn("bash", ["--norc", "-i"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

  const session: ShellSession = {
    id,
    workspaceId,
    cwd,
    env,
    child,
    pty: usePty,
    buffer: "",
    delivered: 0,
    alive: true,
    spawnedAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  child.stdout?.on("data", (chunk: Buffer | string) => {
    session.lastActivityAt = Date.now();
    const clean = stripAnsi(chunk.toString("utf8"));
    if (!clean) return;
    session.buffer += clean;
    if (session.buffer.length > MAX_BUFFER_CHARS) {
      const excess = session.buffer.length - MAX_BUFFER_CHARS;
      session.buffer = session.buffer.slice(excess);
      session.delivered = Math.max(0, session.delivered - excess);
    }
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    session.lastActivityAt = Date.now();
    const clean = stripAnsi(chunk.toString("utf8"));
    if (!clean) return;
    session.buffer += clean;
    if (session.buffer.length > MAX_BUFFER_CHARS) {
      const excess = session.buffer.length - MAX_BUFFER_CHARS;
      session.buffer = session.buffer.slice(excess);
      session.delivered = Math.max(0, session.delivered - excess);
    }
  });
  child.on("exit", () => {
    session.alive = false;
    if (sessions.get(session.workspaceId) === session) {
      sessions.delete(session.workspaceId);
    }
  });
  child.on("error", () => {
    session.alive = false;
  });

  sessions.set(workspaceId, session);
  return session;
}

// ============================================
// Read / write / signal
// ============================================

const MAX_INCREMENT_CHARS = 60 * 1024;

export interface ShellReadResult {
  running: boolean;
  output: string; // increment since last read
  exitCode: number | null;
}

export function readShellIncrement(session: ShellSession): ShellReadResult {
  const tail = session.buffer;
  const next = Math.min(tail.length, session.delivered + MAX_INCREMENT_CHARS);
  const output = tail.slice(session.delivered, next);
  session.delivered = next;
  return {
    running: session.alive && isShellCommandLineAlive(session.child),
    output,
    exitCode: session.child.exitCode !== null && session.child.exitCode !== undefined ? session.child.exitCode : null,
  };
}

export async function writeShellInput(session: ShellSession, input: string): Promise<void> {
  if (!session.alive) return;
  // Preserve interior newlines (heredocs need them); only normalize the final
  // line break to CR = Enter. PTY canonical mode accepts both CR and NL, so
  // this is safe for interactive prompts too.
  const trimmed = input.replace(/[\r\n]+$/, "");
  const normalized = trimmed.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  session.child.stdin?.write(normalized);
  session.child.stdin?.write("\r");
}

export async function interruptShell(session: ShellSession): Promise<void> {
  if (!session.alive) return;
  // INTR byte on the PTY → real SIGINT to the foreground process group.
  session.child.stdin?.write("\x03");
}

/** Kill the shell for this workspace outright (rarely needed). */
export function destroyShellSession(workspaceId: string): boolean {
  const s = sessions.get(workspaceId);
  if (!s) return false;
  closeShellSession(s);
  return true;
}

// ============================================
// Run one command to completion (marker-based)
// ============================================

export interface RunCommandWaitOptions {
  timeoutMs: number;
  cwd?: string;
}

export interface RunCommandWaitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  running: boolean;
  sessionId: string;
}

const MARKER_RE = /__INFY_DONE_([0-9a-f]+)__:(-?[0-9]+)/g;

export async function runCommandInShell(
  workspaceId: string,
  command: string,
  options: RunCommandWaitOptions
): Promise<RunCommandWaitResult> {
  const session = await ensureShellSession(workspaceId, { cwd: options.cwd });

  // If a previous command is still foreground (shouldn't happen for the
  // marker-wait flow, but be safe) — oldest marker lost, so just proceed.
  const token = Math.random().toString(16).slice(2, 10);

  // Compose: optional cd, the command, then the exit-code marker. The `$?`
  // must stay OUTSIDE the quoted printf format — inside the quotes it would
  // print literally. `__INFY_DONE_<token>__:$?` becomes the marker line.
  let inner = command;
  if (options.cwd) {
    const absCwd = path.resolve(session.cwd, options.cwd);
    inner = `cd ${quotePath(absCwd)} 2>/dev/null; ${command}`;
  }
  const full = `${inner} ; printf '\\n%s\\n' __INFY_DONE_${token}__:$?`;

  const startDelivered = session.delivered;
  // Take over delivering so our marker scan starts from the pre-command tail.
  session.delivered = session.buffer.length;

  await writeShellInput(session, full);

  const deadline = Date.now() + options.timeoutMs;
  let matched: { index: number; exitStr: string } | null = null;

  // Poll the buffer until the marker line appears or timeout. The buffer is
  // only mutated by stream events, which are async — poll on a timer.
  while (Date.now() < deadline) {
    const m = findMarker(session.buffer, token);
    if (m) {
      matched = m;
      break;
    }
    if (!session.alive) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  let exitCode = 0;
  if (matched) {
    // Everything from startDelivered up to the marker line is this command.
    let rawSegment = session.buffer.slice(startDelivered, matched.index);
    // The PTY echoes the typed line back (bash's readline re-enables ECHO on
    // the PTY). Remove the exact echoed command so the model reads output only.
    rawSegment = rawSegment.split(full).join("");
    // Exit status: numeric portion after the marker token line.
    exitCode = parseInt(matched.exitStr, 10);
    if (Number.isNaN(exitCode)) exitCode = 1;

    // Advance the delivered pointer PAST the marker line so the marker itself
    // (and any trailing prompt) is not re-delivered on the next call.
    const newlineAfter = session.buffer.indexOf("\n", matched.index);
    const deliveredTo = newlineAfter === -1 ? session.buffer.length : newlineAfter + 1;
    if (deliveredTo > session.delivered) session.delivered = deliveredTo;
    if (session.delivered > session.buffer.length) session.delivered = session.buffer.length;

    const cleanSegment = rawSegment.trim();
    const success = exitCode === 0;
    return {
      success,
      stdout: cleanSegment,
      stderr: success ? "" : cleanSegment, // merged PTY output; surface on failure
      exitCode,
      timedOut: false,
      running: false,
      sessionId: session.id,
    };
  }

  // Timed out (or the shell died) before the marker appeared.
  const segment = session.buffer.slice(startDelivered).trim();
  const timedOut = session.alive;
  return {
    success: false,
    stdout: segment,
    stderr: segment,
    exitCode: 1,
    timedOut,
    running: session.alive,
    sessionId: session.id,
  };
}

function findMarker(buffer: string, token: string): { index: number; exitStr: string } | null {
  // The real marker line is <command output>\n__INFY_DONE_<token>__:<exit>\n —
  // ALWAYS at a line start (a fresh line after the newline that precedes the
  // marker). The echoed input text also contains the marker string, but
  // mid-line, so requiring a preceding \n (or buffer start) is what keeps us
  // from matching the echo instead of the actual output.
  for (let i = 0; i < buffer.length; ) {
    let idx = buffer.indexOf(`__INFY_DONE_${token}__:`, i);
    if (idx === -1) break;
    const lineStart = idx === 0 || buffer[idx - 1] === "\n";
    if (!lineStart) {
      i = idx + 1;
      continue;
    }
    const rest = buffer.slice(idx + `__INFY_DONE_${token}__:`.length);
    const numMatch = rest.match(/^(-?[0-9]+)/);
    if (numMatch) return { index: idx, exitStr: numMatch[1] };
    i = idx + 1;
  }
  return null;
}

function quotePath(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export function getShellSession(workspaceId: string): ShellSession | undefined {
  return sessions.get(workspaceId);
}