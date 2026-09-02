import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("New Conversation"),
  /** "chat" = normal conversation, "gem" = a finished deep-research gem */
  kind: text("kind", { enum: ["chat", "gem"] }).notNull().default("chat"),
  /** Custom system prompt. When set, the chat route uses this instead of the default Infinity prompt (used by gems). */
  systemPrompt: text("system_prompt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  /** Private reasoning chain shown in a collapsible "Thinking" block (thinking mode). */
  reasoning: text("reasoning"),
  /** Compacted summary of conversation history when auto-compaction was applied */
  compactedSummary: text("compacted_summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
