import { promises as fs } from "node:fs";
import path from "node:path";
import { getWorkspaceRoot, getWorkspaceCommandEnvironment } from "./workspace";

/**
 * Build Sandbox — Security layer for executing commands in isolated workspaces.
 * Provides command validation, environment sanitization, and workspace boundary enforcement.
 */

/** Result of command validation */
export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  sanitizedCommand?: string;
}

/** Sandbox execution options */
export interface SandboxOptions {
  timeoutMs?: number;
  maxOutput?: number;
  workspaceId?: string;
  env?: Record<string, string>;
  cwd?: string;
}

/** Sandbox execution result */
export interface SandboxResult {
  stdout: string;
  stderr: string;
  cwd: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Patterns for destructive commands that should be blocked
 */
const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+\*\s*$/,
  /rm\s+-rf\s+~\s*$/,
  /git\s+push\s+--force/,
  /git\s+push\s+-f\s+/,
  /sudo\s+/,
  /chmod\s+777/,
  /chown\s+-R\s+root/,
  /mkfs\./,
  /dd\s+if=/,
  />\s*\/dev\//,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*\&\s*\}/, // fork bomb
  /curl\s+.*\|\s*bash/,
  /wget\s+.*\|\s*bash/,
  /eval\s+\$/,
  /exec\s+\$/,
];

/**
 * Patterns that are allowed (explicit allowlist for common dev commands)
 */
const ALLOWED_PATTERNS = [
  /^npm\s+(install|ci|run|test|build|start|publish)/,
  /^pnpm\s+(install|run|test|build|start|publish)/,
  /^yarn\s+(install|run|test|build|start)/,
  /^bun\s+(install|run|test|build|start)/,
  /^git\s+(status|add|commit|push|pull|fetch|checkout|branch|merge|rebase|diff|log|stash)/,
  /^node\s+/,
  /^npx\s+/,
  /^tsc/,
  /^vite/,
  /^esbuild/,
  /^webpack/,
  /^turbo/,
  /^docker\s+(build|run|compose)/,
  /^python/,
  /^pip/,
  /^make/,
  /^cargo/,
  /^go\s+(build|run|test|mod)/,
  /^dotnet/,
  /^gradle/,
  /^mvn/,
  /^ls|pwd|cat|head|tail|grep|find|mkdir|cp|mv|rm\s+(?!-rf)/,
  /^echo|printf/,
  /^cat\s+>/,
  /^tee/,
  /^sed|awk/,
  /^jq/,
];

/**
 * Secrets patterns that should never be in environment
 */
const SECRET_ENV_KEYS = [
  "API_KEY",
  "API_SECRET",
  "ACCESS_TOKEN",
  "REFRESH_TOKEN",
  "JWT_SECRET",
  "DATABASE_URL",
  "DB_PASSWORD",
  "DB_USER",
  "PRIVATE_KEY",
  "SSH_KEY",
  "AWS_SECRET",
  "AWS_ACCESS_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "NVIDIA_API_KEY",
  "TAVILY_API_KEY",
  "ELEVENLABS_API_KEY",
  "FLUX_API_KEY",
  "WHISPER_API_KEY",
  "SPOTIFY_CLIENT_SECRET",
  "GMAIL_CLIENT_SECRET",
  "FIGMA_ACCESS_TOKEN",
  "NEON_API_KEY",
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "SESSION_SECRET",
  "COOKIE_SECRET",
  "ENCRYPTION_KEY",
];

/**
 * Validate a command against allowlist/denylist patterns
 */
