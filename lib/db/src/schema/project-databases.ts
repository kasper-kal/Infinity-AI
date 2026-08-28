import { pgTable, uuid, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects } from "./projects";
import { accounts } from "./accounts";

export const projectDatabases = pgTable(
  "project_databases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider", { enum: ["supabase", "firebase", "neon", "planetscale", "turso", "sqlite", "postgres", "mysql"] }).notNull(),
    connectionString: text("connection_string").notNull(),
    host: text("host"),
    port: text("port"),
    database: text("database"),
    username: text("username"),
    password: text("password"),
    ssl: boolean("ssl").notNull().default(true),
    options: jsonb("options").$type<Record<string, any>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("project_databases_project_idx").on(table.projectId),
    providerIdx: index("project_databases_provider_idx").on(table.provider),
  })
);

export const projectDatabasesRelations = relations(projectDatabases, ({ one }) => ({
  project: one(projects, { fields: [projectDatabases.projectId], references: [projects.id] }),
}));

export type ProjectDatabase = typeof projectDatabases.$inferSelect;
export type NewProjectDatabase = typeof projectDatabases.$inferInsert;