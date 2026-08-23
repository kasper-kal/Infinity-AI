import { Router, Request, Response } from "express";
import { apiKeyAuth, requireScope } from "../../middlewares/api-key-auth";
import {
  createProposal,
  applyEvolution,
  createCheckpoint,
  rollbackToCheckpoint,
  listCheckpoints,
  getEvolutionHistory,
  runSelfEvolutionCycle,
  isPathAllowed,
  setEvolutionConfig,
  getEvolutionConfig,
  type EvolutionProposal,
} from "../../lib/self-evolution";
import { logActivity } from "./project-activity";
import { logger } from "../../lib/logger";

const router = Router();

/** All self-evolution routes require authentication and project:write scope */
router.use(apiKeyAuth);
router.use(requireScope("project:write"));

/** GET /api/infinity/self-evolution/config — Get current evolution config */
router.get("/config", async (req: Request, res: Response) => {
  try {
    res.json(getEvolutionConfig());
  } catch (err) {
    logger.error({ err }, "Failed to get evolution config");
    res.status(500).json({ error: "Failed to get config" });
  }
});

/** PUT /api/infinity/self-evolution/config — Update evolution config */
router.put("/config", async (req: Request, res: Response) => {
  try {
    setEvolutionConfig(req.body);
    res.json(getEvolutionConfig());
  } catch (err) {
    logger.error({ err }, "Failed to update evolution config");
    res.status(500).json({ error: "Failed to update config" });
  }
});

/** POST /api/infinity/self-evolution/check-path — Check if a path is allowed for modification */
router.post("/check-path", async (req: Request, res: Response) => {
  try {
    const { path } = req.body;
    if (!path) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    res.json({ allowed: isPathAllowed(path) });
  } catch (err) {
    logger.error({ err }, "Failed to check path");
    res.status(500).json({ error: "Failed to check path" });
  }
});

/** POST /api/infinity/self-evolution/propose — Create an evolution proposal */
router.post("/propose", async (req: Request, res: Response) => {
  try {
    const { projectId, title, description, files, rationale } = req.body;

    if (!projectId || !title || !files || !Array.isArray(files)) {
      res.status(400).json({ error: "projectId, title, and files[] are required" });
      return;
    }

    const proposal = createProposal(projectId, title, description, files, rationale || "");

    await logActivity(projectId, "agent_ran", `Self-evolution proposal created: ${title} (${proposal.riskLevel} risk)`);

    res.status(201).json(proposal);
  } catch (err) {
    logger.error({ err }, "Failed to create proposal");
    res.status(500).json({ error: "Failed to create proposal" });
  }
});

/** POST /api/infinity/self-evolution/apply — Apply an evolution proposal */
router.post("/apply", async (req: Request, res: Response) => {
  try {
    const proposal = req.body as EvolutionProposal;

    if (!proposal.id || !proposal.projectId || !proposal.files) {
      res.status(400).json({ error: "Invalid proposal" });
      return;
    }

    const result = await applyEvolution(proposal);

    if (result.success) {
      await logActivity(proposal.projectId, "agent_ran", `Self-evolution applied: ${proposal.title}`);
      res.json({ success: true });
    } else {
      await logActivity(proposal.projectId, "agent_ran", `Self-evolution failed: ${proposal.title} - ${result.error}`);
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    logger.error({ err }, "Failed to apply evolution");
    res.status(500).json({ error: "Failed to apply evolution" });
  }
});

/** POST /api/infinity/self-evolution/run-cycle — Run a full self-evolution cycle */
router.post("/run-cycle", async (req: Request, res: Response) => {
  try {
    const { projectId, goal, maxProposals = 3 } = req.body;

    if (!projectId || !goal) {
      res.status(400).json({ error: "projectId and goal are required" });
      return;
    }

    const result = await runSelfEvolutionCycle(projectId, goal, maxProposals);

    await logActivity(projectId, "agent_ran", `Self-evolution cycle completed: ${result.applied}/${result.proposals.length} applied`);

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to run evolution cycle");
    res.status(500).json({ error: "Failed to run evolution cycle" });
  }
});

/** POST /api/infinity/self-evolution/checkpoint — Create a checkpoint */
router.post("/checkpoint", async (req: Request, res: Response) => {
  try {
    const { projectId, description = "manual checkpoint" } = req.body;

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const checkpointId = await createCheckpoint(projectId, description);
    await logActivity(projectId, "agent_ran", `Checkpoint created: ${checkpointId}`);

    res.json({ checkpointId });
  } catch (err) {
    logger.error({ err }, "Failed to create checkpoint");
    res.status(500).json({ error: "Failed to create checkpoint" });
  }
});

/** POST /api/infinity/self-evolution/rollback — Rollback to a checkpoint */
router.post("/rollback", async (req: Request, res: Response) => {
  try {
    const { projectId, checkpointId } = req.body;

    if (!projectId || !checkpointId) {
      res.status(400).json({ error: "projectId and checkpointId are required" });
      return;
    }

    const success = await rollbackToCheckpoint(projectId, checkpointId);

    if (success) {
      await logActivity(projectId, "agent_ran", `Rolled back to checkpoint: ${checkpointId}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: "Rollback failed" });
    }
  } catch (err) {
    logger.error({ err }, "Failed to rollback");
    res.status(500).json({ error: "Failed to rollback" });
  }
});

/** GET /api/infinity/self-evolution/checkpoints — List checkpoints */
router.get("/checkpoints", async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const checkpoints = listCheckpoints(projectId);
    res.json(checkpoints);
  } catch (err) {
    logger.error({ err }, "Failed to list checkpoints");
    res.status(500).json({ error: "Failed to list checkpoints" });
  }
});

/** GET /api/infinity/self-evolution/history — Get evolution history */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const history = await getEvolutionHistory(projectId);
    res.json(history);
  } catch (err) {
    logger.error({ err }, "Failed to get evolution history");
    res.status(500).json({ error: "Failed to get history" });
  }
});

export default router;