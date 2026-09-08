/**
 * In-app API keys store (Freebuff keys tab).
 *
 * Matches the `app_secrets` DDL created by `auto-migrate.ts`: a plain text
 * key/value store where each row maps an app-wide secret name to its current
 * value (optionally pulled from an env var). Keyed by `key` text PK.
 */
import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const appSecrets = pgTable("app_secrets", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSecret = typeof appSecrets.$inferSelect;
export type NewAppSecret = typeof appSecrets.$inferInsert;