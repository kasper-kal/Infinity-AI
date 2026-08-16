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