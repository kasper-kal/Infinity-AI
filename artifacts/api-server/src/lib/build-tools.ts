/**
 * Phase 1: Tool Execution Framework for Autonomous Coding Agent
 *
 * Replaces the single-shot JSON-map generation with a tool-using agent that
 * progressively explores, modifies, and verifies the workspace. Tools:
 * - list_files() - list workspace files
 * - read_file() - read file content
 * - edit_file() - create/modify/delete files
 * - run_command() - execute shell commands
 * - screenshot() - capture preview screenshot
 * - inspect_console() - get browser console logs
 * - inspect_dom() - get DOM/interactive elements
 * - inspect_accessibility() - get CDP accessibility tree
 * - git_diff() - show git diff of changes
 */

import { execFile, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getWorkspaceRoot,
  safeWorkspacePath,
  readWorkspaceFileText,
  writeWorkspaceFile,
  listWorkspaceFiles,
  runGit,
  hasIsolated,
  isolatedPath,
  getWorkspaceCommandEnvironment,
} from "./workspace";
import { getBrowserPool } from "./browser-pool";
import type { BrowserSlot, ScreenshotViewport } from "./browser-pool";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  id?: string;
}

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  data?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Available tools for the autonomous coding agent
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List all files in the workspace, optionally filtered by pattern",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to filter files (e.g., '*.ts', 'src/**')" },
        includeDirs: { type: "boolean", description: "Include directories in results", default: false },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read the content of a file in the workspace",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file" },
        maxChars: { type: "number", description: "Maximum characters to read", default: 50000 },
      },
      required: ["path"],
    },
  },
  {
    name: "edit_file",
    description: "Create, modify, or delete a file in the workspace",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file" },
        content: { type: "string", description: "New file content (empty string to delete)" },
        operation: { type: "string", enum: ["create", "modify", "delete"], description: "Operation type", default: "modify" },
      },
      required: ["path", "operation"],
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command in the workspace",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds", default: 30000 },
        cwd: { type: "string", description: "Working directory (relative to workspace root)" },
      },
      required: ["command"],
    },
  },
  {
    name: "screenshot",
    description: "Capture a screenshot of the running preview",
    parameters: {
      type: "object",
      properties: {
        viewport: { type: "string", enum: ["desktop", "mobile"], description: "Viewport size", default: "desktop" },
        url: { type: "string", description: "Optional URL to navigate to before screenshot" },
      },
      required: [],
    },
  },
  {
    name: "inspect_console",
    description: "Get browser console logs and errors from the preview",
    parameters: {
      type: "object",
      properties: {
        maxEntries: { type: "number", description: "Maximum log entries to return", default: 50 },
        filter: { type: "string", enum: ["error", "warning", "log", "all"], description: "Filter by log level", default: "all" },
      },
      required: [],
    },
  },
  {
    name: "inspect_dom",
    description: "Get interactive DOM elements from the preview page",
    parameters: {
      type: "object",
      properties: {
        maxItems: { type: "number", description: "Maximum elements to return", default: 50 },
        selector: { type: "string", description: "Optional CSS selector to filter elements" },
      },
      required: [],
    },
  },
  {
    name: "inspect_accessibility",
    description: "Get CDP accessibility tree snapshot from the preview",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL to check (defaults to current page)" },
      },
      required: [],
    },
  },
  {
    name: "git_diff",
    description: "Show git diff of changes in the isolated workspace",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes only", default: false },
        path: { type: "string", description: "Optional path to limit diff" },
      },
      required: [],
    },
  },
];

/**
 * Tool execution context passed to each tool
 */
export interface ToolExecutionContext {
  projectId: string;
  workspaceId: string;
  previewPort?: number;
  previewUrl?: string;
  browserSlot?: BrowserSlot;
}

/**
 * Execute a tool call and return the result
 */
