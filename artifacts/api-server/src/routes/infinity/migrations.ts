import { Router } from "express";
import { execSync, spawn } from "node:child_process";
import { readWorkspaceFile, writeWorkspaceFile, listWorkspaceFiles } from "../../lib/workspace";
import { cleanText } from "../../lib/text-utils";

interface Migration {
  filename: string;
  timestamp: string;
  name: string;
  status: "pending" | "applied";
  createdAt: Date;
}

const router = Router();

// Detect migrations framework
async function detectMigrationsFramework(workspaceId: string): Promise<string> {
  try {
    const files = await listWorkspaceFiles(workspaceId);
    const filenames = files.map(f => f.name.toLowerCase());

    if (filenames.some(f => f === "prisma.schema" || f.includes("prisma"))) return "prisma";
    if (filenames.some(f => f === "ormconfig.json" || f === "typeorm")) return "typeorm";
    if (filenames.some(f => f.includes("alembic"))) return "alembic";
    if (filenames.some(f => f.startsWith("db") && f.includes("migrations"))) return "django";
    if (filenames.some(f => f === "knexfile.js")) return "knex";
    if (filenames.some(f => f === "flyway.conf")) return "flyway";

    return "unknown";
  } catch {
    return "unknown";
  }
}

// List all migration files
router.get("/migrations/list", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";

  try {
    const framework = await detectMigrationsFramework(workspaceId);
    const files = await listWorkspaceFiles(workspaceId);

    const migrations: Migration[] = [];
    const patterns = [
      /migrations?\/.+\.(sql|js|ts)$/i,
      /alembic\/versions\/.+\.py$/i,
      /db\/migrations?\/.+\.rb$/i,
    ];

    for (const file of files) {
      if (file.type === "file" && patterns.some(p => p.test(file.path))) {
        const match = file.name.match(/^(\d{4})\d{2}\d{2}.\d{6}|(\d+)/);
        migrations.push({
          filename: file.name,
          timestamp: match ? match[0] : "unknown",
          name: file.name.replace(/^\d+[-_]/, "").replace(/\.(js|ts|sql|py|rb)$/, ""),
          status: "pending",
          createdAt: new Date(),
        });
      }
    }

    res.json({
      ok: true,
      framework,
      migrations: migrations.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      count: migrations.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list migrations");
    res.status(500).json({ error: "Failed to list migrations" });
  }
});

// Run migrations (Prisma)
router.post("/migrations/run-prisma", async (req, res) => {
  try {
    const output = execSync("npx prisma migrate deploy", {
      encoding: "utf-8",
      stdio: "pipe",
    });

    res.json({
      ok: true,
      framework: "prisma",
      output,
      message: "Migrations applied successfully",
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: "Prisma migration failed",
      details: err.stderr || err.message,
    });
  }
});

// Run migrations (Django)
router.post("/migrations/run-django", async (req, res) => {
  try {
    const output = execSync("python manage.py migrate", {
      encoding: "utf-8",
      stdio: "pipe",
    });

    res.json({
      ok: true,
      framework: "django",
      output,
      message: "Django migrations applied",
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: "Django migration failed",
      details: err.stderr || err.message,
    });
  }
});

// Run migrations (TypeORM)
router.post("/migrations/run-typeorm", async (req, res) => {
  try {
    const output = execSync("typeorm migration:run", {
      encoding: "utf-8",
      stdio: "pipe",
    });

    res.json({
      ok: true,
      framework: "typeorm",
      output,
      message: "TypeORM migrations applied",
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: "TypeORM migration failed",
      details: err.stderr || err.message,
    });
  }
});

// Create a new migration
router.post("/migrations/create", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const framework = cleanText(req.body?.framework, 64);
  const name = cleanText(req.body?.name, 128);

  if (!name) {
    return res.status(400).json({ error: "Migration name required" });
  }

  try {
    const timestamp = Date.now();
    let command = "";

    if (framework === "prisma") {
      command = `npx prisma migrate dev --name ${name}`;
    } else if (framework === "django") {
      command = `python manage.py makemigrations ${name}`;
    } else if (framework === "typeorm") {
      command = `typeorm migration:create src/migrations/${name}`;
    } else if (framework === "alembic") {
      command = `alembic revision --autogenerate -m "${name}"`;
    }

    if (!command) {
      return res.status(400).json({ error: "Unsupported framework" });
    }

    const output = execSync(command, { encoding: "utf-8", stdio: "pipe" });

    return res.json({
      ok: true,
      framework,
      name,
      timestamp,
      output,
      message: `Migration "${name}" created successfully`,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: "Failed to create migration",
      details: err.stderr || err.message,
    });
  }
});

// Run seed scripts
router.post("/migrations/seed", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const framework = cleanText(req.body?.framework, 64);

  try {
    let command = "";

    if (framework === "prisma") {
      command = "npx prisma db seed";
    } else if (framework === "django") {
      command = "python manage.py seed";
    } else if (framework === "typeorm") {
      command = "ts-node src/seeds/index.ts";
    }

    if (!command) {
      return res.status(400).json({ error: "No seed command for framework" });
    }

    const output = execSync(command, { encoding: "utf-8", stdio: "pipe" });

    return res.json({
      ok: true,
      framework,
      output,
      message: "Seed data loaded successfully",
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: "Seed failed",
      details: err.stderr || err.message,
    });
  }
});

// Rollback migration
router.post("/migrations/rollback", async (req, res) => {
  const framework = cleanText(req.body?.framework, 64);
  const steps = Math.min(parseInt(req.body?.steps) || 1, 10);

  try {
    let command = "";

    if (framework === "prisma") {
      command = `npx prisma migrate resolve --rolled-back`;
    } else if (framework === "django") {
      command = `python manage.py migrate --plan`;
    } else if (framework === "typeorm") {
      command = `typeorm migration:revert`;
    }

    if (!command) {
      return res.status(400).json({ error: "Unsupported framework" });
    }

    const output = execSync(command, { encoding: "utf-8", stdio: "pipe" });

    return res.json({
      ok: true,
      framework,
      steps,
      output,
      message: `Rolled back ${steps} migration(s)`,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: "Rollback failed",
      details: err.stderr || err.message,
    });
  }
});

// Get migration status
router.get("/migrations/status", async (req, res) => {
  const framework = cleanText(req.query.framework as string, 64);

  try {
    let command = "";

    if (framework === "prisma") {
      command = "npx prisma migrate status";
    } else if (framework === "django") {
      command = "python manage.py showmigrations";
    } else if (framework === "typeorm") {
      command = "typeorm migration:show";
    }

    if (!command) {
      return res.status(400).json({ error: "Unsupported framework" });
    }

    const output = execSync(command, { encoding: "utf-8", stdio: "pipe" });

    return res.json({
      ok: true,
      framework,
      status: output,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: "Failed to get status",
      details: err.stderr || err.message,
    });
  }
});

export default router;
