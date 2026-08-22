import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

export const taskStates = pgTable("task_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: text("task_id").notNull().unique(),
  userId: uuid("user_id"),
  projectId: uuid("project_id"),
  conversationId: uuid("conversation_id"),
  workspaceId: text("workspace_id"),
  status: text("status").notNull().default("running"),
  objective: text("objective"),
  state: jsonb("state").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
}, (table) => [
  index("task_states_task_id_idx").on(table.taskId),
  index("task_states_user_id_idx").on(table.userId),
  index("task_states_project_id_idx").on(table.projectId),
  index("task_states_status_idx").on(table.status),
  index("task_states_updated_idx").on(table.updatedAt),
]);

export type TaskState = typeof taskStates.$inferSelect;
export type NewTaskState = typeof taskStates.$inferInsert;