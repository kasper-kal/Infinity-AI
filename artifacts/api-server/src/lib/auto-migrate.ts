/**
 * Auto-migration: creates all PostgreSQL tables and keeps their columns in
 * sync with the Drizzle schema on API server startup.
 *
 * Two layers, both idempotent:
 *  1. `CREATE TABLE IF NOT EXISTS`, fresh databases get every table.
 *  2. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, pre-existing tables that
 *     predate newer columns (e.g. `conversations.kind` added for gems) get
 *     their missing columns without touching existing data.
 */
import { pool, filesPool } from "@workspace/db";

const CREATE_TABLES = [
  // ── Core chat ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "title" text NOT NULL DEFAULT 'New Conversation',
    "kind" text NOT NULL DEFAULT 'chat',
    "system_prompt" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS "messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
    "role" text NOT NULL,
    "content" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── Settings (key → value store) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS "infinity_settings" (
    "key" text PRIMARY KEY,
    "value" text NOT NULL,
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── Cross-chat memory ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "user_memories" (
    "topic" text PRIMARY KEY,
    "value" text NOT NULL,
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── OAuth tokens ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "gmail_tokens" (
    "id" text PRIMARY KEY DEFAULT 'default',
    "access_token" text NOT NULL,
    "refresh_token" text NOT NULL,
    "expires_at" bigint NOT NULL,
    "email" text NOT NULL,
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS "spotify_tokens" (
    "id" text PRIMARY KEY DEFAULT 'default',
    "access_token" text NOT NULL,
    "refresh_token" text NOT NULL,
    "expires_at" bigint NOT NULL,
    "display_name" text,
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── Deep research engine ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "research_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "title" text NOT NULL,
    "prompt" text NOT NULL,
    "mode" text NOT NULL DEFAULT 'agent',
    "depth" text NOT NULL DEFAULT 'deep',
    "status" text NOT NULL DEFAULT 'queued',
    "progress" integer NOT NULL DEFAULT 0,
    "phase" text NOT NULL DEFAULT 'Queued…',
    "log" text NOT NULL DEFAULT '',
    "notes" text NOT NULL DEFAULT '',
    "report" text NOT NULL DEFAULT '',
    "gem_system_prompt" text NOT NULL DEFAULT '',
    "gem_conversation_id" uuid,
    "phases_completed" integer NOT NULL DEFAULT 0,
    "error" text,
    "heartbeat_at" timestamp NOT NULL DEFAULT now(),
    "created_at" timestamp NOT NULL DEFAULT now(),
    "started_at" timestamp,
    "completed_at" timestamp
  )`,

  // ── Deep Research v2 engine ────────────────────────────────
  // (separate from the legacy `research_jobs` table; hosts the iterative
  //  plan→search→browse→extract→synthesize→gap-analysis agent and its sources)
  `CREATE TABLE IF NOT EXISTS "research_jobs_v2" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "topic" text NOT NULL,
    "status" text NOT NULL DEFAULT 'queued',
    "phase" text NOT NULL DEFAULT 'planning',
    "progress" integer NOT NULL DEFAULT 0,
    "sources_found" integer NOT NULL DEFAULT 0,
    "pages_read" integer NOT NULL DEFAULT 0,
    "current_query" text,
    "log" text NOT NULL DEFAULT '',
    "report" jsonb,
    "iterations" integer NOT NULL DEFAULT 0,
    "max_iterations" integer NOT NULL DEFAULT 3,
    "error" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "started_at" timestamp,
    "completed_at" timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS "research_jobs_v2_status_idx" ON "research_jobs_v2" ("status")`,
  `CREATE INDEX IF NOT EXISTS "research_jobs_v2_created_at_idx" ON "research_jobs_v2" ("created_at")`,

  `CREATE TABLE IF NOT EXISTS "research_sources_v2" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "job_id" uuid NOT NULL REFERENCES "research_jobs_v2"("id") ON DELETE CASCADE,
    "source_id" text NOT NULL UNIQUE,
    "title" text NOT NULL,
    "url" text NOT NULL,
    "snippet" text,
    "content" text,
    "source_type" text NOT NULL,
    "relevance_score" integer NOT NULL DEFAULT 0,
    "read_at" timestamp,
    "extraction" jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "research_sources_v2_job_id_idx" ON "research_sources_v2" ("job_id")`,
  `CREATE INDEX IF NOT EXISTS "research_sources_v2_source_id_idx" ON "research_sources_v2" ("source_id")`,
  `CREATE INDEX IF NOT EXISTS "research_sources_v2_url_idx" ON "research_sources_v2" ("url")`,

  // ── Book Studio jobs ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "book_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "title" text NOT NULL DEFAULT 'Untitled book',
    "idea" text NOT NULL,
    "language" text NOT NULL DEFAULT 'en',
    "page_count" integer NOT NULL DEFAULT 120,
    "words_per_page" integer NOT NULL DEFAULT 250,
    "chunk_size" integer NOT NULL DEFAULT 10,
    "critique_passes" integer NOT NULL DEFAULT 2,
    "status" text NOT NULL DEFAULT 'queued',
    "progress" integer NOT NULL DEFAULT 0,
    "phase" text NOT NULL DEFAULT 'Queued…',
    "log" text NOT NULL DEFAULT '',
    "plan" text NOT NULL DEFAULT '{}',
    "manuscript" text NOT NULL DEFAULT '',
    "samples" text NOT NULL DEFAULT '[]',
    "api_key" text,
    "base_url" text,
    "model" text,
    "pdf_file" text,
    "error" text,
    "heartbeat_at" timestamp NOT NULL DEFAULT now(),
    "created_at" timestamp NOT NULL DEFAULT now(),
    "started_at" timestamp,
    "completed_at" timestamp
  )`,

  // ── Web push subscriptions ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "endpoint" text PRIMARY KEY,
    "p256dh" text NOT NULL,
    "auth" text NOT NULL,
    "user_agent" text NOT NULL DEFAULT '',
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── LLM key rotation pool ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "llm_keys" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "base_url" text NOT NULL,
    "api_key" text NOT NULL,
    "model" text NOT NULL,
    "enabled" boolean NOT NULL DEFAULT true,
    "priority" integer NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'healthy',
    "cool_down_until" timestamp,
    "uses" integer NOT NULL DEFAULT 0,
    "failures" integer NOT NULL DEFAULT 0,
    "last_used_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── In-app API keys (Freebuff-Keys-tab-free secret store) ──
  `CREATE TABLE IF NOT EXISTS "app_secrets" (
    "key" text PRIMARY KEY,
    "value" text NOT NULL,
    "description" text,
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── Projects (ChatGPT-style folders) ───────────────────────────
  `CREATE TABLE IF NOT EXISTS "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "color" text NOT NULL DEFAULT '#0ea5e9',
    "archived" boolean NOT NULL DEFAULT false,
    "pinned" boolean NOT NULL DEFAULT false,
    "last_opened_at" timestamp,
    "instructions" text,
    "type" text NOT NULL DEFAULT 'general',
    "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "project_chats" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "project_files" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "file_id" uuid NOT NULL,
    "name" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── Project memory (strictly scoped to one project) ────────────
  `CREATE TABLE IF NOT EXISTS "project_memories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "category" text NOT NULL DEFAULT 'about',
    "content" text NOT NULL,
    "key" text NOT NULL,
    "source_type" text NOT NULL DEFAULT 'manual',
    "source_ref" text NOT NULL DEFAULT '',
    "pinned" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "project_memories_project_key_idx" ON "project_memories" ("project_id", "key")`,
  `CREATE INDEX IF NOT EXISTS "project_memories_project_idx" ON "project_memories" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_memories_project_pinned_idx" ON "project_memories" ("project_id", "pinned")`,

  // ── Project instructions (explicit rules, strictly project-scoped) ──
  `CREATE TABLE IF NOT EXISTS "project_instructions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "text" text NOT NULL,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_instructions_project_order_idx" ON "project_instructions" ("project_id", "sort_order", "created_at")`,

  // ── Project tasks (lightweight to-do list, strictly project-scoped) ──
  `CREATE TABLE IF NOT EXISTS "project_tasks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "title" text NOT NULL,
    "description" text,
    "status" text NOT NULL DEFAULT 'todo',
    "priority" text NOT NULL DEFAULT 'medium',
    "due_at" timestamp,
    "conversation_id" uuid,
    "file_id" uuid,
    "memory_id" uuid,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_tasks_project_idx" ON "project_tasks" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_tasks_project_status_idx" ON "project_tasks" ("project_id", "status")`,
  `CREATE INDEX IF NOT EXISTS "project_tasks_project_sort_idx" ON "project_tasks" ("project_id", "sort_order")`,

  // ── Project activity (append-only feed) ────────────────────────
  `CREATE TABLE IF NOT EXISTS "project_activity" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "description" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_activity_project_idx" ON "project_activity" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_activity_project_created_idx" ON "project_activity" ("project_id", "created_at")`,

  // ── Project research (join + saved findings) ───────────────────
  `CREATE TABLE IF NOT EXISTS "project_research" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "research_job_id" uuid NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_research_project_idx" ON "project_research" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_research_job_idx" ON "project_research" ("research_job_id")`,
  `CREATE TABLE IF NOT EXISTS "project_research_findings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "research_job_id" uuid NOT NULL,
    "excerpt" text NOT NULL,
    "pinned" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_research_findings_project_idx" ON "project_research_findings" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_research_findings_job_idx" ON "project_research_findings" ("research_job_id")`,

  // ── Project agent runs + actions (agent-ready, populated later) ──
  `CREATE TABLE IF NOT EXISTS "project_agent_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "status" text NOT NULL DEFAULT 'queued',
    "objective" text,
    "result_summary" text,
    "started_at" timestamp,
    "completed_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_agent_runs_project_idx" ON "project_agent_runs" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_agent_runs_project_status_idx" ON "project_agent_runs" ("project_id", "status")`,
  `CREATE TABLE IF NOT EXISTS "project_agent_actions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_id" uuid NOT NULL REFERENCES "project_agent_runs"("id") ON DELETE CASCADE,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "type" text NOT NULL DEFAULT 'other',
    "description" text,
    "detail" text,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_agent_actions_run_idx" ON "project_agent_actions" ("run_id")`,
  `CREATE INDEX IF NOT EXISTS "project_agent_actions_project_idx" ON "project_agent_actions" ("project_id")`,

  // ── Pins (pinned chats sort to the top) ────────────────────────
  `CREATE TABLE IF NOT EXISTS "pins" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversation_id" uuid NOT NULL UNIQUE REFERENCES "conversations"("id") ON DELETE CASCADE,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── Share links (public read-only conversation links) ──────────
  `CREATE TABLE IF NOT EXISTS "share_links" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "token" text NOT NULL UNIQUE,
    "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "expires_at" timestamp
  )`,

  // ── Groupchats (AI roundtables + human groups) ─────────────────
  `CREATE TABLE IF NOT EXISTS "group_chats" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "kind" text NOT NULL DEFAULT 'ai',
    "ai_toggle" text NOT NULL DEFAULT 'always',
    "owner_token_hash" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "group_members" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "group_id" uuid NOT NULL REFERENCES "group_chats"("id") ON DELETE CASCADE,
    "account_id" uuid,
    "persona" text,
    "role" text NOT NULL DEFAULT 'member',
    "joined_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "invite_codes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "group_id" uuid NOT NULL REFERENCES "group_chats"("id") ON DELETE CASCADE,
    "code" text NOT NULL UNIQUE,
    "created_by" uuid,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "expires_at" timestamp,
    "used_at" timestamp
  )`,

  `ALTER TABLE "group_chats" ADD COLUMN IF NOT EXISTS "owner_token_hash" text`,

  // ── Accounts + sessions (invited users, minimal local auth) ────
  `CREATE TABLE IF NOT EXISTS "accounts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text NOT NULL UNIQUE,
    "password_hash" text NOT NULL,
    "display_name" text NOT NULL DEFAULT '',
    "avatar_url" text,
    "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "token" text NOT NULL UNIQUE,
    "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "expires_at" timestamp,
    "revoked_at" timestamp
  )`,

  // ── Infinity Build saved apps ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "build_apps" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "file_id" uuid,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── MCP Server Configurations (project-scoped, encrypted secrets) ────
  `CREATE TABLE IF NOT EXISTS "mcp_servers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "server_id" text NOT NULL,
    "name" text NOT NULL,
    "transport_type" text NOT NULL,
    "transport_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "builtin_type" text,
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "enabled" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_project_server_idx" ON "mcp_servers" ("project_id", "server_id")`,
  `CREATE INDEX IF NOT EXISTS "mcp_servers_project_idx" ON "mcp_servers" ("project_id")`,
  // ── Phase 1.2: Build Checkpoints (resume system) ────────────────
  `CREATE TABLE IF NOT EXISTS "build_checkpoints" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" text NOT NULL,
    "iteration" integer NOT NULL DEFAULT 1,
    "completed" integer NOT NULL DEFAULT 0,
    "plan" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "completed_steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "working_context" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "file_snapshots" jsonb,
    "token_usage" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
];

/**
 * ALTER statements, fill in any columns missing from pre-existing tables.
 * Each is a no-op when the column already exists.
 */
const ALTER_TABLES = [
  // conversations, `kind` + `system_prompt` were added after the first deploy
  `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'chat'`,
  `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "system_prompt" text`,
  `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now()`,
  `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()`,

  // messages
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "reasoning" text`,
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now()`,

  // research_jobs, deep research engine columns
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "mode" text NOT NULL DEFAULT 'agent'`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "depth" text NOT NULL DEFAULT 'deep'`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "progress" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "phase" text NOT NULL DEFAULT 'Queued…'`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "log" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "notes" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "report" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "gem_system_prompt" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "gem_conversation_id" uuid`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "phases_completed" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "error" text`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp NOT NULL DEFAULT now()`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "started_at" timestamp`,
  `ALTER TABLE "research_jobs" ADD COLUMN IF NOT EXISTS "completed_at" timestamp`,

  // book_jobs, book studio columns (added after first deploy)
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "title" text NOT NULL DEFAULT 'Untitled book'`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "idea" text NOT NULL`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'en'`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "page_count" integer NOT NULL DEFAULT 120`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "words_per_page" integer NOT NULL DEFAULT 250`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "chunk_size" integer NOT NULL DEFAULT 10`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "critique_passes" integer NOT NULL DEFAULT 2`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "progress" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "phase" text NOT NULL DEFAULT 'Queued…'`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "log" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "plan" text NOT NULL DEFAULT '{}'`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "manuscript" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "samples" text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "api_key" text`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "base_url" text`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "model" text`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "pdf_file" text`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "error" text`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp NOT NULL DEFAULT now()`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "started_at" timestamp`,
  `ALTER TABLE "book_jobs" ADD COLUMN IF NOT EXISTS "completed_at" timestamp`,

  // llm_keys, rotation pool columns
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'healthy'`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "cool_down_until" timestamp`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "uses" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "failures" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now()`,

  // projects, Phase B project management fields
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "last_opened_at" timestamp`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'general'`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS "projects_account_id_idx" ON "projects" ("account_id")`,

  // push_subscriptions
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_agent" text NOT NULL DEFAULT ''`,

  // accounts, scopes column for auth middleware
  `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb`,

  // sessions, revoked_at column for session revocation
  `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp`,
  `CREATE INDEX IF NOT EXISTS "sessions_account_revoked_idx" ON "sessions" ("account_id", "revoked_at")`,

  // gmail / spotify
  `ALTER TABLE "gmail_tokens" ADD COLUMN IF NOT EXISTS "email" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "spotify_tokens" ADD COLUMN IF NOT EXISTS "display_name" text`,
];

