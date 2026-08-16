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