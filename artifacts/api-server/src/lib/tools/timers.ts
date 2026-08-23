/**
 * Phase 25: Universal Tool Layer — Agent Timer Tools
 *
 * Provides timer capabilities for agents to set and check timers in Build Mode.
 * The timer system allows agents to track time spent on tasks and receive notifications
 * when timers expire, without notifying the user.
 */

import { registerTool } from "../tool-registry";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";

// In-memory timer store (in production, this would be persisted)
interface AgentTimer {
  id: string;
  agentId: string; // Could be conversationId or taskId
  name: string;
  durationMs: number;
  startTime: number;
  endTime: number;
  notified: boolean;
  createdAt: number;
}

const timerStore = new Map<string, AgentTimer>();

/**
 * Generate a unique timer ID
 */
function generateTimerId(): string {
  return `timer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get the agent identifier from context
 */
function getAgentId(ctx: ToolExecutionContext): string {
  // Use taskId if available, otherwise conversationId, otherwise a default
  return ctx.taskId || ctx.conversationId || `agent_${ctx.workspaceId || 'default'}`;
}

/**
 * Timer tool: build.set_timer
 * Allows the agent to set a timer for itself
 */
const setTimerTool: UniversalToolDefinition = {
  name: "build.set_timer",
  description: "Set a timer for the agent. The timer will notify the AGENT (not the user) when it expires. The agent should continue working until the timer is done. Use this when the user asks you to work on something for a specific duration.",
  category: "build",
  risk: "READ",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name/description of the timer (e.g., 'Work on feature X', 'Code review session')",
      },
      durationMinutes: {
        type: "number",
        description: "Duration in minutes (e.g., 60 for 1 hour, 30 for 30 minutes)",
        minimum: 1,
        maximum: 1440, // Max 24 hours
      },
      durationSeconds: {
        type: "number",
        description: "Additional duration in seconds (optional, for precise timing)",
        minimum: 0,
        maximum: 59,
      },
    },
    required: ["name", "durationMinutes"],
  },
  execute: async (args, ctx): Promise<UniversalToolResult> => {
    const { name, durationMinutes, durationSeconds = 0 } = args as {
      name: string;
      durationMinutes: number;
      durationSeconds?: number;
    };

    const agentId = getAgentId(ctx);
    const timerId = generateTimerId();
    const startTime = Date.now();
    const durationMs = (durationMinutes * 60 + durationSeconds) * 1000;
    const endTime = startTime + durationMs;

    const timer: AgentTimer = {
      id: timerId,
      agentId,
      name,
      durationMs,
      startTime,
      endTime,
      notified: false,
      createdAt: startTime,
    };

    timerStore.set(timerId, timer);

    return {
      success: true,
      data: {
        timerId,
        name,
        durationMinutes,
        durationSeconds,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        message: `Timer "${name}" set for ${durationMinutes}m ${durationSeconds}s. You will be notified when it expires.`,
      },
      summary: `Timer "${name}" set for ${durationMinutes}m ${durationSeconds}s (expires ${new Date(endTime).toLocaleTimeString()})`,
    };
  },
};

/**
 * Timer tool: build.check_timer
 * Allows the agent to check the status of its timers
 */
const checkTimerTool: UniversalToolDefinition = {
  name: "build.check_timer",
  description: "Check the status of agent timers. Returns all active timers for this agent with remaining time and whether they've expired.",
  category: "build",
  risk: "READ",
  parameters: {
    type: "object",
    properties: {
      timerId: {
        type: "string",
        description: "Optional specific timer ID to check. If omitted, returns all timers for this agent.",
      },
    },
    required: [],
  },
  execute: async (args, ctx): Promise<UniversalToolResult> => {
    const { timerId } = args as { timerId?: string };
    const agentId = getAgentId(ctx);
    const now = Date.now();

    // Get all timers for this agent
    const agentTimers = Array.from(timerStore.values()).filter(t => t.agentId === agentId);

    if (timerId) {
      const timer = timerStore.get(timerId);
      if (!timer) {
        return {
          success: false,
          error: `Timer "${timerId}" not found`,
        };
      }
      if (timer.agentId !== agentId) {
        return {
          success: false,
          error: `Timer "${timerId}" belongs to a different agent`,
        };
      }

      const remainingMs = Math.max(0, timer.endTime - now);
      const expired = remainingMs === 0 && !timer.notified;

      return {
        success: true,
        data: {
          timerId: timer.id,
          name: timer.name,
          durationMinutes: Math.floor(timer.durationMs / 60000),
          durationSeconds: Math.floor((timer.durationMs % 60000) / 1000),
          startTime: new Date(timer.startTime).toISOString(),
          endTime: new Date(timer.endTime).toISOString(),
          remainingMs,
          remainingMinutes: Math.floor(remainingMs / 60000),
          remainingSeconds: Math.floor((remainingMs % 60000) / 1000),
          expired,
          notified: timer.notified,
        },
        summary: expired
          ? `Timer "${timer.name}" has EXPIRED!`
          : `Timer "${timer.name}": ${Math.floor(remainingMs / 60000)}m ${Math.floor((remainingMs % 60000) / 1000)}s remaining`,
      };
    }

    // Return all timers for this agent
    const timersData = agentTimers.map(timer => {
      const remainingMs = Math.max(0, timer.endTime - now);
      const expired = remainingMs === 0 && !timer.notified;
      return {
        timerId: timer.id,
        name: timer.name,
        durationMinutes: Math.floor(timer.durationMs / 60000),
        durationSeconds: Math.floor((timer.durationMs % 60000) / 1000),
        startTime: new Date(timer.startTime).toISOString(),
        endTime: new Date(timer.endTime).toISOString(),
        remainingMs,
        remainingMinutes: Math.floor(remainingMs / 60000),
        remainingSeconds: Math.floor((remainingMs % 60000) / 1000),
        expired,
        notified: timer.notified,
      };
    });

    const expiredTimers = timersData.filter(t => t.expired).length;
    const activeTimers = timersData.filter(t => !t.expired).length;

    return {
      success: true,
      data: {
        timers: timersData,
        total: timersData.length,
        active: activeTimers,
        expired: expiredTimers,
      },
      summary: `${timersData.length} timer(s) for this agent: ${activeTimers} active, ${expiredTimers} expired`,
    };
  },
};

/**
 * Timer tool: build.clear_timer
 * Allows the agent to clear/remove a timer
 */
const clearTimerTool: UniversalToolDefinition = {
  name: "build.clear_timer",
  description: "Clear/remove a timer. Use this when a timer is no longer needed or after it has expired and you've acknowledged it.",
  category: "build",
  risk: "WRITE",
  parameters: {
    type: "object",
    properties: {
      timerId: {
        type: "string",
        description: "Timer ID to clear",
      },
    },
    required: ["timerId"],
  },
  execute: async (args, ctx): Promise<UniversalToolResult> => {
    const { timerId } = args as { timerId: string };
    const agentId = getAgentId(ctx);

    const timer = timerStore.get(timerId);
    if (!timer) {
      return {
        success: false,
        error: `Timer "${timerId}" not found`,
      };
    }

    if (timer.agentId !== agentId) {
      return {
        success: false,
        error: `Timer "${timerId}" belongs to a different agent`,
      };
    }

    timerStore.delete(timerId);

    return {
      success: true,
      data: {
        timerId,
        name: timer.name,
        message: `Timer "${timer.name}" cleared`,
      },
      summary: `Timer "${timer.name}" cleared`,
    };
  },
};

/**
 * Timer tool: build.clear_all_timers
 * Clears all timers for the current agent
 */
const clearAllTimersTool: UniversalToolDefinition = {
  name: "build.clear_all_timers",
  description: "Clear all timers for the current agent. Use with caution - this removes all active and expired timers.",
  category: "build",
  risk: "WRITE",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (_args, ctx): Promise<UniversalToolResult> => {
    const agentId = getAgentId(ctx);
    const agentTimers = Array.from(timerStore.values()).filter(t => t.agentId === agentId);
    const count = agentTimers.length;

    for (const timer of agentTimers) {
      timerStore.delete(timer.id);
    }

    return {
      success: true,
      data: {
        clearedCount: count,
        message: `Cleared ${count} timer(s) for this agent`,
      },
      summary: `Cleared ${count} timer(s)`,
    };
  },
};

/**
 * Timer tool: build.wait_for_timer
 * Allows the agent to wait for a timer to expire (blocking with polling)
 * This is useful for the agent to pause its work until a timer expires
 */
const waitForTimerTool: UniversalToolDefinition = {
  name: "build.wait_for_timer",
  description: "Wait for a specific timer to expire. This tool will block/poll until the timer expires, then return. Use this when you want to ensure you work for at least the timer duration.",
  category: "build",
  risk: "READ",
  parameters: {
    type: "object",
    properties: {
      timerId: {
        type: "string",
        description: "Timer ID to wait for",
      },
      pollIntervalMs: {
        type: "number",
        description: "How often to check (ms), default 5000 (5 seconds)",
        default: 5000,
        minimum: 1000,
        maximum: 60000,
      },
      maxWaitMs: {
        type: "number",
        description: "Maximum time to wait (ms), default 0 (wait indefinitely)",
        default: 0,
      },
    },
    required: ["timerId"],
  },
  execute: async (args, ctx): Promise<UniversalToolResult> => {
    const { timerId, pollIntervalMs = 5000, maxWaitMs = 0 } = args as {
      timerId: string;
      pollIntervalMs?: number;
      maxWaitMs?: number;
    };
    const agentId = getAgentId(ctx);

    const timer = timerStore.get(timerId);
    if (!timer) {
      return {
        success: false,
        error: `Timer "${timerId}" not found`,
      };
    }

    if (timer.agentId !== agentId) {
      return {
        success: false,
        error: `Timer "${timerId}" belongs to a different agent`,
      };
    }

    const startWait = Date.now();
    const endTime = timer.endTime;

    // If already expired, return immediately
    if (Date.now() >= endTime) {
      timer.notified = true;
      return {
        success: true,
        data: {
          timerId,
          name: timer.name,
          alreadyExpired: true,
          waitedMs: 0,
          message: `Timer "${timer.name}" has already expired`,
        },
        summary: `Timer "${timer.name}" already expired`,
      };
    }

    // Poll until timer expires
    while (Date.now() < endTime) {
      // Check max wait time
      if (maxWaitMs > 0 && Date.now() - startWait >= maxWaitMs) {
        return {
          success: false,
          error: `Max wait time (${maxWaitMs}ms) exceeded before timer expired`,
          data: {
            timerId,
            name: timer.name,
            waitedMs: Date.now() - startWait,
            remainingMs: endTime - Date.now(),
          },
        };
      }

      // Wait for poll interval
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    const waitedMs = Date.now() - startWait;
    timer.notified = true;

    return {
      success: true,
      data: {
        timerId,
        name: timer.name,
        alreadyExpired: false,
        waitedMs,
        message: `Timer "${timer.name}" has expired after waiting ${Math.round(waitedMs / 1000)}s`,
      },
      summary: `Timer "${timer.name}" expired (waited ${Math.round(waitedMs / 1000)}s)`,
    };
  },
};

/**
 * Register all timer tools
 */
export function registerTimerTools(): void {
  registerTool(setTimerTool);
  registerTool(checkTimerTool);
  registerTool(clearTimerTool);
  registerTool(clearAllTimersTool);
  registerTool(waitForTimerTool);
}

// Export for testing/debugging
export { timerStore };
export type { AgentTimer };