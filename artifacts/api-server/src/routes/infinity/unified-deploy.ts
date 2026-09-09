/**
 * Unified Deploy API Routes (Phase 12 — Multi-Artifact Support)
 *
 * Deploy all of a project's artifacts (web + mobile + slides + api + cli +
 * extension) as a single orchestrated action with one aggregated status.
 *
 * Mounted at /api/infinity/unified-deploy
 */

import { Router, Request, Response } from "express";
import { getUnifiedDeployService } from "../../lib/unified-deploy";
import { BUILTIN_ARTIFACT_TYPES } from "../../lib/artifact-types";

const router = Router();
const service = getUnifiedDeployService();

/** GET /api/infinity/unified-deploy/artifact-types — all deployable artifact types */
router.get("/artifact-types", (_req: Request, res: Response) => {
  res.json({
    artifactTypes: BUILTIN_ARTIFACT_TYPES.map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      description: t.description,
      category: t.category,
      deployTargets: t.deployTargets,
      defaultDeployTarget: t.defaultDeployTarget,
    })),
  });
});

/** GET /api/infinity/unified-deploy — recent unified deployments for a project */
router.get("/", async (req: Request, res: Response) => {
  try {
    const projectId = (req.query.projectId as string) || "";
    const deployments = service.listDeployments(projectId);
    res.json({ deployments });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || "Failed to list deployments" });
  }
});

/** POST /api/infinity/unified-deploy — start a unified deployment of a project's artifacts */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { projectId, projectPath, artifacts } = req.body || {};
    if (!projectId || !projectPath) {
      res.status(400).json({ ok: false, error: "projectId and projectPath are required" });
      return;
    }
    const deployment = await service.deployProject({
      projectId,
      projectPath,
      artifacts: Array.isArray(artifacts) ? artifacts : undefined,
    });
    res.status(202).json({ ok: true, deployment });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || "Failed to start unified deployment" });
  }
});

/** GET /api/infinity/unified-deploy/:id — full status of a unified deployment (per artifact) */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const deployment = service.getDeployment(req.params.id);
    if (!deployment) {
      res.status(404).json({ ok: false, error: "Deployment not found" });
      return;
    }
    res.json({ deployment });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || "Failed to get deployment" });
  }
});

/** GET /api/infinity/unified-deploy/:id/artifacts — per-artifact summary status */
router.get("/:id/artifacts", async (req: Request, res: Response) => {
  try {
    const deployment = service.getDeployment(req.params.id);
    if (!deployment) {
      res.status(404).json({ ok: false, error: "Deployment not found" });
      return;
    }
    res.json({
      artifacts: deployment.artifacts.map((a) => ({
        artifactId: a.artifactId,
        type: a.type,
        name: a.name,
        target: a.target,
        status: a.status,
        url: a.url,
        error: a.error,
        message: a.message,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || "Failed to get artifact statuses" });
  }
});

export default router;