export async function ensureTables(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const sql of CREATE_TABLES) {
      await client.query(sql);
    }
    for (const sql of ALTER_TABLES) {
      await client.query(sql);
    }
    const { rows } = await client.query(
      `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    console.log(`[auto-migrate] ready, ${rows[0]?.c ?? 0} public tables, columns synced`);
  } finally {
    client.release();
  }
}

/**
 * Create the `files` table in the SEPARATE files database (DATABASE_URL_FILES,
 * falling back to DATABASE_URL until a dedicated files DB exists). Additive
 * and idempotent, same as ensureTables.
 */
export async function ensureFilesTables(): Promise<void> {
  const client = await filesPool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "files" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "conversation_id" uuid,
      "kind" text NOT NULL DEFAULT 'document',
      "name" text NOT NULL DEFAULT 'unnamed',
      "mime" text NOT NULL DEFAULT 'application/octet-stream',
      "size" integer NOT NULL DEFAULT 0,
      "storage_key" text NOT NULL,
      "bucket" text NOT NULL DEFAULT 'local',
      "owner" text NOT NULL DEFAULT 'user',
      "created_at" timestamp NOT NULL DEFAULT now()
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS "files_conversation_idx" ON "files" ("conversation_id")`);
    await client.query(`CREATE INDEX IF NOT EXISTS "files_storage_key_idx" ON "files" ("storage_key")`);
    console.log("[auto-migrate] files table ready (files database)");
  } finally {
    client.release();
  }
}
