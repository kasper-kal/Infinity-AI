/**
 * Safety Watcher Database Schema
 *
 * Tables for safety rules, notifications, channels, and push subscriptions.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const safetySeverityEnum = pgEnum("safety_severity", [
  "info",
  "warning",
  "critical",
  "emergency",
]);

export const safetyActionEnum = pgEnum("safety_action", [
  "notify",
  "pause_agent",
  "rollback",
  "request_human",
  "throttle",
]);

export const notificationChannelTypeEnum = pgEnum("notification_channel_type", [
  "webpush",
  "email",
  "slack",
  "discord",
  "webhook",
  "inapp",
]);

// Safety Rules - configurable detection rules
export const safetyRules = pgTable(
  "safety_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ruleId: varchar("rule_id", { length: 100 }).notNull(), // e.g., "runaway_loop", "token_burn"
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    enabled: boolean("enabled").default(true).notNull(),
    severity: safetySeverityEnum("severity").default("warning").notNull(),
    action: safetyActionEnum("action").default("notify").notNull(),
    // Rule-specific configuration (thresholds, cooldowns, etc.)
    config: jsonb("config").default({}).notNull(),
    // Cooldown in milliseconds
    cooldownMs: integer("cooldown_ms").default(300000).notNull(), // 5 minutes default
    // Tags for filtering/grouping
    tags: text("tags").array().default([]).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectRuleIdx: uniqueIndex("safety_rules_project_rule_idx").on(
      table.projectId,
      table.ruleId
    ),
    projectEnabledIdx: index("safety_rules_project_enabled_idx").on(
      table.projectId,
      table.enabled
    ),
  })
);

// Notification Channels - configured delivery channels per project
export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: notificationChannelTypeEnum("type").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    // Channel-specific configuration (webhook URLs, API keys, etc.)
    config: jsonb("config").default({}).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    // Which severities this channel should receive
    severityFilter: safetySeverityEnum("severity_filter")
      .array()
      .default(["warning", "critical", "emergency"])
      .notNull(),
    // Quiet hours configuration
    quietHoursEnabled: boolean("quiet_hours_enabled").default(true).notNull(),
    quietHoursStart: varchar("quiet_hours_start", { length: 5 }).default("22:00").notNull(), // HH:MM
    quietHoursEnd: varchar("quiet_hours_end", { length: 5 }).default("08:00").notNull(), // HH:MM
    quietHoursTimezone: varchar("quiet_hours_timezone", { length: 50 }).default("UTC").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectTypeIdx: index("notification_channels_project_type_idx").on(
      table.projectId,
      table.type
    ),
  })
);

// Safety Notifications - history of all dispatched notifications
export const safetyNotifications = pgTable(
  "safety_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => safetyRules.id, {
      onDelete: "set null",
    }),
    severity: safetySeverityEnum("severity").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    message: text("message").notNull(),
    details: jsonb("details").default({}).notNull(),
    source: varchar("source", { length: 200 }).notNull(), // e.g., "agent-loop", "build", "deployment"
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    // Delivery tracking
    channel: notificationChannelTypeEnum("channel").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, delivered, failed, queued
    error: text("error"),
    externalId: varchar("external_id", { length: 200 }), // provider message ID
    deliveredAt: timestamp("delivered_at"),
    // Deduplication
    deduplicationKey: varchar("deduplication_key", { length: 200 }),
    // Quiet hours queuing
    queuedForQuietHours: boolean("queued_for_quiet_hours").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    projectTimestampIdx: index("safety_notifications_project_timestamp_idx").on(
      table.projectId,
      table.timestamp
    ),
    projectStatusIdx: index("safety_notifications_project_status_idx").on(
      table.projectId,
      table.status
    ),
    dedupIdx: index("safety_notifications_dedup_idx").on(
      table.projectId,
      table.deduplicationKey
    ),
  })
);

// In-App Notifications - persistent notifications for the UI
export const inAppNotifications = pgTable(
  "in_app_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => safetyNotifications.id, { onDelete: "cascade" }),
    severity: safetySeverityEnum("severity").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    message: text("message").notNull(),
    details: jsonb("details").default({}).notNull(),
    source: varchar("source", { length: 200 }).notNull(),
    actionUrl: varchar("action_url", { length: 500 }),
    actionLabel: varchar("action_label", { length: 100 }),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    read: boolean("read").default(false).notNull(),
    dismissed: boolean("dismissed").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    projectTimestampIdx: index("in_app_notifications_project_timestamp_idx").on(
      table.projectId,
      table.timestamp
    ),
    projectReadIdx: index("in_app_notifications_project_read_idx").on(
      table.projectId,
      table.read
    ),
    notificationIdIdx: uniqueIndex("in_app_notifications_notification_id_idx").on(
      table.notificationId
    ),
  })
);

// Push Subscriptions - Web Push API subscriptions
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id"), // optional, for user-specific subscriptions
    endpoint: text("endpoint").notNull(),
    p256dh: varchar("p256dh", { length: 200 }).notNull(),
    auth: varchar("auth", { length: 200 }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectEndpointIdx: uniqueIndex("push_subscriptions_project_endpoint_idx").on(
      table.projectId,
      table.endpoint
    ),
    projectUserIdx: index("push_subscriptions_project_user_idx").on(
      table.projectId,
      table.userId
    ),
  })
);

// Safety Watcher Settings - global settings per project
export const safetyWatcherSettings = pgTable(
  "safety_watcher_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" })
      .unique(),
    enabled: boolean("enabled").default(true).notNull(),
    // Global quiet hours
    quietHoursEnabled: boolean("quiet_hours_enabled").default(true).notNull(),
    quietHoursStart: varchar("quiet_hours_start", { length: 5 }).default("22:00").notNull(),
    quietHoursEnd: varchar("quiet_hours_end", { length: 5 }).default("08:00").notNull(),
    quietHoursTimezone: varchar("quiet_hours_timezone", { length: 50 }).default("UTC").notNull(),
    // Batching configuration
    batchEnabled: boolean("batch_enabled").default(true).notNull(),
    batchMaxSize: integer("batch_max_size").default(10).notNull(),
    batchMaxWaitMs: integer("batch_max_wait_ms").default(300000).notNull(), // 5 minutes
    batchGroupBy: varchar("batch_group_by", { length: 20 }).default("rule").notNull(), // rule, severity, source
    // Local model configuration
    localModelEnabled: boolean("local_model_enabled").default(true).notNull(),
    localModelProvider: varchar("local_model_provider", { length: 50 }).default("ollama").notNull(), // ollama, transformers, auto
    localModelName: varchar("local_model_name", { length: 100 }).default("llama3.2:1b").notNull(),
    // Fallback API configuration
    fallbackApiEnabled: boolean("fallback_api_enabled").default(true).notNull(),
    fallbackApiProvider: varchar("fallback_api_provider", { length: 50 }).default("groq").notNull(),
    // Retention
    notificationRetentionDays: integer("notification_retention_days").default(30).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
);

// Type exports for TypeScript
export type SafetyRule = typeof safetyRules.$inferSelect;
export type NewSafetyRule = typeof safetyRules.$inferInsert;

export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;

export type SafetyNotification = typeof safetyNotifications.$inferSelect;
export type NewSafetyNotification = typeof safetyNotifications.$inferInsert;

export type InAppNotification = typeof inAppNotifications.$inferSelect;
export type NewInAppNotification = typeof inAppNotifications.$inferInsert;

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

export type SafetyWatcherSetting = typeof safetyWatcherSettings.$inferSelect;
export type NewSafetyWatcherSetting = typeof safetyWatcherSettings.$inferInsert;