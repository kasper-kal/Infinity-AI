import { pgTable, text, timestamp, uuid, boolean, index } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/** Join table: project ↔ researchJob (cross-db, no FK on researchJobId). */
export const projectResearch = pgTable(
  "project_research",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    researchJobId: uuid("research_job_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_research_project_idx").on(table.projectId),
    index("project_research_job_idx").on(table.researchJobId),
  ],
);

/** User-saved excerpts from a research run inside a project. */
export const projectResearchFindings = pgTable(
  "project_research_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    researchJobId: uuid("research_job_id").notNull(),
    excerpt: text("excerpt").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_research_findings_project_idx").on(table.projectId),
    index("project_research_findings_job_idx").on(table.researchJobId),
  ],
);

export type ProjectResearch = typeof projectResearch.$inferSelect;
export type NewProjectResearch = typeof projectResearch.$inferInsert;
export type ProjectResearchFinding = typeof projectResearchFindings.$inferSelect;
export type NewProjectResearchFinding = typeof projectResearchFindings.$inferInsert;