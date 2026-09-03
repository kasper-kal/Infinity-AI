import { Router, Request, Response } from "express";
import { db, projects, automations, automationRuns, automationLogs, automationSchedules, automationWebhooks, connectors } from "@workspace/db";
import { eq, and, desc, asc, lt, sql, inArray } from "drizzle-orm";
import { apiKeyAuth, requireScope } from "../../middlewares/api-key-auth";
import { logActivity } from "./project-activity";
import { logger } from "../../lib/logger";
import { AutomationRuntime } from "../../lib/automation-runtime";
import { AutomationRegistry } from "@workspace/db/src/lib/automation-registry";
import { createConnector } from "../../lib/connectors/base";
import { AutomationTriggerType, CONNECTOR_EVENTS, type AutomationTrigger, type AutomationSpec } from "../../lib/automation-parser";

const router = Router();

/** All automation routes require authentication */
router.use(apiKeyAuth);
router.use(requireScope("build:write", "project:write"));

const runtime = new AutomationRuntime();

/** GET /api/infinity/automations — List all automations for a project */
router.get("/", async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const items = await AutomationRegistry.listByProject(projectId, {
      enabled: req.query.enabled === "true" ? true : req.query.enabled === "false" ? false : undefined,
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
      tags: req.query.tags ? (req.query.tags as string).split(",") : undefined,
    });

    res.json(items);
  } catch (err) {
    logger.error({ err }, "Failed to list automations");
    res.status(500).json({ error: "Failed to list automations" });
  }
});

/** POST /api/infinity/automations — Create a new automation (from spec or natural language) */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { projectId, spec, prompt, availableConnectors } = req.body;

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    let automationSpec: AutomationSpec;

    if (prompt) {
      // Parse natural language
      const existing = await AutomationRegistry.listByProject(projectId);
      const parserResult = await AutomationRegistry.parseNaturalLanguage(prompt, {
        projectId,
        existingAutomations: existing.map(e => e.settings as any),
        availableConnectors,
      });

      if (!parserResult.spec) {
        res.status(400).json({ error: "Failed to parse natural language", clarifications: parserResult.clarifications });
        return;
      }

      automationSpec = parserResult.spec;
    } else if (spec) {
      automationSpec = spec;
    } else {
      res.status(400).json({ error: "Either spec or prompt is required" });
      return;
    }

    // Validate spec
    const validation = AutomationRegistry.validateSpec(automationSpec);
    if (!validation.valid) {
      res.status(400).json({ error: "Invalid automation spec", errors: validation.errors });
      return;
    }

    // Create automation
    const automation = await AutomationRegistry.create({
      projectId,
      name: automationSpec.settings.name,
      description: automationSpec.settings.description,
      trigger: automationSpec.trigger,
      conditions: automationSpec.conditions,
      actions: automationSpec.actions,
      settings: automationSpec.settings,
      createdBy: req.user?.id,
      tags: automationSpec.settings.tags,
    });

    // Register with runtime
    await runtime.register(automation.id, automationSpec);

    await logActivity(projectId, "agent_ran", `Created automation: ${automation.name}`);

    res.status(201).json({ automation, spec: automationSpec });
  } catch (err) {
    logger.error({ err }, "Failed to create automation");
    res.status(500).json({ error: "Failed to create automation" });
  }
});

/** GET /api/infinity/automations/stats — Get automation statistics */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const stats = await AutomationRegistry.getStats(projectId);
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "Failed to get automation stats");
    res.status(500).json({ error: "Failed to get automation stats" });
  }
});

/** GET /api/infinity/automations/:id — Get automation with spec */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const automation = await AutomationRegistry.getById(id);
    if (!automation) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    const spec = await AutomationRegistry.getSpecById(id);

    // Get recent runs
    const runs = await AutomationRegistry.listRuns(id, { limit: 10 });

    res.json({ automation, spec, recentRuns: runs });
  } catch (err) {
    logger.error({ err }, "Failed to get automation");
    res.status(500).json({ error: "Failed to get automation" });
  }
});

