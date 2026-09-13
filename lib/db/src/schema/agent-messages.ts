import { pgTable, text, timestamp, uuid, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 2 — Crew message bus persistence.
 *
 * The agent crew (planner / coder / reviewer / fixer / helper) "speaks" by
 * posting messages onto a per-project thread. The in-process delivery lives in
 * build-message-bus.ts (EventEmitter pub/sub so agents react in-process); this
 * table is the DURABLE record — the "conversation log" a build's crew produced.
 * Survives server restarts and powers /build/crew/:projectId — the honest,
 * inspectable proof of genuine multi-agent dialogue.
 *
 * Steer lines are the same channel as talk: kind="steering" with toRole =
 * "orchestrator" lets a human inject an instruction at the next step boundary
 * (interactive steering, Phase 2).
 */
export const agentMessages = pgTable("agent_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id").notNull(),
  threadId: text("thread_id").notNull().default("default"),
  /** incrementing per (projectId, threadId) — poll(after:seqN) is resume-safe */
  seq: integer("seq").notNull().default(1),
  fromRole: text("from_role").notNull(),
  /** absent or "everyone" = broadcast; otherwise a role address (@mentions) */
  toRole: text("to_role"),
  kind: text("kind").notNull().default("message"), // message | reply | steering | review | helper | orchestrator
  content: text("content").notNull(),
  /** optional structured payload (review findings, handoff, decision, …) */
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;