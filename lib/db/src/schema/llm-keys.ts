import { pgTable, text, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

/**
 * LLM key pool — one row per provider credential.
 * Each entry pairs an API key with its base URL + model, so Jarvis can rotate
 * across providers (NVIDIA NIM, OpenRouter, Groq, Google AI Studio, …) and
 * quarantine exhausted keys. Health/stats are tracked per row so a server
 * restart keeps the knowledge.
 *
 * Env-sourced keys (OPENAI_LLM_API_KEY, _2, _3 …) are merged into the pool at
 * runtime and are not stored here.
 *
 * Also supports user API keys (source="user-api") for headless CLI access.
 */
export const llmKeys = pgTable("llm_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** User-facing label, e.g. "NVIDIA #1" or "OpenRouter free" or "CLI Key - CI". */
  name: text("name").notNull(),
  /** OpenAI-compatible base URL, e.g. https://integrate.api.nvidia.com/v1 (not used for user-api) */
  baseUrl: text("base_url").notNull(),
  /** The API key itself — server-side only, never returned to the client. */
  apiKey: text("api_key").notNull(),
  /** Model id this key is allowed to run (not used for user-api) */
  model: text("model").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Lower = picked first in round-robin. */
  priority: integer("priority").notNull().default(0),
  /** healthy | cooling (quota/transient) | quarantined (bad key) */
  status: text("status", { enum: ["healthy", "cooling", "quarantined"] }).notNull().default("healthy"),
  /** When the key may be picked again (null = immediately usable). */
  coolDownUntil: timestamp("cool_down_until"),
  uses: integer("uses").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** Source: "llm-provider" for LLM keys, "user-api" for CLI/API keys */
  source: text("source", { enum: ["llm-provider", "user-api"] }).notNull().default("llm-provider"),
  /** Project ID this key is scoped to (for user-api keys) */
  projectId: text("project_id"),
  /** Scopes/permissions for this key (for user-api keys) */
  scopes: text("scopes").array(),
  /** Account ID that owns this user-api key (for authorization) */
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
});

export type LlmKey = typeof llmKeys.$inferSelect;
