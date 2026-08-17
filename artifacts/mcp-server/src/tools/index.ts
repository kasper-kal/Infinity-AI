/**
 * MCP Tool definitions for Infinity
 *
 * Each tool maps to an Infinity API endpoint or local capability.
 * Tools are scoped to a projectId from the MCP client config.
 */

import axios from "axios";
import { z } from "zod";
import type { AuthResult } from "../auth.js";

export interface McpToolContext {
  apiBaseUrl: string;
  apiKey: string;
  projectId: string;
  auth: AuthResult;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  scopes: string[];
  handler: (args: unknown, ctx: McpToolContext) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

const apiHeaders = (ctx: McpToolContext) => ({
  Authorization: `Bearer ${ctx.apiKey}`,
  "X-API-Key": ctx.apiKey,
  "Content-Type": "application/json",
});

async function apiGet(ctx: McpToolContext, path: string): Promise<any> {
  const r = await axios.get(`${ctx.apiBaseUrl}${path}`, { headers: apiHeaders(ctx), timeout: 60000 });
  return r.data;
}

async function apiPost(ctx: McpToolContext, path: string, body: any): Promise<any> {
  const r = await axios.post(`${ctx.apiBaseUrl}${path}`, body, { headers: apiHeaders(ctx), timeout: 120000 });
  return r.data;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function json(data: unknown) {
  return ok("```json\n" + JSON.stringify(data, null, 2) + "\n```");
}

// ---------------------------------------------------------------------------
// File tools (from build-tools.ts via API)
// ---------------------------------------------------------------------------

const listFilesTool: McpTool = {
  name: "list_files",
  description: "List all files in the Infinity workspace, optionally filtered by glob pattern",
  scopes: ["build:read"],
  inputSchema: z.object({
    pattern: z.string().optional().describe("Glob pattern to filter files (e.g. '*.ts', 'src/**')"),
    includeDirs: z.boolean().optional().describe("Include directories in results"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiGet(ctx, `/api/jarvis/workspace/list?projectId=${ctx.projectId}&pattern=${encodeURIComponent(a.pattern || "**/*")}`);
    return json(data);
  },
};

const readFileTool: McpTool = {
  name: "read_file",
  description: "Read the content of a file in the Infinity workspace",
  scopes: ["build:read"],
  inputSchema: z.object({
    path: z.string().describe("Relative path to the file"),
    maxChars: z.number().optional().describe("Maximum characters to read"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiGet(ctx, `/api/jarvis/workspace/read?projectId=${ctx.projectId}&path=${encodeURIComponent(a.path)}`);
    return ok(data.content || "");
  },
};

const editFileTool: McpTool = {
  name: "edit_file",
  description: "Create, modify, or delete a file in the Infinity workspace",
  scopes: ["build:write"],
  inputSchema: z.object({
    path: z.string().describe("Relative path to the file"),
    content: z.string().optional().describe("New file content (empty string to delete)"),
    operation: z.enum(["create", "modify", "delete"]).optional().describe("Operation type"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/workspace/write`, {
      projectId: ctx.projectId,
      path: a.path,
      content: a.content || "",
      operation: a.operation || "modify",
    });
    return json(data);
  },
};

const runCommandTool: McpTool = {
  name: "run_command",
  description: "Execute a shell command in the Infinity workspace",
  scopes: ["build:write"],
  inputSchema: z.object({
    command: z.string().describe("Shell command to execute"),
    timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
    cwd: z.string().optional().describe("Working directory (relative to workspace root)"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/workspace/command`, {
      projectId: ctx.projectId,
      command: a.command,
      timeoutMs: a.timeoutMs,
      cwd: a.cwd,
    });
    return json(data);
  },
};

// ---------------------------------------------------------------------------
// Git tools
// ---------------------------------------------------------------------------

const gitDiffTool: McpTool = {
  name: "git_diff",
  description: "Show git diff of changes in the isolated workspace",
  scopes: ["build:read"],
  inputSchema: z.object({
    staged: z.boolean().optional().describe("Show staged changes only"),
    path: z.string().optional().describe("Optional path to limit diff"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const qs = new URLSearchParams({ projectId: ctx.projectId });
    if (a.staged) qs.set("staged", "true");
    if (a.path) qs.set("path", a.path);
    const data = await apiGet(ctx, `/api/jarvis/build/git-diff?${qs.toString()}`);
    return ok(data.diff || "(no changes)");
  },
};

const gitStatusTool: McpTool = {
  name: "git_status",
  description: "Show git status of the isolated workspace",
  scopes: ["build:read"],
  inputSchema: z.object({}),
  handler: async (args, ctx) => {
    const data = await apiGet(ctx, `/api/jarvis/build/git-status?projectId=${ctx.projectId}`);
    return ok(data.status || "");
  },
};

const gitCommitTool: McpTool = {
  name: "git_commit",
  description: "Commit changes in the isolated workspace with a message",
  scopes: ["build:write"],
  inputSchema: z.object({
    message: z.string().describe("Commit message"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/build/git-commit`, {
      projectId: ctx.projectId,
      message: a.message,
    });
    return json(data);
  },
};

// ---------------------------------------------------------------------------
// Build Agent tools
// ---------------------------------------------------------------------------

const buildAgentRunTool: McpTool = {
  name: "build_agent_run",
  description: "Run the autonomous Infinity build agent for a goal",
  scopes: ["build:write"],
  inputSchema: z.object({
    goal: z.string().describe("The goal/description for the agent to implement"),
    maxIterations: z.number().optional().describe("Maximum iterations"),
    verify: z.boolean().optional().describe("Run verification after each step"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/build/agent/run`, {
      projectId: ctx.projectId,
      goal: a.goal,
      maxIterations: a.maxIterations,
      verify: a.verify,
    });
    return json(data);
  },
};

const buildAgentStepTool: McpTool = {
  name: "build_agent_step",
  description: "Run the build agent for a specific plan step",
  scopes: ["build:write"],
  inputSchema: z.object({
    stepId: z.string().describe("The plan step ID to execute"),
    goal: z.string().optional().describe("Override goal for this step"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/build/agent/step`, {
      projectId: ctx.projectId,
      stepId: a.stepId,
      goal: a.goal,
    });
    return json(data);
  },
};

// ---------------------------------------------------------------------------
// Project Memory tools
// ---------------------------------------------------------------------------

const projectMemoryReadTool: McpTool = {
  name: "project_memory_read",
  description: "Read project-scoped memory (durable project facts)",
  scopes: ["build:read"],
  inputSchema: z.object({
    query: z.string().optional().describe("Keyword query to search memory"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const qs = new URLSearchParams({ projectId: ctx.projectId });
    if (a.query) qs.set("query", a.query);
    const data = await apiGet(ctx, `/api/jarvis/projects/${ctx.projectId}/memory?${qs.toString()}`);
    return json(data);
  },
};

const projectMemoryWriteTool: McpTool = {
  name: "project_memory_write",
  description: "Write a project-scoped memory entry",
  scopes: ["build:write"],
  inputSchema: z.object({
    key: z.string().describe("Canonical key for the memory"),
    value: z.string().describe("Memory content"),
    pinned: z.boolean().optional().describe("Pin this memory (always retrieved)"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/projects/${ctx.projectId}/memory`, {
      key: a.key,
      value: a.value,
      pinned: a.pinned,
    });
    return json(data);
  },
};

// ---------------------------------------------------------------------------
// Research tools
// ---------------------------------------------------------------------------

const researchRunTool: McpTool = {
  name: "research_run",
  description: "Start a deep research job",
  scopes: ["research:write"],
  inputSchema: z.object({
    prompt: z.string().describe("Research question/prompt"),
    title: z.string().optional().describe("Optional title"),
    mode: z.enum(["agent", "normal", "both"]).optional().describe("Research mode"),
    depth: z.enum(["standard", "deep", "quantum", "omni"]).optional().describe("Research depth"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/research`, {
      projectId: ctx.projectId,
      prompt: a.prompt,
      title: a.title,
      mode: a.mode,
      depth: a.depth,
    });
    return json(data);
  },
};

const researchExtractTool: McpTool = {
  name: "research_extract",
  description: "Get the results/extract of a research job",
  scopes: ["research:read"],
  inputSchema: z.object({
    jobId: z.string().describe("Research job ID"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiGet(ctx, `/api/jarvis/research/${a.jobId}`);
    return json(data);
  },
};

// ---------------------------------------------------------------------------
// Browser tools
// ---------------------------------------------------------------------------

const browserNavigateTool: McpTool = {
  name: "browser_navigate",
  description: "Navigate the Infinity browser preview to a URL",
  scopes: ["build:write"],
  inputSchema: z.object({
    url: z.string().describe("URL to navigate to"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/build/browser/navigate`, {
      projectId: ctx.projectId,
      url: a.url,
    });
    return json(data);
  },
};

const browserScreenshotTool: McpTool = {
  name: "browser_screenshot",
  description: "Capture a screenshot of the Infinity browser preview",
  scopes: ["build:read"],
  inputSchema: z.object({
    viewport: z.enum(["desktop", "mobile"]).optional().describe("Viewport size"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/build/browser/screenshot`, {
      projectId: ctx.projectId,
      viewport: a.viewport || "desktop",
    });
    return json(data);
  },
};

const browserActionTool: McpTool = {
  name: "browser_action",
  description: "Perform an action (click, type, scroll) in the Infinity browser preview",
  scopes: ["build:write"],
  inputSchema: z.object({
    action: z.enum(["click", "type", "scroll", "press"]).describe("Action type"),
    selector: z.string().optional().describe("CSS selector for the element"),
    value: z.string().optional().describe("Value for type/press actions"),
  }),
  handler: async (args, ctx) => {
    const a = args as any;
    const data = await apiPost(ctx, `/api/jarvis/build/browser/action`, {
      projectId: ctx.projectId,
      action: a.action,
      selector: a.selector,
      value: a.value,
    });
    return json(data);
  },
};

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const MCP_TOOLS: McpTool[] = [
  listFilesTool,
  readFileTool,
  editFileTool,
  runCommandTool,
  gitDiffTool,
  gitStatusTool,
  gitCommitTool,
  buildAgentRunTool,
  buildAgentStepTool,
  projectMemoryReadTool,
  projectMemoryWriteTool,
  researchRunTool,
  researchExtractTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserActionTool,
];

export function getTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}
