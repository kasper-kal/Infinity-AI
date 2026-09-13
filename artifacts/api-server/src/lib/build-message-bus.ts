/**
 * BUILD MESSAGE BUS — Phase 2 "the crew speaks".
 *
 * A per-project conversation channel for the build crew. Designed so the crew
 * is a GENUINE multi-agent dialogue, not a one-way broadcast:
 *
 *  - `post(...)`           — an agent says something. Delivered in-process to
 *                            subscribers instantly; persisted to Postgres
 *                            (`agent_messages`) best-effort so the CONVERSATION
 *                            LOG survives restarts (the honest proof the crew
 *                            actually spoke).
 *  - `subscribe(...)`      — a role listens for messages addressed to it
 *                            (@mentions) or broadcast. Subscribers can reply.
 *  - `getThread(...)`      — the durable conversation log (ascending).
 *  - `postSteering(...)`   — a HUMAN injects an instruction addressed to the
 *                            "orchestrator"; the orchestrator drains pending
 *                            steering at every step boundary and injects it
 *                            into the next step's goal (interactive steering).
 *  - `messagesForRole(...)`— what a role would see since sequence N
 *                            (poll — the cross-process / restart-safe read).
 *
 * Delivery is in-process EventEmitter (all crew agents live in the same api
 * server process); persistence is the durable tail. DB-down degrades to
 * in-process delivery only — the bus never crashes the server and never
 * swallows a live message.
 *
 * Message addressing = roles. `toRole` omitted means broadcast ("everyone");
 * `toRole: "reviewer"` is an @mention the reviewer's subscription receives.
 */

import { EventEmitter } from "node:events";
import { db, databaseConfigured } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { agentMessages, type AgentMessage } from "@workspace/db/schema";

/** The crew roster. "orchestrator" is the step planner/coordinator role. */
export type CrewRole = "planner" | "coder" | "reviewer" | "fixer" | "helper" | "orchestrator" | "designer";

export const CREW_ROLES: CrewRole[] = ["planner", "coder", "reviewer", "fixer", "helper", "orchestrator"];

/** What the message is FOR — steering and reviews are first-class channels. */
export type MessageKind = "message" | "reply" | "steering" | "review" | "helper" | "orchestrator" | "handoff";

export interface PostMessageInput {
  projectId: string;
  threadId?: string;
  fromRole: CrewRole;
  /** omitted = broadcast to the whole crew */
  toRole?: CrewRole | "everyone";
  kind?: MessageKind;
  content: string;
  payload?: Record<string, unknown> | null;
  /** in-process/pub-sub event bus only — not persisted; delivery-only tag */
  _echo?: boolean;
}

export interface CrewMessage {
  seq: number;
  projectId: string;
  threadId: string;
  fromRole: string;
  toRole: string | null;
  kind: string;
  content: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  persisted: boolean;
}

export interface SubscribeFilter {
  projectId?: string;
  toRole?: CrewRole;
  kinds?: MessageKind[];
}

export interface MessageBusOptions {
  /** include POSTED-but-not-persisted messages in getThread (live tail). Default true. */
  includeLive?: boolean;
}

type Handler = (message: CrewMessage) => void;

// ============================================================================
// In-process pub/sub (the live delivery path)
// ============================================================================

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

/** Fallback in-memory seq when Postgres is unreachable (persistence degraded). */
const memSeq = new Map<string, number>();

function busKey(projectId: string, threadId: string): string {
  return `${projectId}::${threadId}`;
}

function nextMemSeq(projectId: string, threadId: string): number {
  const k = busKey(projectId, threadId);
  const next = (memSeq.get(k) ?? 0) + 1;
  memSeq.set(k, next);
  return next;
}

async function nextDbSeq(projectId: string, threadId: string): Promise<number> {
  try {
    const rows = await db
      .select({ seq: agentMessages.seq })
      .from(agentMessages)
      .where(and(eq(agentMessages.projectId, projectId), eq(agentMessages.threadId, threadId)))
      .orderBy(asc(agentMessages.seq))
      .limit(1);
    const maxRow = rows.length ? rows[0].seq : 0;
    return maxRow + 1;
  } catch {
    return 0; // caller falls back to mem seq
  }
}

// ============================================================================
// Bus
// ============================================================================

export class MessageBus {
  private projectId: string;
  private threadId: string;
  private liveCache: CrewMessage[] = [];

  constructor(projectId: string, threadId = "default") {
    this.projectId = projectId;
    this.threadId = threadId;
  }