/** PUT /api/infinity/automations/:id — Update an automation */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { spec, prompt, availableConnectors, ...updates } = req.body;

    const existing = await AutomationRegistry.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    let automationSpec: AutomationSpec | undefined;

    if (prompt) {
      const parserResult = await AutomationRegistry.parseNaturalLanguage(prompt, {
        projectId: existing.projectId,
        existingAutomations: [existing.settings as any],
        availableConnectors,
      });
      if (!parserResult.spec) {
        res.status(400).json({ error: "Failed to parse natural language", clarifications: parserResult.clarifications });
        return;
      }
      automationSpec = parserResult.spec;
    } else if (spec) {
      automationSpec = spec;
    }

    if (automationSpec) {
      const validation = AutomationRegistry.validateSpec(automationSpec);
      if (!validation.valid) {
        res.status(400).json({ error: "Invalid automation spec", errors: validation.errors });
        return;
      }
    }

    const updated = await AutomationRegistry.update(id, {
      ...updates,
      ...(automationSpec ? {
        trigger: automationSpec.trigger,
        conditions: automationSpec.conditions,
        actions: automationSpec.actions,
        settings: automationSpec.settings,
      } : {}),
    });

    if (!updated) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    // Re-register with runtime if spec changed
    if (automationSpec) {
      await runtime.unregister(id);
      await runtime.register(id, automationSpec);
    }

    await logActivity(existing.projectId, "agent_ran", `Updated automation: ${updated.name}`);

    res.json({ automation: updated, spec: automationSpec });
  } catch (err) {
    logger.error({ err }, "Failed to update automation");
    res.status(500).json({ error: "Failed to update automation" });
  }
});

/** DELETE /api/infinity/automations/:id — Delete an automation */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await AutomationRegistry.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    await runtime.unregister(id);
    await AutomationRegistry.delete(id);

    await logActivity(existing.projectId, "agent_ran", `Deleted automation: ${existing.name}`);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete automation");
    res.status(500).json({ error: "Failed to delete automation" });
  }
});

/** POST /api/infinity/automations/:id/enable — Enable an automation */
router.post("/:id/enable", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updated = await AutomationRegistry.setEnabled(id, true);
    if (!updated) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    const spec = await AutomationRegistry.getSpecById(id);
    if (spec) {
      await runtime.register(id, spec);
    }

    res.json({ automation: updated });
  } catch (err) {
    logger.error({ err }, "Failed to enable automation");
    res.status(500).json({ error: "Failed to enable automation" });
  }
});

/** POST /api/infinity/automations/:id/disable — Disable an automation */
router.post("/:id/disable", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updated = await AutomationRegistry.setEnabled(id, false);
    if (!updated) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    await runtime.unregister(id);

    res.json({ automation: updated });
  } catch (err) {
    logger.error({ err }, "Failed to disable automation");
    res.status(500).json({ error: "Failed to disable automation" });
  }
});

/** POST /api/infinity/automations/:id/run — Manually trigger an automation */
router.post("/:id/run", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { payload, idempotencyKey } = req.body;

    const automation = await AutomationRegistry.getById(id);
    if (!automation) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    if (!automation.enabled) {
      res.status(400).json({ error: "Automation is disabled" });
      return;
    }

    const spec = await AutomationRegistry.getSpecById(id);
    if (!spec) {
      res.status(404).json({ error: "Automation spec not found" });
      return;
    }

    // Check idempotency
    if (idempotencyKey) {
      const existingRun = await AutomationRegistry.checkIdempotency(idempotencyKey);
      if (existingRun) {
        res.status(409).json({ error: "Duplicate request", runId: existingRun.id });
        return;
      }
    }

    // Create run
    const run = await AutomationRegistry.createRun({
      automationId: id,
      projectId: automation.projectId,
      triggerType: AutomationTriggerType.MANUAL,
      triggerPayload: payload,
      idempotencyKey,
    });

    // Execute asynchronously
    runtime.execute(automation.id, {
      triggerType: AutomationTriggerType.MANUAL,
      payload: payload || {},
      runId: run.id,
    }).catch(err => logger.error({ err, automationId: id }, "Automation execution failed"));

    res.status(202).json({ runId: run.id, status: "started" });
  } catch (err) {
    logger.error({ err }, "Failed to run automation");
    res.status(500).json({ error: "Failed to run automation" });
  }
});

