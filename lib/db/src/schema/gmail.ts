import { pgTable, text, timestamp, bigint } from "drizzle-orm/pg-core";

/**
 * Stores the Gmail OAuth tokens for the single user of this Infinity instance.
 * Using a single-row table keyed by a constant id ("default").
 */
export const gmailTokens = pgTable("gmail_tokens", {
  id:           text("id").primaryKey().default("default"),
  accessToken:  text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt:    bigint("expires_at", { mode: "number" }).notNull(), // unix ms
  email:        text("email").notNull(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

export type GmailTokens = typeof gmailTokens.$inferSelect;
