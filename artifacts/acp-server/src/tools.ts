/**
 * ACP Tool Registry - Maps Infinity tools to ACP tool definitions
 */

import { type ACPTool } from "./types";

export const ACP_TOOLS: ACPTool[] = [
  // File operations
  {
    name: "list_files",
    description: "List files in the project workspace",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        path: { type: "string", description: "Directory path (optional)", default: "." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the project workspace",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        path: { type: "string", description: "File path" },
      },
      required: ["projectId", "path"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a file in the project workspace (create or modify)",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "New file content" },
      },
      required: ["projectId", "path", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the project workspace",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        path: { type: "string", description: "File path" },
      },
      required: ["projectId", "path"],
    },
  },

  // Command execution
  {
    name: "run_command",
    description: "Run a shell command in the project workspace",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        command: { type: "string", description: "Command to run" },
        cwd: { type: "string", description: "Working directory (optional)" },
        timeout: { type: "number", description: "Timeout in ms (default 120000)" },
      },
      required: ["projectId", "command"],
    },
  },

  // Git operations
  {
    name: "git_status",
    description: "Get git status of the project workspace",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "git_diff",
    description: "Get git diff of the project workspace",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        staged: { type: "boolean", description: "Show staged changes only", default: false },
      },
      required: ["projectId"],
    },
  },
  {
    name: "git_commit",
    description: "Commit changes in the project workspace",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        message: { type: "string", description: "Commit message" },
        addAll: { type: "boolean", description: "Stage all changes before commit", default: true },
      },
      required: ["projectId", "message"],
    },
  },

  // Build agent operations
  {
    name: "build_agent_run",
    description: "Start a multi-agent build orchestration",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        goal: { type: "string", description: "Build goal/description" },
        model: { type: "string", description: "Model to use (optional)" },
      },
      required: ["projectId", "goal"],
    },
  },
  {
    name: "build_agent_step",
    description: "Execute a single build step",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        step: { type: "object", description: "Build step definition" },
      },
      required: ["projectId", "step"],
    },
  },

  // Project memory
  {
    name: "project_memory_read",
    description: "Read project memory",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        key: { type: "string", description: "Memory key (optional, reads all if omitted)" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "project_memory_write",
    description: "Write to project memory",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        key: { type: "string", description: "Memory key" },
        value: { type: "string", description: "Memory value" },
      },
      required: ["projectId", "key", "value"],
    },
  },

  // Research
  {
    name: "research_run",
    description: "Run a research query",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        query: { type: "string", description: "Research query" },
        depth: { type: "string", enum: ["standard", "deep", "quantum", "omni"], default: "deep" },
        sources: { type: "array", items: { type: "string" }, description: "Specific sources to search" },
      },
      required: ["projectId", "query"],
    },
  },
  {
    name: "research_extract",
    description: "Extract information from research results",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        researchId: { type: "string", description: "Research ID" },
        query: { type: "string", description: "Extraction query" },
      },
      required: ["projectId", "researchId", "query"],
    },
  },

  // Browser
  {
    name: "browser_navigate",
    description: "Navigate browser to a URL",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        url: { type: "string", description: "URL to navigate to" },
      },
      required: ["projectId", "url"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current browser page",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        fullPage: { type: "boolean", description: "Capture full page", default: false },
      },
      required: ["projectId"],
    },
  },
  {
    name: "browser_action",
    description: "Perform an action in the browser (click, type, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        action: { type: "string", enum: ["click", "type", "scroll", "wait", "back", "forward", "reload"] },
        selector: { type: "string", description: "CSS selector for click/type" },
        text: { type: "string", description: "Text to type (for type action)" },
      },
      required: ["projectId", "action"],
    },
  },
];

export function getACPTools(): ACPTool[] {
  return ACP_TOOLS;
}

export function getACPTool(name: string): ACPTool | undefined {
  return ACP_TOOLS.find(t => t.name === name);
}