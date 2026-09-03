/**
 * Phase 35: Dynamic Island / Live Task Display — Database Schema
 *
 * Tasks table for persistent task state across sessions
 */

import { pgTable, uuid, varchar, text, integer, timestamp, jsonb, boolean, index, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Tasks table - stores all active and recent tasks
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: varchar("type", { length: 32 }).notNull(), // build, research, write, automation, agent-loop, deploy, chat, migration, sync
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description").notNull(),
    progress: integer("progress").default(0).notNull(), // 0-100
    status: varchar("status", { length: 16 }).default("pending").notNull(), // pending, running, complete, error, paused
    priority: varchar("priority", { length: 16 }).default("normal").notNull(), // low, normal, high, critical
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    eta: timestamp("eta", { withTimezone: true }), // estimated completion time
    metadata: jsonb("metadata").default({}).notNull(), // flexible metadata per task type
    parentId: uuid("parent_id"), // for parent/child relationships
    children: jsonb("children").default([]).notNull(), // array of child task IDs
    createdBy: varchar("created_by", { length: 16 }).default("system").notNull(), // system, user, agent
    tags: jsonb("tags").default([]).notNull(), // array of tags for filtering
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    typeIdx: index("tasks_type_idx").on(table.type),
    statusIdx: index("tasks_status_idx").on(table.status),
    parentIdIdx: index("tasks_parent_id_idx").on(table.parentId),
    createdByIdx: index("tasks_created_by_idx").on(table.createdBy),
    updatedAtIdx: index("tasks_updated_at_idx").on(table.updatedAt),
    activeTasksIdx: index("tasks_active_idx").on(table.status, table.priority, table.startedAt),
  })
);

/**
 * Task Events table - audit log for task lifecycle
 */
export const taskEvents = pgTable(
  "task_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 32 }).notNull(), // created, updated, completed, deleted, progress
    eventData: jsonb("event_data").default({}).notNull(), // snapshot of task at event time
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index("task_events_task_id_idx").on(table.taskId),
    eventTypeIdx: index("task_events_type_idx").on(table.eventType),
    timestampIdx: index("task_events_timestamp_idx").on(table.timestamp),
  })
);

/**
 * Zod schemas for validation
 */
export const insertTaskSchema = createInsertSchema(tasks, {
  type: z.enum(["build", "research", "write", "automation", "agent-loop", "deploy", "chat", "migration", "sync"]),
  status: z.enum(["pending", "running", "complete", "error", "paused"]),
  priority: z.enum(["low", "normal", "high", "critical"]),
  progress: z.number().min(0).max(100),
  metadata: z.record(z.unknown()),
  children: z.array(z.string().uuid()),
  createdBy: z.enum(["system", "user", "agent"]),
  tags: z.array(z.string()),
});

export const selectTaskSchema = createSelectSchema(tasks);
export const insertTaskEventSchema = createInsertSchema(taskEvents, {
  eventType: z.enum(["created", "updated", "completed", "deleted", "progress"]),
  eventData: z.record(z.unknown()),
});
export const selectTaskEventSchema = createSelectSchema(taskEvents);

/**
 * Type exports
 */
export type Task = z.infer<typeof selectTaskSchema>;
export type NewTask = z.infer<typeof insertTaskSchema>;
export type TaskEvent = z.infer<typeof selectTaskEventSchema>;
export type NewTaskEvent = z.infer<typeof insertTaskEventSchema>;