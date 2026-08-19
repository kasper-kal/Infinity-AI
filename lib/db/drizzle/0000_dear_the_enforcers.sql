CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'New Conversation' NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"system_prompt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"reasoning" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_memories" (
	"topic" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category" text DEFAULT 'about' NOT NULL,
	"content" text NOT NULL,
	"key" text NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_at" timestamp,
	"conversation_id" uuid,
	"file_id" uuid,
	"memory_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"research_job_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_research_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"research_job_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"description" text,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"objective" text,
	"result_summary" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_tokens" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"email" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spotify_tokens" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"display_name" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"mode" text DEFAULT 'agent' NOT NULL,
	"depth" text DEFAULT 'deep' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"phase" text DEFAULT 'Queued…' NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"report" text DEFAULT '' NOT NULL,
	"gem_system_prompt" text DEFAULT '' NOT NULL,
	"gem_conversation_id" uuid,
	"phases_completed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"model" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'healthy' NOT NULL,
	"cool_down_until" timestamp,
	"uses" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"source" text DEFAULT 'llm-provider' NOT NULL,
	"project_id" text,
	"scopes" text[]
);
--> statement-breakpoint
CREATE TABLE "app_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"duration_seconds" integer NOT NULL,
	"fire_at" timestamp,
	"remaining_seconds" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"label" text,
	"conversation_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pins_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE "project_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#0ea5e9' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_opened_at" timestamp,
	"instructions" text,
	"type" text DEFAULT 'general' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "group_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'ai' NOT NULL,
	"ai_toggle" text DEFAULT 'always' NOT NULL,
	"owner_token_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"account_id" uuid,
	"persona" text,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"used_at" timestamp,
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "build_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"file_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referencing_project_id" uuid NOT NULL,
	"referenced_project_id" uuid NOT NULL,
	"access_level" varchar(10) DEFAULT 'view' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"source_project_id" uuid NOT NULL,
	"target_project_id" uuid NOT NULL,
	"access_level" varchar(10) DEFAULT 'view' NOT NULL,
	"shared_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"iteration" integer DEFAULT 1 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"working_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_snapshots" jsonb,
	"token_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"max_tokens_per_build" integer DEFAULT 0 NOT NULL,
	"max_tokens_per_day" integer DEFAULT 0 NOT NULL,
	"max_cost_per_build_cents" integer DEFAULT 0 NOT NULL,
	"max_cost_per_day_cents" integer DEFAULT 0 NOT NULL,
	"max_builds_per_day" integer DEFAULT 0 NOT NULL,
	"max_duration_minutes_per_build" integer DEFAULT 0 NOT NULL,
	"alert_at_percent" integer DEFAULT 80 NOT NULL,
	"daily_reset_hour" integer DEFAULT 0 NOT NULL,
	"hard_stop" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "build_budgets_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "build_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"checkpoint_id" uuid,
	"iteration" integer DEFAULT 1 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"limit_hit" text DEFAULT 'none' NOT NULL,
	"model" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_daily_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"builds_count" integer DEFAULT 0 NOT NULL,
	"total_duration_ms" integer DEFAULT 0 NOT NULL,
	"alert_sent" boolean DEFAULT false NOT NULL,
	"alert_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "build_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"cron" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"last_run_result" jsonb,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"notify_on_completion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"status_code" integer,
	"error" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_on" jsonb DEFAULT '["build_completed","build_failed","research_completed","scheduled_job_failed"]'::jsonb NOT NULL,
	"installation" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'Untitled book' NOT NULL,
	"idea" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"page_count" integer DEFAULT 120 NOT NULL,
	"words_per_page" integer DEFAULT 250 NOT NULL,
	"chunk_size" integer DEFAULT 10 NOT NULL,
	"critique_passes" integer DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"phase" text DEFAULT 'Queued…' NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"plan" text DEFAULT '{}' NOT NULL,
	"manuscript" text DEFAULT '' NOT NULL,
	"samples" text DEFAULT '[]' NOT NULL,
	"api_key" text,
	"base_url" text,
	"model" text,
	"pdf_file" text,
	"error" text,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memories" ADD CONSTRAINT "project_memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_instructions" ADD CONSTRAINT "project_instructions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_memory_id_project_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."project_memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_research" ADD CONSTRAINT "project_research_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_research_findings" ADD CONSTRAINT "project_research_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_actions" ADD CONSTRAINT "project_agent_actions_run_id_project_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."project_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_actions" ADD CONSTRAINT "project_agent_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_runs" ADD CONSTRAINT "project_agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_group_chats_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_group_id_group_chats_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_schedule_runs" ADD CONSTRAINT "build_schedule_runs_schedule_id_build_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."build_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_schedule_runs" ADD CONSTRAINT "build_schedule_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_schedules" ADD CONSTRAINT "build_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_notifications" ADD CONSTRAINT "connector_notifications_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_notifications" ADD CONSTRAINT "connector_notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_memories_project_key_idx" ON "project_memories" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "project_memories_project_idx" ON "project_memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_memories_project_pinned_idx" ON "project_memories" USING btree ("project_id","pinned");--> statement-breakpoint
CREATE INDEX "project_tasks_project_idx" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_status_idx" ON "project_tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_tasks_project_sort_idx" ON "project_tasks" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_activity_project_idx" ON "project_activity" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_activity_project_created_idx" ON "project_activity" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_research_project_idx" ON "project_research" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_research_job_idx" ON "project_research" USING btree ("research_job_id");--> statement-breakpoint
CREATE INDEX "project_research_findings_project_idx" ON "project_research_findings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_research_findings_job_idx" ON "project_research_findings" USING btree ("research_job_id");--> statement-breakpoint
CREATE INDEX "project_agent_actions_run_idx" ON "project_agent_actions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "project_agent_actions_project_idx" ON "project_agent_actions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_agent_runs_project_idx" ON "project_agent_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_agent_runs_project_status_idx" ON "project_agent_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "build_budgets_project_idx" ON "build_budgets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "build_costs_project_idx" ON "build_costs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "build_costs_checkpoint_idx" ON "build_costs" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE INDEX "build_costs_created_idx" ON "build_costs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "build_daily_aggregates_project_date_idx" ON "build_daily_aggregates" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "build_schedule_runs_schedule_idx" ON "build_schedule_runs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "build_schedule_runs_project_idx" ON "build_schedule_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "build_schedule_runs_started_idx" ON "build_schedule_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "build_schedules_project_idx" ON "build_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "build_schedules_status_idx" ON "build_schedules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "build_schedules_next_run_idx" ON "build_schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "connector_notifications_connector_idx" ON "connector_notifications" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "connector_notifications_project_idx" ON "connector_notifications" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "connector_notifications_created_idx" ON "connector_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "connectors_project_idx" ON "connectors" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "connectors_platform_idx" ON "connectors" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "connectors_enabled_idx" ON "connectors" USING btree ("enabled");