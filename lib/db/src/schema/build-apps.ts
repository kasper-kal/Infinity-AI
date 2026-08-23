import { pgTable, text, timestamp, uuid, jsonb, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Saved Infinity Build projects ("build-apps"). Each app's file bundle lives in
 * the files database (fileId); metadata (ports, run command, env keys) is
 * stored here as JSON.
 */
export const buildApps = pgTable("build_apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Bundle file in the files database (zip or workspace manifest). */
  fileId: uuid("file_id"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BuildApp = typeof buildApps.$inferSelect;

/**
 * Project access log: tracks which projects reference which other projects.
 * Used for @ tagging feature to manage permissions (view-only vs edit).
 */
export const projectAccessLog = pgTable("project_access_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  referencingProjectId: uuid("referencing_project_id").notNull(),
  referencedProjectId: uuid("referenced_project_id").notNull(),
  accessLevel: varchar("access_level", { length: 10 }).notNull().default("view"), // "view" or "edit"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ProjectAccessLog = typeof projectAccessLog.$inferSelect;

/**
 * Shared files: tracks individual files shared between projects.
 * Allows fine-grained control over which files are visible to referenced projects.
 */
export const sharedFiles = pgTable("shared_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id").notNull(),
  sourceProjectId: uuid("source_project_id").notNull(),
  targetProjectId: uuid("target_project_id").notNull(),
  accessLevel: varchar("access_level", { length: 10 }).notNull().default("view"), // "view" or "edit"
  sharedAt: timestamp("shared_at").notNull().defaultNow(),
});

export type SharedFile = typeof sharedFiles.$inferSelect;