export function validateCommand(command: string): ValidationResult {
  const trimmed = command.trim();

  // Check for destructive patterns first
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: `Destructive command blocked: matches pattern ${pattern.source}`,
      };
    }
  }

  // Check if command matches any allowed pattern
  const firstWord = trimmed.split(/\s+/)[0];
  let allowed = false;

  for (const pattern of ALLOWED_PATTERNS) {
    if (pattern.test(trimmed)) {
      allowed = true;
      break;
    }
  }

  // If not explicitly allowed, check if it's a simple command (no pipes, redirects, etc.)
  if (!allowed) {
    const hasComplexOps = /[|&;<>$`]/.test(trimmed) || /\|\|/.test(trimmed) || /&&/.test(trimmed);
    if (!hasComplexOps && firstWord && !firstWord.startsWith(".") && !firstWord.startsWith("/")) {
      // Simple command without complex shell ops - allow with warning
      allowed = true;
    }
  }

  if (!allowed) {
    return {
      allowed: false,
      reason: `Command not in allowlist: "${firstWord}". Add to ALLOWED_PATTERNS if needed.`,
    };
  }

  return { allowed: true, sanitizedCommand: trimmed };
}

/**
 * Create a sanitized environment with no secrets
 */
export function createSandboxedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  // Start with safe keys from the existing workspace environment
  const baseEnv = getWorkspaceCommandEnvironment();

  // Copy only non-secret keys
  for (const [key, value] of Object.entries(baseEnv)) {
    const upperKey = key.toUpperCase();
    const isSecret = SECRET_ENV_KEYS.some((secret) => upperKey.includes(secret));
    if (!isSecret) {
      env[key] = value;
    }
  }

  // Add any extra env vars (these are explicitly provided by caller, assumed safe)
  for (const [key, value] of Object.entries(extra)) {
    const upperKey = key.toUpperCase();
    const isSecret = SECRET_ENV_KEYS.some((secret) => upperKey.includes(secret));
    if (!isSecret) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Enforce workspace boundary - prevent directory traversal outside project root
 */
export function enforceWorkspaceBoundary(
  cwd: string,
  workspaceId: string = "default"
): string {
  const workspaceRoot = getWorkspaceRoot(workspaceId);
  const resolvedCwd = path.resolve(cwd);

  if (!resolvedCwd.startsWith(workspaceRoot + path.sep) && resolvedCwd !== workspaceRoot) {
    throw new Error(`Directory traversal blocked: ${resolvedCwd} is outside workspace ${workspaceRoot}`);
  }

  return resolvedCwd;
}

/**
 * Validate workspace root exists and is accessible
 */
export async function validateWorkspaceRoot(workspaceId: string = "default"): Promise<string> {
  const workspaceRoot = getWorkspaceRoot(workspaceId);
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, ".tmp"), { recursive: true });
  return workspaceRoot;
}

/**
 * Run a command in the sandbox with all guards
 */
export async function runInSandbox(
  command: string,
  options: SandboxOptions = {}
): Promise<SandboxResult> {
  const workspaceId = options.workspaceId ?? "default";

  // 1. Validate command
  const validation = validateCommand(command);
  if (!validation.allowed) {
    throw new Error(validation.reason || "Command validation failed");
  }

  // 2. Validate workspace
  const workspaceRoot = await validateWorkspaceRoot(workspaceId);

  // 3. Determine and validate working directory
  const requestedCwd = options.cwd ?? workspaceRoot;
  const safeCwd = enforceWorkspaceBoundary(requestedCwd, workspaceId);

  // 4. Create sandboxed environment
  const env = createSandboxedEnv(options.env);

  // 5. Execute with timeout and output limits
  const timeoutMs = Math.min(options.timeoutMs ?? 15_000, 60_000);
  const maxOutput = Math.min(options.maxOutput ?? 30_000, 200_000);

  const { execFile } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const sanitizedCommand = validation.sanitizedCommand ?? command;
    const script = `cd ${safeCwd}; ${sanitizedCommand}; printf '\\n__CWD__=%s\\n' "$PWD"`;

    const child = execFile(
      "/bin/bash",
      ["-lc", script],
      {
        cwd: safeCwd,
        timeout: timeoutMs,
        maxBuffer: maxOutput * 2,
        killSignal: "SIGKILL",
        env,
      },
      (err, stdout, stderr) => {
        let out = stdout ?? "";
        const marker = out.match(/\n__CWD__=(.+)\n?$/);
        const newCwd = marker?.[1]?.trim();

        // Verify new cwd is still within workspace
        let finalCwd = safeCwd;
        if (newCwd && path.isAbsolute(newCwd)) {
          try {
            finalCwd = enforceWorkspaceBoundary(newCwd, workspaceId);
          } catch {
            finalCwd = safeCwd; // Fallback to original safe cwd
          }
        }

        if (marker?.index !== undefined) out = out.slice(0, marker.index);

        const code = err && typeof err === "object" && "code" in err
          ? (err as { code?: number | string }).code
          : 0;

        resolve({
          stdout: out.slice(-maxOutput),
          stderr: (stderr ?? "").slice(-maxOutput),
          cwd: finalCwd,
          exitCode: err ? (typeof code === "number" ? code : 1) : 0,
          timedOut: (err as { killed?: boolean } | null)?.killed === true,
        });
      }
    );
  });
}

/**
 * Check if a command looks like it might be dangerous (for logging/auditing)
 */
export function isCommandPotentiallyDangerous(command: string): boolean {
  const trimmed = command.trim();
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Get the list of blocked patterns (for documentation/debugging)
 */
export function getBlockedPatterns(): RegExp[] {
  return [...DESTRUCTIVE_PATTERNS];
}

/**
 * Get the list of allowed patterns (for documentation/debugging)
 */
export function getAllowedPatterns(): RegExp[] {
  return [...ALLOWED_PATTERNS];
}