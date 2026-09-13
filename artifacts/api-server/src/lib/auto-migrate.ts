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
  // ── Accounts + sessions (invited users, minimal local auth) ────
  // Created FIRST because accounts is referenced by FK from projects,
  // sessions, llm_keys, mfa_* and push_subscriptions. (Fix 0.3 — the
  // previous position after group_members aborted fresh-db migration at the
  // first FK violation.)
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
    "source" text NOT NULL DEFAULT 'llm-provider',
    "project_id" text,
    "scopes" text[] DEFAULT '{}',
    "account_id" uuid REFERENCES "accounts"("id") ON DELETE CASCADE,
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
    "compacted_context" jsonb,
    "file_snapshots" jsonb,
    "token_usage" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  // ── Phase 2: Crew message bus (agent_messages) ─────────────────
  `CREATE TABLE IF NOT EXISTS "agent_messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" text NOT NULL,
    "thread_id" text NOT NULL DEFAULT 'default',
    "seq" integer NOT NULL DEFAULT 1,
    "from_role" text NOT NULL,
    "to_role" text,
    "kind" text NOT NULL DEFAULT 'message',
    "content" text NOT NULL DEFAULT '',
    "payload" jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "agent_messages_project_seq_idx" ON "agent_messages" ("project_id", "thread_id", "seq")`,
  `CREATE INDEX IF NOT EXISTS "agent_messages_project_role_idx" ON "agent_messages" ("project_id", "from_role")`,

  // ── Phase 18: Preview Sharing & Collaboration ─────────────────
  `CREATE TABLE IF NOT EXISTS "preview_shares" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "component_id" uuid REFERENCES "build_apps"("id") ON DELETE SET NULL,
    "preview_url" text NOT NULL,
    "title" text NOT NULL,
    "description" text,
    "share_token" text NOT NULL UNIQUE,
    "access_level" text NOT NULL DEFAULT 'public' CHECK ("access_level" IN ('public', 'private', 'password')),
    "password_hash" text,
    "expires_at" timestamp,
    "allowed_emails" jsonb DEFAULT '[]',
    "allowed_domains" jsonb DEFAULT '[]',
    "enable_comments" boolean NOT NULL DEFAULT true,
    "enable_reactions" boolean NOT NULL DEFAULT true,
    "notify_on_comment" boolean NOT NULL DEFAULT true,
    "view_count" integer NOT NULL DEFAULT 0,
    "comment_count" integer NOT NULL DEFAULT 0,
    "created_by" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "preview_shares_project_idx" ON "preview_shares" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "preview_shares_expires_idx" ON "preview_shares" ("expires_at")`,

  `CREATE TABLE IF NOT EXISTS "preview_share_access" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "share_id" uuid NOT NULL REFERENCES "preview_shares"("id") ON DELETE CASCADE,
    "email" text,
    "ip" text,
    "user_agent" text,
    "accessed_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "preview_share_access_share_idx" ON "preview_share_access" ("share_id")`,
  `CREATE INDEX IF NOT EXISTS "preview_share_access_accessed_idx" ON "preview_share_access" ("accessed_at")`,

  `CREATE TABLE IF NOT EXISTS "preview_comments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "share_id" uuid NOT NULL REFERENCES "preview_shares"("id") ON DELETE CASCADE,
    "parent_id" uuid REFERENCES "preview_comments"("id") ON DELETE CASCADE,
    "element_selector" text,
    "element_data" jsonb,
    "author_name" text NOT NULL,
    "author_email" text,
    "author_avatar" text,
    "content" text NOT NULL,
    "is_resolved" boolean NOT NULL DEFAULT false,
    "resolved_by" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
    "resolved_at" timestamp,
    "reactions" jsonb DEFAULT '{}',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "preview_comments_share_idx" ON "preview_comments" ("share_id")`,
  `CREATE INDEX IF NOT EXISTS "preview_comments_parent_idx" ON "preview_comments" ("parent_id")`,
  `CREATE INDEX IF NOT EXISTS "preview_comments_element_idx" ON "preview_comments" ("element_selector")`,
  `CREATE INDEX IF NOT EXISTS "preview_comments_created_idx" ON "preview_comments" ("created_at")`,

  `CREATE TABLE IF NOT EXISTS "preview_comment_mentions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "comment_id" uuid NOT NULL REFERENCES "preview_comments"("id") ON DELETE CASCADE,
    "mentioned_email" text NOT NULL,
    "notified" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "preview_comment_mentions_comment_idx" ON "preview_comment_mentions" ("comment_id")`,
  `CREATE INDEX IF NOT EXISTS "preview_comment_mentions_email_idx" ON "preview_comment_mentions" ("mentioned_email")`,

  // ── Phase 19: External Database Connections ───────────────────────
  `CREATE TABLE IF NOT EXISTS "project_databases" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "provider" text NOT NULL CHECK ("provider" IN ('supabase', 'firebase', 'neon', 'planetscale', 'turso', 'sqlite', 'postgres', 'mysql')),
    "connection_string" text NOT NULL,
    "host" text,
    "port" text,
    "database" text,
    "username" text,
    "password" text,
    "ssl" boolean NOT NULL DEFAULT true,
    "options" jsonb DEFAULT '{}',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "project_databases_project_idx" ON "project_databases" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_databases_provider_idx" ON "project_databases" ("provider")`,

  // ── Phase 37: Workflows (NL → Deployed Product) ──────────────────
  `CREATE TABLE IF NOT EXISTS "workflows" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
    "goal" text NOT NULL,
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "plan" jsonb,
    "status" text NOT NULL DEFAULT 'pending',
    "current_phase" text NOT NULL DEFAULT 'discover',
    "current_step" text,
    "total_estimated_duration" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now(),
    "completed_at" timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS "workflows_project_id_idx" ON "workflows" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "workflows_account_id_idx" ON "workflows" ("account_id")`,
  `CREATE INDEX IF NOT EXISTS "workflows_status_idx" ON "workflows" ("status")`,

  `CREATE TABLE IF NOT EXISTS "workflow_steps" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
    "phase" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "agent" text,
    "dependencies" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "estimated_duration" integer NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'pending',
    "result" jsonb,
    "error" text,
    "started_at" timestamp,
    "completed_at" timestamp,
    "requires_approval" boolean NOT NULL DEFAULT false,
    "approval_gate" text,
    "worktree_id" text,
    "artifacts" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "workflow_steps_workflow_id_idx" ON "workflow_steps" ("workflow_id")`,
  `CREATE INDEX IF NOT EXISTS "workflow_steps_status_idx" ON "workflow_steps" ("status")`,

  `CREATE TABLE IF NOT EXISTS "workflow_checkpoints" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
    "phase" text NOT NULL,
    "step_id" text NOT NULL,
    "timestamp" timestamp NOT NULL DEFAULT now(),
    "state" jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "workflow_checkpoints_workflow_id_idx" ON "workflow_checkpoints" ("workflow_id")`,

  `CREATE TABLE IF NOT EXISTS "workflow_approvals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
    "gate" text NOT NULL,
    "step_id" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "requested_at" timestamp NOT NULL DEFAULT now(),
    "responded_at" timestamp,
    "feedback" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "workflow_approvals_workflow_id_idx" ON "workflow_approvals" ("workflow_id")`,
  `CREATE INDEX IF NOT EXISTS "workflow_approvals_status_idx" ON "workflow_approvals" ("status")`,

  // ── Phase 38: Safety Watcher ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "safety_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
    "rule_id" varchar(100) NOT NULL,
    "name" varchar(200) NOT NULL,
    "description" text,
    "enabled" boolean NOT NULL DEFAULT true,
    "severity" varchar(20) NOT NULL DEFAULT 'warning',
    "action" varchar(20) NOT NULL DEFAULT 'notify',
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "cooldown_ms" integer NOT NULL DEFAULT 300000,
    "tags" text[] NOT NULL DEFAULT '{}',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "safety_rules_project_rule_idx" ON "safety_rules" ("project_id", "rule_id")`,
  `CREATE INDEX IF NOT EXISTS "safety_rules_project_enabled_idx" ON "safety_rules" ("project_id", "enabled")`,

  `CREATE TABLE IF NOT EXISTS "notification_channels" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
    "type" varchar(20) NOT NULL,
    "name" varchar(200) NOT NULL,
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "enabled" boolean NOT NULL DEFAULT true,
    "severity_filter" varchar(20)[] NOT NULL DEFAULT ARRAY['warning','critical','emergency'],
    "quiet_hours_enabled" boolean NOT NULL DEFAULT true,
    "quiet_hours_start" varchar(5) NOT NULL DEFAULT '22:00',
    "quiet_hours_end" varchar(5) NOT NULL DEFAULT '08:00',
    "quiet_hours_timezone" varchar(50) NOT NULL DEFAULT 'UTC',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "notification_channels_project_type_idx" ON "notification_channels" ("project_id", "type")`,

  `CREATE TABLE IF NOT EXISTS "safety_notifications" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
    "rule_id" uuid REFERENCES "safety_rules"("id") ON DELETE SET NULL,
    "severity" varchar(20) NOT NULL,
    "title" varchar(500) NOT NULL,
    "message" text NOT NULL,
    "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "source" varchar(200) NOT NULL,
    "timestamp" timestamp NOT NULL DEFAULT now(),
    "channel" varchar(20) NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "error" text,
    "external_id" varchar(200),
    "delivered_at" timestamp,
    "deduplication_key" varchar(200),
    "queued_for_quiet_hours" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "safety_notifications_project_timestamp_idx" ON "safety_notifications" ("project_id", "timestamp")`,
  `CREATE INDEX IF NOT EXISTS "safety_notifications_project_status_idx" ON "safety_notifications" ("project_id", "status")`,
  `CREATE INDEX IF NOT EXISTS "safety_notifications_dedup_idx" ON "safety_notifications" ("project_id", "deduplication_key")`,

  `CREATE TABLE IF NOT EXISTS "in_app_notifications" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
    "notification_id" uuid NOT NULL REFERENCES "safety_notifications"("id") ON DELETE CASCADE,
    "severity" varchar(20) NOT NULL,
    "title" varchar(500) NOT NULL,
    "message" text NOT NULL,
    "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "source" varchar(200) NOT NULL,
    "action_url" varchar(500),
    "action_label" varchar(100),
    "timestamp" timestamp NOT NULL DEFAULT now(),
    "read" boolean NOT NULL DEFAULT false,
    "dismissed" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "in_app_notifications_project_timestamp_idx" ON "in_app_notifications" ("project_id", "timestamp")`,
  `CREATE INDEX IF NOT EXISTS "in_app_notifications_project_read_idx" ON "in_app_notifications" ("project_id", "read")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "in_app_notifications_notification_id_idx" ON "in_app_notifications" ("notification_id")`,

  `CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "user_id" uuid,
    "endpoint" text NOT NULL,
    "p256dh" varchar(200) NOT NULL,
    "auth" varchar(200) NOT NULL,
    "user_agent" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_project_endpoint_idx" ON "push_subscriptions" ("project_id", "endpoint")`,
  `CREATE INDEX IF NOT EXISTS "push_subscriptions_project_user_idx" ON "push_subscriptions" ("project_id", "user_id")`,

  `CREATE TABLE IF NOT EXISTS "safety_watcher_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE UNIQUE,
    "enabled" boolean NOT NULL DEFAULT true,
    "quiet_hours_enabled" boolean NOT NULL DEFAULT true,
    "quiet_hours_start" varchar(5) NOT NULL DEFAULT '22:00',
    "quiet_hours_end" varchar(5) NOT NULL DEFAULT '08:00',
    "quiet_hours_timezone" varchar(50) NOT NULL DEFAULT 'UTC',
    "batch_enabled" boolean NOT NULL DEFAULT true,
    "batch_max_size" integer NOT NULL DEFAULT 10,
    "batch_max_wait_ms" integer NOT NULL DEFAULT 300000,
    "batch_group_by" varchar(20) NOT NULL DEFAULT 'rule',
    "local_model_enabled" boolean NOT NULL DEFAULT true,
    "local_model_provider" varchar(50) NOT NULL DEFAULT 'ollama',
    "local_model_name" varchar(100) NOT NULL DEFAULT 'llama3.2:1b',
    "fallback_api_enabled" boolean NOT NULL DEFAULT true,
    "fallback_api_provider" varchar(50) NOT NULL DEFAULT 'groq',
    "notification_retention_days" integer NOT NULL DEFAULT 30,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ── Phase 42: MFA (TOTP + Passkeys) ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "mfa_totp_secrets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "account_id" uuid NOT NULL UNIQUE REFERENCES "accounts"("id") ON DELETE CASCADE,
    "encrypted_secret" text NOT NULL,
    "confirmed_at" timestamp,
    "backup_codes" jsonb NOT NULL DEFAULT '[]',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "mfa_totp_secrets_account_idx" ON "mfa_totp_secrets" ("account_id")`,
  `CREATE TABLE IF NOT EXISTS "mfa_passkeys" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
    "credential_id" text NOT NULL UNIQUE,
    "public_key" text NOT NULL,
    "counter" integer NOT NULL DEFAULT 0,
    "transports" jsonb NOT NULL DEFAULT '[]',
    "aaguid" text,
    "name" text NOT NULL DEFAULT 'Passkey',
    "device_type" text,
    "backed_up" boolean NOT NULL DEFAULT false,
    "user_verified" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "last_used_at" timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS "mfa_passkeys_account_idx" ON "mfa_passkeys" ("account_id")`,
  `CREATE INDEX IF NOT EXISTS "mfa_passkeys_credential_idx" ON "mfa_passkeys" ("credential_id")`,
  `CREATE TABLE IF NOT EXISTS "mfa_trusted_devices" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
    "device_fingerprint" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "expires_at" timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "mfa_trusted_account_idx" ON "mfa_trusted_devices" ("account_id")`,
  `CREATE TABLE IF NOT EXISTS "mfa_pending_logins" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "token" text NOT NULL UNIQUE,
    "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
    "email" text NOT NULL,
    "challenge" text,
    "requested_methods" jsonb NOT NULL DEFAULT '[]',
    "expires_at" timestamp NOT NULL,
    "used_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "mfa_pending_token_idx" ON "mfa_pending_logins" ("token")`,
  `CREATE INDEX IF NOT EXISTS "mfa_pending_account_idx" ON "mfa_pending_logins" ("account_id")`,
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
  // llm_keys, user-api key columns (source/scopes/project_id/account_id)
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'llm-provider'`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "project_id" text`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "scopes" text[] DEFAULT '{}'`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE CASCADE`,
  // Phase 39: Enhanced LLM API Key System columns
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "model_access" text[] DEFAULT '{}'`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "rate_limit" jsonb`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "budget" jsonb`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "last_tested" timestamp`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "llm_keys" ADD COLUMN IF NOT EXISTS "failover_chain" text[] DEFAULT '{}'`,

  // projects, Phase B project management fields
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "last_opened_at" timestamp`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'general'`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS "projects_account_id_idx" ON "projects" ("account_id")`,

  // push_subscriptions (web push - first definition)
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_agent" text NOT NULL DEFAULT ''`,
  // push_subscriptions (safety watcher - add missing columns from second definition)
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid()`,
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE CASCADE`,
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_id" uuid`,
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "p256dh" varchar(200)`,
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "auth" varchar(200)`,
  `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()`,

  // notification_channels - add account_id column
  `ALTER TABLE "notification_channels" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL`,
  // safety_notifications - add account_id column
  `ALTER TABLE "safety_notifications" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL`,
  // in_app_notifications - add account_id column
  `ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL`,
  // safety_rules - add account_id column
  `ALTER TABLE "safety_rules" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL`,

  // accounts, scopes column for auth middleware
  `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb`,

  // sessions, revoked_at column for session revocation
  `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp`,
  `CREATE INDEX IF NOT EXISTS "sessions_account_revoked_idx" ON "sessions" ("account_id", "revoked_at")`,

  // sessions, mfa_verified_at column for session elevation (Phase 42)
  `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamp`,

  // gmail / spotify
  `ALTER TABLE "gmail_tokens" ADD COLUMN IF NOT EXISTS "email" text NOT NULL DEFAULT ''`,
  `ALTER TABLE "spotify_tokens" ADD COLUMN IF NOT EXISTS "display_name" text`,

  // build_checkpoints, resume-system columns (Fix 0.5 — DDL/DML contract with
  // lib/db/src/schema/build-checkpoints.ts)
  `ALTER TABLE "build_checkpoints" ADD COLUMN IF NOT EXISTS "compacted_context" jsonb`,
  `ALTER TABLE "build_checkpoints" ADD COLUMN IF NOT EXISTS "file_snapshots" jsonb`,
  `ALTER TABLE "build_checkpoints" ADD COLUMN IF NOT EXISTS "token_usage" jsonb NOT NULL DEFAULT '{}'::jsonb`,
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
