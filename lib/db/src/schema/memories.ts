import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent cross-chat memory.
 * Each row represents one fact Infinity has learned about the user.
 * The `topic` column is used as an upsert key — if the same topic
 * is learned again, the value is updated rather than duplicated.
 */
export const userMemories = pgTable("user_memories", {
  topic: text("topic").primaryKey(),   // e.g. "pet preference", "name", "location"
  value: text("value").notNull(),      // e.g. "The user likes frogs"
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserMemory = typeof userMemories.$inferSelect;
