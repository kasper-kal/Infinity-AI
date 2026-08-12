import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/** Agent run attached to a project. The autonomous loop itself is deferred. */
export const projectAgentRuns = pgTable(
  "project_agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    }).notNull().default("queued"),
    objective: text("objective"),
    resultSummary: text("result_summary"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_agent_runs_project_idx").on(table.projectId),
    index("project_agent_runs_project_status_idx").on(table.projectId, table.status),
  ],
);

/** Individual action within an agent run. */
export const projectAgentActions = pgTable(
  "project_agent_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => projectAgentRuns.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["browser", "code", "file", "test", "terminal", "search", "other"],
    }).notNull().default("other"),
    description: text("description"),
    detail: text("detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_agent_actions_run_idx").on(table.runId),
    index("project_agent_actions_project_idx").on(table.projectId),
  ],
);

export type ProjectAgentRun = typeof projectAgentRuns.$inferSelect;
export type NewProjectAgentRun = typeof projectAgentRuns.$inferInsert;
export type ProjectAgentAction = typeof projectAgentActions.$inferSelect;
export type NewProjectAgentAction = typeof projectAgentActions.$inferInsert;