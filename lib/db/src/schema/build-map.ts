/**
 * Build Map Database Schema
 * Stores the visual roadmap graph: nodes, edges, and versions
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  primaryKey,
  foreignKey,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Node type enum
 */
export const buildMapNodeTypeEnum = pgEnum("build_map_node_type", [
  "feature",
  "component",
  "page",
  "api",
  "integration",
  "test",
  "doc",
  "database",
  "model",
  "config",
  "deployment",
]);

/**
 * Node status enum
 */
export const buildMapNodeStatusEnum = pgEnum("build_map_node_status", [
  "planned",
  "in_progress",
  "review",
  "done",
  "blocked",
  "archived",
]);

/**
 * Edge type enum
 */
export const buildMapEdgeTypeEnum = pgEnum("build_map_edge_type", [
  "depends_on",
  "data_flow",
  "user_flow",
  "parent_child",
  "related_to",
  "blocks",
]);

/**
 * Assignee enum
 */
export const buildMapAssigneeEnum = pgEnum("build_map_assignee", [
  "human",
  "agent",
  "unassigned",
]);

/**
 * Layout algorithm enum
 */
export const buildMapLayoutAlgorithmEnum = pgEnum("build_map_layout_algorithm", [
  "hierarchical",
  "force_directed",
  "circular",
  "manual",
]);

/**
 * Build Map Nodes Table
 */
export const buildMapNodes = pgTable(
  "build_map_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    type: buildMapNodeTypeEnum("type").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: buildMapNodeStatusEnum("status").notNull().default("planned"),
    priority: integer("priority").notNull().default(5),
    assignee: buildMapAssigneeEnum("assignee").notNull().default("unassigned"),
    files: jsonb("files").$type<string[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    estimate: integer("estimate"),
    actualTime: integer("actual_time"),
    dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
    dependents: jsonb("dependents").$type<string[]>().notNull().default([]),
    positionX: integer("position_x"),
    positionY: integer("position_y"),
    metadata: jsonb("metadata").notNull().default({}),
    createdBy: varchar("created_by", { length: 100 }).notNull().default("agent"),
    updatedBy: varchar("updated_by", { length: 100 }).notNull().default("agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdIdx: index("build_map_nodes_project_id_idx").on(table.projectId),
    typeIdx: index("build_map_nodes_type_idx").on(table.type),
    statusIdx: index("build_map_nodes_status_idx").on(table.status),
    assigneeIdx: index("build_map_nodes_assignee_idx").on(table.assignee),
    projectTypeIdx: index("build_map_nodes_project_type_idx").on(table.projectId, table.type),
    projectStatusIdx: index("build_map_nodes_project_status_idx").on(table.projectId, table.status),
  })
);

/**
 * Build Map Edges Table
 */
export const buildMapEdges = pgTable(
  "build_map_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
    type: buildMapEdgeTypeEnum("type").notNull(),
    label: varchar("label", { length: 200 }),
    description: text("description"),
    metadata: jsonb("metadata").notNull().default({}),
    createdBy: varchar("created_by", { length: 100 }).notNull().default("agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdIdx: index("build_map_edges_project_id_idx").on(table.projectId),
    sourceIdIdx: index("build_map_edges_source_id_idx").on(table.sourceId),
    targetIdIdx: index("build_map_edges_target_id_idx").on(table.targetId),
    projectSourceIdx: index("build_map_edges_project_source_idx").on(table.projectId, table.sourceId),
    projectTargetIdx: index("build_map_edges_project_target_idx").on(table.projectId, table.targetId),
    sourceTargetIdx: index("build_map_edges_source_target_idx").on(table.sourceId, table.targetId),
    fkSource: foreignKey({
      columns: [table.sourceId],
      foreignColumns: [buildMapNodes.id],
      name: "build_map_edges_source_id_fk",
    }).onDelete("cascade"),
    fkTarget: foreignKey({
      columns: [table.targetId],
      foreignColumns: [buildMapNodes.id],
      name: "build_map_edges_target_id_fk",
    }).onDelete("cascade"),
  })
);

/**
 * Build Map Versions Table (for versioning/history)
 */
export const buildMapVersions = pgTable(
  "build_map_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    version: integer("version").notNull(),
    graphSnapshot: jsonb("graph_snapshot").notNull(), // Full graph JSON
    changedBy: varchar("changed_by", { length: 100 }).notNull(),
    changeSummary: text("change_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdIdx: index("build_map_versions_project_id_idx").on(table.projectId),
    versionIdx: index("build_map_versions_version_idx").on(table.version),
    projectVersionIdx: index("build_map_versions_project_version_idx").on(table.projectId, table.version),
    pk: primaryKey({ columns: [table.projectId, table.version] }),
  })
);

/**
 * Build Map Metadata Table (per-project settings)
 */
export const buildMapMetadata = pgTable(
  "build_map_metadata",
  {
    projectId: uuid("project_id").primaryKey(),
    layout: buildMapLayoutAlgorithmEnum("layout").notNull().default("hierarchical"),
    layoutOptions: jsonb("layout_options").notNull().default({}),
    viewportX: integer("viewport_x").default(0),
    viewportY: integer("viewport_y").default(0),
    viewportZoom: integer("viewport_zoom").default(100), // Stored as integer (100 = 1.0)
    stats: jsonb("stats").notNull().default({}),
    lastUpdatedBy: varchar("last_updated_by", { length: 100 }).notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdIdx: index("build_map_metadata_project_id_idx").on(table.projectId),
  })
);

/**
 * Build Map AI Suggestions Table (for tracking AI proposals)
 */
export const buildMapSuggestions = pgTable(
  "build_map_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    nodeId: uuid("node_id"),
    targetNodeId: uuid("target_node_id"),
    type: varchar("type", { length: 50 }).notNull(), // "add_node", "update_status", "add_edge", etc.
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    confidence: integer("confidence").notNull(), // 0-100
    priority: integer("priority").notNull(), // 1-10
    autoApply: boolean("auto_apply").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, accepted, rejected, applied
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedBy: varchar("applied_by", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdIdx: index("build_map_suggestions_project_id_idx").on(table.projectId),
    nodeIdIdx: index("build_map_suggestions_node_id_idx").on(table.nodeId),
    statusIdx: index("build_map_suggestions_status_idx").on(table.status),
    typeIdx: index("build_map_suggestions_type_idx").on(table.type),
  })
);

/**
 * Type exports for use in other files
 */
export type BuildMapNode = typeof buildMapNodes.$inferSelect;
export type BuildMapNodeInsert = typeof buildMapNodes.$inferInsert;
export type BuildMapEdge = typeof buildMapEdges.$inferSelect;
export type BuildMapEdgeInsert = typeof buildMapEdges.$inferInsert;
export type BuildMapVersion = typeof buildMapVersions.$inferSelect;
export type BuildMapVersionInsert = typeof buildMapVersions.$inferInsert;
export type BuildMapMetadataRow = typeof buildMapMetadata.$inferSelect;
export type BuildMapMetadataInsert = typeof buildMapMetadata.$inferInsert;
export type BuildMapSuggestion = typeof buildMapSuggestions.$inferSelect;
export type BuildMapSuggestionInsert = typeof buildMapSuggestions.$inferInsert;