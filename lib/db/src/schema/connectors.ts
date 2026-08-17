import { pgTable, text, timestamp, uuid, boolean, jsonb, index, integer } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * Messaging Connectors — per-project Slack, Discord, Telegram integrations.
 * Each project can have multiple connectors (one per platform).
 * Webhook URLs and tokens are stored encrypted (application-level encryption).
 */
export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Platform: slack | discord | telegram */
    platform: text("platform", { enum: ["slack", "discord", "telegram"] })
      .notNull(),
    /** Human-readable name, e.g. "Team Slack #build-notifications" */
    name: text("name").notNull(),
    /** Platform-specific configuration (webhook URL, bot token, channel ID, etc.) */
    config: jsonb("config").notNull().default({}),
    /** Whether this connector is active and should receive notifications */
    enabled: boolean("enabled").notNull().default(true),
    /** Which event types to notify about */
    notifyOn: jsonb("notify_on")
      .notNull()
      .default(["build_completed", "build_failed", "research_completed", "scheduled_job_failed"]),
    /** OAuth/installation metadata (for Slack/Discord app installs) */
    installation: jsonb("installation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("connectors_project_idx").on(table.projectId),
    index("connectors_platform_idx").on(table.platform),
    index("connectors_enabled_idx").on(table.enabled),
  ],
);

export type Connector = typeof connectors.$inferSelect;
export type NewConnector = typeof connectors.$inferInsert;

/**
 * Connector Notifications Log — audit trail of sent notifications.
 * Useful for debugging delivery issues and rate limiting.
 */
export const connectorNotifications = pgTable(
  "connector_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Event type that triggered this notification */
    eventType: text("event_type").notNull(),
    /** HTTP status code from webhook/API call */
    statusCode: integer("status_code"),
    /** Error message if failed */
    error: text("error"),
    /** Payload sent (truncated for storage) */
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("connector_notifications_connector_idx").on(table.connectorId),
    index("connector_notifications_project_idx").on(table.projectId),
    index("connector_notifications_created_idx").on(table.createdAt),
  ],
);

export type ConnectorNotification = typeof connectorNotifications.$inferSelect;
export type NewConnectorNotification = typeof connectorNotifications.$inferInsert;