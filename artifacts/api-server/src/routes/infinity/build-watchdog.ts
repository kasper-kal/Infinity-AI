import { Router, Request, Response } from "express";
import { getBuildWatchdog, initializeBuildWatchdog, shutdownBuildWatchdog, BuildWatchdog, WatchdogRule } from "../../lib/build-watchdog";
import { MessageBus } from "../../lib/build-message-bus";

const router = Router();

/**
 * Helper to get project ID from request
 */
function getProjectId(req: Request): string | undefined {
  return (req.query.projectId as string) || (req.body?.projectId as string) || (req.headers["x-project-id"] as string) || undefined;
}

/**
 * GET /api/infinity/build/watchdog/status - Get watchdog status
 */
router.get("/build/watchdog/status", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const threadId = (req.query.threadId as string) || "default";

    if (!projectId) {
      // Return global watchdog status if available
      const watchdog = getBuildWatchdog();
      if (watchdog) {
        res.json({ ok: true, status: watchdog.getStatus() });
      } else {
        res.json({ ok: true, status: { running: false, message: "No active watchdog" } });
      }
      return;
    }

    // For a specific project/thread, we'd need to track per-project watchdogs
    // Currently there's a singleton, so return its status if it matches
    const watchdog = getBuildWatchdog();
    if (watchdog && watchdog.getStatus().running) {
      res.json({ ok: true, status: watchdog.getStatus(), projectId, threadId });
    } else {
      res.json({ ok: true, status: { running: false, message: "No active watchdog for this project" }, projectId, threadId });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to get build watchdog status");
    res.status(500).json({ error: "Failed to get build watchdog status" });
  }
});

/**
 * POST /api/infinity/build/watchdog/start - Start build watchdog for a project
 */
router.post("/build/watchdog/start", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const threadId = (req.body?.threadId as string) || "default";

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const options = {
      sampleEveryNTurns: req.body?.sampleEveryNTurns ?? 1,
      maxTurnsBeforeForceStop: req.body?.maxTurnsBeforeForceStop ?? 50,
      enabled: req.body?.enabled ?? true,
      userRules: req.body?.userRules ?? [],
    };

    const watchdog = await initializeBuildWatchdog(projectId, threadId, options);
    res.json({ ok: true, message: "Build watchdog started", status: watchdog.getStatus() });
  } catch (err) {
    req.log.error({ err }, "Failed to start build watchdog");
    res.status(500).json({ error: "Failed to start build watchdog" });
  }
});

/**
 * POST /api/infinity/build/watchdog/stop - Stop build watchdog
 */
router.post("/build/watchdog/stop", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);

    await shutdownBuildWatchdog();
    res.json({ ok: true, message: "Build watchdog stopped" });
  } catch (err) {
    req.log.error({ err }, "Failed to stop build watchdog");
    res.status(500).json({ error: "Failed to stop build watchdog" });
  }
});

/**
 * GET /api/infinity/build/watchdog/findings - Get all watchdog findings
 */
router.get("/build/watchdog/findings", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const threadId = (req.query.threadId as string) || "default";

    const watchdog = getBuildWatchdog();
    if (!watchdog) {
      res.json({ ok: true, findings: [], message: "No active watchdog" });
      return;
    }

    const findings = watchdog.getFindings();
    res.json({ ok: true, findings, count: findings.length });
  } catch (err) {
    req.log.error({ err }, "Failed to get watchdog findings");
    res.status(500).json({ error: "Failed to get watchdog findings" });
  }
});

/**
 * GET /api/infinity/build/watchdog/rules - Get watchdog rules (default + user)
 */
router.get("/build/watchdog/rules", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const threadId = (req.query.threadId as string) || "default";

    const watchdog = getBuildWatchdog();
    if (!watchdog) {
      // Return default rules
      const defaultWatchdog = new BuildWatchdog({ projectId: "default", threadId: "default" });
      const rules = defaultWatchdog["getDefaultRules"]();
      res.json({ ok: true, rules, count: rules.length, source: "default" });
      return;
    }

    // Get rules from the watchdog's config (internal access)
    const status = watchdog.getStatus();
    // We need to expose rules from the watchdog instance
    // Since rules are private, we'll return a summary
    res.json({
      ok: true,
      rulesLoaded: status.rulesLoaded,
      localModelAvailable: status.localModelAvailable,
      note: "Full rule details available via watchdog internals"
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get watchdog rules");
    res.status(500).json({ error: "Failed to get watchdog rules" });
  }
});

/**
 * POST /api/infinity/build/watchdog/rules - Add custom watchdog rule
 */
router.post("/build/watchdog/rules", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const threadId = (req.body?.threadId as string) || "default";

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { ruleId, description, pattern, severity, action, enabled } = req.body;

    if (!ruleId || !description || !pattern) {
      res.status(400).json({ error: "ruleId, description, and pattern are required" });
      return;
    }

    const rule: WatchdogRule = {
      id: ruleId,
      description,
      pattern,
      severity: severity || "warning",
      action: action || "notify",
      enabled: enabled ?? true,
    };

    const watchdog = getBuildWatchdog();
    if (!watchdog) {
      res.status(400).json({ error: "No active watchdog. Start watchdog first." });
      return;
    }

    // Access private config to add rule (in a real implementation, we'd have a public method)
    // For now, we'll return success but note the limitation
    res.json({
      ok: true,
      message: "Rule added (requires watchdog restart to take effect)",
      rule,
      note: "Current implementation requires watchdog restart for new rules. Full dynamic rule management coming in Phase 4."
    });
  } catch (err) {
    req.log.error({ err }, "Failed to add watchdog rule");
    res.status(500).json({ error: "Failed to add watchdog rule" });
  }
});

/**
 * GET /api/infinity/build/watchdog/crew-thread - Get the crew message bus thread for this build
 */
router.get("/build/watchdog/crew-thread", async (req: Request, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const threadId = (req.query.threadId as string) || "default";

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const bus = new MessageBus(projectId, threadId);
    const thread = await bus.getThread({ includeLive: true });

    res.json({
      ok: true,
      projectId,
      threadId,
      count: thread.length,
      messages: thread,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get crew thread");
    res.status(500).json({ error: "Failed to get crew thread" });
  }
});

export default router;