export async function executeTool(
  toolCall: ToolCall,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { name, arguments: args } = toolCall;

  try {
    switch (name) {
      case "list_files":
        return await toolListFiles(args, context);

      case "read_file":
        return await toolReadFile(args, context);

      case "edit_file":
        return await toolEditFile(args, context);

      case "run_command":
        return await toolRunCommand(args, context);

      case "screenshot":
        return await toolScreenshot(args, context);

      case "inspect_console":
        return await toolInspectConsole(args, context);

      case "inspect_dom":
        return await toolInspectDom(args, context);

      case "inspect_accessibility":
        return await toolInspectAccessibility(args, context);

      case "git_diff":
        return await toolGitDiff(args, context);

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List files in the workspace
 */
async function toolListFiles(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = (args.pattern as string) || "**/*";
  const includeDirs = (args.includeDirs as boolean) || false;

  const entries = await listWorkspaceFiles(context.workspaceId);
  let files = entries.map((e) => ({
    path: e.path,
    name: e.name,
    type: e.type,
    size: e.size,
  }));

  // Simple glob matching
  if (pattern !== "**/*") {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    files = files.filter((f) => regex.test(f.path));
  }

  if (!includeDirs) {
    files = files.filter((f) => f.type === "file");
  }

  return { success: true, result: { files, count: files.length } };
}

/**
 * Read a file from the workspace
 */
async function toolReadFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = args.path as string;
  const maxChars = (args.maxChars as number) || 50000;

  if (!filePath) {
    return { success: false, error: "path is required" };
  }

  const safePath = safeWorkspacePath(filePath, context.workspaceId);
  if (!safePath) {
    return { success: false, error: "Path escapes the workspace" };
  }

  const content = await readWorkspaceFileText(filePath, context.workspaceId);
  return { success: true, result: { path: filePath, content: content.slice(0, maxChars), truncated: content.length > maxChars } };
}

/**
 * Create, modify, or delete a file in the workspace
 */
async function toolEditFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = args.path as string;
  const content = (args.content as string) || "";
  const operation = (args.operation as "create" | "modify" | "delete") || "modify";

  if (!filePath) {
    return { success: false, error: "path is required" };
  }

  const safePath = safeWorkspacePath(filePath, context.workspaceId);
  if (!safePath) {
    return { success: false, error: "Path escapes the workspace" };
  }

  if (operation === "delete") {
    const { deleteWorkspacePath } = await import("./workspace");
    await deleteWorkspacePath(filePath, context.workspaceId);
    return { success: true, result: { path: filePath, operation: "deleted" } };
  }

  await writeWorkspaceFile(filePath, content, context.workspaceId);
  return { success: true, result: { path: filePath, operation, bytes: content.length } };
}

/**
 * Run a shell command in the workspace
 */
async function toolRunCommand(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args.command as string;
  const timeoutMs = (args.timeoutMs as number) || 30000;
  const cwdRel = (args.cwd as string) || ".";
  const workspaceRoot = getWorkspaceRoot(context.workspaceId);
  const cwd = path.resolve(workspaceRoot, cwdRel);

  if (!cwd.startsWith(workspaceRoot)) {
    return { success: false, error: "Working directory escapes the workspace" };
  }

  return new Promise((resolve) => {
    const child = execFile(
      "/bin/bash",
      ["-lc", command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 10,
        killSignal: "SIGKILL",
        env: getWorkspaceCommandEnvironment(),
      },
      (err, stdout, stderr) => {
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: number | string }).code : 0;
        resolve({
          success: !err || (err as any).killed === false,
          result: {
            stdout: stdout?.slice(-10000) || "",
            stderr: stderr?.slice(-10000) || "",
            exitCode: err ? (typeof code === "number" ? code : 1) : 0,
            timedOut: (err as { killed?: boolean } | null)?.killed === true,
          },
        });
      },
    );
  });
}

/**
 * Capture a screenshot of the preview
 */
async function toolScreenshot(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const viewport = (args.viewport as ScreenshotViewport) || "desktop";
  const url = args.url as string;

  // Use browser pool
  const pool = getBrowserPool();
  const slot = await pool.acquire(`screenshot-${Date.now()}`);

  try {
    const targetUrl = url || context.previewUrl || `http://127.0.0.1:${context.previewPort}`;
    if (!targetUrl) {
      return { success: false, error: "No preview URL available and none provided" };
    }

    await pool.navigate(slot.id, targetUrl);
    const result = await pool.captureScreenshot(slot.id);

    if (!result.success) {
      return { success: false, error: result.error || "Screenshot failed" };
    }

    return { success: true, result: { viewport, url: targetUrl, image: result.data } };
  } finally {
    pool.release(slot.id);
  }
}

/**
 * Get browser console logs
 */
