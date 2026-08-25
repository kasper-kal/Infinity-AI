import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { files } from "./schema/files";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

// Do NOT crash the whole server at import time when DATABASE_URL is missing.
// Instead, construct a pool that fails fast on connect: the health route
// reports `db: disconnected` and chat/settings routes surface a clear,
// detailed error (with the exact fix) instead of taking the entire app down
// with "server unreachable".
export const pool = new Pool(
  connectionString
    ? { connectionString }
    : { connectionTimeoutMillis: 2000, idleTimeoutMillis: 2000, max: 1 },
);

// Required when the DB is down: pg emits an "error" event for idle-client
// failures, and an unhandled one crashes the whole Node process. Swallow and
// log instead — the app stays up and the health check reports disconnected.
pool.on("error", (err) => {
  console.error(`[db] pool error (${connectionString ? "configured" : "DATABASE_URL missing"}):`, err.message);
});

export const db = drizzle(pool, { schema });

export const databaseConfigured = !!connectionString;

// ── Files database (SEPARATE Neon database, per the product spec) ──────────
// Metadata for uploaded/generated files lives here, distinct from the main DB.
// Until a dedicated DATABASE_URL_FILES is provisioned, it falls back to the
// main DATABASE_URL so the app works out of the box. Same fail-fast pool
// semantics: never crash at import time, report `disconnected` instead.
const filesConnectionString =
  process.env["DATABASE_URL_FILES"] || process.env["DATABASE_URL"];

export const filesPool = new Pool(
  filesConnectionString
    ? { connectionString: filesConnectionString }
    : { connectionTimeoutMillis: 2000, idleTimeoutMillis: 2000, max: 1 },
);

filesPool.on("error", (err) => {
  console.error(
    `[files-db] pool error (${filesConnectionString ? "configured" : "DATABASE_URL_FILES missing"}):`,
    err.message,
  );
});

export const filesDb = drizzle(filesPool, { schema: { files } });

export const filesDatabaseConfigured = !!filesConnectionString;

export { files };

export * from "./schema";
export * from "./schema/mobile-apps.js";