/** GET /api/infinity/automations/:id/runs — List runs for an automation */
router.get("/:id/runs", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const automation = await AutomationRegistry.getById(id);
    if (!automation) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    const runs = await AutomationRegistry.listRuns(id, {
      status: req.query.status as string,
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
    });

    res.json(runs);
  } catch (err) {
    logger.error({ err }, "Failed to list runs");
    res.status(500).json({ error: "Failed to list runs" });
  }
});

/** GET /api/infinity/automations/:id/runs/:runId — Get run details with logs */
router.get("/:id/runs/:runId", async (req: Request, res: Response) => {
  try {
    const { id, runId } = req.params;
    const automation = await AutomationRegistry.getById(id as string);
    if (!automation) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    const run = await AutomationRegistry.getRun(runId as string);
    if (!run || run.automationId !== id) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    const logs = await AutomationRegistry.getLogsForRun(runId as string);

    res.json({ run, logs });
  } catch (err) {
    logger.error({ err }, "Failed to get run");
    res.status(500).json({ error: "Failed to get run" });
  }
});

/** GET /api/infinity/automations/:id/logs — Get recent logs for an automation */
router.get("/:id/logs", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const automation = await AutomationRegistry.getById(id);
    if (!automation) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }

    const logs = await AutomationRegistry.getRecentLogs(id, parseInt(req.query.limit as string) || 100);
    res.json(logs);
  } catch (err) {
    logger.error({ err }, "Failed to get logs");
    res.status(500).json({ error: "Failed to get logs" });
  }
});

/** POST /api/infinity/automations/validate — Validate an automation spec */
router.post("/validate", async (req: Request, res: Response) => {
  try {
    const { spec } = req.body;
    if (!spec) {
      res.status(400).json({ error: "spec is required" });
      return;
    }

    const validation = AutomationRegistry.validateSpec(spec);
    res.json(validation);
  } catch (err) {
    logger.error({ err }, "Failed to validate spec");
    res.status(500).json({ error: "Failed to validate spec" });
  }
});

/** POST /api/infinity/automations/parse — Parse natural language to automation spec */
router.post("/parse", async (req: Request, res: Response) => {
  try {
    const { prompt, projectId, availableConnectors } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    let existing: any[] = [];
    if (projectId) {
      existing = await AutomationRegistry.listByProject(projectId);
    }

    const result = await AutomationRegistry.parseNaturalLanguage(prompt, {
      projectId,
      existingAutomations: existing.map(e => e.settings as any),
      availableConnectors,
    });

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to parse natural language");
    res.status(500).json({ error: "Failed to parse natural language" });
  }
});

