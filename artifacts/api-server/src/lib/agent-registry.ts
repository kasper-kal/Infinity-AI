import { LLMCapabilities } from "./llm-adapter";
import { TOOL_DEFINITIONS } from "./build-tools";

export type AgentRole = "planner" | "coder" | "reviewer" | "fixer";

export interface AgentRoleConfig {
  role: AgentRole;
  promptRole: "planner" | "coder" | "reviewer" | "fixer";
  temperature: number;
  maxIterations: number;
  maxToolCallsPerIteration: number;
  allowedTools: string[];
  requiredCapabilities: Partial<LLMCapabilities>;
  systemPromptAddendum?: string;
}

export const AGENT_REGISTRY: Record<AgentRole, AgentRoleConfig> = {
  planner: {
    role: "planner",
    promptRole: "planner",
    temperature: 0.1,
    maxIterations: 3,
    maxToolCallsPerIteration: 3,
    allowedTools: ["list_files", "read_file"],
    requiredCapabilities: { jsonMode: true },
    systemPromptAddendum:
      "You are the PLANNER. Your ONLY job is to decompose the goal into a structured plan.\n" +
      "Output a JSON object with a 'steps' array containing PlanStep objects.\n" +
      "Each step must have: id, description, dependsOn (array of step IDs), parallel (boolean).\n" +
      "Steps should be SMALL and focused - one logical task per step.\n" +
      "Use 'parallel: true' for steps that can run simultaneously (no shared files).\n" +
      "Use 'dependsOn' to enforce ordering - a step waits for ALL dependencies to complete.\n" +
      "Do NOT write code, do NOT use tools beyond list_files/read_file for exploration.\n" +
      "Return ONLY the JSON plan object.",
  },
  coder: {
    role: "coder",
    promptRole: "coder",
    temperature: 0.2,
    maxIterations: 10,
    maxToolCallsPerIteration: 8,
    allowedTools: ["list_files", "read_file", "edit_file", "run_command", "git_diff"],
    requiredCapabilities: { toolCalling: true },
    systemPromptAddendum:
      "You are a CODER. Your job is to IMPLEMENT a single plan step.\n" +
      "You receive: the step description, relevant context, and files from dependencies.\n" +
      "Use tools to: explore (list_files, read_file), implement (edit_file, run_command), verify (git_diff, run_command for tests).\n" +
      "Make SMALL, focused changes. One logical change per tool call sequence.\n" +
      "After each change, verify it works before moving on.\n" +
      "When the step is complete, call the 'done' tool with a summary of what you did and files changed.\n" +
      "Do NOT plan - just execute the step you were given.",
  },
  reviewer: {
    role: "reviewer",
    promptRole: "reviewer",
    temperature: 0.1,
    maxIterations: 3,
    maxToolCallsPerIteration: 5,
    allowedTools: [
      "list_files",
      "read_file",
      "run_command",
      "inspect_console",
      "inspect_dom",
      "screenshot",
      "git_diff",
    ],
    requiredCapabilities: { jsonMode: true, toolCalling: true },
    systemPromptAddendum:
      "You are the REVIEWER. Your job is to CRITIQUE completed work.\n" +
      "You receive: the goal, the plan step, and all files changed by the coder.\n" +
      "Use tools to: read files, run tests/build/lint (run_command), inspect browser (screenshot, inspect_console, inspect_dom), review diffs (git_diff).\n" +
      "Output a JSON object with: { done: boolean, summary: string, fixRequest?: { files: string[], issues: string[] }, deferred?: string[] }.\n" +
      "Set 'done: true' ONLY if the work is correct and complete.\n" +
      "If issues found, set 'done: false' and provide 'fixRequest' with specific files and issues.\n" +
      "Use 'deferred' for non-blocking issues that can be addressed later.\n" +
      "Be THOROUGH - catch bugs, type errors, missing tests, style issues.",
  },
  fixer: {
    role: "fixer",
    promptRole: "fixer",
    temperature: 0.15,
    maxIterations: 5,
    maxToolCallsPerIteration: 6,
    allowedTools: ["list_files", "read_file", "edit_file", "run_command", "git_diff"],
    requiredCapabilities: { toolCalling: true },
    systemPromptAddendum:
      "You are the FIXER. Your job is to APPLY MINIMAL FIXES for specific issues.\n" +
      "You receive: the fixRequest from the reviewer (files + issues), and the relevant context.\n" +
      "Make the SMALLEST possible change to resolve each issue.\n" +
      "Do NOT refactor, do NOT add features - ONLY fix the reported issues.\n" +
      "Use edit_file for code changes, run_command to verify fixes.\n" +
      "When all issues in the fixRequest are resolved, call 'done' with summary of fixes applied.\n" +
      "If you cannot fix an issue, note it in the done summary so it can be deferred.",
  },
};

/**
 * Get the configuration for a specific agent role
 */
export function getAgentConfig(role: AgentRole): AgentRoleConfig {
  return AGENT_REGISTRY[role];
}

/**
 * Get the tool definitions filtered to only those allowed for a role
 */
export function getAllowedToolDefinitions(role: AgentRole) {
  const config = AGENT_REGISTRY[role];
  const allowedSet = new Set(config.allowedTools);
  return TOOL_DEFINITIONS.filter((td) => allowedSet.has(td.name));
}

/**
 * Check if a role is allowed to use a specific tool
 */
export function isToolAllowedForRole(role: AgentRole, toolName: string): boolean {
  return AGENT_REGISTRY[role].allowedTools.includes(toolName);
}