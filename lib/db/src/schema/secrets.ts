import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * In-app secret store — the Freebuff-Keys-tab-free alternative.
 * Keys are pasted inside Infinity (Settings → API Keys), stored here in the
 * app's own database, and injected into process.env at server boot so every
 * existing `process.env.XXX` read site just works.
 */
export const appSecrets = pgTable("app_secrets", {
  /** Env var name, e.g. OPENROUTER_API_KEY */
  key: text("key").primaryKey(),
  /** The secret value — server-side only, never returned to the client. */
  value: text("value").notNull(),
  /** Optional human-readable note, e.g. "OpenRouter free auto-router" */
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSecret = typeof appSecrets.$inferSelect;
