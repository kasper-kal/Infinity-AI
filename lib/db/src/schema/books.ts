import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";

/**
 * Book Studio jobs — the autonomous book-generation pipeline.
 *
 * A book job runs in the background on the API server. The engine walks the
 * pipeline and writes progress, phase logs and the growing manuscript into
 * this table on every step, so the frontend can poll status and so a server
 * restart can resume a job from where it left off.
 *
 * Pipeline (all autonomous after plan approval):
 *   1. PLAN     — idea → chapters + summary (done synchronously via /book/plan,
 *                 stored here when the job is created)
 *   2. GENERATE — N chunks of `chunk_size` pages each. Every chunk is a SEPARATE
 *                 LLM call that receives the running manuscript (the growing
 *                 "book.txt"), the chapter plan and the style samples. The
 *                 manuscript is persisted after every chunk.
 *   3. CRITIQUE — 2 passes: full manuscript + style samples are sent back with
 *                 "Tell me exactly what to change", then the change is applied.
 *   4. FORMAT   — final manuscript → A5 PDF (Times New Roman / Liberation Serif)
 *                 via Puppeteer, written to data/books/<id>.pdf
 *   5. CHECK    — one last LLM final check over the formatted text.
 *   6. NOTIFY   — push notification with the download link, then completed.
 */
export const bookJobs = pgTable("book_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("Untitled book"),
  /** The user's raw idea, the seed of the whole book. */
  idea: text("idea").notNull(),
  /** Book language, e.g. "en", "nl", "de". Free text, the model adapts. */
  language: text("language").notNull().default("en"),
  /** Total pages the user chose at the start. */
  pageCount: integer("page_count").notNull().default(120),
  /** Words per A5 page estimate, used to size each chunk's target. */
  wordsPerPage: integer("words_per_page").notNull().default(250),
  /** Pages written per LLM chunk (user asked for 10-page chunks). */
  chunkSize: integer("chunk_size").notNull().default(10),
  /** How many "Tell me exactly what to change" passes to run. Default 2. */
  critiquePasses: integer("critique_passes").notNull().default(2),
  /** queued | running | completed | failed | cancelled */
  status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] })
    .notNull()
    .default("queued"),
  /** 0-100 progress */
  progress: integer("progress").notNull().default(0),
  /** Current phase label, e.g. "Chunk 3/12 — pages 21-30" */
  phase: text("phase").notNull().default("Queued…"),
  /** Append-only human-readable log of every step the engine took */
  log: text("log").notNull().default(""),
  /** Chapter plan as JSON: { summary, chapters: [{ title, summary }] } */
  plan: text("plan").notNull().default("{}"),
  /** The growing manuscript — every chunk is appended, this is book.txt */
  manuscript: text("manuscript").notNull().default(""),
  /** JSON array of style-sample excerpts pulled from Books/ */
  samples: text("samples").notNull().default("[]"),
  /** BYO API key the user pasted into the studio — server-side only, masked on output. */
  apiKey: text("api_key"),
  /** OpenAI-compatible base URL for the BYO key. */
  baseUrl: text("base_url"),
  /** Model id for the BYO key. */
  model: text("model"),
  /** Where the finished A5 PDF lives (relative to data/books/). */
  pdfFile: text("pdf_file"),
  error: text("error"),
  /** Heartbeat timestamp — a job whose heartbeat is stale gets resumed on boot */
  heartbeatAt: timestamp("heartbeat_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export type BookJob = typeof bookJobs.$inferSelect;
export type BookJobNew = typeof bookJobs.$inferInsert;
