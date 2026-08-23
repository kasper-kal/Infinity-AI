import { pgTable, text, timestamp, uuid, integer, index } from "drizzle-orm/pg-core";

/**
 * Files metadata. Lives in the SEPARATE files database (DATABASE_URL_FILES),
 * which falls back to DATABASE_URL until a dedicated files DB is provisioned.
 * Blobs live in Cloudflare R2 (or local disk `data/files/` until R2 is set up).
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Conversation this file belongs to (null for standalone/generated files). */
    conversationId: uuid("conversation_id"),
    kind: text("kind", { enum: ["image", "document", "audio", "build-app", "code"] })
      .notNull()
      .default("document"),
    name: text("name").notNull().default("unnamed"),
    mime: text("mime").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    /** Storage key inside the blob store (local path or R2 object key). */
    storageKey: text("storage_key").notNull(),
    /** Storage backend the blob lives in: "local" | "r2". */
    bucket: text("bucket").notNull().default("local"),
    owner: text("owner", { enum: ["user", "infinity", "account"] }).notNull().default("user"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("files_conversation_idx").on(t.conversationId),
    index("files_storage_key_idx").on(t.storageKey),
  ],
);

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
