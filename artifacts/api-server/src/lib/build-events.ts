import { createWriteStream, WriteStream } from "node:fs";
import { stdout } from "node:process";

/**
 * Build event types for JSONL streaming output
 */
export interface BuildEvent {
  type: BuildEventType;
  timestamp: string;
  projectId: string;
  buildId?: string;
  data: Record<string, unknown>;
}

export type BuildEventType =
  | "build.started"
  | "build.progress"
  | "build.iteration_start"
  | "build.iteration_complete"
  | "build.tool_call"
  | "build.tool_result"
  | "build.error"
  | "build.warning"
  | "build.completed"
  | "build.failed"
  | "build.cancelled"
  | "build.budget_warning"
  | "build.budget_exceeded"
  | "build.checkpoint_created"
  | "build.snapshot_created"
  // Multi-agent orchestration events
  | "build.agent_start"
  | "build.agent_complete"
  | "build.agent_handoff"
  | "build.parallel_group_start"
  | "build.parallel_group_complete"
  | "build.review_start"
  | "build.review_complete"
  | "build.fix_start"
  | "build.fix_complete"
  | "build.orchestrator_start"
  | "build.orchestrator_complete"
  | "build.orchestrator_fallback";

export interface BuildEventEmitterOptions {
  /** Output stream (default: stdout) */
  output?: WriteStream;
  /** Project ID for context */
  projectId: string;
  /** Build ID for correlation */
  buildId?: string;
  /** Whether to emit to stdout (for CLI headless mode) */
  emitToStdout?: boolean;
  /** Whether to also log to console (non-JSON) */
  verbose?: boolean;
}

/**
 * JSONL event emitter for headless build mode
 * Emits structured events to stdout for pipeline parsing
 */
export class BuildEventEmitter {
  private output: WriteStream;
  private projectId: string;
  private buildId: string;
  private emitToStdout: boolean;
  private verbose: boolean;
  private eventCount = 0;

