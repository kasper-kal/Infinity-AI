import { pgTable, text, timestamp, uuid, jsonb, boolean, integer, varchar, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./projects.js";
import { accounts } from "./accounts.js";

/**
 * UI Settings - AI Self-Management
 *
 * User-facing settings with support for:
 * - Global defaults
 * - Per-user overrides
 * - Per-project overrides
 * - AI-proposed changes with confirmation workflow
 * - Full audit trail
 *
 * Setting keys defined in settings-manager.ts SETTING_DEFINITIONS:
 * - accentColor, theme, profilePicture, density, language
 * - notifications, autoCompact, fontSize, sidebarWidth, animationEnabled
 */
export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Setting key (matches SETTING_DEFINITIONS)
  key: varchar("key", { length: 50 }).notNull(),

  // Setting value (JSON for flexibility - strings, numbers, booleans, objects)
  value: jsonb("value").notNull(),

  // Scoping
  userId: uuid("user_id").references(() => accounts.id, { onDelete: "cascade" }), // null = global default
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }), // null = global/user-level

  // Who last updated
  updatedBy: varchar("updated_by", { enum: ["user", "ai", "system"] }).notNull().default("user"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("settings_user_idx").on(table.userId),
  projectIdx: index("settings_project_idx").on(table.projectId),
  keyIdx: index("settings_key_idx").on(table.key),
  userProjectKeyIdx: index("settings_user_project_key_idx").on(table.userId, table.projectId, table.key),
}));

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

/**
 * Setting Change Audit Log
 *
 * Records all setting and secret operations for accountability.
 * Used for:
 * - AI-proposed change confirmation workflow
 * - Security audit trail
 * - Debugging configuration changes
 * - Compliance
 */
export const settingChanges = pgTable("setting_changes", {
  id: uuid("id").primaryKey().defaultRandom(),

  // What was changed
  keyId: varchar("key_id", { length: 100 }).notNull(), // Setting key or Secret ID

  // Operation type
  operation: varchar("operation", {
    enum: ["create", "read", "update", "delete", "rotate", "health-check", "propose", "confirm", "reject"]
  }).notNull(),

  // Who performed the operation
  performedBy: varchar("performed_by", { enum: ["user", "ai", "system"] }).notNull(),
  performedById: uuid("performed_by_id").references(() => accounts.id, { onDelete: "set null" }), // User ID or AI agent ID

  // Details (flexible JSON)
  details: jsonb("details").notNull().default({}),

  // Previous and new values (for comparison)
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),

  // Request metadata
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),

  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ({
  keyIdIdx: index("setting_changes_key_id_idx").on(table.keyId),
  performedByIdx: index("setting_changes_performed_by_idx").on(table.performedBy),
  operationIdx: index("setting_changes_operation_idx").on(table.operation),
  timestampIdx: index("setting_changes_timestamp_idx").on(table.timestamp),
  performedByIdIdx: index("setting_changes_performed_by_id_idx").on(table.performedById),
}));

export type SettingChange = typeof settingChanges.$inferSelect;
export type NewSettingChange = typeof settingChanges.$inferInsert;