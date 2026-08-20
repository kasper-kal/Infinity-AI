import { pgTable, text, timestamp, uuid, integer, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Deep Research v2 Jobs
 *
 * True deep research agent (ChatGPT/Gemini style, 3-7 min):
 * Iterative loop: plan → search → browse → extract → synthesize → gap analysis → repeat (max 3 iterations)
 * 20-50 unique sources (Tavily + browser + Semantic Scholar/Crossref free APIs)
 * Output: Structured ResearchReport artifact with executive summary, detailed sections, numbered citations, source list, confidence scores, gaps/limitations
 */
export const researchJobsV2 = pgTable("research_jobs_v2", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: text("topic").notNull(),
  /** queued | running | completed | failed | cancelled */
  status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] })
    .notNull()
    .default("queued"),
  /** planning | searching | reading | extracting | synthesizing | gap_analysis | finalizing | completed | failed */
  phase: text("phase", { enum: ["planning", "searching", "reading", "extracting", "synthesizing", "gap_analysis", "finalizing", "completed", "failed"] })
    .notNull()
    .default("planning"),
  /** 0-100 progress */
  progress: integer("progress").notNull().default(0),
  /** Number of unique sources found */
  sourcesFound: integer("sources_found").notNull().default(0),
  /** Number of pages actually read (with content) */
  pagesRead: integer("pages_read").notNull().default(0),
  /** Current query being processed */
  currentQuery: text("current_query"),
  /** Append-only human-readable log of every step */
  log: text("log").array().notNull().default([]),
  /** Final synthesized report (structured JSON) */
  report: jsonb("report"),
  /** Current iteration (1-3) */
  iterations: integer("iterations").notNull().default(0),
  /** Maximum iterations allowed */
  maxIterations: integer("max_iterations").notNull().default(3),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  statusIdx: index("research_jobs_v2_status_idx").on(table.status),
  createdAtIdx: index("research_jobs_v2_created_at_idx").on(table.createdAt),
}));

export type ResearchJobV2 = typeof researchJobsV2.$inferSelect;

/**
 * Individual sources for Deep Research v2
 */
export const researchSourcesV2 = pgTable("research_sources_v2", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => researchJobsV2.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull().unique(), // UUID from the engine
  title: text("title").notNull(),
  url: text("url").notNull(),
  snippet: text("snippet"),
  content: text("content"),
  /** tavily | browser | academic */
  sourceType: text("source_type", { enum: ["tavily", "browser", "academic"] }).notNull(),
  relevanceScore: integer("relevance_score").notNull().default(0),
  readAt: timestamp("read_at"),
  /** Structured extraction results */
  extraction: jsonb("extraction"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  jobIdIdx: index("research_sources_v2_job_id_idx").on(table.jobId),
  sourceIdIdx: index("research_sources_v2_source_id_idx").on(table.sourceId),
  urlIdx: index("research_sources_v2_url_idx").on(table.url),
}));

export type ResearchSourceV2 = typeof researchSourcesV2.$inferSelect;