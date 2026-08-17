import { Router, Request, Response } from "express";
import { apiKeyAuth, requireScope } from "../../middlewares/api-key-auth";
import { db, projects } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  listSchedules,
  createSchedule,
  getScheduleWithRuns,
  updateSchedule,
  deleteSchedule,
  triggerSchedule,
  getScheduleRuns,
  startBuildScheduler,
} from "../../lib/build-scheduler";
import type { BuildSchedule, NewBuildSchedule } from "@workspace/db/schema";

const router = Router();

/** All build schedule routes require authentication and build:write scope */
router.use(apiKeyAuth);
router.use(requireScope("build:write"));

/** GET /api/jarvis/build/schedules — List all schedules for a project */
router.get("/build/schedules", async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    // Verify project access
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const schedules = await listSchedules(projectId);
    res.json(schedules);
  } catch (err) {
    console.error({ err }, "Failed to list build schedules");
    res.status(500).json({ error: "Failed to list build schedules" });
  }
});

/** POST /api/jarvis/build/schedules — Create a new build schedule */
router.post("/build/schedules", async (req: Request, res: Response) => {
  try {
    const input = req.body as Omit<NewBuildSchedule, "id" | "createdAt" | "updatedAt" | "runCount" | "nextRunAt" | "lastRunAt" | "lastRunResult" | "lastError" | "status">;

    if (!input.projectId || !input.name || !input.type || !input.cron) {
      res.status(400).json({ error: "projectId, name, type, and cron are required" });
      return;
    }

    // Validate type
    const validTypes = ["build", "research", "memory_compaction", "budget_reset", "snapshot_cleanup"];
    if (!validTypes.includes(input.type)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
      return;
    }

    // Verify project access
    const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const schedule = await createSchedule(input);
    res.status(201).json(schedule);
  } catch (err) {
    console.error({ err }, "Failed to create build schedule");
    res.status(500).json({ error: "Failed to create build schedule" });
  }
});

/** GET /api/jarvis/build/schedules/:id — Get a schedule with recent runs */
router.get("/build/schedules/:id", async (req: Request, res) => {
  try {
    const schedule = await getScheduleWithRuns(req.params.id as string);
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    res.json(schedule);
  } catch (err) {
    console.error({ err }, "Failed to get build schedule");
    res.status(500).json({ error: "Failed to get build schedule" });
  }
});

/** PUT /api/jarvis/build/schedules/:id — Update a schedule */
router.put("/build/schedules/:id", async (req: Request, res) => {
  try {
    const input = req.body as Partial<Pick<BuildSchedule, "name" | "cron" | "config" | "status" | "notifyOnCompletion">>;

    const schedule = await updateSchedule(req.params.id as string, input);
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    res.json(schedule);
  } catch (err) {
    console.error({ err }, "Failed to update build schedule");
    res.status(500).json({ error: "Failed to update build schedule" });
  }
});

/** DELETE /api/jarvis/build/schedules/:id — Delete a schedule */
router.delete("/build/schedules/:id", async (req: Request, res) => {
  try {
    const deleted = await deleteSchedule(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error({ err }, "Failed to delete build schedule");
    res.status(500).json({ error: "Failed to delete build schedule" });
  }
});

/** POST /api/jarvis/build/schedules/:id/trigger — Manually trigger a schedule (Run now) */
router.post("/build/schedules/:id/trigger", async (req: Request, res) => {
  try {
    const result = await triggerSchedule(req.params.id as string);
    res.json(result);
  } catch (err) {
    console.error({ err }, "Failed to trigger build schedule");
    res.status(500).json({ error: "Failed to trigger build schedule" });
  }
});

/** GET /api/jarvis/build/schedules/:id/runs — Get paginated run history for a schedule */
router.get("/build/schedules/:id/runs", async (req: Request, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const runs = await getScheduleRuns(req.params.id as string, limit, offset);
    res.json({ runs, limit, offset });
  } catch (err) {
    console.error({ err }, "Failed to get schedule runs");
    res.status(500).json({ error: "Failed to get schedule runs" });
  }
});

/** Initialize scheduler on module load (runs on server start) */
startBuildScheduler().catch((err) => {
  console.error("[scheduler] failed to start on boot:", err);
});

export default router;