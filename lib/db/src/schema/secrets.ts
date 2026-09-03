import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, varchar, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./projects.js";
import { accounts } from "./accounts.js";

/**
 * LLM API Keys - AI Self-Management
 *
 * Enhanced key pool for LLM provider credentials with full encryption,
 * health monitoring, rotation tracking, and audit logging.
 *
 * Distinct from:
 * - project_secrets: Project-scoped secrets for build/runtime (DB URLs, API keys for services)
 * - llm_keys: Legacy table for model router (being replaced by this)
 *
 * Features:
 * - AES-256-GCM encrypted API keys
 * - Health states: healthy | cooling | quarantined
 * - Provider-specific rotation support
 * - Priority-based selection
 * - Project-scoped or global pool
 * - User API keys (source="user-api") for CLI access
 */
export const secrets = pgTable("secrets", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Project scoping (null = global pool)
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),

  // Provider identification
  provider: varchar("provider", { length: 50 }).notNull(), // 'openai', 'anthropic', 'google', 'groq', 'custom'
  model: varchar("model", { length: 100 }), // Optional model restriction

  // Encrypted API key (AES-256-GCM)
  // Stored as JSON: { ciphertext, iv, authTag, salt } all base64
  encryptedKey: jsonb("encrypted_key").notNull(),

  // Human-readable name
  name: text("name").notNull(),

  // Health tracking
  health: varchar("health", { enum: ["healthy", "cooling", "quarantined"] }).notNull().default("healthy"),
  priority: integer("priority").notNull().default(0), // Higher = preferred

  // Source type
  source: varchar("source", { enum: ["user-api", "project-pool", "global-pool"] }).notNull().default("project-pool"),

  // Usage tracking
  lastUsed: timestamp("last_used"),
  lastHealthCheck: timestamp("last_health_check").notNull().defaultNow(),

  // Cooling/quarantine
  coolingUntil: timestamp("cooling_until"),
  quarantineReason: text("quarantine_reason"),

  // Rotation tracking
  rotationCount: integer("rotation_count").notNull().default(0),

  // Metadata (flexible JSON for provider-specific data)
  metadata: jsonb("metadata").default({}),

  // Account ownership (for user-api keys)
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),

  // Scopes/permissions (for user-api keys)
  scopes: text("scopes").array(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("secrets_project_idx").on(table.projectId),
  providerIdx: index("secrets_provider_idx").on(table.provider),
  healthIdx: index("secrets_health_idx").on(table.health),
  sourceIdx: index("secrets_source_idx").on(table.source),
  projectProviderIdx: index("secrets_project_provider_idx").on(table.projectId, table.provider),
  accountIdx: index("secrets_account_idx").on(table.accountId),
}));

export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;

/**
 * Encrypted key structure stored in encryptedKey column
 */
export interface EncryptedKeyData {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  salt: string; // base64
}