/**
 * ACP tool bridge — wraps api-server's build-orchestrator functions
 * for the MCP tool surface. The MCP protocol expects `runAgentForStep`
 * with a { projectId, step, toolContext } shape; the underlying
 * implementation takes (step, goal, context) — this shim adapts between.
 */
import { runMultiAgentBuild } from "../../../api-server/src/lib/build-orchestrator";
import { runAgentForStep as runAgentForStepImpl, type PlanStep } from "../../../api-server/src/lib/build-agent";
import { ensureWorkspace } from "../../../api-server/src/lib/workspace";
import type { ToolExecutionContext } from "../../../api-server/src/lib/build-tools";

export { runMultiAgentBuild, ensureWorkspace };

export interface BuildAgentStepArgs {
  projectId: string;
  workspaceId?: string;
  step: PlanStep;
  toolContext: ToolExecutionContext;
}

export async function runAgentForStep(args: BuildAgentStepArgs): Promise<{ success: boolean; summary: string; filesChanged: string[] }> {
  const { projectId, workspaceId = projectId, step, toolContext } = args;

  // Ensure workspace exists before delegating to the real agent runner.
  await ensureWorkspace(projectId);

  return runAgentForStepImpl(step, "", toolContext);
}