async function toolInspectConsole(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  // This would need to connect to an active preview page
  // For now, return a placeholder - actual implementation requires
  // connecting to a running browser page with console listener
  const maxEntries = (args.maxEntries as number) || 50;
  const filter = (args.filter as "error" | "warning" | "log" | "all") || "all";

  // TODO: Implement actual console capture from browser pool
  // This requires maintaining a persistent page connection
  return {
    success: true,
    result: {
      logs: [],
      message: "Console inspection requires an active preview agent session. Use /build/preview/agent for live console capture.",
      filter,
      maxEntries,
    },
  };
}

/**
 * Get interactive DOM elements
 */
async function toolInspectDom(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const maxItems = (args.maxItems as number) || 50;
  const selector = args.selector as string | undefined;

  const pool = getBrowserPool();
  const slot = await pool.acquire(`inspect-dom-${Date.now()}`);

  try {
    const targetUrl = context.previewUrl || `http://127.0.0.1:${context.previewPort}`;
    if (!targetUrl) {
      return { success: false, error: "No preview URL available" };
    }

    await pool.navigate(slot.id, targetUrl);
    const result = await pool.getInteractiveElements(slot.id, maxItems);

    if (!result.success) {
      return { success: false, error: result.error || "DOM inspection failed" };
    }

    let elements = result.data || [];
    if (selector) {
      // Filter by selector would require client-side evaluation
      // For now, return all elements
    }

    return { success: true, result: { elements: elements.slice(0, maxItems), count: elements.length, url: targetUrl } };
  } finally {
    pool.release(slot.id);
  }
}

/**
 * Get CDP accessibility tree
 */
async function toolInspectAccessibility(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args.url as string | undefined;

  const pool = getBrowserPool();
  const slot = await pool.acquire(`inspect-a11y-${Date.now()}`);

  try {
    const targetUrl = url || context.previewUrl || `http://127.0.0.1:${context.previewPort}`;
    if (!targetUrl) {
      return { success: false, error: "No preview URL available" };
    }

    await pool.navigate(slot.id, targetUrl);
    const snapshot = await pool.captureAccessibility(slot.id);

    if (!snapshot) {
      return { success: false, error: "Failed to capture accessibility tree" };
    }

    return { success: true, result: snapshot };
  } finally {
    pool.release(slot.id);
  }
}

/**
 * Show git diff of changes
 */
async function toolGitDiff(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const staged = (args.staged as boolean) || false;
  const diffPath = args.path as string | undefined;

  if (!hasIsolated(context.projectId)) {
    return { success: false, error: "No isolated workspace for this project" };
  }

  const worktreePath = isolatedPath(context.projectId);
  const gitArgs = ["diff"];
  if (staged) gitArgs.push("--cached");
  if (diffPath) gitArgs.push(diffPath);

  const result = await runGit(worktreePath, gitArgs);

  return {
    success: result.ok,
    result: { diff: result.stdout, path: diffPath, staged },
    error: result.ok ? undefined : result.stderr,
  };
}

/**
 * Execute multiple tool calls in sequence
 */
export async function executeToolSequence(
  toolCalls: ToolCall[],
  context: ToolExecutionContext,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of toolCalls) {
    const result = await executeTool(call, context);
    results.push(result);
    // Stop on error if needed
    if (!result.success && call.name !== "run_command") {
      // Continue on run_command errors (they might be expected)
    }
  }
  return results;
}

/**
 * Format tool results for injection into LLM prompt
 */
export function formatToolResults(results: ToolResult[]): string {
  return results
    .map((r, i) => {
      const prefix = r.success ? "✓" : "✗";
      const data = r.result ? JSON.stringify(r.result, null, 2).slice(0, 2000) : "";
      const error = r.error ? `ERROR: ${r.error}` : "";
      return `${prefix} Tool ${i + 1} Result:\n${data}\n${error}`;
    })
    .join("\n\n");
}

/**
 * Tool failure categories for targeted recovery
 */
export type ToolFailureCategory =
  | "npm_install"
  | "browser_error"
  | "compilation_error"
  | "network_failure"
  | "permission_denied"
  | "disk_full"
  | "timeout"
  | "git_conflict"
  | "unknown";

/**
 * Tool failure diagnosis result
 */
