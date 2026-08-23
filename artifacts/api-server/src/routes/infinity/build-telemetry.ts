import { Router, Request, Response } from "express";
import { cleanText } from "../../lib/text-utils";
import {
  logBuildEvent,
  getRecentEvents,
  readAllEvents,
  summarizeTelemetry,
  countEvents,
  clearTelemetry,
  type BuildEvent,
  type BuildEventType,
} from "../../lib/build-telemetry";

const router = Router();

/**
 * GET /api/infinity/build/telemetry/:projectId
 * Get recent telemetry events (from memory buffer, newest last).
 * Query: ?limit=500 (default 500, max 2000)
 */
router.get("/telemetry/:projectId", async (req: Request, res: Response) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  const events = getRecentEvents(projectId, limit);
  res.json({ ok: true, events });
});

/**
 * GET /api/infinity/build/telemetry/:projectId/all
 * Read all events from the on-disk log (for export/replay).
 */
router.get("/telemetry/:projectId/all", async (req: Request, res: Response) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const events = await readAllEvents(projectId);
  res.json({ ok: true, events });
});

/**
 * GET /api/infinity/build/telemetry/:projectId/summary
 * Get a compact summary string for the Debug panel "replay" view or model feedback.
 */
router.get("/telemetry/:projectId/summary", async (req: Request, res: Response) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const summary = await summarizeTelemetry(projectId);
  res.json({ ok: true, summary });
});

/**
 * GET /api/infinity/build/telemetry/:projectId/count
 * Get total event count (on disk) for the Debug panel header.
 */
router.get("/telemetry/:projectId/count", async (req: Request, res: Response) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const total = await countEvents(projectId);
  res.json({ ok: true, total });
});

/**
 * DELETE /api/infinity/build/telemetry/:projectId
 * Clear all telemetry for a project (Debug panel "clear logs").
 */
router.delete("/telemetry/:projectId", async (req: Request, res: Response) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  await clearTelemetry(projectId);
  res.json({ ok: true });
});

/**
 * POST /api/infinity/build/telemetry/:projectId (internal use by build routes)
 * Append a single event. Not for direct client use — exists so build routes can
 * record events without importing the library directly.
 * Body: { type, label, data?, durationMs?, step? }
 */
router.post("/telemetry/:projectId", async (req: Request, res: Response) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const { type, label, data, durationMs, step } = req.body as {
    type: BuildEventType;
    label: string;
    data?: Record<string, unknown> | null;
    durationMs?: number;
    step?: string;
  };
  if (!type || !label) {
    res.status(400).json({ error: "type and label required" });
    return;
  }
  await logBuildEvent(projectId, type, label, { data, durationMs, step });
  res.json({ ok: true });
});

/**
 * POST /api/infinity/build/telemetry/:projectId/batch (internal use)
 * Append multiple events at once (e.g., from a worker process).
 * Body: { events: BuildEvent[] }
 */
router.post("/telemetry/:projectId/batch", async (req: Request, res: Response) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const events = req.body?.events as BuildEvent[] | undefined;
  if (!Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: "events array required" });
    return;
  }
  for (const e of events) {
    await logBuildEvent(projectId, e.type, e.label, {
      data: e.data,
      durationMs: e.durationMs,
      step: e.step,
    });
  }
  res.json({ ok: true, recorded: events.length });
});

export default router;