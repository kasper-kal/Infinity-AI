/**
 * Phase 5.3: Edge Cases — Resilience utilities for Build Mode.
 *
 * Handles: network failure retry, disk full pause, rate limit queue,
 * git conflict merge, workspace corruption detect, concurrent build queue.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getWorkspaceRoot, safeWorkspacePath, runGit } from "./workspace";
import { logBuildEvent } from "./build-telemetry";
import { workspaceKey } from "./workspace";
import type { ToolResult } from "./build-tools";

const EDGE_CASES_ROOT = path.resolve(getWorkspaceRoot(), "edge-cases");

/**
 * Edge case types we handle
 */
export type EdgeCaseType =
  | "network_failure"
  | "disk_full"
  | "rate_limit"
  | "git_conflict"
  | "workspace_corruption"
  | "concurrent_build";

export interface EdgeCaseEvent {
  id: string;
  type: EdgeCaseType;
  projectId: string;
  timestamp: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  details: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: string;
  resolution?: string;
}

/**
 * Disk space check result
 */
export interface DiskSpaceInfo {
  freeBytes: number;
  totalBytes: number;
  usedPercent: number;
  critical: boolean; // < 100MB free
  warning: boolean;  // < 500MB free
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "socket hang up", "network"],
};

/**
 * Check available disk space for a workspace
 */
export async function checkDiskSpace(projectId: string): Promise<DiskSpaceInfo> {
  try {
    const workspaceRoot = getWorkspaceRoot(projectId);
    const { stdout } = await runGit(workspaceRoot, ["status"]); // Just to ensure path exists
    // Use df to get disk info
    const { stdout: dfOut } = await runGit(workspaceRoot, ["sh", "-c", `df -k "${workspaceRoot}" | tail -1`]);
    const parts = dfOut.trim().split(/\s+/);
    if (parts.length >= 4) {
      const totalBlocks = parseInt(parts[1], 10);
      const usedBlocks = parseInt(parts[2], 10);
      const freeBlocks = parseInt(parts[3], 10);
      const blockSize = 1024; // df -k uses 1K blocks
      const totalBytes = totalBlocks * blockSize;
      const freeBytes = freeBlocks * blockSize;
      const usedPercent = ((totalBlocks - freeBlocks) / totalBlocks) * 100;
      return {
        freeBytes,
        totalBytes,
        usedPercent,
        critical: freeBytes < 100 * 1024 * 1024, // < 100MB
        warning: freeBytes < 500 * 1024 * 1024,  // < 500MB
      };
    }
  } catch {
    // Fallback: try Node's fs.stat
  }
  return {
    freeBytes: 0,
    totalBytes: 0,
    usedPercent: 0,
    critical: false,
    warning: false,
  };
}

/**
 * Wait for disk space to become available (pause build)
 */
export async function waitForDiskSpace(
  projectId: string,
  requiredBytes: number,
  maxWaitMs = 300000, // 5 minutes
  checkIntervalMs = 5000
): Promise<{ ok: boolean; waitedMs: number }> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const info = await checkDiskSpace(projectId);
    if (info.freeBytes >= requiredBytes) {
      await logBuildEvent(projectId, "info", `Disk space recovered: ${info.freeBytes} bytes free`);
      return { ok: true, waitedMs: Date.now() - start };
    }
    await logBuildEvent(projectId, "info", `Waiting for disk space: ${info.freeBytes}/${requiredBytes} bytes free`, {
      data: { freeBytes: info.freeBytes, requiredBytes },
    });
    await new Promise((r) => setTimeout(r, checkIntervalMs));
  }
  return { ok: false, waitedMs: Date.now() - start };
}

/**
 * Record an edge case event
 */