export interface ToolFailureDiagnosis {
  category: ToolFailureCategory;
  rootCause: string;
  suggestedAction: ToolRecoveryAction;
  confidence: number; // 0-1
  retryable: boolean;
}

/**
 * Recovery action types
 */
export type ToolRecoveryAction =
  | "retry_same"
  | "retry_alternative"
  | "fallback_tool"
  | "escalate_to_diagnostic"
  | "require_human"
  | "abort";

/**
 * Diagnostic agent for specific tool failures
 */
export interface DiagnosticAgent {
  name: string;
  toolTypes: string[];
  diagnose: (error: Error, context: ToolExecutionContext, args: Record<string, unknown>) => Promise<ToolFailureDiagnosis>;
  recover: (diagnosis: ToolFailureDiagnosis, context: ToolExecutionContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Circuit breaker state for tool failure patterns
 */
export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  threshold: number;
  timeout: number;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

/**
 * Classify a tool error into a failure category
 */
export function classifyToolError(error: Error, toolName: string, args: Record<string, unknown>): ToolFailureCategory {
  const message = error.message.toLowerCase();
  const command = (args.command as string)?.toLowerCase() || "";

  // npm install failures
  if (toolName === "run_command" && (command.includes("npm install") || command.includes("pnpm install") || command.includes("yarn install"))) {
    if (message.includes("eacces") || message.includes("eperm")) return "permission_denied";
    if (message.includes("enospc") || message.includes("disk full")) return "disk_full";
    if (message.includes("timeout") || message.includes("etimedout")) return "timeout";
    if (message.includes("network") || message.includes("enotfound") || message.includes("econnrefused")) return "network_failure";
    return "npm_install";
  }

  // Browser errors
  if (["screenshot", "inspect_dom", "inspect_console", "inspect_accessibility"].includes(toolName)) {
    if (message.includes("browser") || message.includes("chromium") || message.includes("puppeteer") || message.includes("cdp")) {
      return "browser_error";
    }
    if (message.includes("timeout")) return "timeout";
    if (message.includes("network") || message.includes("connection")) return "network_failure";
    return "browser_error";
  }

  // Compilation errors (TypeScript, build commands)
  if (toolName === "run_command" && (command.includes("tsc") || command.includes("vite build") || command.includes("next build") || command.includes("webpack") || command.includes("esbuild"))) {
    if (message.includes("error ts") || message.includes("type error") || message.includes("cannot find")) return "compilation_error";
    return "compilation_error";
  }

  // Git conflicts
  if (toolName === "run_command" && command.includes("git ") && (message.includes("conflict") || message.includes("merge"))) {
    return "git_conflict";
  }

  // Network failures
  if (message.includes("enotfound") || message.includes("econnrefused") || message.includes("etimedout") || message.includes("socket hang up") || message.includes("network")) {
    return "network_failure";
  }

  // Disk full
  if (message.includes("enospc") || message.includes("disk full") || message.includes("no space")) {
    return "disk_full";
  }

  // Timeout
  if (message.includes("timeout") || message.includes("etimedout")) {
    return "timeout";
  }

  // Permission denied
  if (message.includes("eacces") || message.includes("eperm") || message.includes("permission denied")) {
    return "permission_denied";
  }

  return "unknown";
}

/**
 * Check circuit breaker for a tool
 */
export function checkCircuitBreaker(toolName: string): { allowed: boolean; reason?: string } {
  const breaker = circuitBreakers.get(toolName);
  if (!breaker) return { allowed: true };

  const now = Date.now();

  if (breaker.state === "open") {
    if (now - breaker.lastFailure > breaker.timeout) {
      // Half-open: allow one request
      breaker.state = "half-open";
      return { allowed: true };
    }
    return { allowed: false, reason: `Circuit breaker open for ${toolName} (${breaker.failures} failures)` };
  }

  return { allowed: true };
}

/**
 * Record tool failure for circuit breaker
 */
export function recordToolFailure(toolName: string): void {
  const now = Date.now();
  const breaker = circuitBreakers.get(toolName) || { failures: 0, lastFailure: 0, state: "closed", threshold: 5, timeout: 60000 };

  breaker.failures++;
  breaker.lastFailure = now;

  if (breaker.failures >= breaker.threshold) {
    breaker.state = "open";
  }

  circuitBreakers.set(toolName, breaker);
}

/**
 * Record tool success (resets circuit breaker)
 */
export function recordToolSuccess(toolName: string): void {
  const breaker = circuitBreakers.get(toolName);
  if (breaker) {
    breaker.failures = 0;
    breaker.state = "closed";
  }
}

/**
 * Get circuit breaker status for all tools
 */
export function getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
  const result: Record<string, CircuitBreakerState> = {};
  for (const [name, state] of circuitBreakers) {
    result[name] = { ...state };
  }
  return result;
}

/**
 * Reset circuit breaker for a tool
 */
export function resetCircuitBreaker(toolName: string): void {
  circuitBreakers.delete(toolName);
}

/**
 * Resilient tool execution wrapper with diagnosis and recovery
 */
export async function executeToolResilient(
  toolCall: ToolCall,
  context: ToolExecutionContext,
  options: {
    maxRetries?: number;
    enableDiagnostics?: boolean;
    enableCircuitBreaker?: boolean;
    onRecovery?: (action: ToolRecoveryAction, diagnosis: ToolFailureDiagnosis) => void;
  } = {}
): Promise<ToolResult> {
  const { maxRetries = 3, enableDiagnostics = true, enableCircuitBreaker = true, onRecovery } = options;
  const { name, arguments: args } = toolCall;

  // Check circuit breaker
  if (enableCircuitBreaker) {
    const cbCheck = checkCircuitBreaker(name);
    if (!cbCheck.allowed) {
      return { success: false, error: cbCheck.reason };
    }
  }

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const result = await executeTool(toolCall, context);

      if (result.success) {
        if (enableCircuitBreaker) recordToolSuccess(name);
        return result;
      }

      // Tool returned failure (not exception)
      lastError = new Error(result.error || "Tool returned failure");

      if (enableDiagnostics && attempt < maxRetries) {
        const diagnosis = await diagnoseToolFailure(lastError, name, context, args);

        if (diagnosis.retryable && diagnosis.suggestedAction !== "abort" && diagnosis.suggestedAction !== "require_human") {
          // Try recovery
          const recoveryResult = await attemptRecovery(diagnosis, toolCall, context);

          if (onRecovery) onRecovery(diagnosis.suggestedAction, diagnosis);

          if (recoveryResult.success) {
            if (enableCircuitBreaker) recordToolSuccess(name);
            return recoveryResult;
          }

          // Recovery failed, continue to retry
          lastError = new Error(recoveryResult.error || "Recovery failed");
        } else {
          // Non-retryable or requires human/escalation
          if (onRecovery) onRecovery(diagnosis.suggestedAction, diagnosis);
          if (enableCircuitBreaker) recordToolFailure(name);
          return { success: false, error: `${diagnosis.rootCause}. Suggested: ${diagnosis.suggestedAction}` };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (enableDiagnostics && attempt < maxRetries) {
        const diagnosis = await diagnoseToolFailure(lastError, name, context, args);

        if (diagnosis.retryable && diagnosis.suggestedAction !== "abort" && diagnosis.suggestedAction !== "require_human") {
          const recoveryResult = await attemptRecovery(diagnosis, toolCall, context);

          if (onRecovery) onRecovery(diagnosis.suggestedAction, diagnosis);

          if (recoveryResult.success) {
            if (enableCircuitBreaker) recordToolSuccess(name);
            return recoveryResult;
          }

          lastError = new Error(recoveryResult.error || "Recovery failed");
        } else {
          if (onRecovery) onRecovery(diagnosis.suggestedAction, diagnosis);
          if (enableCircuitBreaker) recordToolFailure(name);
          return { success: false, error: `${diagnosis.rootCause}. Suggested: ${diagnosis.suggestedAction}` };
        }
      }
    }

    attempt++;

    // Exponential backoff between retries
    if (attempt <= maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // All retries exhausted
  if (enableCircuitBreaker) recordToolFailure(name);
  return {
    success: false,
    error: `Tool ${name} failed after ${maxRetries + 1} attempts: ${lastError?.message}`
  };
}

/**
 * Diagnose a tool failure and determine recovery strategy
 */
export async function diagnoseToolFailure(
  error: Error,
  toolName: string,
  context: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<ToolFailureDiagnosis> {
  const category = classifyToolError(error, toolName, args);

  // Default diagnosis
  let diagnosis: ToolFailureDiagnosis = {
    category,
    rootCause: error.message,
    suggestedAction: "retry_same",
    confidence: 0.5,
    retryable: true,
  };

  // Tool-specific diagnosis
  switch (category) {
    case "npm_install":
      diagnosis = await diagnoseNpmInstall(error, args);
      break;
    case "browser_error":
      diagnosis = await diagnoseBrowserError(error, toolName, context);
      break;
    case "compilation_error":
      diagnosis = await diagnoseCompilationError(error, args);
      break;
    case "network_failure":
      diagnosis = { category, rootCause: error.message, suggestedAction: "retry_same", confidence: 0.8, retryable: true };
      break;
    case "timeout":
      diagnosis = { category, rootCause: error.message, suggestedAction: "retry_alternative", confidence: 0.7, retryable: true };
      break;
    case "disk_full":
      diagnosis = { category, rootCause: error.message, suggestedAction: "require_human", confidence: 0.9, retryable: false };
      break;
    case "permission_denied":
      diagnosis = { category, rootCause: error.message, suggestedAction: "require_human", confidence: 0.9, retryable: false };
      break;
    case "git_conflict":
      diagnosis = { category, rootCause: error.message, suggestedAction: "fallback_tool", confidence: 0.8, retryable: true };
      break;
    default:
      diagnosis = { category, rootCause: error.message, suggestedAction: "retry_same", confidence: 0.3, retryable: true };
  }

  return diagnosis;
}

/**
 * Diagnose npm install failures
 */
async function diagnoseNpmInstall(error: Error, args: Record<string, unknown>): Promise<ToolFailureDiagnosis> {
  const message = error.message.toLowerCase();
  const command = (args.command as string)?.toLowerCase() || "";

  if (message.includes("eacces") || message.includes("eperm")) {
    return { category: "npm_install", rootCause: "Permission denied on node_modules", suggestedAction: "require_human", confidence: 0.95, retryable: false };
  }

  if (message.includes("enospc")) {
    return { category: "npm_install", rootCause: "Disk full during install", suggestedAction: "require_human", confidence: 0.95, retryable: false };
  }

  if (message.includes("peer dependency") || message.includes("eresolve")) {
    return { category: "npm_install", rootCause: "Peer dependency conflict", suggestedAction: "retry_alternative", confidence: 0.85, retryable: true };
  }

  if (message.includes("integrity") || message.includes("checksum")) {
    return { category: "npm_install", rootCause: "Package integrity/checksum mismatch", suggestedAction: "retry_alternative", confidence: 0.8, retryable: true };
  }

  if (message.includes("network") || message.includes("enotfound") || message.includes("econnrefused")) {
    return { category: "npm_install", rootCause: "Network failure downloading packages", suggestedAction: "retry_same", confidence: 0.9, retryable: true };
  }

  if (message.includes("timeout") || message.includes("etimedout")) {
    return { category: "npm_install", rootCause: "Install timeout", suggestedAction: "retry_alternative", confidence: 0.8, retryable: true };
  }

  if (command.includes("npm install") && !command.includes("pnpm")) {
    // Suggest pnpm as alternative
    return { category: "npm_install", rootCause: "npm install failed", suggestedAction: "retry_alternative", confidence: 0.7, retryable: true };
  }

  return { category: "npm_install", rootCause: error.message, suggestedAction: "retry_same", confidence: 0.4, retryable: true };
}

/**
 * Diagnose browser-related failures
 */
async function diagnoseBrowserError(error: Error, toolName: string, context: ToolExecutionContext): Promise<ToolFailureDiagnosis> {
  const message = error.message.toLowerCase();

  if (message.includes("browser") || message.includes("chromium") || message.includes("puppeteer")) {
    if (message.includes("executable") || message.includes("not found")) {
      return { category: "browser_error", rootCause: "Browser executable not found", suggestedAction: "require_human", confidence: 0.95, retryable: false };
    }

    if (message.includes("crash") || message.includes("killed") || message.includes("exit code")) {
      return { category: "browser_error", rootCause: "Browser process crashed", suggestedAction: "retry_alternative", confidence: 0.8, retryable: true };
    }

    if (message.includes("timeout") || message.includes("navigation")) {
      return { category: "browser_error", rootCause: "Page navigation/operation timeout", suggestedAction: "retry_alternative", confidence: 0.75, retryable: true };
    }

    if (message.includes("cdp") || message.includes("protocol")) {
      return { category: "browser_error", rootCause: "CDP protocol error", suggestedAction: "retry_alternative", confidence: 0.7, retryable: true };
    }

    if (message.includes("context") || message.includes("detached") || message.includes("frame")) {
      return { category: "browser_error", rootCause: "Browser context/frame detached", suggestedAction: "retry_alternative", confidence: 0.8, retryable: true };
    }
  }

  return { category: "browser_error", rootCause: error.message, suggestedAction: "retry_alternative", confidence: 0.5, retryable: true };
}

/**
 * Diagnose compilation/build failures
 */
async function diagnoseCompilationError(error: Error, args: Record<string, unknown>): Promise<ToolFailureDiagnosis> {
  const message = error.message.toLowerCase();

  if (message.includes("error ts") || message.includes("typescript")) {
    const tsErrorMatch = message.match(/error ts(\d+)/i);
    const errorCode = tsErrorMatch ? parseInt(tsErrorMatch[1], 10) : 0;

    // Common fixable TypeScript errors
    if ([2304, 2307, 2322, 2339, 2345, 2554, 2769].includes(errorCode)) {
      return { category: "compilation_error", rootCause: `TypeScript error TS${errorCode}`, suggestedAction: "escalate_to_diagnostic", confidence: 0.8, retryable: true };
    }

    return { category: "compilation_error", rootCause: `TypeScript error ${message}`, suggestedAction: "escalate_to_diagnostic", confidence: 0.7, retryable: true };
  }

  if (message.includes("module not found") || message.includes("cannot find module")) {
    return { category: "compilation_error", rootCause: "Missing module/import", suggestedAction: "escalate_to_diagnostic", confidence: 0.85, retryable: true };
  }

  if (message.includes("syntax error") || message.includes("unexpected token")) {
    return { category: "compilation_error", rootCause: "Syntax error in source", suggestedAction: "escalate_to_diagnostic", confidence: 0.9, retryable: true };
  }

  return { category: "compilation_error", rootCause: error.message, suggestedAction: "escalate_to_diagnostic", confidence: 0.5, retryable: true };
}

/**
 * Attempt recovery based on diagnosis
 */
async function attemptRecovery(
  diagnosis: ToolFailureDiagnosis,
  toolCall: ToolCall,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const { name, arguments: args } = toolCall;

  switch (diagnosis.suggestedAction) {
    case "retry_same":
      // Just retry the same tool call
      return await executeTool(toolCall, context);

    case "retry_alternative":
      return await retryWithAlternative(name, args, context, diagnosis, toolCall);

    case "fallback_tool":
      return await fallbackToAlternativeTool(name, args, context, diagnosis);

    case "escalate_to_diagnostic":
      return await escalateToDiagnosticAgent(name, args, context, diagnosis);

    case "require_human":
      return { success: false, error: `Requires human intervention: ${diagnosis.rootCause}` };

    case "abort":
      return { success: false, error: `Aborted: ${diagnosis.rootCause}` };

    default:
      return { success: false, error: `Unknown recovery action: ${diagnosis.suggestedAction}` };
  }
}

/**
 * Retry with alternative approach (e.g., pnpm instead of npm)
 */
async function retryWithAlternative(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  diagnosis: ToolFailureDiagnosis,
  originalToolCall: ToolCall
): Promise<ToolResult> {
  if (toolName === "run_command") {
    const command = (args.command as string) || "";

    // npm -> pnpm fallback
    if (command.includes("npm install") && !command.includes("pnpm")) {
      const pnpmCommand = command.replace("npm install", "pnpm install");
      const altCall: ToolCall = { ...originalToolCall, arguments: { ...args, command: pnpmCommand } };
      return await executeTool(altCall, context);
    }

    // pnpm -> npm fallback (if pnpm failed)
    if (command.includes("pnpm install")) {
      const npmCommand = command.replace("pnpm install", "npm install");
      const altCall: ToolCall = { ...originalToolCall, arguments: { ...args, command: npmCommand } };
      return await executeTool(altCall, context);
    }

    // Increase timeout for timeout failures
    if (diagnosis.category === "timeout") {
      const altCall: ToolCall = { ...originalToolCall, arguments: { ...args, timeoutMs: (args.timeoutMs as number || 30000) * 2 } };
      return await executeTool(altCall, context);
    }
  }

  if (["screenshot", "inspect_dom", "inspect_console", "inspect_accessibility"].includes(toolName)) {
    // Browser errors: try releasing and re-acquiring slot
    // The browser pool handles this internally, but we can try a fresh slot
    return await executeTool(originalToolCall, context);
  }

  // Default: just retry
  return await executeTool(originalToolCall, context);
}

/**
 * Fallback to a different tool that can achieve similar result
 */
async function fallbackToAlternativeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  diagnosis: ToolFailureDiagnosis
): Promise<ToolResult> {
  if (toolName === "git_diff" && diagnosis.category === "git_conflict") {
    // For git conflicts, try running git status instead
    const statusCall: ToolCall = { name: "run_command", arguments: { command: "git status --porcelain" } };
    return await executeTool(statusCall, context);
  }

  if (["inspect_dom", "inspect_console", "inspect_accessibility"].includes(toolName)) {
    // Browser inspection failed -> try screenshot as fallback
    const screenshotCall: ToolCall = { name: "screenshot", arguments: { viewport: args.viewport || "desktop" } };
    return await executeTool(screenshotCall, context);
  }

  // No fallback available
  return { success: false, error: `No fallback tool available for ${toolName}` };
}

/**
 * Escalate to a specialized diagnostic agent
 */
async function escalateToDiagnosticAgent(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  diagnosis: ToolFailureDiagnosis
): Promise<ToolResult> {
  // For compilation errors, we'd invoke a specialized fixer agent
  // This is a placeholder - in practice this would call an LLM-based diagnostic agent

  if (diagnosis.category === "compilation_error") {
    return {
      success: false,
      error: `Compilation error requires diagnostic agent: ${diagnosis.rootCause}`,
      data: {
        escalated: true,
        diagnosticType: "compilation",
        suggestedAgent: "typescript-fixer",
        originalError: diagnosis.rootCause,
      }
    };
  }

  return { success: false, error: `No diagnostic agent available for ${diagnosis.category}` };
}

/**
 * Built-in diagnostic agents for common tool failures
 */
export const BUILTIN_DIAGNOSTIC_AGENTS: DiagnosticAgent[] = [
  {
    name: "npm-install-fixer",
    toolTypes: ["run_command"],
    diagnose: async (error, context, args) => diagnoseNpmInstall(error, args),
    recover: async (diagnosis, context, args) => {
      if (diagnosis.suggestedAction === "retry_alternative") {
        // Create a mock toolCall for the recovery
        const mockToolCall: ToolCall = { name: "run_command", arguments: args };
        return await retryWithAlternative("run_command", args, context, diagnosis, mockToolCall);
      }
      return { success: false, error: "npm-install-fixer: no recovery available" };
    },
  },
  {
    name: "browser-recovery",
    toolTypes: ["screenshot", "inspect_dom", "inspect_console", "inspect_accessibility"],
    diagnose: async (error, context, args) => diagnoseBrowserError(error, "browser", context),
    recover: async (diagnosis, context, args) => {
      if (diagnosis.suggestedAction === "retry_alternative") {
        const mockToolCall: ToolCall = { name: "browser", arguments: args };
        return await retryWithAlternative("browser", args, context, diagnosis, mockToolCall);
      }
      return { success: false, error: "browser-recovery: no recovery available" };
    },
  },
  {
    name: "compilation-fixer",
    toolTypes: ["run_command"],
    diagnose: async (error, context, args) => diagnoseCompilationError(error, args),
    recover: async (diagnosis, context, args) => {
      if (diagnosis.suggestedAction === "escalate_to_diagnostic") {
        return await escalateToDiagnosticAgent("run_command", args, context, diagnosis);
      }
      return { success: false, error: "compilation-fixer: no recovery available" };
    },
  },
];

/**
 * Get diagnostic agent for a tool type
 */
export function getDiagnosticAgent(toolName: string): DiagnosticAgent | undefined {
  return BUILTIN_DIAGNOSTIC_AGENTS.find(agent => agent.toolTypes.includes(toolName));
}