/**
 * Phase 5.1: Telemetry + Debugging — Structured event log for Build Mode.
 *
 * Every build action (plan start, step start, tool call, tool result, verify
 * start/result, checkpoint, error) is appended as a single JSON line to a
 * per-project log file under WORKSPACE_ROOT/telemetry/<projectId>.log.
 *
 * The log is the source of truth for the client Debug panel: it streams and
 * replays events, and can be exported as JSONL. No external services — the file
 * is on local disk, rotated/bounded in size.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT } from "./workspace";
import { getWorkingContext } from "./build-context";

export type BuildEventType =
  | "plan_start"
  | "plan_ready"
  | "step_start"
  | "tool_call"
  | "tool_result"
  | "verify_start"
  | "verify_result"
  | "checkpoint"
  | "snapshot"
  | "error"
  | "retry"
  | "info"
  | "agent_start"
  | "agent_end"
  | "agent_error"
  | "agent_step_start"
  | "orchestrator"
  | "orchestrator_start";

export interface BuildEvent {
  ts: string;
  seq: number;
  type: BuildEventType;
  projectId: string;
  /** Optional human label, e.g. "Run tsc --noEmit" */
  label: string;
  /** Optional structured payload (tool call args, verify result, error) */
  data?: Record<string, unknown> | null;
  /** Optional duration in ms (for tool_result / verify_result) */
  durationMs?: number;
  /** Optional step id this event belongs to */
  step?: string;
}

const TELEMETRY_ROOT = path.resolve(WORKSPACE_ROOT, "telemetry");
const MAX_LOG_BYTES = 4 * 1024 * 1024; // 4MB per project log
const MAX_EVENTS_IN_MEMORY = 2000;

// In-memory ring buffer per project for fast recent lookups (the Debug panel
// mostly needs the last few hundred events; the file is the durable store).
const buffers = new Map<string, BuildEvent[]>();
let seqCounter = 0;

function logPath(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96) || "default";
  return path.join(TELEMETRY_ROOT, `${safe}.log`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(TELEMETRY_ROOT, { recursive: true });
}

/**
 * Append a structured event to the project telemetry log. Failures are swallowed
 * (telemetry must never break a build) but surfaced via console.error for ops.
 */
export async function logBuildEvent(
  projectId: string,
  type: BuildEventType,
  label: string,
  opts: {
    data?: Record<string, unknown> | null;
    durationMs?: number;
    step?: string;
  } = {},
): Promise<void> {
  const event: BuildEvent = {
    ts: new Date().toISOString(),
    seq: ++seqCounter,
    type,
    projectId,
    label,
    data: opts.data ?? null,
    durationMs: opts.durationMs,
    step: opts.step,
  };

  // Memory buffer
  const buf = buffers.get(projectId) ?? [];
  buf.push(event);
  if (buf.length > MAX_EVENTS_IN_MEMORY) buf.splice(0, buf.length - MAX_EVENTS_IN_MEMORY);
  buffers.set(projectId, buf);

  // Append to file (fire and forget, but await so callers can rely on order)
  try {
    await ensureDir();
    const line = `${JSON.stringify(event)}\n`;
    const p = logPath(projectId);
    // Bound the file: if too big, trim from the head by rewriting the tail.
    try {
      const stat = await fs.stat(p);
      if (stat.size > MAX_LOG_BYTES) await trimLog(p);
    } catch { /* file may not exist yet */ }
    await fs.appendFile(p, line, "utf8");
  } catch (err) {
    console.error("[telemetry] write failed for", projectId, err);
  }
}

async function trimLog(p: string): Promise<void> {
  try {
    const content = await fs.readFile(p, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const keep = lines.slice(-Math.floor(MAX_EVENTS_IN_MEMORY / 2));
    await fs.writeFile(p, `${keep.join("\n")}\n`, "utf8");
  } catch { /* best effort */ }
}

/** Get buffered (recent) events for a project, newest last. */
export function getRecentEvents(projectId: string, limit = 500): BuildEvent[] {
  const buf = buffers.get(projectId) ?? [];
  return buf.slice(-limit);
}

/** Read all events from the on-disk log (newest last). Used for export/replay. */
export async function readAllEvents(projectId: string): Promise<BuildEvent[]> {
  try {
    const content = await fs.readFile(logPath(projectId), "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as BuildEvent; } catch { return null; }
      })
      .filter((e): e is BuildEvent => e !== null);
  } catch {
    return [];
  }
}

/**
 * Replay helper: produce a compact summary string of what happened, useful for
 * feeding back into a model or showing in the Debug panel "replay" view.
 */
export async function summarizeTelemetry(projectId: string): Promise<string> {
  const events = await readAllEvents(projectId);
  if (events.length === 0) return "(no telemetry yet)";
  const ctx = getWorkingContextSafe(projectId);
  const lines = events.slice(-40).map((e) => {
    const d = e.durationMs != null ? ` (${e.durationMs}ms)` : "";
    return `- [${e.type}] ${e.label}${d}`;
  });
  return `Build telemetry for ${projectId} (${events.length} events)${ctx ? `, goal: ${ctx}` : ""}:\n${lines.join("\n")}`;
}

function getWorkingContextSafe(projectId: string): string | null {
  try {
    return getWorkingContext(projectId)?.projectGoal ?? null;
  } catch {
    return null;
  }
}

/** Count of events on disk (for the Debug panel header). */
export async function countEvents(projectId: string): Promise<number> {
  try {
    const content = await fs.readFile(logPath(projectId), "utf8");
    return content.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** Clear all telemetry for a project (Debug panel "clear logs"). */
export async function clearTelemetry(projectId: string): Promise<void> {
  buffers.delete(projectId);
  try {
    await fs.rm(logPath(projectId), { force: true });
  } catch { /* best effort */ }
}
