import { pgTable, text, timestamp, uuid, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { projectMemories } from "./project-memory";
import { conversations } from "./conversations";

/** Lightweight tasks inside a project. Kept deliberately simple. */
export const projectTasks = pgTable(
  "project_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: ["todo", "in_progress", "done"] }).notNull().default("todo"),
    priority: text("priority", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
    dueAt: timestamp("due_at"),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    fileId: uuid("file_id"),
    memoryId: uuid("memory_id").references(() => projectMemories.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_tasks_project_idx").on(table.projectId),
    index("project_tasks_project_status_idx").on(table.projectId, table.status),
    index("project_tasks_project_sort_idx").on(table.projectId, table.sortOrder),
  ],
);

export type ProjectTask = typeof projectTasks.$inferSelect;
export type NewProjectTask = typeof projectTasks.$inferInsert;