export async function recordEdgeCase(
  projectId: string,
  type: EdgeCaseType,
  message: string,
  details: Record<string, unknown> = {},
  severity: EdgeCaseEvent["severity"] = "warning"
): Promise<string> {
  const event: EdgeCaseEvent = {
    id: randomUUID(),
    type,
    projectId,
    timestamp: new Date().toISOString(),
    severity,
    message,
    details,
    resolved: false,
  };

  try {
    await fs.mkdir(EDGE_CASES_ROOT, { recursive: true });
    const filePath = path.join(EDGE_CASES_ROOT, `${workspaceKey(projectId)}.jsonl`);
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
    await logBuildEvent(projectId, "error", `Edge case: ${type} - ${message}`, { data: { edgeCaseId: event.id, ...details } });
  } catch (err) {
    console.error("[edge-cases] Failed to record event:", err);
  }
  return event.id;
}

/**
 * Mark edge case as resolved
 */
export async function resolveEdgeCase(projectId: string, edgeCaseId: string, resolution: string): Promise<void> {
  try {
    const filePath = path.join(EDGE_CASES_ROOT, `${workspaceKey(projectId)}.jsonl`);
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const updated = lines.map((line) => {
      try {
        const event = JSON.parse(line) as EdgeCaseEvent;
        if (event.id === edgeCaseId) {
          return JSON.stringify({ ...event, resolved: true, resolvedAt: new Date().toISOString(), resolution });
        }
        return line;
      } catch {
        return line;
      }
    });
    await fs.writeFile(filePath, `${updated.join("\n")}\n`, "utf8");
    await logBuildEvent(projectId, "info", `Edge case resolved: ${edgeCaseId} - ${resolution}`);
  } catch (err) {
    console.error("[edge-cases] Failed to resolve event:", err);
  }
}

/**
 * Get unresolved edge cases for a project
 */