/** POST /api/infinity/automations/webhook/:path — Generic webhook endpoint for automations */
router.post("/webhook/:path", async (req: Request, res: Response) => {
  try {
    const path = req.params.path as string;
    const webhook = await AutomationRegistry.getWebhookByPath(`/${path}`);

    if (!webhook) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    const automation = await AutomationRegistry.getById(webhook.automationId);
    if (!automation || !automation.enabled) {
      res.status(404).json({ error: "Automation not found or disabled" });
      return;
    }

    // Verify webhook secret if configured
    if (webhook.secret) {
      const signature = req.headers["x-webhook-signature"] as string;
      // In production, verify HMAC signature
      // const expected = crypto.createHmac('sha256', webhook.secret).update(JSON.stringify(req.body)).digest('hex');
      // if (signature !== expected) { res.status(401).json({ error: "Invalid signature" }); return; }
    }

    // Apply filter if configured
    if (webhook.filter) {
      // In production, evaluate filter expression against req.body
    }

    // Create run with idempotency key
    const idempotencyKey = `webhook-${path}-${req.headers["x-request-id"] || Date.now()}-${Math.random().toString(36).slice(2)}`;

    const existingRun = await AutomationRegistry.checkIdempotency(idempotencyKey);
    if (existingRun) {
      res.status(409).json({ error: "Duplicate request", runId: existingRun.id });
      return;
    }

    const run = await AutomationRegistry.createRun({
      automationId: automation.id,
      projectId: automation.projectId,
      triggerType: AutomationTriggerType.WEBHOOK,
      triggerPayload: req.body,
      idempotencyKey,
    });

    const spec = await AutomationRegistry.getSpecById(automation.id);
    if (spec) {
      runtime.execute(automation.id, {
        triggerType: AutomationTriggerType.WEBHOOK,
        payload: req.body,
        runId: run.id,
      }).catch(err => logger.error({ err, automationId: automation.id }, "Webhook automation execution failed"));
    }

    res.status(202).json({ runId: run.id, status: "started" });
  } catch (err) {
    logger.error({ err }, "Webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** Connector Event Webhooks — These receive events from connected services and trigger automations */

/** POST /api/infinity/automations/connector/linear — Linear webhook events */
router.post("/connector/linear", async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const projectId = req.query.projectId as string;

    // Verify signature if needed
    const signature = req.headers["linear-signature"] as string;

    logger.info({ action: payload.action, type: payload.type, projectId }, "Linear webhook received");

    // Find matching automations
    await triggerConnectorEventAutomations("linear", payload.action, payload, projectId);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Linear connector webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** POST /api/infinity/automations/connector/slack — Slack webhook events */
router.post("/connector/slack", async (req: Request, res: Response) => {
  try {
    const { type, challenge, event } = req.body;
    const projectId = req.query.projectId as string;

    // URL verification challenge
    if (type === "url_verification") {
      res.json({ challenge });
      return;
    }

    // Event callback
    if (type === "event_callback" && event) {
      logger.info({ eventType: event.type, projectId }, "Slack event received");
      await triggerConnectorEventAutomations("slack", event.type, event, projectId);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Slack connector webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** POST /api/infinity/automations/connector/notion — Notion webhook events */
router.post("/connector/notion", async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const projectId = req.query.projectId as string;

    const signature = req.headers["notion-signature"] as string;

    logger.info({ type: payload.type, projectId }, "Notion webhook received");

    await triggerConnectorEventAutomations("notion", payload.type, payload, projectId);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Notion connector webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** POST /api/infinity/automations/connector/google-sheets — Google Sheets webhook events */
router.post("/connector/google-sheets", async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const projectId = req.query.projectId as string;

    logger.info({ resourceId: payload.resourceId, projectId }, "Google Sheets webhook received");

    // Google sends channel notifications, need to fetch actual changes
    // For now, trigger with generic event
    await triggerConnectorEventAutomations("google-sheets", "resource_changed", payload, projectId);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Google Sheets connector webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** POST /api/infinity/automations/connector/github — GitHub webhook events */
router.post("/connector/github", async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const eventType = req.headers["x-github-event"] as string;
    const projectId = req.query.projectId as string;

    const signature = req.headers["x-hub-signature-256"] as string;

    logger.info({ eventType, projectId }, "GitHub webhook received");

    await triggerConnectorEventAutomations("github", eventType, payload, projectId);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "GitHub connector webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** POST /api/infinity/automations/connector/custom — Custom webhook events */
router.post("/connector/custom", async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const projectId = req.query.projectId as string;
    const eventType = req.headers["x-event-type"] as string || "webhook.received";

    logger.info({ eventType, projectId }, "Custom connector webhook received");

    await triggerConnectorEventAutomations("custom", eventType, payload, projectId);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Custom connector webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/**
 * Trigger automations that listen for connector events
 */
async function triggerConnectorEventAutomations(
  platform: string,
  eventType: string,
  payload: any,
  projectId?: string
): Promise<void> {
  try {
    // Build query conditions
    const conditions = [
      eq(automations.enabled, true),
      eq(sql`${automations.trigger}->>'type'`, AutomationTriggerType.CONNECTOR_EVENT),
      eq(sql`${automations.trigger}->>'connectorId'`, platform),
      eq(sql`${automations.trigger}->>'connectorEvent'`, eventType),
    ];

    if (projectId) {
      conditions.push(eq(automations.projectId, projectId));
    }

    const matchingAutomations = await db
      .select()
      .from(automations)
      .where(and(...conditions));

    for (const automation of matchingAutomations) {
      // Check idempotency
      const idempotencyKey = `${platform}-${eventType}-${payload.id || payload.event_id || Date.now()}`;
      const existingRun = await AutomationRegistry.checkIdempotency(idempotencyKey);
      if (existingRun) {
        logger.info({ automationId: automation.id, idempotencyKey }, "Skipping duplicate event");
        continue;
      }

      const spec = await AutomationRegistry.getSpecById(automation.id);
      if (!spec) continue;

      const run = await AutomationRegistry.createRun({
        automationId: automation.id,
        projectId: automation.projectId,
        triggerType: AutomationTriggerType.CONNECTOR_EVENT,
        triggerPayload: payload,
        idempotencyKey,
      });

      runtime.execute(automation.id, {
        triggerType: AutomationTriggerType.CONNECTOR_EVENT,
        payload,
        runId: run.id,
      }).catch(err => logger.error({ err, automationId: automation.id }, "Connector event automation execution failed"));
    }
  } catch (err) {
    logger.error({ err, platform, eventType }, "Failed to trigger connector event automations");
  }
}

/** POST /api/infinity/automations/cron/tick — Cron scheduler tick (called by external scheduler) */
router.post("/cron/tick", async (req: Request, res: Response) => {
  try {
    const dueAutomations = await AutomationRegistry.getDueAutomations(100);

    for (const schedule of dueAutomations) {
      const automation = await AutomationRegistry.getById(schedule.automationId);
      if (!automation || !automation.enabled) {
        await AutomationRegistry.updateScheduleAfterRun(schedule.automationId);
        continue;
      }

      const spec = await AutomationRegistry.getSpecById(automation.id);
      if (!spec) continue;

      const idempotencyKey = `cron-${schedule.cronExpression?.replace(/[^a-z0-9]/g, "-")}-${schedule.nextRunAt.toISOString()}`;
      const existingRun = await AutomationRegistry.checkIdempotency(idempotencyKey);
      if (existingRun) {
        await AutomationRegistry.updateScheduleAfterRun(schedule.automationId);
        continue;
      }

      const run = await AutomationRegistry.createRun({
        automationId: automation.id,
        projectId: automation.projectId,
        triggerType: AutomationTriggerType.CRON,
        triggerPayload: { scheduledAt: schedule.nextRunAt.toISOString() },
        idempotencyKey,
      });

      runtime.execute(automation.id, {
        triggerType: AutomationTriggerType.CRON,
        payload: { scheduledAt: schedule.nextRunAt.toISOString() },
        runId: run.id,
      }).catch(err => logger.error({ err, automationId: automation.id }, "Cron automation execution failed"));

      await AutomationRegistry.updateScheduleAfterRun(schedule.automationId);
    }

    res.json({ processed: dueAutomations.length });
  } catch (err) {
    logger.error({ err }, "Cron tick error");
    res.status(500).json({ error: "Cron tick error" });
  }
});

export default router;