  constructor(options: BuildEventEmitterOptions) {
    this.output = options.output || stdout;
    this.projectId = options.projectId;
    this.buildId = options.buildId || `build_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.emitToStdout = options.emitToStdout ?? true;
    this.verbose = options.verbose ?? false;
  }

  private emit(type: BuildEventType, data: Record<string, unknown>): void {
    const event: BuildEvent = {
      type,
      timestamp: new Date().toISOString(),
      projectId: this.projectId,
      buildId: this.buildId,
      data,
    };

    this.eventCount++;

    if (this.emitToStdout) {
      this.output.write(JSON.stringify(event) + "\n");
    }

    if (this.verbose) {
      console.error(`[${event.timestamp}] ${type}:`, JSON.stringify(data));
    }
  }

  /** Emit build started event */
  started(prompt: string, options: Record<string, unknown> = {}): void {
    this.emit("build.started", {
      prompt,
      options,
      eventCount: this.eventCount,
    });
  }

  /** Emit progress update */
  progress(message: string, progress?: number, metadata: Record<string, unknown> = {}): void {
    this.emit("build.progress", {
      message,
      progress,
      ...metadata,
      eventCount: this.eventCount,
    });
  }

  /** Emit iteration start */
  iterationStart(iteration: number, goal: string): void {
    this.emit("build.iteration_start", {
      iteration,
      goal,
      eventCount: this.eventCount,
    });
  }

  /** Emit iteration complete */
  iterationComplete(iteration: number, summary: string, toolCalls: number, toolResults: number): void {
    this.emit("build.iteration_complete", {
      iteration,
      summary,
      toolCalls,
      toolResults,
      eventCount: this.eventCount,
    });
  }

  /** Emit tool call */
  toolCall(toolName: string, args: Record<string, unknown>, callId: string): void {
    this.emit("build.tool_call", {
      toolName,
      args,
      callId,
      eventCount: this.eventCount,
    });
  }

  /** Emit tool result */
  toolResult(callId: string, success: boolean, result: unknown, error?: string): void {
    this.emit("build.tool_result", {
      callId,
      success,
      result,
      error,
      eventCount: this.eventCount,
    });
  }

  /** Emit error */
  error(message: string, error?: Error | unknown, context: Record<string, unknown> = {}): void {
    this.emit("build.error", {
      message,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...context,
      eventCount: this.eventCount,
    });
  }

  /** Emit warning */
  warning(message: string, context: Record<string, unknown> = {}): void {
    this.emit("build.warning", {
      message,
      ...context,
      eventCount: this.eventCount,
    });
  }

  /** Emit budget warning */
  budgetWarning(percentUsed: number, limit: number, current: number): void {
    this.emit("build.budget_warning", {
      percentUsed,
      limit,
      current,
      eventCount: this.eventCount,
    });
  }

  /** Emit budget exceeded */
  budgetExceeded(limit: number, current: number): void {
    this.emit("build.budget_exceeded", {
      limit,
      current,
      eventCount: this.eventCount,
    });
  }

  /** Emit checkpoint created */
  checkpointCreated(checkpointId: string, label: string): void {
    this.emit("build.checkpoint_created", {
      checkpointId,
      label,
      eventCount: this.eventCount,
    });
  }

  /** Emit snapshot created */
  snapshotCreated(snapshotId: string, label: string): void {
    this.emit("build.snapshot_created", {
      snapshotId,
      label,
      eventCount: this.eventCount,
    });
  }

  // Multi-agent orchestration events

  /** Emit agent start */
  agentStart(agentRole: string, stepId: string, agentId: string, goal: string): void {
    this.emit("build.agent_start", {
      agentRole,
      stepId,
      agentId,
      goal,
      eventCount: this.eventCount,
    });
  }

  /** Emit agent complete */
  agentComplete(agentRole: string, stepId: string, agentId: string, summary: string, filesChanged: string[]): void {
    this.emit("build.agent_complete", {
      agentRole,
      stepId,
      agentId,
      summary,
      filesChanged,
      eventCount: this.eventCount,
    });
  }

  /** Emit agent handoff */
  agentHandoff(fromRole: string, toRole: string, stepId: string, payload: Record<string, unknown>): void {
    this.emit("build.agent_handoff", {
      fromRole,
      toRole,
      stepId,
      payload,
      eventCount: this.eventCount,
    });
  }

  /** Emit parallel group start */
  parallelGroupStart(groupIndex: number, stepIds: string[]): void {
    this.emit("build.parallel_group_start", {
      groupIndex,
      stepIds,
      eventCount: this.eventCount,
    });
  }

  /** Emit parallel group complete */
  parallelGroupComplete(groupIndex: number, stepIds: string[], results: Array<{ stepId: string; success: boolean }>): void {
    this.emit("build.parallel_group_complete", {
      groupIndex,
      stepIds,
      results,
      eventCount: this.eventCount,
    });
  }

  /** Emit review start */
  reviewStart(stepId: string, filesChanged: string[]): void {
    this.emit("build.review_start", {
      stepId,
      filesChanged,
      eventCount: this.eventCount,
    });
  }

  /** Emit review complete */
  reviewComplete(stepId: string, done: boolean, fixRequest?: { files: string[]; issues: string[] }): void {
    this.emit("build.review_complete", {
      stepId,
      done,
      fixRequest,
      eventCount: this.eventCount,
    });
  }

  /** Emit fix start */
  fixStart(stepId: string, issues: string[]): void {
    this.emit("build.fix_start", {
      stepId,
      issues,
      eventCount: this.eventCount,
    });
  }

  /** Emit fix complete */
  fixComplete(stepId: string, resolved: boolean, filesChanged: string[], unresolvedIssues?: string[]): void {
    this.emit("build.fix_complete", {
      stepId,
      resolved,
      filesChanged,
      unresolvedIssues,
      eventCount: this.eventCount,
    });
  }

  /** Emit orchestrator start */
  orchestratorStart(goal: string, planSteps: number): void {
    this.emit("build.orchestrator_start", {
      goal,
      planSteps,
      eventCount: this.eventCount,
    });
  }

  /** Emit orchestrator complete */
  orchestratorComplete(summary: string, stats: { totalSteps: number; completedSteps: number; failedSteps: number; durationMs: number }): void {
    this.emit("build.orchestrator_complete", {
      summary,
      ...stats,
      eventCount: this.eventCount,
    });
  }

  /** Emit orchestrator fallback to single agent */
  orchestratorFallback(reason: string, fallbackResult?: any): void {
    this.emit("build.orchestrator_fallback", {
      reason,
      fallbackResult: fallbackResult ? "success" : "failed",
      eventCount: this.eventCount,
    });
  }

  /** Emit build completed successfully */
  completed(summary: string, stats: {
    iterations: number;
    toolCalls: number;
    toolResults: number;
    durationMs: number;
    filesCreated?: number;
    filesModified?: number;
  }): void {
    this.emit("build.completed", {
      summary,
      ...stats,
      eventCount: this.eventCount,
    });
  }

  /** Emit build failed */
  failed(summary: string, error: string, stats: {
    iterations: number;
    toolCalls: number;
    toolResults: number;
    durationMs: number;
  }): void {
    this.emit("build.failed", {
      summary,
      error,
      ...stats,
      eventCount: this.eventCount,
    });
  }

  /** Emit build cancelled */
  cancelled(reason: string, stats: {
    iterations: number;
    toolCalls: number;
    durationMs: number;
  }): void {
    this.emit("build.cancelled", {
      reason,
      ...stats,
      eventCount: this.eventCount,
    });
  }

  /** Get the build ID */
  getBuildId(): string {
    return this.buildId;
  }

  /** Get event count */
  getEventCount(): number {
    return this.eventCount;
  }
}

/**
 * Create a build event emitter for headless mode
 */
export function createBuildEventEmitter(options: BuildEventEmitterOptions): BuildEventEmitter {
  return new BuildEventEmitter(options);
}

/**
 * Parse JSONL build events from stdin or file
 * Useful for pipeline consumers
 */
export async function parseBuildEvents(
  input: NodeJS.ReadableStream
): Promise<BuildEvent[]> {
  const events: BuildEvent[] = [];

  for await (const line of input) {
    const trimmed = line.toString().trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as BuildEvent;
      events.push(event);
    } catch (err) {
      console.error("Failed to parse build event:", err);
    }
  }

  return events;
}

/**
 * Filter events by type
 */
export function filterEventsByType(events: BuildEvent[], types: BuildEventType[]): BuildEvent[] {
  const typeSet = new Set(types);
  return events.filter(e => typeSet.has(e.type));
}

/**
 * Get final build result from events
 */
export function getBuildResult(events: BuildEvent[]): {
  success: boolean;
  summary: string;
  error?: string;
  stats: {
    iterations: number;
    toolCalls: number;
    toolResults: number;
    durationMs: number;
  };
} | null {
  const completed = events.find(e => e.type === "build.completed");
  const failed = events.find(e => e.type === "build.failed");
  const cancelled = events.find(e => e.type === "build.cancelled");

  if (completed) {
    return {
      success: true,
      summary: completed.data.summary as string,
      stats: {
        iterations: completed.data.iterations as number,
        toolCalls: completed.data.toolCalls as number,
        toolResults: completed.data.toolResults as number,
        durationMs: completed.data.durationMs as number,
      },
    };
  }

  if (failed) {
    return {
      success: false,
      summary: failed.data.summary as string,
      error: failed.data.error as string,
      stats: {
        iterations: failed.data.iterations as number,
        toolCalls: failed.data.toolCalls as number,
        toolResults: failed.data.toolResults as number,
        durationMs: failed.data.durationMs as number,
      },
    };
  }

  if (cancelled) {
    return {
      success: false,
      summary: "Build cancelled",
      error: cancelled.data.reason as string,
      stats: {
        iterations: cancelled.data.iterations as number,
        toolCalls: cancelled.data.toolCalls as number,
        toolResults: 0,
        durationMs: cancelled.data.durationMs as number,
      },
    };
  }

  return null;
}