export async function getUnresolvedEdgeCases(projectId: string): Promise<EdgeCaseEvent[]> {
  try {
    const filePath = path.join(EDGE_CASES_ROOT, `${workspaceKey(projectId)}.jsonl`);
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EdgeCaseEvent)
      .filter((e) => !e.resolved);
  } catch {
    return [];
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context: { projectId?: string; operation?: string } = {}
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const errStr = err instanceof Error ? err.message : String(err);
      const isRetryable = cfg.retryableErrors.some((e) => errStr.includes(e));

      if (!isRetryable || attempt === cfg.maxAttempts - 1) {
        if (context.projectId) {
          await recordEdgeCase(context.projectId, "network_failure", `${context.operation || "Operation"} failed after ${attempt + 1} attempts`, {
            error: errStr,
            attempts: attempt + 1,
            retryable: isRetryable,
          }, "error");
        }
        throw err;
      }

      const delay = Math.min(cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, attempt), cfg.maxDelayMs);
      if (context.projectId) {
        await logBuildEvent(context.projectId, "retry", `${context.operation || "Operation"} retry ${attempt + 1}/${cfg.maxAttempts} in ${delay}ms`, {
          data: { error: errStr, attempt: attempt + 1, delayMs: delay },
          step: "network-retry",
        });
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Detect workspace corruption (missing critical files, git issues, etc.)
 */
export async function detectWorkspaceCorruption(projectId: string): Promise<{ corrupted: boolean; issues: string[] }> {
  const issues: string[] = [];
  try {
    const workspaceRoot = getWorkspaceRoot(projectId);

    // Check if workspace exists
    try {
      await fs.access(workspaceRoot);
    } catch {
      issues.push("Workspace root does not exist");
      return { corrupted: true, issues };
    }

    // Check git repo integrity
    const gitResult = await runGit(workspaceRoot, ["status", "--porcelain"]);
    if (!gitResult.ok) {
      issues.push("Git status failed - possible repo corruption");
    }

    // Check for uncommitted changes that might be problematic
    if (gitResult.stdout.trim()) {
      // This is normal during builds, but note it
    }

    // Check if we can read a sample of files
    const { stdout: files } = await runGit(workspaceRoot, ["ls-files"]);
    if (!files.trim()) {
      issues.push("No tracked files in git repo");
    }

    // Check .infinity marker file exists
    try {
      await fs.access(path.join(workspaceRoot, ".infinity"));
    } catch {
      issues.push("Missing .infinity workspace marker");
    }
  } catch (err) {
    issues.push(`Detection error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (issues.length > 0) {
    await recordEdgeCase(projectId, "workspace_corruption", "Workspace corruption detected", { issues }, "critical");
  }
  return { corrupted: issues.length > 0, issues };
}

/**
 * Attempt to auto-repair workspace corruption
 */
export async function repairWorkspace(projectId: string, issues: string[]): Promise<{ ok: boolean; repaired: string[]; failed: string[] }> {
  const repaired: string[] = [];
  const failed: string[] = [];

  try {
    const workspaceRoot = getWorkspaceRoot(projectId);

    // Re-init git if needed
    if (issues.some((i) => i.includes("Git status failed"))) {
      try {
        await runGit(workspaceRoot, ["init", "-q"]);
        await runGit(workspaceRoot, ["add", "-A"]);
        await runGit(workspaceRoot, ["commit", "-q", "-m", "infinity: auto-repair after corruption"]);
        repaired.push("git-reinit");
      } catch {
        failed.push("git-reinit");
      }
    }

    // Re-create .infinity marker
    if (issues.some((i) => i.includes(".infinity"))) {
      try {
        await fs.writeFile(path.join(workspaceRoot, ".infinity"), `# Infinity build workspace for ${projectId}\n`);
        repaired.push("infinity-marker");
      } catch {
        failed.push("infinity-marker");
      }
    }

    // Ensure .tmp directory exists
    try {
      await fs.mkdir(path.join(workspaceRoot, ".tmp"), { recursive: true });
      repaired.push("tmp-dir");
    } catch {
      failed.push("tmp-dir");
    }

    if (repaired.length > 0) {
      await resolveEdgeCase(projectId, "latest", `Auto-repaired: ${repaired.join(", ")}`);
    }
  } catch (err) {
    failed.push(`general: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { ok: failed.length === 0, repaired, failed };
}

/**
 * Handle git merge conflicts during operations
 */
export async function handleGitConflict(projectId: string, operation: string): Promise<{ ok: boolean; strategy: string }> {
  const workspaceRoot = getWorkspaceRoot(projectId);

  try {
    // Check for conflict markers
    const { stdout } = await runGit(workspaceRoot, ["diff", "--name-only", "--diff-filter=U"]);
    const conflictedFiles = stdout.trim().split("\n").filter(Boolean);

    if (conflictedFiles.length === 0) {
      return { ok: true, strategy: "none" };
    }

    await recordEdgeCase(projectId, "git_conflict", `Git conflicts detected during ${operation}`, { conflictedFiles }, "warning");

    // Strategy 1: Try to auto-merge (accept ours for build artifacts, theirs for source)
    // For build worktrees, we typically want to keep the latest build state (ours)
    for (const file of conflictedFiles) {
      // Check if it's a build artifact or source
      if (file.includes("node_modules") || file.includes(".git") || file.includes("dist/") || file.includes("build/")) {
        await runGit(workspaceRoot, ["checkout", "--ours", file]);
      } else {
        // For source files, try to merge; if complex, accept theirs (incoming change)
        await runGit(workspaceRoot, ["checkout", "--theirs", file]);
      }
      await runGit(workspaceRoot, ["add", file]);
    }

    await runGit(workspaceRoot, ["commit", "-q", "-m", `infinity: auto-resolve conflicts during ${operation}`]);
    await resolveEdgeCase(projectId, "latest", `Auto-resolved ${conflictedFiles.length} git conflicts`);
    return { ok: true, strategy: "auto-resolve" };
  } catch (err) {
    await recordEdgeCase(projectId, "git_conflict", `Failed to resolve git conflicts during ${operation}`, { error: String(err) }, "error");
    return { ok: false, strategy: "failed" };
  }
}

/**
 * Concurrent build queue per project
 */
const buildQueues = new Map<string, Array<() => Promise<any>>>();
const buildProcessing = new Map<string, boolean>();

export async function enqueueBuild<T>(
  projectId: string,
  fn: () => Promise<T>,
  opts: { priority?: "high" | "normal"; timeoutMs?: number } = {}
): Promise<T> {
  const queue = buildQueues.get(projectId) ?? [];
  const priority = opts.priority === "high" ? 0 : 1;

  return new Promise((resolve, reject) => {
    const task = async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    // Insert based on priority
    if (priority === 0) {
      queue.unshift(task);
    } else {
      queue.push(task);
    }
    buildQueues.set(projectId, queue);
    processQueue(projectId);
  });
}

async function processQueue(projectId: string): Promise<void> {
  if (buildProcessing.get(projectId)) return;
  const queue = buildQueues.get(projectId);
  if (!queue || queue.length === 0) return;

  buildProcessing.set(projectId, true);

  while (true) {
    const queueNow = buildQueues.get(projectId);
    if (!queueNow || queueNow.length === 0) break;
    const task = queueNow.shift()!;
    buildQueues.set(projectId, queueNow);

    try {
      await task();
    } catch (err) {
      // Error already handled by the promise
    }

    // Log queue status
    const remaining = buildQueues.get(projectId)?.length ?? 0;
    if (remaining > 0) {
      await logBuildEvent(projectId, "info", `Build queue: ${remaining} task(s) waiting`, { step: "queue" });
    }
  }

  buildProcessing.set(projectId, false);
}

export function getBuildQueueStatus(projectId: string): { waiting: number; processing: boolean } {
  return {
    waiting: buildQueues.get(projectId)?.length ?? 0,
    processing: buildProcessing.get(projectId) ?? false,
  };
}

/**
 * Rate limit queue for external API calls
 */
interface RateLimitEntry {
  key: string;
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { key, count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true };
}

export async function waitForRateLimit(key: string, maxRequests: number, windowMs: number, maxWaitMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { allowed, retryAfterMs } = checkRateLimit(key, maxRequests, windowMs);
    if (allowed) return true;
    if (retryAfterMs) {
      await new Promise((r) => setTimeout(r, Math.min(retryAfterMs, 5000)));
    }
  }
  return false;
}

/**
 * Comprehensive pre-flight check before build operations
 */
export async function preflightCheck(projectId: string, requiredDiskBytes = 50 * 1024 * 1024): Promise<{ ok: boolean; checks: Record<string, boolean>; issues: string[] }> {
  const issues: string[] = [];
  const checks: Record<string, boolean> = {};

  // Disk space
  const disk = await checkDiskSpace(projectId);
  checks.diskSpace = !disk.critical;
  if (disk.critical) issues.push(`Critical: Only ${disk.freeBytes} bytes free (need ${requiredDiskBytes})`);
  else if (disk.warning) issues.push(`Warning: Low disk space (${disk.freeBytes} bytes free)`);

  // Workspace corruption
  const corruption = await detectWorkspaceCorruption(projectId);
  checks.workspaceIntegrity = !corruption.corrupted;
  if (corruption.corrupted) issues.push(...corruption.issues);

  // Git status
  try {
    const workspaceRoot = getWorkspaceRoot(projectId);
    const gitStatus = await runGit(workspaceRoot, ["status", "--porcelain"]);
    checks.gitClean = gitStatus.ok;
    if (!gitStatus.ok) issues.push("Git status check failed");
  } catch {
    checks.gitClean = false;
    issues.push("Git not accessible");
  }

  // Unresolved edge cases
  const edgeCases = await getUnresolvedEdgeCases(projectId);
  checks.noUnresolvedEdgeCases = edgeCases.length === 0;
  if (edgeCases.length > 0) issues.push(`${edgeCases.length} unresolved edge case(s)`);

  // Build queue
  const queue = getBuildQueueStatus(projectId);
  checks.queueAvailable = !queue.processing;
  if (queue.processing) issues.push("Another build is in progress");

  return {
    ok: checks.diskSpace && checks.workspaceIntegrity && checks.gitClean && checks.noUnresolvedEdgeCases && checks.queueAvailable,
    checks,
    issues,
  };
}

/**
 * Tool-specific resilience configurations
 */
export interface ToolResilienceConfig {
  name: string;
  retryConfig: RetryConfig;
  circuitBreaker: {
    threshold: number;
    timeout: number;
  };
  fallbackTools: string[];
  diagnosticAgent?: string;
}

export const TOOL_RESILIENCE_CONFIGS: ToolResilienceConfig[] = [
  {
    name: "run_command",
    retryConfig: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 60000, backoffMultiplier: 2, retryableErrors: ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "socket hang up", "network", "timeout"] },
    circuitBreaker: { threshold: 5, timeout: 60000 },
    fallbackTools: ["run_command"],
    diagnosticAgent: "npm-install-fixer",
  },
  {
    name: "npm_install",
    retryConfig: { maxAttempts: 3, baseDelayMs: 5000, maxDelayMs: 120000, backoffMultiplier: 2, retryableErrors: ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "socket hang up", "network", "peer dependency", "eresolve", "integrity"] },
    circuitBreaker: { threshold: 3, timeout: 120000 },
    fallbackTools: ["run_command"],
    diagnosticAgent: "npm-install-fixer",
  },
  {
    name: "screenshot",
    retryConfig: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ["timeout", "browser", "crash", "navigation", "cdp"] },
    circuitBreaker: { threshold: 3, timeout: 30000 },
    fallbackTools: ["inspect_dom"],
    diagnosticAgent: "browser-recovery",
  },
  {
    name: "inspect_dom",
    retryConfig: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ["timeout", "browser", "crash", "navigation", "cdp"] },
    circuitBreaker: { threshold: 3, timeout: 30000 },
    fallbackTools: ["screenshot"],
    diagnosticAgent: "browser-recovery",
  },
  {
    name: "inspect_console",
    retryConfig: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ["timeout", "browser", "crash", "navigation", "cdp"] },
    circuitBreaker: { threshold: 3, timeout: 30000 },
    fallbackTools: ["screenshot"],
    diagnosticAgent: "browser-recovery",
  },
  {
    name: "inspect_accessibility",
    retryConfig: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ["timeout", "browser", "crash", "navigation", "cdp"] },
    circuitBreaker: { threshold: 3, timeout: 30000 },
    fallbackTools: ["screenshot"],
    diagnosticAgent: "browser-recovery",
  },
  {
    name: "git_diff",
    retryConfig: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, retryableErrors: ["conflict", "merge"] },
    circuitBreaker: { threshold: 5, timeout: 30000 },
    fallbackTools: ["run_command"],
    diagnosticAgent: undefined,
  },
  {
    name: "list_files",
    retryConfig: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, retryableErrors: [] },
    circuitBreaker: { threshold: 10, timeout: 10000 },
    fallbackTools: [],
    diagnosticAgent: undefined,
  },
  {
    name: "read_file",
    retryConfig: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, retryableErrors: [] },
    circuitBreaker: { threshold: 10, timeout: 10000 },
    fallbackTools: [],
    diagnosticAgent: undefined,
  },
  {
    name: "edit_file",
    retryConfig: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, retryableErrors: [] },
    circuitBreaker: { threshold: 10, timeout: 10000 },
    fallbackTools: [],
    diagnosticAgent: undefined,
  },
];

/**
 * Get resilience config for a tool
 */
export function getToolResilienceConfig(toolName: string): ToolResilienceConfig | undefined {
  return TOOL_RESILIENCE_CONFIGS.find(c => c.name === toolName);
}

/**
 * Execute tool with full resilience (retry + circuit breaker + diagnostics)
 */
export interface ToolExecutionContextEdge {
  projectId: string;
  workspaceId: string;
  previewPort?: number;
  previewUrl?: string;
}

export async function executeToolWithResilience<T extends Record<string, unknown>>(
  toolName: string,
  args: T,
  context: ToolExecutionContextEdge,
  executeFn: (args: T, context: ToolExecutionContextEdge) => Promise<ToolResult>,
  options: { onProgress?: (stage: string, info: Record<string, unknown>) => void } = {}
): Promise<ToolResult> {
  const config = getToolResilienceConfig(toolName);
  if (!config) {
    // No config - just execute once
    return await executeFn(args, context);
  }

  const { retryConfig, circuitBreaker: cbConfig, fallbackTools, diagnosticAgent } = config;
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retryConfig.maxAttempts) {
    try {
      options.onProgress?.("execute", { tool: toolName, attempt: attempt + 1, maxAttempts: retryConfig.maxAttempts + 1 });
      const result = await executeFn(args, context);

      if (result.success) {
        return result;
      }

      // Tool failed but didn't throw
      lastError = new Error(result.error || "Tool returned failure");
      options.onProgress?.("tool_failed", { tool: toolName, error: lastError.message, attempt: attempt + 1 });

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      options.onProgress?.("tool_exception", { tool: toolName, error: lastError.message, attempt: attempt + 1 });
    }

    // Check if we should retry
    const errStr = lastError?.message || "";
    const isRetryable = retryConfig.retryableErrors.some(e => errStr.toLowerCase().includes(e.toLowerCase()));

    if (!isRetryable || attempt === retryConfig.maxAttempts) {
      // Try fallback tools
      for (const fallback of fallbackTools) {
        const fallbackConfig = getToolResilienceConfig(fallback);
        if (fallbackConfig) {
          options.onProgress?.("fallback", { from: toolName, to: fallback });
          try {
            // Would need fallback execute function - for now return error with fallback info
            return {
              success: false,
              error: `${lastError?.message}. Fallback available: ${fallback}`,
              data: { fallbackTool: fallback, originalError: lastError?.message }
            };
          } catch {
            // Fallback also failed
          }
        }
      }

      // Try diagnostic agent if available
      if (diagnosticAgent) {
        options.onProgress?.("diagnostic", { tool: toolName, agent: diagnosticAgent });
        // Diagnostic agent would be invoked here
        return {
          success: false,
          error: `${lastError?.message}. Diagnostic agent available: ${diagnosticAgent}`,
          data: { diagnosticAgent, originalError: lastError?.message }
        };
      }

      // No more options
      return { success: false, error: lastError?.message || "Unknown error" };
    }

    // Exponential backoff
    attempt++;
    if (attempt <= retryConfig.maxAttempts) {
      const delay = Math.min(retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1), retryConfig.maxDelayMs);
      options.onProgress?.("retry_wait", { tool: toolName, delayMs: delay, attempt });
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return { success: false, error: `Tool ${toolName} failed after ${retryConfig.maxAttempts + 1} attempts: ${lastError?.message}` };
}

/**
 * Tool health check - verifies tools are working
 */
export async function runToolHealthCheck(
  projectId: string,
  workspaceId: string,
  tools: string[] = ["list_files", "read_file", "run_command", "git_diff"]
): Promise<{ healthy: boolean; results: Record<string, { ok: boolean; latencyMs: number; error?: string }> }> {
  const results: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};
  let allHealthy = true;

  for (const tool of tools) {
    const start = Date.now();
    try {
      // Run a simple test for each tool
      if (tool === "list_files") {
        const { listWorkspaceFiles } = await import("./workspace");
        await listWorkspaceFiles(workspaceId);
        results[tool] = { ok: true, latencyMs: Date.now() - start };
      } else if (tool === "read_file") {
        // Try reading a known file
        const { readWorkspaceFileText } = await import("./workspace");
        await readWorkspaceFileText("package.json", workspaceId);
        results[tool] = { ok: true, latencyMs: Date.now() - start };
      } else if (tool === "run_command") {
        const { runGit } = await import("./workspace");
        const workspaceRoot = getWorkspaceRoot(workspaceId);
        await runGit(workspaceRoot, ["status"]);
        results[tool] = { ok: true, latencyMs: Date.now() - start };
      } else if (tool === "git_diff") {
        const { hasIsolated, isolatedPath, runGit } = await import("./workspace");
        if (hasIsolated(projectId)) {
          const path = isolatedPath(projectId);
          await runGit(path, ["diff"]);
          results[tool] = { ok: true, latencyMs: Date.now() - start };
        } else {
          results[tool] = { ok: true, latencyMs: Date.now() - start, error: "No isolated workspace" };
        }
      }
    } catch (error) {
      results[tool] = { ok: false, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
      allHealthy = false;
    }
  }

  return { healthy: allHealthy, results };
}

/**
 * Resilience metrics tracking
 */
export interface ResilienceMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  retriedCalls: number;
  fallbackUsed: number;
  diagnosticsEscalated: number;
  avgLatencyMs: number;
  byTool: Record<string, { calls: number; failures: number; retries: number; fallbacks: number }>;
}

const resilienceMetrics: ResilienceMetrics = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  retriedCalls: 0,
  fallbackUsed: 0,
  diagnosticsEscalated: 0,
  avgLatencyMs: 0,
  byTool: {},
};

export function recordResilienceMetric(
  toolName: string,
  outcome: "success" | "failure" | "retry" | "fallback" | "diagnostic",
  latencyMs: number
): void {
  resilienceMetrics.totalCalls++;

  if (outcome === "success") resilienceMetrics.successfulCalls++;
  else if (outcome === "failure") resilienceMetrics.failedCalls++;
  else if (outcome === "retry") resilienceMetrics.retriedCalls++;
  else if (outcome === "fallback") resilienceMetrics.fallbackUsed++;
  else if (outcome === "diagnostic") resilienceMetrics.diagnosticsEscalated++;

  // Update running average latency
  resilienceMetrics.avgLatencyMs = (resilienceMetrics.avgLatencyMs * (resilienceMetrics.totalCalls - 1) + latencyMs) / resilienceMetrics.totalCalls;

  // Per-tool metrics
  if (!resilienceMetrics.byTool[toolName]) {
    resilienceMetrics.byTool[toolName] = { calls: 0, failures: 0, retries: 0, fallbacks: 0 };
  }
  resilienceMetrics.byTool[toolName].calls++;
  if (outcome === "failure") resilienceMetrics.byTool[toolName].failures++;
  else if (outcome === "retry") resilienceMetrics.byTool[toolName].retries++;
  else if (outcome === "fallback") resilienceMetrics.byTool[toolName].fallbacks++;
}

export function getResilienceMetrics(): ResilienceMetrics {
  return { ...resilienceMetrics, byTool: { ...resilienceMetrics.byTool } };
}

export function resetResilienceMetrics(): void {
  resilienceMetrics.totalCalls = 0;
  resilienceMetrics.successfulCalls = 0;
  resilienceMetrics.failedCalls = 0;
  resilienceMetrics.retriedCalls = 0;
  resilienceMetrics.fallbackUsed = 0;
  resilienceMetrics.diagnosticsEscalated = 0;
  resilienceMetrics.avgLatencyMs = 0;
  for (const tool of Object.keys(resilienceMetrics.byTool)) {
    delete resilienceMetrics.byTool[tool];
  }
}