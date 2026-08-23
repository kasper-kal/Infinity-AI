import { Router, Request, Response } from "express";
import { cleanText } from "../../lib/text-utils";
import {
  saveCheckpoint,
  getLatestCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  markCheckpointComplete,
} from "../../lib/build-checkpoints";
import { logBuildEvent } from "../../lib/build-telemetry";

const router = Router();

/**
 * POST /api/infinity/build/checkpoint
 * Save (upsert) a build checkpoint for a project.
 */
router.post("/checkpoint", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.body?.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const iteration = Math.max(1, Number(req.body?.iteration) || 1);
    const completed = req.body?.completed === 1 ? 1 : 0;
    const id = await saveCheckpoint({
      projectId,
      iteration,
      completed,
      phase: "planning",
      plan: req.body?.plan && typeof req.body.plan === "object" ? req.body.plan : {},
      completedSteps: Array.isArray(req.body?.completedSteps) ? req.body.completedSteps : [],
      workingContext: req.body?.workingContext && typeof req.body.workingContext === "object" ? req.body.workingContext : {},
      fileSnapshots: req.body?.fileSnapshots && typeof req.body.fileSnapshots === "object" ? req.body.fileSnapshots : undefined,
      tokenUsage: req.body?.tokenUsage && typeof req.body.tokenUsage === "object" ? req.body.tokenUsage : undefined,
    });
    await logBuildEvent(projectId, "checkpoint", `Checkpoint saved (iteration ${iteration}, completed=${completed === 1})`, { data: { id, iteration, completed }, step: `checkpoint-${iteration}` });
    res.json({ ok: true, id });
  } catch (err) {
    req.log.error({ err }, "Failed to save checkpoint");
    res.status(500).json({ error: "Failed to save checkpoint" });
  }
});

/**
 * GET /api/infinity/build/checkpoint/:projectId
 * Fetch the latest checkpoint (for resume prompt on boot / reopen).
 */
router.get("/checkpoint/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    const checkpoint = await getLatestCheckpoint(projectId);
    if (!checkpoint) {
      res.status(404).json({ error: "No checkpoint found" });
      return;
    }
    res.json({ ok: true, checkpoint });
  } catch (err) {
    req.log.error({ err }, "Failed to get checkpoint");
    res.status(500).json({ error: "Failed to get checkpoint" });
  }
});

/**
 * GET /api/infinity/build/checkpoints/:projectId
 * List all checkpoints for a project.
 */
router.get("/checkpoints/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const checkpoints = await listCheckpoints(projectId, limit);
    res.json({ ok: true, checkpoints });
  } catch (err) {
    req.log.error({ err }, "Failed to list checkpoints");
    res.status(500).json({ error: "Failed to list checkpoints" });
  }
});

/**
 * POST /api/infinity/build/checkpoint/:id/complete
 * Mark a checkpoint as completed (build finished).
 */
router.post("/checkpoint/:id/complete", async (req: Request, res: Response) => {
  try {
    const id = cleanText(req.params.id as string, 64);
    const ok = await markCheckpointComplete(id);
    res.json({ ok });
  } catch (err) {
    req.log.error({ err }, "Failed to mark checkpoint complete");
    res.status(500).json({ error: "Failed to mark checkpoint complete" });
  }
});

/**
 * DELETE /api/infinity/build/checkpoint/:id
 * Delete a checkpoint.
 */
router.delete("/checkpoint/:id", async (req: Request, res: Response) => {
  try {
    const id = cleanText(req.params.id as string, 64);
    const ok = await deleteCheckpoint(id);
    res.json({ ok });
  } catch (err) {
    req.log.error({ err }, "Failed to delete checkpoint");
    res.status(500).json({ error: "Failed to delete checkpoint" });
  }
});

export default router;