  /** An agent says something. Persisted + delivered in-process. Never throws. */
  async post(input: PostMessageInput): Promise<CrewMessage> {
    const { fromRole, content } = input;
    const toRole = input.toRole && input.toRole !== "everyone" ? input.toRole : null;
    const kind = input.kind ?? "message";
    const threadId = input.threadId ?? this.threadId;

    let seq = nextMemSeq(this.projectId, threadId);
    let persisted = false;

    if (databaseConfigured) {
      try {
        const dbSeq = await nextDbSeq(this.projectId, threadId);
        if (dbSeq > 0) seq = dbSeq;
        const now = new Date().toISOString();
        await db.insert(agentMessages).values({
          projectId: this.projectId,
          threadId,
          seq,
          fromRole,
          toRole,
          kind,
          content,
          payload: (input.payload ?? null) as any,
        });
        persisted = true;
      } catch (err) {
        // Persistence is the durable tail — never fail a live post because the
        // log is unwritable. In-process delivery still happens.
        console.error(`[message-bus] persist failed for ${fromRole}:`, err.message);
      }
    }

    const message: CrewMessage = {
      seq,
      projectId: this.projectId,
      threadId,
      fromRole,
      toRole: toRole as string | null,
      kind,
      content,
      payload: (input.payload ?? null) as Record<string, unknown> | null,
      createdAt: new Date().toISOString(),
      persisted,
    };

    this.liveCache.push(message);
    emitLive(this.projectId, threadId, message);
    return message;
  }

  /**
   * A role tunes in. Handlers with no filter get every message in this bus's
   * project; `toRole` filters to @mentions of that role. Subscribe can be
   * called multiple times (different roles in the same crew).
   */
  subscribe(filter: SubscribeFilter, handler: Handler): () => void {
    const listener = ({ projectId, threadId, message }: LiveEnvelope) => {
      if (this.projectId && projectId !== this.projectId) return;
      if (filter.projectId && projectId !== filter.projectId) return;
      if (filter.toRole && message.toRole && message.toRole !== filter.toRole) return;
      if (filter.kinds && filter.kinds.length > 0 && !filter.kinds.includes(message.kind as MessageKind)) return;
      handler(message);
    };
    emitter.on("agent-message", listener);
    return () => emitter.off("agent-message", listener);
  }

  /** The durable conversation log — what the crew actually said, ascending. */
  async getThread(options?: MessageBusOptions & { afterSeq?: number }): Promise<CrewMessage[]> {
    const rows: CrewMessage[] = options?.includeLive === false ? [] : [...this.liveCache];
    if (databaseConfigured && !options?.includeLive) {
      try {
        const persisted = await db
          .select()
          .from(agentMessages)
          .where(and(eq(agentMessages.projectId, this.projectId), eq(agentMessages.threadId, this.threadId)))
          .orderBy(asc(agentMessages.seq));
        for (const row of persisted) {
          rows.push(rowToMessage(row));
        }
        rows.sort((a, b) => a.seq - b.seq);
        return rows;
      } catch {
        return rows.sort((a, b) => a.seq - b.seq);
      }
    }
    return rows.sort((a, b) => a.seq - b.seq);
  }

  /** What a role would read since message N — poll-based, restart-safe. */
  async messagesForRole(role: CrewRole, afterSeq = 0): Promise<CrewMessage[]> {
    const all = await this.getThread({ afterSeq });
    return all.filter(
      (m) =>
        m.seq > afterSeq &&
        (m.toRole === null || m.toRole === role || m.toRole === "everyone") &&
        !(m.fromRole === role && m.kind === "message")
    );
  }

  /** Human steering: @orchestrator with an instruction, applied at next step. */
  async postSteering(instruction: string, payload?: Record<string, unknown>): Promise<CrewMessage> {
    return this.post({
      projectId: this.projectId,
      threadId: this.threadId,
      fromRole: "orchestrator",
      toRole: "orchestrator",
      kind: "steering",
      content: instruction,
      payload: payload ?? { source: "human" },
    });
  }

  /** Pull every pending (un-drained) steering instruction for the orchestrator. */
  async drainSteering(afterSeq = 0): Promise<CrewMessage[]> {
    const all = await this.messagesForRole("orchestrator", afterSeq);
    return all.filter((m) => m.kind === "steering");
  }

  /** Count of messages on the thread (the "genuine dialogue" tally). */
  async size(): Promise<number> {
    return (await this.getThread()).length;
  }
}

interface LiveEnvelope {
  projectId: string;
  threadId: string;
  message: CrewMessage;
}

function emitLive(projectId: string, threadId: string, message: CrewMessage): void {
  emitter.emit("agent-message", { projectId, threadId, message } satisfies LiveEnvelope);
}

/** Format an @mention line for human-readable crew logs. */
export function mention(role: CrewRole, text: string): string {
  return `@${role}: ${text}`;
}

export function rowToMessage(row: AgentMessage): CrewMessage {
  return {
    seq: row.seq,
    projectId: row.projectId,
    threadId: row.threadId,
    fromRole: row.fromRole,
    toRole: row.toRole ?? null,
    kind: row.kind,
    content: row.content,
    payload: (row.payload ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    persisted: true,
  };
}

/** Reset in-memory subscriber state (tests / long-running servers). */
export function resetBusForTests(): void {
  emitter.removeAllListeners("agent-message");
  memSeq.clear();
}