/**
 * Phase 34: AI Self-Management — AI Management Tools Registration
 *
 * Registers tools for AI-initiated settings and secrets management:
 * - settings.propose: AI proposes a setting change
 * - settings.confirm: User confirms a pending AI-proposed change
 * - settings.reject: User rejects a pending AI-proposed change
 * - secrets.rotate: AI proposes rotation of an LLM API key
 *
 * All AI-proposed changes require explicit user confirmation.
 */

import { registerTool } from "../tool-registry";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";
import { settingsManager, SETTING_DEFINITIONS, type SettingKey } from "../settings-manager";
import { secretManager } from "../secret-manager";

/**
 * Tool: settings.propose
 * AI proposes a setting change that requires user confirmation.
 */
const proposeSettingTool: UniversalToolDefinition = {
  name: "settings.propose",
  description: "Propose a setting change that requires user confirmation. Use this when you want to suggest a UI/behavior change (e.g., accent color, theme, density, language, notifications). The user must explicitly confirm before the change is applied.",
  category: "settings",
  risk: "WRITE",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Setting key to propose (must be a valid setting from settings.definitions)",
        enum: Object.keys(SETTING_DEFINITIONS) as SettingKey[],
      },
      proposedValue: {
        description: "The proposed new value for the setting. Type depends on the setting (string, number, boolean, object, color).",
      },
      reason: {
        type: "string",
        description: "Human-readable explanation of WHY you want this change (e.g., 'Current accent color has low contrast in dark mode', 'User requested Dutch language', 'Rate limits hit, need to rotate key'). Required for audit trail and user decision.",
      },
      userId: {
        type: "string",
        format: "uuid",
        description: "Optional: Specific user ID to apply the setting for. If omitted, applies to current user context.",
      },
      projectId: {
        type: "string",
        format: "uuid",
        description: "Optional: Specific project ID to apply the setting for. If omitted, applies to current project context.",
      },
      expiresInMs: {
        type: "number",
        description: "Optional: Time in milliseconds before the proposal expires (default: 24 hours). Max 168 hours (7 days).",
        minimum: 60000,
        maximum: 604800000,
      },
    },
    required: ["key", "proposedValue", "reason"],
    additionalProperties: false,
  },
  execute: async (args: {
    key: SettingKey;
    proposedValue: unknown;
    reason: string;
    userId?: string;
    projectId?: string;
    expiresInMs?: number;
  }, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      // Validate the setting key exists
      const definition = SETTING_DEFINITIONS[args.key];
      if (!definition) {
        return {
          success: false,
          error: `Invalid setting key: "${args.key}". Valid keys: ${Object.keys(SETTING_DEFINITIONS).join(", ")}`,
        };
      }

      // Validate the proposed value
      const validation = settingsManager.validateSetting(args.key, args.proposedValue);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || `Invalid value for setting "${args.key}"`,
        };
      }

      // Check if AI is allowed to propose this setting
      if (!definition.aiProposable) {
        return {
          success: false,
          error: `Setting "${args.key}" cannot be proposed by AI. It can only be changed directly by the user.`,
        };
      }

      // Get context from execution context if not provided
      const userId = args.userId || ctx.userId;
      const projectId = args.projectId || ctx.projectId;

      // Propose the change
      const proposal = await settingsManager.proposeChange(
        args.key,
        args.proposedValue,
        args.reason,
        "ai",
        "universal-agent", // agent ID
        userId,
        projectId,
        args.expiresInMs
      );

      return {
        success: true,
        data: {
          changeId: proposal.id,
          key: proposal.targetId,
          currentValue: proposal.currentValue,
          proposedValue: proposal.proposedValue,
          reason: proposal.reason,
          status: proposal.status,
          expiresAt: proposal.expiresAt.toISOString(),
          message: `Setting change proposed. User must confirm via settings.confirm(changeId="${proposal.id}") or reject via settings.reject(changeId="${proposal.id}").`,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Tool: settings.confirm
 * User confirms a pending AI-proposed setting change.
 */
const confirmSettingTool: UniversalToolDefinition = {
  name: "settings.confirm",
  description: "Confirm a pending AI-proposed setting change. This applies the proposed value. Use this when the user explicitly approves an AI suggestion.",
  category: "settings",
  risk: "WRITE",
  parameters: {
    type: "object",
    properties: {
      changeId: {
        type: "string",
        description: "The ID of the pending change to confirm (from settings.propose response).",
      },
      confirmedBy: {
        type: "string",
        description: "ID of the user confirming (for audit trail).",
      },
    },
    required: ["changeId", "confirmedBy"],
    additionalProperties: false,
  },
  execute: async (args: { changeId: string; confirmedBy: string }, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      const result = await settingsManager.confirmChange(args.changeId, args.confirmedBy);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        data: {
          changeId: args.changeId,
          appliedValue: result.appliedValue,
          message: `Setting change confirmed and applied successfully.`,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Tool: settings.reject
 * User rejects a pending AI-proposed setting change.
 */
const rejectSettingTool: UniversalToolDefinition = {
  name: "settings.reject",
  description: "Reject a pending AI-proposed setting change. This discards the proposal without applying it.",
  category: "settings",
  risk: "READ", // Rejecting doesn't modify settings, just updates proposal status
  parameters: {
    type: "object",
    properties: {
      changeId: {
        type: "string",
        description: "The ID of the pending change to reject (from settings.propose response).",
      },
      rejectedBy: {
        type: "string",
        description: "ID of the user rejecting (for audit trail).",
      },
    },
    required: ["changeId", "rejectedBy"],
    additionalProperties: false,
  },
  execute: async (args: { changeId: string; rejectedBy: string }, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      const result = await settingsManager.rejectChange(args.changeId, args.rejectedBy);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        data: {
          changeId: args.changeId,
          message: `Setting change rejected. The proposed change has been discarded.`,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Tool: secrets.rotate
 * AI proposes rotation of an LLM API key.
 */
const rotateSecretTool: UniversalToolDefinition = {
  name: "secrets.rotate",
  description: "Propose rotation of an LLM API key. The agent should explain WHY rotation is needed (e.g., rate limits, 401 errors, key compromised). If newKey is not provided, the system will attempt provider-specific rotation. All rotations require user confirmation before the new key is activated.",
  category: "secrets",
  risk: "WRITE",
  parameters: {
    type: "object",
    properties: {
      secretId: {
        type: "string",
        format: "uuid",
        description: "ID of the secret (LLM key) to rotate.",
      },
      reason: {
        type: "string",
        description: "Human-readable explanation of WHY rotation is needed (e.g., 'Key hitting rate limits on Anthropic', 'Received 401 unauthorized, key may be invalid', 'Security rotation policy'). Required for audit trail.",
      },
      newKey: {
        type: "string",
        description: "Optional: The new API key value. If omitted, the system will attempt provider-specific automatic rotation (not all providers support this).",
      },
      rotatedBy: {
        type: "string",
        enum: ["ai", "user"],
        description: "Who is initiating the rotation (default: 'ai').",
      },
    },
    required: ["secretId", "reason"],
    additionalProperties: false,
  },
  execute: async (args: {
    secretId: string;
    reason: string;
    newKey?: string;
    rotatedBy?: "ai" | "user";
  }, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      const result = await secretManager.rotateKey(
        args.secretId,
        args.newKey,
        args.rotatedBy || "ai",
        ctx.agentId || "universal-agent"
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          data: { rotatedAt: result.rotatedAt.toISOString() }
        };
      }

      return {
        success: true,
        data: {
          secretId: args.secretId,
          newKeyId: result.newKeyId,
          rotatedAt: result.rotatedAt.toISOString(),
          message: `Key rotation successful. New key ID: ${result.newKeyId}. The old key has been replaced.`,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Tool: secrets.health-check
 * Check health of a specific LLM API key.
 */
const healthCheckSecretTool: UniversalToolDefinition = {
  name: "secrets.health-check",
  description: "Perform a health check on an LLM API key. Tests if the key is valid and working with its provider. Updates the key's health status (healthy/cooling/quarantined).",
  category: "secrets",
  risk: "READ",
  parameters: {
    type: "object",
    properties: {
      secretId: {
        type: "string",
        format: "uuid",
        description: "ID of the secret (LLM key) to health check.",
      },
    },
    required: ["secretId"],
    additionalProperties: false,
  },
  execute: async (args: { secretId: string }, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      const health = await secretManager.checkKeyHealth(args.secretId);

      return {
        success: true,
        data: {
          secretId: args.secretId,
          health: health.health,
          latency: health.latency,
          lastChecked: health.lastChecked.toISOString(),
          details: health.details,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Tool: settings.list-definitions
 * List all available setting definitions.
 */
const listSettingDefinitionsTool: UniversalToolDefinition = {
  name: "settings.list-definitions",
  description: "List all available setting definitions with their types, default values, allowed values, and whether they can be proposed by AI.",
  category: "settings",
  risk: "READ",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (_args: {}, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      const definitions = settingsManager.getAllSettingDefinitions();

      return {
        success: true,
        data: {
          definitions: definitions.map(d => ({
            key: d.key,
            type: d.type,
            defaultValue: d.defaultValue,
            allowedValues: d.allowedValues,
            description: d.description,
            category: d.category,
            requiresRestart: d.requiresRestart,
            userEditable: d.userEditable,
            aiProposable: d.aiProposable,
          })),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Tool: secrets.list
 * List all LLM API keys (health status only, never decrypted values).
 */
const listSecretsTool: UniversalToolDefinition = {
  name: "secrets.list",
  description: "List all LLM API keys with their health status. Never returns decrypted key values. Use for monitoring key health across providers.",
  category: "secrets",
  risk: "READ",
  parameters: {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        format: "uuid",
        description: "Optional: Filter by project ID.",
      },
      provider: {
        type: "string",
        description: "Optional: Filter by provider (e.g., 'anthropic', 'openai', 'google').",
      },
      health: {
        type: "string",
        enum: ["healthy", "cooling", "quarantined"],
        description: "Optional: Filter by health status.",
      },
      onlyHealthy: {
        type: "boolean",
        description: "Optional: Only return healthy keys (default: false).",
      },
    },
    additionalProperties: false,
  },
  execute: async (args: { projectId?: string; provider?: string; health?: "healthy" | "cooling" | "quarantined"; onlyHealthy?: boolean }, ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      const projectId = args.projectId || ctx.projectId;
      const keys = await secretManager.getKeys(projectId, {
        provider: args.provider,
        health: args.health,
        onlyHealthy: args.onlyHealthy,
      });

      return {
        success: true,
        data: {
          keys: keys.map(k => ({
            id: k.id,
            projectId: k.projectId,
            provider: k.provider,
            model: k.model,
            name: k.name,
            health: k.health,
            priority: k.priority,
            source: k.source,
            lastUsed: k.lastUsed?.toISOString(),
            lastHealthCheck: k.lastHealthCheck.toISOString(),
            coolingUntil: k.coolingUntil?.toISOString(),
            quarantineReason: k.quarantineReason,
            rotationCount: k.rotationCount,
            metadata: k.metadata,
            createdAt: k.createdAt,
            updatedAt: k.updatedAt,
          })),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Tool: secrets.get-health-metrics
 * Get aggregate health metrics for all LLM keys.
 */
const getHealthMetricsTool: UniversalToolDefinition = {
  name: "secrets.get-health-metrics",
  description: "Get aggregate health metrics for all LLM API keys (counts by provider/health, oldest key age, rotation rate).",
  category: "secrets",
  risk: "READ",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (_args: {}, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
    try {
      const metrics = await secretManager.getHealthMetrics();

      return {
        success: true,
        data: metrics,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Register all AI Management tools
 */
export function registerAIManagementTools(): void {
  registerTool(proposeSettingTool);
  registerTool(confirmSettingTool);
  registerTool(rejectSettingTool);
  registerTool(rotateSecretTool);
  registerTool(healthCheckSecretTool);
  registerTool(listSettingDefinitionsTool);
  registerTool(listSecretsTool);
  registerTool(getHealthMetricsTool);
}