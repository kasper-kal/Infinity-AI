import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * Durable facts learned about one project.
 *
 * `key` is canonical within a project, so a changed fact updates the existing
 * row instead of creating conflicting memories. The project foreign key is
 * the isolation boundary for every read and write.
 */
export const projectMemories = pgTable(
  "project_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("about"),
    content: text("content").notNull(),
    key: text("key").notNull(),
    sourceType: text("source_type", {
      enum: ["conversation", "file", "research", "instruction", "agent", "manual"],
    })
      .notNull()
      .default("manual"),
    sourceRef: text("source_ref").notNull().default(""),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_memories_project_key_idx").on(table.projectId, table.key),
    index("project_memories_project_idx").on(table.projectId),
    index("project_memories_project_pinned_idx").on(table.projectId, table.pinned),
  ],
);

export type ProjectMemory = typeof projectMemories.$inferSelect;
export type NewProjectMemory = typeof projectMemories.$inferInsert;
