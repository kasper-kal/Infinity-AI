import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Groupchats: AI persona roundtables (kind = "ai") and human groups with
 * invite codes (kind = "human").
 */
export const groupChats = pgTable("group_chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["ai", "human"] }).notNull().default("ai"),
  /** "always" = Infinity replies to everything, "mention" = only when @Infinity. */
  aiToggle: text("ai_toggle", { enum: ["always", "mention"] }).notNull().default("always"),
  /** Hash of the anonymous owner's browser token, never exposed to clients. */
  ownerTokenHash: text("owner_token_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Group participants. accountId null means the primary (owner) user; AI
 * members carry a persona name. A groupchat is also a conversation, linked
 * by groupChats.id == conversations.id when the group was created as a chat.
 */
export const groupMembers = pgTable("group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groupChats.id, { onDelete: "cascade" }),
  accountId: uuid("account_id"),
  persona: text("persona"),
  role: text("role").notNull().default("member"),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

/** 4-digit invite codes, scoped to one group, one-time use. */
export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groupChats.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
});

export type GroupChat = typeof groupChats.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;
