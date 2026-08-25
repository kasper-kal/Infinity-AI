import { pgTable, text, timestamp, uuid, jsonb, varchar, integer, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * PHASE 10 — Mobile App Projects
 *
 * Extends the build_apps system for mobile-specific metadata:
 * - Platform targets (iOS, Android, both)
 * - Design kit bindings (iOS 27 Liquid Glass, Material 3)
 * - Expo/EAS configuration
 * - Store submission tracking
 * - Preview session management
 */

/** Mobile project — extends build_apps with mobile-specific metadata */
export const mobileApps = pgTable("mobile_apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildAppId: uuid("build_app_id").notNull().references(() => buildApps.id, { onDelete: "cascade" }),

  // Platform targets
  platform: varchar("platform", { length: 10 }).notNull().default("both"), // "ios" | "android" | "both"

  // Design kit binding
  designKit: varchar("design_kit", { length: 20 }).notNull().default("ios-27"), // "ios-27" | "material-3" | "custom"
  customFigmaUrl: text("custom_figma_url"),

  // Expo/EAS configuration
  expoProjectId: text("expo_project_id"),
  bundleIdentifier: text("bundle_identifier").notNull(), // com.example.app
  packageName: text("package_name").notNull(),           // com.example.app
  appName: text("app_name").notNull(),
  version: text("version").notNull().default("1.0.0"),
  buildNumber: integer("build_number").notNull().default(1),

  // Capabilities / native features
  capabilities: jsonb("capabilities").notNull().default(sql`'{}'::jsonb`), // camera, location, push, biometrics, etc.

  // NativeWind / styling
  nativeWindConfig: jsonb("native_wind_config").notNull().default(sql`'{}'::jsonb`),

  // Template used for scaffolding
  template: varchar("template", { length: 30 }).notNull().default("blank"), // blank, tabs, stack, drawer, auth, social, ecommerce, content, dashboard

  // Status
  status: varchar("status", { length: 20 }).notNull().default("scaffolded"), // scaffolded | building | previewing | submitting | live

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  buildAppIdx: index("mobile_apps_build_app_idx").on(table.buildAppId),
  platformIdx: index("mobile_apps_platform_idx").on(table.platform),
}));

export type MobileApp = typeof mobileApps.$inferSelect;
export type NewMobileApp = typeof mobileApps.$inferInsert;

/** Expo preview session tracking */
export const mobilePreviewSessions = pgTable("mobile_preview_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  mobileAppId: uuid("mobile_app_id").notNull().references(() => mobileApps.id, { onDelete: "cascade" }),

  // Session state
  status: varchar("status", { length: 20 }).notNull().default("starting"), // starting | running | stopped | error
  metroPort: integer("metro_port").notNull(),
  expoPort: integer("expo_port").notNull(),

  // QR code data
  qrCodeData: text("qr_code_data"),
  qrCodeImage: text("qr_code_image"), // base64 PNG

  // Device tracking
  deviceConnections: integer("device_connections").notNull().default(0),

  // Logs (capped at 500 entries in memory, persisted on stop)
  logs: jsonb("logs").notNull().default(sql`'[]'::jsonb`),

  // Error info
  error: text("error"),

  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  mobileAppIdx: index("mobile_preview_sessions_app_idx").on(table.mobileAppId),
  statusIdx: index("mobile_preview_sessions_status_idx").on(table.status),
}));

export type MobilePreviewSession = typeof mobilePreviewSessions.$inferSelect;
export type NewMobilePreviewSession = typeof mobilePreviewSessions.$inferInsert;

/** Store submission job tracking */
export const mobileStoreSubmissions = pgTable("mobile_store_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  mobileAppId: uuid("mobile_app_id").notNull().references(() => mobileApps.id, { onDelete: "cascade" }),

  // Platform & stage
  platform: varchar("platform", { length: 10 }).notNull(), // "ios" | "android" | "both"
  stage: varchar("stage", { length: 20 }).notNull().default("prepare"), // prepare | credentials | build | upload | review | release | complete
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | running | completed | failed | cancelled
  progress: integer("progress").notNull().default(0), // 0-100

  // Build profile
  buildProfile: varchar("build_profile", { length: 20 }).notNull().default("production"), // development | preview | production

  // Credentials (encrypted in production, plain here for dev)
  credentials: jsonb("credentials").notNull().default(sql`'{}'::jsonb`),

  // EAS config
  easConfig: jsonb("eas_config").notNull().default(sql`'{}'::jsonb`),

  // Build URLs
  buildUrls: jsonb("build_urls").notNull().default(sql`'{}'::jsonb`), // { ios?: string, android?: string }

  // Logs
  logs: jsonb("logs").notNull().default(sql`'[]'::jsonb`),

  // Error
  error: text("error"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  mobileAppIdx: index("mobile_store_submissions_app_idx").on(table.mobileAppId),
  statusIdx: index("mobile_store_submissions_status_idx").on(table.status),
  stageIdx: index("mobile_store_submissions_stage_idx").on(table.stage),
}));

export type MobileStoreSubmission = typeof mobileStoreSubmissions.$inferSelect;
export type NewMobileStoreSubmission = typeof mobileStoreSubmissions.$inferInsert;

/** Design token sync log — tracks when kits were refreshed */
export const designKitSyncLog = pgTable("design_kit_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),

  kit: varchar("kit", { length: 20 }).notNull(), // "ios-27" | "material-3"
  versionId: text("version_id"),
  versionLabel: text("version_label"),
  publishedAt: timestamp("published_at"),

  // Sync result
  success: boolean("success").notNull(),
  error: text("error"),
  tokensExtracted: boolean("tokens_extracted").notNull().default(false),

  syncedAt: timestamp("synced_at").notNull().defaultNow(),
}, (table) => ({
  kitIdx: index("design_kit_sync_log_kit_idx").on(table.kit),
  syncedAtIdx: index("design_kit_sync_log_synced_idx").on(table.syncedAt),
}));

export type DesignKitSyncLog = typeof designKitSyncLog.$inferSelect;
export type NewDesignKitSyncLog = typeof designKitSyncLog.$inferInsert;

/** Mobile app generated components — tracks which official components were generated */
export const mobileAppComponents = pgTable("mobile_app_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  mobileAppId: uuid("mobile_app_id").notNull().references(() => mobileApps.id, { onDelete: "cascade" }),

  platform: varchar("platform", { length: 10 }).notNull(), // "ios" | "android"
  componentType: text("component_type").notNull(), // e.g., "glass-button", "m3-card"
  componentCode: text("component_code").notNull(),

  // Kit version this was generated from
  kitVersionId: text("kit_version_id"),
  kitVersionLabel: text("kit_version_label"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  mobileAppIdx: index("mobile_app_components_app_idx").on(table.mobileAppId),
  platformIdx: index("mobile_app_components_platform_idx").on(table.platform),
  componentTypeIdx: index("mobile_app_components_type_idx").on(table.componentType),
}));

export type MobileAppComponent = typeof mobileAppComponents.$inferSelect;
export type NewMobileAppComponent = typeof mobileAppComponents.$inferInsert;

/** Re-export buildApps for foreign key references */
import { buildApps } from "./build-apps.js";