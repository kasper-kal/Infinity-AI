import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";

/**
 * Minimal local accounts for invited users (groupchats). The primary user has
 * no account row; group features degrade gracefully when no other accounts
 * exist yet.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull().default(""),
  avatarUrl: text("avatar_url"),
  scopes: jsonb("scopes").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Cookie sessions for invited accounts. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
});

export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
