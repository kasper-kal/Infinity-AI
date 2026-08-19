import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { conversations } from "./conversations";

/**
 * ChatGPT-style Projects: a named, colored folder that groups related chats.
 * Chats inside a project inherit its files/instructions as shared context.
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#0ea5e9"),
  archived: boolean("archived").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  lastOpenedAt: timestamp("last_opened_at"),
  /** Custom instructions injected as system text into every chat in the project. */
  instructions: text("instructions"),
  /** Project type: "general", "book", "website", "company", "app", "research", "course" */
  type: text("type").notNull().default("general"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Which conversations belong to which project. */
export const projectChats = pgTable("project_chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Shared context files attached to a project. fileId references the files
 * table in the separate files database (no FK possible across databases).
 */
export const projectFiles = pgTable("project_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Pinned conversations sort above all others in the sidebar. */
export const pins = pgTable("pins", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .unique()
    .references(() => conversations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type Pin = typeof pins.$inferSelect;
