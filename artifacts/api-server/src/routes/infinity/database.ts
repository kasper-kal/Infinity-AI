import { Router } from "express";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";

const router = Router();

interface DatabaseConnection {
  type: "sqlite" | "postgresql" | "mongodb";
  host?: string;
  port?: number;
  database: string;
  user?: string;
  connected: boolean;
}

interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  indexes: string[];
  rowCount: number;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string;
}

const connections: Map<string, DatabaseConnection> = new Map();

/**
 * Detect database files in workspace
 */
async function detectDatabases(workspaceId: string): Promise<string[]> {
  const workspacePath = path.join("/tmp/workspaces", workspaceId);
  const databases: string[] = [];

  try {
    const entries = await fs.readdir(workspacePath, { recursive: true });
    for (const entry of entries) {
      const fullPath = String(entry);
      if (fullPath.endsWith(".db") || fullPath.endsWith(".sqlite") || fullPath.endsWith(".sqlite3")) {
        databases.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return databases;
}

/**
 * Execute SQLite query
 */
function executeQuery(dbPath: string, query: string): unknown[] {
  try {
    const result = execSync(`sqlite3 "${dbPath}" ".mode json" "${query.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.trim() ? JSON.parse(result) : [];
  } catch (err) {
    console.error("[v0] SQLite query error:", err);
    return [];
  }
}

/**
 * Get SQLite schema
 */
function getSQLiteSchema(dbPath: string): TableSchema[] {
  try {
    const tablesResult = execSync(`sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table';"`, {
      encoding: "utf-8",
    });
    const tables = tablesResult.trim().split("\n").filter((t) => t);

    return tables.map((tableName) => {
      const infoResult = execSync(`sqlite3 "${dbPath}" "PRAGMA table_info(${tableName});"`, {
        encoding: "utf-8",
      });
      const columns = infoResult
        .trim()
        .split("\n")
        .map((line) => {
          const parts = line.split("|");
          return {
            name: parts[1],
            type: parts[2],
            nullable: parts[3] === "0",
            primaryKey: parts[5] === "1",
            defaultValue: parts[4] || undefined,
          };
        });

      const countResult = execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM ${tableName};"`, {
        encoding: "utf-8",
      });
      const rowCount = parseInt(countResult.trim(), 10);

      return {
        name: tableName,
        columns,
        indexes: [],
        rowCount,
      };
    });
  } catch (err) {
    console.error("[v0] SQLite schema error:", err);
    return [];
  }
}

// Detect databases in workspace
router.get("/database/detect", async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "default").slice(0, 64);

  try {
    const databases = await detectDatabases(workspaceId);
    res.json({ ok: true, databases });
  } catch (err) {
    res.status(500).json({ error: "Failed to detect databases" });
  }
});

// Connect to database
router.post("/database/connect", (req, res) => {
  const connectionId = String(req.body?.connectionId || `conn-${Date.now()}`).slice(0, 64);
  const type = String(req.body?.type || "sqlite").slice(0, 20) as "sqlite" | "postgresql" | "mongodb";
  const dbPath = String(req.body?.path || "").slice(0, 256);

  try {
    let connected = false;

    if (type === "sqlite") {
      // Test SQLite connection
      try {
        execSync(`sqlite3 "${dbPath}" ".tables"`);
        connected = true;
      } catch {
        return res.status(400).json({ error: "Failed to connect to SQLite database" });
      }
    }

    const connection: DatabaseConnection = {
      type,
      database: dbPath,
      connected,
    };

    connections.set(connectionId, connection);
    return res.json({ ok: true, connectionId, connection });
  } catch (err) {
    return res.status(500).json({ error: "Failed to connect to database" });
  }
});

