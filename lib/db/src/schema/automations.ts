import { pgTable, text, timestamp, uuid, boolean, jsonb, index, integer, pgEnum } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * Automation Trigger Types
 */
export const automationTriggerTypeEnum = pgEnum("automation_trigger_type", [
  "cron",
  "webhook",
  "manual",
  "api_call",
  "connector_event",
]);

/**
 * Automation Action Types
 */
export const automationActionTypeEnum = pgEnum("automation_action_type", [
  "connector_action",
  "notification",
  "code_execution",
  "llm_call",
  "data_transform",
  "http_request",
  "delay",
  "conditional",
  "loop",
  "parallel",
]);

/**
 * Automation Run Status
 */
export const automationRunStatusEnum = pgEnum("automation_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "partial",
]);

/**
 * Automation Log Level
 */
export const automationLogLevelEnum = pgEnum("automation_log_level", [
  "debug",
  "info",
  "warn",
  "error",
]);

/**
 * Automations — Natural language defined automations with triggers, conditions, and actions.
 * Each automation belongs to a project and can be enabled/disabled.
 */
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Human-readable name */
    name: text("name").notNull(),
    /** Description of what this automation does */
    description: text("description"),
    /** Whether the automation is active */
    enabled: boolean("enabled").notNull().default(true),
    /** Trigger configuration (cron, webhook, connector_event, manual, api_call) */
    trigger: jsonb("trigger").notNull(),
    /** Array of conditions to evaluate before executing actions */
    conditions: jsonb("conditions").notNull().default([]),
    /** Array of actions to execute (with chaining, branching, loops, parallel) */
    actions: jsonb("actions").notNull(),
    /** Settings: maxConcurrentRuns, timeoutMs, retry config, logLevel, idempotencyKey, tags */
    settings: jsonb("settings").notNull().default({}),
    /** Version for optimistic locking / updates */
    version: integer("version").notNull().default(1),
    /** User who created this automation */
    createdBy: uuid("created_by").references(() => projects.id, { onDelete: "set null" }),
    /** Idempotency key template for deduplication */
    idempotencyKeyTemplate: text("idempotency_key_template"),
    /** Tags for organization/filtering */
    tags: text("tags").array().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("automations_project_idx").on(table.projectId),
    index("automations_enabled_idx").on(table.enabled),
    index("automations_trigger_idx").on(table.trigger),
    index("automations_created_idx").on(table.createdAt),
  ],
);

export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;

/**
 * Automation Runs — Each execution of an automation.
 * Tracks status, input/output, timing, and error information.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Trigger that started this run */
    triggerType: automationTriggerTypeEnum("trigger_type").notNull(),
    /** Input payload that triggered this run */
    triggerPayload: jsonb("trigger_payload"),
    /** Unique idempotency key for deduplication */
    idempotencyKey: text("idempotency_key").unique(),
    /** Current status of the run */
    status: automationRunStatusEnum("status").notNull().default("pending"),
    /** Error message if failed */
    error: text("error"),
    /** Final output/result of the automation */
    output: jsonb("output"),
    /** Execution timing */
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
    /** Retry count if retried */
    retryCount: integer("retry_count").default(0),
    /** Parent run ID if this is a retry */
    parentRunId: uuid("parent_run_id").references(() => automationRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("automation_runs_automation_idx").on(table.automationId),
    index("automation_runs_project_idx").on(table.projectId),
    index("automation_runs_status_idx").on(table.status),
    index("automation_runs_idempotency_idx").on(table.idempotencyKey),
    index("automation_runs_started_idx").on(table.startedAt),
    index("automation_runs_parent_idx").on(table.parentRunId),
  ],
);

export type AutomationRun = typeof automationRuns.$inferSelect;
export type NewAutomationRun = typeof automationRuns.$inferInsert;

/**
 * Automation Logs — Detailed action-by-action execution logs for each run.
 * Enables debugging, auditing, and observability.
 */
export const automationLogs = pgTable(
  "automation_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Action ID from the automation spec */
    actionId: text("action_id").notNull(),
    /** Type of action executed */
    actionType: automationActionTypeEnum("action_type").notNull(),
    /** Action name from spec */
    actionName: text("action_name"),
    /** Log level */
    level: automationLogLevelEnum("level").notNull().default("info"),
    /** Log message */
    message: text("message").notNull(),
    /** Input data to this action */
    input: jsonb("input"),
    /** Output data from this action */
    output: jsonb("output"),
    /** Error if action failed */
    error: text("error"),
    /** Duration in milliseconds */
    durationMs: integer("duration_ms"),
    /** Retry attempt number (0 = first attempt) */
    attempt: integer("attempt").default(0),
    /** Parent action ID for nested actions (conditional branches, loops, parallel) */
    parentActionId: text("parent_action_id"),
    /** Execution order within the run */
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("automation_logs_run_idx").on(table.runId),
    index("automation_logs_automation_idx").on(table.automationId),
    index("automation_logs_action_idx").on(table.actionId),
    index("automation_logs_level_idx").on(table.level),
    index("automation_logs_sequence_idx").on(table.sequence),
  ],
);

export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = typeof automationLogs.$inferInsert;

/**
 * Automation Schedules — For cron-triggered automations, tracks next run times.
 * Helps with scheduling and distributed execution.
 */
export const automationSchedules = pgTable(
  "automation_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .unique()
      .references(() => automations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Cron expression */
    cronExpression: text("cron_expression").notNull(),
    /** Timezone for the cron */
    timezone: text("timezone").notNull().default("UTC"),
    /** Next scheduled run time */
    nextRunAt: timestamp("next_run_at").notNull(),
    /** Last run time */
    lastRunAt: timestamp("last_run_at"),
    /** Whether scheduling is active */
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("automation_schedules_next_run_idx").on(table.nextRunAt),
    index("automation_schedules_active_idx").on(table.active),
  ],
);

export type AutomationSchedule = typeof automationSchedules.$inferSelect;
export type NewAutomationSchedule = typeof automationSchedules.$inferInsert;

/**
 * Automation Webhooks — For webhook-triggered automations, stores webhook configuration.
 * Allows multiple automations to share webhook paths with different secrets/filters.
 */
export const automationWebhooks = pgTable(
  "automation_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Webhook path (e.g., "/webhook/github") */
    path: text("path").notNull(),
    /** Secret for signature verification */
    secret: text("secret"),
    /** Optional filter expression for payload */
    filter: text("filter"),
    /** Whether webhook is active */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("automation_webhooks_path_idx").on(table.path),
    index("automation_webhooks_automation_idx").on(table.automationId),
    index("automation_webhooks_active_idx").on(table.active),
  ],
);

export type AutomationWebhook = typeof automationWebhooks.$inferSelect;
export type NewAutomationWebhook = typeof automationWebhooks.$inferInsert;