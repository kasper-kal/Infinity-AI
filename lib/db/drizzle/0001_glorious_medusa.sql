CREATE TABLE "research_jobs_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"phase" text DEFAULT 'planning' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"sources_found" integer DEFAULT 0 NOT NULL,
	"pages_read" integer DEFAULT 0 NOT NULL,
	"current_query" text,
	"log" text[] DEFAULT '{}' NOT NULL,
	"report" jsonb,
	"iterations" integer DEFAULT 0 NOT NULL,
	"max_iterations" integer DEFAULT 3 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "research_sources_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"snippet" text,
	"content" text,
	"source_type" text NOT NULL,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"read_at" timestamp,
	"extraction" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_sources_v2_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "task_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"conversation_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"objective" text,
	"initial_config" jsonb DEFAULT '{}'::jsonb,
	"current_step" integer DEFAULT 0,
	"total_steps" integer DEFAULT 0,
	"completed_steps" jsonb DEFAULT '[]'::jsonb,
	"working_context" jsonb DEFAULT '{}'::jsonb,
	"tool_call_history" jsonb DEFAULT '[]'::jsonb,
	"pending_approvals" jsonb DEFAULT '[]'::jsonb,
	"last_checkpoint" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text,
	CONSTRAINT "task_states_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
ALTER TABLE "research_sources_v2" ADD CONSTRAINT "research_sources_v2_job_id_research_jobs_v2_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_jobs_v2_status_idx" ON "research_jobs_v2" USING btree ("status");--> statement-breakpoint
CREATE INDEX "research_jobs_v2_created_at_idx" ON "research_jobs_v2" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "research_sources_v2_job_id_idx" ON "research_sources_v2" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "research_sources_v2_source_id_idx" ON "research_sources_v2" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "research_sources_v2_url_idx" ON "research_sources_v2" USING btree ("url");--> statement-breakpoint
CREATE INDEX "task_states_task_id_idx" ON "task_states" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_states_user_id_idx" ON "task_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_states_project_id_idx" ON "task_states" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_states_status_idx" ON "task_states" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_states_updated_idx" ON "task_states" USING btree ("updated_at");