import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/** Append-only activity feed for a project. */
export const projectActivity = pgTable(
  "project_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "project_created",
        "conversation_started",
        "file_uploaded",
        "file_changed",
        "research_completed",
        "memory_added",
        "memory_updated",
        "instruction_added",
        "task_added",
        "task_completed",
        "agent_ran",
      ],
    }).notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_activity_project_idx").on(table.projectId),
    index("project_activity_project_created_idx").on(table.projectId, table.createdAt),
  ],
);

export type ProjectActivity = typeof projectActivity.$inferSelect;
export type NewProjectActivity = typeof projectActivity.$inferInsert;