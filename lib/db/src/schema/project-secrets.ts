import { pgTable, text, timestamp, uuid, varchar, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./projects.js";

/**
 * Project-scoped secrets — per-project, per-environment encrypted storage.
 * Separate from global app_secrets (which are server-wide API keys).
 *
 * Each secret belongs to a project and an environment (dev/staging/prod).
 * Values are encrypted with AES-256-GCM using a project-derived key.
 */
export const projectSecrets = pgTable("project_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  // Secret key name (e.g., "DATABASE_URL", "STRIPE_SECRET_KEY")
  key: text("key").notNull(),

  // Encrypted value (AES-256-GCM, stored as base64 iv:authTag:ciphertext)
  value: text("value").notNull(),

  // Environment: development | staging | production
  environment: varchar("environment", { length: 20 }).notNull().default("development"),

  // Optional metadata
  description: text("description"),
  category: varchar("category", { length: 30 }), // e.g., "database", "api", "auth", "storage"

  // Rotation support
  rotationProvider: varchar("rotation_provider", { length: 30 }), // "github", "vercel", "aws", "generic"
  rotatedAt: timestamp("rotated_at"),
  rotationEnabled: boolean("rotation_enabled").notNull().default(false),
  rotationIntervalDays: integer("rotation_interval_days"),

  // Access control
  isProtected: boolean("is_protected").notNull().default(false), // If true, value cannot be retrieved by API (injected only)

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_secrets_project_idx").on(table.projectId),
  projectEnvKeyIdx: index("project_secrets_project_env_key_idx").on(table.projectId, table.environment, table.key),
  environmentIdx: index("project_secrets_env_idx").on(table.environment),
}));

export type ProjectSecret = typeof projectSecrets.$inferSelect;
export type NewProjectSecret = typeof projectSecrets.$inferInsert;