// Get database schema
router.get("/database/:connectionId/schema", (req, res) => {
  const connectionId = String(req.params.connectionId).slice(0, 64);
  const connection = connections.get(connectionId);

  if (!connection) {
    return res.status(404).json({ error: "Connection not found" });
  }

  try {
    if (connection.type === "sqlite") {
      const schema = getSQLiteSchema(connection.database);
      return res.json({ ok: true, schema });
    } else {
      return res.status(501).json({ error: `${connection.type} schema introspection not yet implemented` });
    }
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch schema" });
  }
});

// Query database
router.post("/database/:connectionId/query", (req, res) => {
  const connectionId = String(req.params.connectionId).slice(0, 64);
  const query = String(req.body?.query || "").slice(0, 5000);
  const connection = connections.get(connectionId);

  if (!connection) {
    return res.status(404).json({ error: "Connection not found" });
  }

  try {
    if (connection.type === "sqlite") {
      const results = executeQuery(connection.database, query);
      return res.json({ ok: true, results, rowCount: Array.isArray(results) ? results.length : 0 });
    } else {
      return res.status(501).json({ error: `${connection.type} queries not yet implemented` });
    }
  } catch (err) {
    return res.status(500).json({ error: "Failed to execute query" });
  }
});

// Get table data with pagination
router.get("/database/:connectionId/table/:tableName", (req, res) => {
  const connectionId = String(req.params.connectionId).slice(0, 64);
  const tableName = String(req.params.tableName).slice(0, 128);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const connection = connections.get(connectionId);
  if (!connection) {
    return res.status(404).json({ error: "Connection not found" });
  }

  try {
    if (connection.type === "sqlite") {
      const rows = executeQuery(connection.database, `SELECT * FROM ${tableName} LIMIT ${limit} OFFSET ${offset}`);
      const countResult = executeQuery(connection.database, `SELECT COUNT(*) as count FROM ${tableName}`);
      const total = Array.isArray(countResult) && countResult.length > 0 ? (countResult[0] as any).count : 0;

      return res.json({
        ok: true,
        rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } else {
      return res.status(501).json({ error: `${connection.type} table browsing not yet implemented` });
    }
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch table data" });
  }
});

// Export table to CSV
router.get("/database/:connectionId/export/:tableName", (req, res) => {
  const connectionId = String(req.params.connectionId).slice(0, 64);
  const tableName = String(req.params.tableName).slice(0, 128);
  const connection = connections.get(connectionId);

  if (!connection) {
    return res.status(404).json({ error: "Connection not found" });
  }

  try {
    if (connection.type === "sqlite") {
      const rows = executeQuery(connection.database, `SELECT * FROM ${tableName}`);

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.json({ ok: true, csv: "" });
      }

      const headers = Object.keys(rows[0] as object);
      const csvContent = [
        headers.join(","),
        ...rows.map((row: any) =>
          headers.map((h) => {
            const value = row[h];
            if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value ?? "";
          }),
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${tableName}.csv"`);
      return res.send(csvContent);
    } else {
      return res.status(501).json({ error: `${connection.type} export not yet implemented` });
    }
  } catch (err) {
    return res.status(500).json({ error: "Failed to export table" });
  }
});

// Execute database dump
router.get("/database/:connectionId/dump", (req, res) => {
  const connectionId = String(req.params.connectionId).slice(0, 64);
  const connection = connections.get(connectionId);

  if (!connection) {
    return res.status(404).json({ error: "Connection not found" });
  }

  try {
    if (connection.type === "sqlite") {
      const dump = execSync(`sqlite3 "${connection.database}" ".dump"`, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      });

      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", "attachment; filename=database.sql");
      return res.send(dump);
    } else {
      return res.status(501).json({ error: `${connection.type} dump not yet implemented` });
    }
  } catch (err) {
    return res.status(500).json({ error: "Failed to create database dump" });
  }
});

// Disconnect from database
router.post("/database/:connectionId/disconnect", (req, res) => {
  const connectionId = String(req.params.connectionId).slice(0, 64);
  connections.delete(connectionId);
  res.json({ ok: true, message: "Disconnected" });
});

export default router;
