/**
 * Phase 21/22: Universal Tool Layer — Build Tools Registration
 *
 * Registers the existing Build Mode tools (from `build-tools.ts`) as the first
 * capabilities in the Universal Tool Registry. This does NOT duplicate their
 * execution logic — it wraps their existing `executeTool` implementations.
 */

import { registerTool } from "../tool-registry";
import {
  executeTool as buildExecuteTool,
  TOOL_DEFINITIONS as BUILD_TOOL_DEFINITIONS,
} from "../build-tools";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";

/**
 * Wrap a Build Mode tool definition into a UniversalToolDefinition.
 * The execution delegates to the existing `buildExecuteTool`.
 */
function wrapBuildTool(def: typeof BUILD_TOOL_DEFINITIONS[number]): UniversalToolDefinition {
  // Map Build Mode tool names to namespaced universal names
  const nameMap: Record<string, string> = {
    list_files: "files.list",
    read_file: "files.read",
    edit_file: "files.write",
    run_command: "build.run_command",
    screenshot: "browser.screenshot",
    inspect_console: "browser.inspect_console",
    inspect_dom: "browser.inspect_dom",
    inspect_accessibility: "browser.inspect_accessibility",
    git_diff: "git.diff",
    apply_fix: "files.apply_fix",
  };

  // Map Build Mode tools to risk levels
  const riskMap: Record<string, "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_ACTION" | "SELF_MODIFICATION"> = {
    list_files: "READ",
    read_file: "READ",
    edit_file: "WRITE",
    run_command: "EXTERNAL_ACTION",
    screenshot: "READ",
    inspect_console: "READ",
    inspect_dom: "READ",
    inspect_accessibility: "READ",
    git_diff: "READ",
    apply_fix: "WRITE",
  };

  // Map Build Mode tools to categories
  const categoryMap: Record<string, "web" | "browser" | "files" | "vision" | "data" | "memory" | "research" | "build" | "evolution" | "integration"> = {
    list_files: "files",
    read_file: "files",
    edit_file: "files",
    run_command: "build",
    screenshot: "browser",
    inspect_console: "browser",
    inspect_dom: "browser",
    inspect_accessibility: "browser",
    git_diff: "build",
    apply_fix: "files",
  };

  const universalName = nameMap[def.name] ?? def.name;
  const risk = riskMap[def.name] ?? "READ";
  const category = categoryMap[def.name] ?? "build";

  return {
    name: universalName,
    description: def.description,
    category,
    parameters: def.parameters,
    risk,
    requiresApproval: risk === "EXTERNAL_ACTION" || risk === "DESTRUCTIVE" || risk === "SELF_MODIFICATION",
    timeoutMs: 30000,
    execute: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      // Delegate to existing Build Mode executeTool
      const buildResult = await buildExecuteTool(
        { name: def.name, arguments: args },
        ctx as any // Build Mode context is a subset
      );

      // Convert Build Mode ToolResult to UniversalToolResult
      return {
        success: buildResult.success,
        data: buildResult.result,
        error: buildResult.error,
        summary: buildResult.result ? JSON.stringify(buildResult.result).slice(0, 200) : undefined,
      };
    },
  };
}

/**
 * Register all Build Mode tools into the Universal Tool Registry.
 * Call this during server initialization.
 */
export function registerBuildTools(): void {
  for (const def of BUILD_TOOL_DEFINITIONS) {
    const universalDef = wrapBuildTool(def);
    registerTool(universalDef);
  }
}