/**
 * Phase 22/23: Universal Tool Layer — Evolution Capability Integration
 *
 * Registers self-evolution tools that allow the agent to propose, apply, verify,
 * and rollback code changes with full safety guardrails (checkpoints, tests, approvals).
 * Wraps existing implementations from self-evolution.ts.
 */

import { registerTool } from "../tool-registry";
import {
  createProposal,
  applyEvolution,
  createCheckpoint,
  rollbackToCheckpoint,
  listCheckpoints,
  getEvolutionConfig,
  setEvolutionConfig,
  isPathAllowed,
  type EvolutionProposal,
} from "../self-evolution";
import { logger } from "../logger";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";

export function registerEvolutionTools(): void {
  const evolutionInspect: UniversalToolDefinition = {
    name: "evolution.inspect",
    description: "Inspect the current self-evolution configuration (allowed/blocked paths, test requirements, approval settings).",
    category: "evolution",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {},
    },
    timeoutMs: 5000,
    execute: async (_args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      try {
        const config = getEvolutionConfig();
        return {
          success: true,
          data: config,
          summary: `Evolution config: ${config.allowedPaths.length} allowed paths, ${config.blockedPaths.length} blocked paths, requireTests=${config.requireTests}, requireApproval=${config.requireApproval}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Inspect failed" };
      }
    },
  };

  const evolutionPropose: UniversalToolDefinition = {
    name: "evolution.propose",
    description: "Create a self-evolution proposal with specific file changes. Returns proposal ID for review/approval. Does NOT apply changes.",
    category: "evolution",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        title: { type: "string", description: "Short title for the proposal" },
        description: { type: "string", description: "Detailed description of the changes" },
        files: {
          type: "array",
          description: "Array of file changes",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path relative to project root" },
              oldContent: { type: "string", description: "Current file content" },
              newContent: { type: "string", description: "Proposed new content" },
            },
            required: ["path", "oldContent", "newContent"],
          },
          minItems: 1,
        },
        rationale: { type: "string", description: "Why this change is needed" },
      },
      required: ["projectId", "title", "description", "files", "rationale"],
    },
    timeoutMs: 10000,
    execute: async (args, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const title = String(args["title"] ?? "").trim();
      const description = String(args["description"] ?? "").trim();
      const files = args["files"] as EvolutionProposal["files"];
      const rationale = String(args["rationale"] ?? "").trim();

      if (!projectId || !title || !description || !files?.length || !rationale) {
        return { success: false, error: "projectId, title, description, files, and rationale are all required" };
      }

      // Validate paths are allowed
      for (const file of files) {
        if (!isPathAllowed(file.path)) {
          return { success: false, error: `Path not allowed for self-modification: ${file.path}` };
        }
      }

      try {
        const proposal = createProposal(projectId, title, description, files, rationale);

        return {
          success: true,
          data: {
            id: proposal.id,
            title: proposal.title,
            description: proposal.description,
            files: proposal.files.map(f => ({ path: f.path, changeSize: Math.abs(f.newContent.length - f.oldContent.length) })),
            rationale: proposal.rationale,
            riskLevel: proposal.riskLevel,
            requiresApproval: proposal.requiresApproval,
            status: proposal.status,
            createdAt: proposal.createdAt.toISOString(),
          },
          summary: `Created evolution proposal: ${proposal.id} (${proposal.riskLevel} risk, ${proposal.requiresApproval ? "requires approval" : "auto-approvable"})`,
          artifacts: [{ type: "evolution_proposal", id: proposal.id, title: `Proposal: ${title}`, data: proposal }],
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Propose failed" };
      }
    },
  };

  const evolutionApply: UniversalToolDefinition = {
    name: "evolution.apply",
    description: "Apply an approved evolution proposal. Runs tests, creates checkpoint, commits on success, rolls back on failure.",
    category: "evolution",
    risk: "SELF_MODIFICATION",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        proposalId: { type: "string", description: "Proposal ID to apply" },
      },
      required: ["projectId", "proposalId"],
    },
    timeoutMs: 180000, // 3 minutes for tests
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const proposalId = String(args["proposalId"] ?? "").trim();

      if (!projectId || !proposalId) {
        return { success: false, error: "projectId and proposalId are required" };
      }

      // In a real implementation, we'd fetch the proposal from a database
      // For now, we'll need the proposal passed in or reconstructed
      // This is a limitation - the proposal needs to be stored somewhere
      return {
        success: false,
        error: "Proposal storage not yet implemented. Evolution proposals need to be persisted to a database first.",
        metadata: { hint: "This tool requires a proposal database. Use the self-evolution API routes for now." },
      };
    },
  };

  const evolutionVerify: UniversalToolDefinition = {
    name: "evolution.verify",
    description: "Verify an applied evolution by running typecheck and build. Returns test results.",
    category: "evolution",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    timeoutMs: 180000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();

      if (!projectId) {
        return { success: false, error: "projectId is required" };
      }

      try {
        const { execSync } = await import("child_process");
        const output = execSync("npm run typecheck && npm run build", {
          encoding: "utf-8",
          timeout: 180000,
          stdio: "pipe",
          cwd: process.cwd(),
        });

        return {
          success: true,
          data: { passed: true, output },
          summary: "Typecheck and build passed successfully",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          data: { passed: false, output: message },
          error: `Verification failed: ${message}`,
          summary: "Typecheck or build failed",
        };
      }
    },
  };

  const evolutionRollback: UniversalToolDefinition = {
    name: "evolution.rollback",
    description: "Rollback to a previous checkpoint. Restores the codebase to a known good state.",
    category: "evolution",
    risk: "SELF_MODIFICATION",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        checkpointId: { type: "string", description: "Checkpoint ID to rollback to" },
      },
      required: ["projectId", "checkpointId"],
    },
    timeoutMs: 30000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const checkpointId = String(args["checkpointId"] ?? "").trim();

      if (!projectId || !checkpointId) {
        return { success: false, error: "projectId and checkpointId are required" };
      }

      try {
        const success = await rollbackToCheckpoint(projectId, checkpointId);
        if (success) {
          return {
            success: true,
            data: { ok: true, checkpointId },
            summary: `Rolled back to checkpoint: ${checkpointId}`,
          };
        } else {
          return { success: false, error: "Rollback failed" };
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Rollback failed" };
      }
    },
  };

  const evolutionCheckpoint: UniversalToolDefinition = {
    name: "evolution.checkpoint",
    description: "Create a manual checkpoint (git commit + file manifest) before making changes.",
    category: "evolution",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        description: { type: "string", description: "Checkpoint description" },
      },
      required: ["projectId", "description"],
    },
    timeoutMs: 30000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();
      const description = String(args["description"] ?? "").trim();

      if (!projectId || !description) {
        return { success: false, error: "projectId and description are required" };
      }

      try {
        const checkpointId = await createCheckpoint(projectId, description);
        return {
          success: true,
          data: { checkpointId },
          summary: `Created checkpoint: ${checkpointId}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Checkpoint failed" };
      }
    },
  };

  const evolutionListCheckpoints: UniversalToolDefinition = {
    name: "evolution.list_checkpoints",
    description: "List all available checkpoints for a project.",
    category: "evolution",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const projectId = String(args["projectId"] ?? "").trim();

      if (!projectId) {
        return { success: false, error: "projectId is required" };
      }

      try {
        const checkpoints = listCheckpoints(projectId);
        return {
          success: true,
          data: { checkpoints },
          summary: `Found ${checkpoints.length} checkpoints`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "List checkpoints failed" };
      }
    },
  };

  const evolutionConfig: UniversalToolDefinition = {
    name: "evolution.config",
    description: "Get or update self-evolution configuration (allowed/blocked paths, test requirements, approval settings).",
    category: "evolution",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        allowedPaths: { type: "array", items: { type: "string" }, description: "Paths the agent can modify" },
        blockedPaths: { type: "array", items: { type: "string" }, description: "Paths the agent can NEVER modify" },
        requireTests: { type: "boolean", description: "Require tests to pass before applying" },
        requireApproval: { type: "boolean", description: "Require approval for non-low-risk changes" },
        maxFileSize: { type: "number", description: "Max file size in bytes" },
        checkpointDir: { type: "string", description: "Checkpoint directory path" },
      },
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      // If no args provided, return current config
      if (Object.keys(args).length === 0) {
        const config = getEvolutionConfig();
        return { success: true, data: config, summary: "Current evolution config" };
      }

      // Update config with provided values
      const currentConfig = getEvolutionConfig();
      const updates: Partial<typeof currentConfig> = {};

      if (args["allowedPaths"] !== undefined) updates.allowedPaths = args["allowedPaths"] as string[];
      if (args["blockedPaths"] !== undefined) updates.blockedPaths = args["blockedPaths"] as string[];
      if (args["requireTests"] !== undefined) updates.requireTests = Boolean(args["requireTests"]);
      if (args["requireApproval"] !== undefined) updates.requireApproval = Boolean(args["requireApproval"]);
      if (args["maxFileSize"] !== undefined) updates.maxFileSize = Number(args["maxFileSize"]);
      if (args["checkpointDir"] !== undefined) updates.checkpointDir = String(args["checkpointDir"]);

      setEvolutionConfig(updates);
      const newConfig = getEvolutionConfig();

      return {
        success: true,
        data: newConfig,
        summary: "Evolution config updated",
      };
    },
  };

  registerTool(evolutionInspect);
  registerTool(evolutionPropose);
  registerTool(evolutionApply);
  registerTool(evolutionVerify);
  registerTool(evolutionRollback);
  registerTool(evolutionCheckpoint);
  registerTool(evolutionListCheckpoints);
  registerTool(evolutionConfig);
  logger.info("[tools/evolution] Registered 8 evolution tools (inspect, propose, apply, verify, rollback, checkpoint, list_checkpoints, config)");
}