import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  safetyRules,
  notificationChannels,
  safetyNotifications,
  inAppNotifications,
  pushSubscriptions,
  safetyWatcherSettings,
  projects,
} from "@workspace/db/schema/safety-watcher.js";
import { eq, and, desc, gte, count, sql, or, lt } from "drizzle-orm";
import { buildErrorDetail } from "../../lib/error-detail";
import { getSafetyWatcher } from "../../lib/safety-watcher";
import { getInAppNotificationService } from "../../lib/in-app-notification-service";
import { getWebPushService } from "../../lib/web-push-service";
import { getEmailService } from "../../lib/email-service";
import { getWebhookService } from "../../lib/webhook-service";

const router = Router();

/**
 * Helper to get project ID from request (query param or header)
 */
function getProjectId(req: Request): string | undefined {
  return (req.query.projectId as string) || (req.headers["x-project-id"] as string) || undefined;
}

/**
 * GET /api/infinity/safety-watcher/status - Get safety watcher status
 */
router.get("/safety-watcher/status", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    const watcher = getSafetyWatcher({ projectId });
    const status = watcher.getStatus();

    res.json({ ok: true, status });
  } catch (err) {
    req.log.error({ err }, "Failed to get safety watcher status");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get safety watcher status", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/start - Start safety watcher
 */
router.post("/safety-watcher/start", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    const watcher = getSafetyWatcher({ projectId });
    await watcher.start();
    res.json({ ok: true, message: "Safety watcher started" });
  } catch (err) {
    req.log.error({ err }, "Failed to start safety watcher");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to start safety watcher", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/stop - Stop safety watcher
 */
router.post("/safety-watcher/stop", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    const watcher = getSafetyWatcher({ projectId });
    await watcher.stop();
    res.json({ ok: true, message: "Safety watcher stopped" });
  } catch (err) {
    req.log.error({ err }, "Failed to stop safety watcher");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to stop safety watcher", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/config - Get safety watcher configuration
 */
router.get("/safety-watcher/config", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      const watcher = getSafetyWatcher();
      res.json({ ok: true, config: watcher.getConfig() });
      return;
    }

    const settings = await db
      .select()
      .from(safetyWatcherSettings)
      .where(eq(safetyWatcherSettings.projectId, projectId))
      .limit(1);

    if (settings.length === 0) {
      // Return default config
      const watcher = getSafetyWatcher({ projectId });
      res.json({ ok: true, config: watcher.getConfig() });
      return;
    }

    const config = settings[0];
    res.json({ ok: true, config });
  } catch (err) {
    req.log.error({ err }, "Failed to get safety watcher config");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get safety watcher config", detail });
  }
});

/**
 * PUT /api/infinity/safety-watcher/config - Update safety watcher configuration
 */
router.put("/safety-watcher/config", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const config = req.body as any;
    const updateData = {
      ...config,
      projectId,
      updatedAt: new Date(),
    };

    await db
      .insert(safetyWatcherSettings)
      .values(updateData as any)
      .onConflictDoUpdate({
        target: safetyWatcherSettings.projectId,
        set: { ...updateData, updatedAt: new Date() },
      });

    // Update in-memory watcher
    const watcher = getSafetyWatcher({ projectId });
    watcher.updateConfig(config);

    res.json({ ok: true, message: "Configuration updated" });
  } catch (err) {
    req.log.error({ err }, "Failed to update safety watcher config");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to update safety watcher config", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/rules - Get all safety rules for a project
 */
router.get("/safety-watcher/rules", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const rules = await db
      .select()
      .from(safetyRules)
      .where(eq(safetyRules.projectId, projectId))
      .orderBy(safetyRules.ruleId);

    res.json({ ok: true, rules });
  } catch (err) {
    req.log.error({ err }, "Failed to get safety rules");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get safety rules", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/rules - Create or update a safety rule
 */
router.post("/safety-watcher/rules", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { ruleId, name, description, enabled, severity, action, config, cooldownMs, tags } = req.body;

    if (!ruleId || !name) {
      res.status(400).json({ error: "ruleId and name are required" });
      return;
    }

    const ruleData = {
      projectId,
      ruleId,
      name,
      description,
      enabled: enabled ?? true,
      severity: severity || "warning",
      action: action || "notify",
      config: config || {},
      cooldownMs: cooldownMs || 300000,
      tags: tags || [],
      updatedAt: new Date(),
    };

    await db
      .insert(safetyRules)
      .values(ruleData as any)
      .onConflictDoUpdate({
        target: [safetyRules.projectId, safetyRules.ruleId],
        set: { ...ruleData, updatedAt: new Date() },
      });

    // Update in-memory watcher
    const watcher = getSafetyWatcher({ projectId });
    watcher.updateRule(ruleId, ruleData);

    res.json({ ok: true, message: "Rule saved" });
  } catch (err) {
    req.log.error({ err }, "Failed to save safety rule");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to save safety rule", detail });
  }
});

/**
 * DELETE /api/infinity/safety-watcher/rules/:ruleId - Delete a safety rule
 */
router.delete("/safety-watcher/rules/:ruleId", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { ruleId } = req.params;

    await db
      .delete(safetyRules)
      .where(and(eq(safetyRules.projectId, projectId), eq(safetyRules.ruleId, ruleId)));

    res.json({ ok: true, message: "Rule deleted" });
  } catch (err) {
    req.log.error({ err }, "Failed to delete safety rule");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to delete safety rule", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/channels - Get notification channels for a project
 */
router.get("/safety-watcher/channels", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const channels = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.projectId, projectId))
      .orderBy(notificationChannels.type);

    // Mask sensitive config values
    const maskedChannels = channels.map((ch) => ({
      ...ch,
      config: maskSensitiveConfig(ch.config),
    }));

    res.json({ ok: true, channels: maskedChannels });
  } catch (err) {
    req.log.error({ err }, "Failed to get notification channels");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get notification channels", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/channels - Create or update a notification channel
 */
router.post("/safety-watcher/channels", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { id, type, name, config, enabled, severityFilter, quietHoursEnabled, quietHoursStart, quietHoursEnd, quietHoursTimezone } = req.body;

    if (!type || !name) {
      res.status(400).json({ error: "type and name are required" });
      return;
    }

    const channelData = {
      id: id || undefined,
      projectId,
      type,
      name,
      config: config || {},
      enabled: enabled ?? true,
      severityFilter: severityFilter || ["warning", "critical", "emergency"],
      quietHoursEnabled: quietHoursEnabled ?? true,
      quietHoursStart: quietHoursStart || "22:00",
      quietHoursEnd: quietHoursEnd || "08:00",
      quietHoursTimezone: quietHoursTimezone || "UTC",
      updatedAt: new Date(),
    };

    let result;
    if (id) {
      result = await db
        .update(notificationChannels)
        .set({ ...channelData, updatedAt: new Date() })
        .where(and(eq(notificationChannels.projectId, projectId), eq(notificationChannels.id, id)));
    } else {
      result = await db.insert(notificationChannels).values(channelData as any);
    }

    res.json({ ok: true, message: id ? "Channel updated" : "Channel created" });
  } catch (err) {
    req.log.error({ err }, "Failed to save notification channel");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to save notification channel", detail });
  }
});

/**
 * DELETE /api/infinity/safety-watcher/channels/:channelId - Delete a notification channel
 */
router.delete("/safety-watcher/channels/:channelId", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { channelId } = req.params;

    await db
      .delete(notificationChannels)
      .where(and(eq(notificationChannels.projectId, projectId), eq(notificationChannels.id, channelId)));

    res.json({ ok: true, message: "Channel deleted" });
  } catch (err) {
    req.log.error({ err }, "Failed to delete notification channel");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to delete notification channel", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/channels/:channelId/test - Send test notification to a channel
 */
router.post("/safety-watcher/channels/:channelId/test", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { channelId } = req.params;

    const channel = await db
      .select()
      .from(notificationChannels)
      .where(and(eq(notificationChannels.projectId, projectId), eq(notificationChannels.id, channelId)))
      .limit(1);

    if (channel.length === 0) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const ch = channel[0];
    const testPayload = {
      test: true,
      source: "safety-watcher",
      timestamp: new Date().toISOString(),
      message: "This is a test notification from Infinity Safety Watcher",
      severity: "info",
    };

    let result: { success: boolean; error?: string; provider?: string } = { success: false };

    switch (ch.type) {
      case "webpush": {
        const webPushService = getWebPushService();
        try {
          await webPushService.sendNotification(projectId, {
            title: "🧪 Test Notification",
            body: testPayload.message,
            url: "/safety",
          });
          result = { success: true, provider: "webpush" };
        } catch (e) {
          result = { success: false, error: e instanceof Error ? e.message : "Web Push failed", provider: "webpush" };
        }
        break;
      }
      case "email": {
        const emailService = getEmailService();
        await emailService.initialize(projectId, ch.config);
        const emailResult = await emailService.send({
          to: ch.config.to || "test@example.com",
          subject: "[TEST] Safety Watcher Notification",
          html: `<p>${testPayload.message}</p>`,
          text: testPayload.message,
        });
        result = { success: emailResult.success, error: emailResult.error, provider: emailResult.provider };
        break;
      }
      case "slack": {
        const webhookService = getWebhookService();
        const slackResult = await webhookService.sendSlack(ch.config.webhookUrl, {
          text: testPayload.message,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*🧪 Test Notification from Safety Watcher*\n${testPayload.message}`,
              },
            },
          ],
        });
        result = { success: slackResult.success, error: slackResult.error, provider: "slack" };
        break;
      }
      case "discord": {
        const webhookService = getWebhookService();
        const discordResult = await webhookService.sendDiscord(ch.config.webhookUrl, {
          content: testPayload.message,
          embeds: [
            {
              title: "🧪 Test Notification",
              description: testPayload.message,
              color: 0x0ea5e9,
              timestamp: new Date().toISOString(),
            },
          ],
        });
        result = { success: discordResult.success, error: discordResult.error, provider: "discord" };
        break;
      }
      case "webhook": {
        const webhookService = getWebhookService();
        const webhookResult = await webhookService.send(ch.config, testPayload);
        result = { success: webhookResult.success, error: webhookResult.error, provider: "webhook" };
        break;
      }
      case "inapp": {
        const inAppService = getInAppNotificationService();
        await inAppService.initialize(projectId);
        await inAppService.createSystemNotification(projectId, "info", "Test Notification", testPayload.message);
        result = { success: true, provider: "inapp" };
        break;
      }
      default:
        result = { success: false, error: `Unknown channel type: ${ch.type}`, provider: ch.type };
    }

    res.json({ ok: true, result });
  } catch (err) {
    req.log.error({ err }, "Failed to send test notification");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to send test notification", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/notifications - Get safety notification history
 */
router.get("/safety-watcher/notifications", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const severity = req.query.severity as string;
    const status = req.query.status as string;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;

    let query = db
      .select()
      .from(safetyNotifications)
      .where(eq(safetyNotifications.projectId, projectId))
      .orderBy(desc(safetyNotifications.timestamp))
      .limit(limit)
      .offset(offset);

    if (severity) {
      query = query.where(eq(safetyNotifications.severity, severity));
    }
    if (status) {
      query = query.where(eq(safetyNotifications.status, status));
    }
    if (since) {
      query = query.where(gte(safetyNotifications.timestamp, since));
    }

    const notifications = await query;

    // Get total count for pagination
    const totalResult = await db
      .select({ count: count() })
      .from(safetyNotifications)
      .where(eq(safetyNotifications.projectId, projectId));

    res.json({
      ok: true,
      notifications,
      pagination: {
        limit,
        offset,
        total: Number(totalResult[0]?.count || 0),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get safety notifications");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get safety notifications", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/notifications/stats - Get notification statistics
 */
router.get("/safety-watcher/notifications/stats", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalResult, bySeverity, byStatus, byChannel, bySource] = await Promise.all([
      db.select({ count: count() }).from(safetyNotifications).where(
        and(eq(safetyNotifications.projectId, projectId), gte(safetyNotifications.timestamp, since))
      ),
      db
        .select({ severity: safetyNotifications.severity, count: count() })
        .from(safetyNotifications)
        .where(and(eq(safetyNotifications.projectId, projectId), gte(safetyNotifications.timestamp, since)))
        .groupBy(safetyNotifications.severity),
      db
        .select({ status: safetyNotifications.status, count: count() })
        .from(safetyNotifications)
        .where(and(eq(safetyNotifications.projectId, projectId), gte(safetyNotifications.timestamp, since)))
        .groupBy(safetyNotifications.status),
      db
        .select({ channel: safetyNotifications.channel, count: count() })
        .from(safetyNotifications)
        .where(and(eq(safetyNotifications.projectId, projectId), gte(safetyNotifications.timestamp, since)))
        .groupBy(safetyNotifications.channel),
      db
        .select({ source: safetyNotifications.source, count: count() })
        .from(safetyNotifications)
        .where(and(eq(safetyNotifications.projectId, projectId), gte(safetyNotifications.timestamp, since)))
        .groupBy(safetyNotifications.source),
    ]);

    const stats = {
      total: Number(totalResult[0]?.count || 0),
      bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, Number(r.count)])),
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.count)])),
      byChannel: Object.fromEntries(byChannel.map((r) => [r.channel, Number(r.count)])),
      bySource: Object.fromEntries(bySource.map((r) => [r.source, Number(r.count)])),
    };

    res.json({ ok: true, stats });
  } catch (err) {
    req.log.error({ err }, "Failed to get notification stats");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get notification stats", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/in-app - Get in-app notifications
 */
router.get("/safety-watcher/in-app", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const severity = req.query.severity as string;
    const unreadOnly = req.query.unreadOnly === "true";
    const since = req.query.since ? new Date(req.query.since as string) : undefined;

    const inAppService = getInAppNotificationService();
    await inAppService.initialize(projectId);

    const notifications = await inAppService.getNotifications({
      projectId,
      limit,
      offset,
      severity: severity as any,
      unreadOnly,
      since,
    });

    const stats = await inAppService.getStats(projectId, since);

    res.json({ ok: true, notifications, stats });
  } catch (err) {
    req.log.error({ err }, "Failed to get in-app notifications");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get in-app notifications", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/in-app/:notificationId/read - Mark in-app notification as read
 */
router.post("/safety-watcher/in-app/:notificationId/read", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { notificationId } = req.params;

    const inAppService = getInAppNotificationService();
    await inAppService.initialize(projectId);

    const success = await inAppService.markAsRead(projectId, notificationId);

    res.json({ ok: true, success });
  } catch (err) {
    req.log.error({ err }, "Failed to mark notification as read");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to mark notification as read", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/in-app/read-all - Mark all in-app notifications as read
 */
router.post("/safety-watcher/in-app/read-all", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const inAppService = getInAppNotificationService();
    await inAppService.initialize(projectId);

    const count = await inAppService.markAllAsRead(projectId);

    res.json({ ok: true, count });
  } catch (err) {
    req.log.error({ err }, "Failed to mark all notifications as read");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to mark all notifications as read", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/in-app/:notificationId/dismiss - Dismiss in-app notification
 */
router.post("/safety-watcher/in-app/:notificationId/dismiss", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { notificationId } = req.params;

    const inAppService = getInAppNotificationService();
    await inAppService.initialize(projectId);

    const success = await inAppService.dismiss(projectId, notificationId);

    res.json({ ok: true, success });
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss notification");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to dismiss notification", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/push-subscriptions - Get push subscriptions
 */
router.get("/safety-watcher/push-subscriptions", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.projectId, projectId))
      .orderBy(desc(pushSubscriptions.createdAt));

    // Mask sensitive keys
    const masked = subscriptions.map((sub) => ({
      ...sub,
      p256dh: maskString(sub.p256dh),
      auth: maskString(sub.auth),
    }));

    res.json({ ok: true, subscriptions: masked });
  } catch (err) {
    req.log.error({ err }, "Failed to get push subscriptions");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get push subscriptions", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/push-subscriptions - Register a push subscription
 */
router.post("/safety-watcher/push-subscriptions", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { endpoint, p256dh, auth, userAgent, userId } = req.body;

    if (!endpoint || !p256dh || !auth) {
      res.status(400).json({ error: "endpoint, p256dh, and auth are required" });
      return;
    }

    await db
      .insert(pushSubscriptions)
      .values({
        projectId,
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent,
        updatedAt: new Date(),
      } as any)
      .onConflictDoUpdate({
        target: [pushSubscriptions.projectId, pushSubscriptions.endpoint],
        set: { p256dh, auth, userAgent, updatedAt: new Date() },
      });

    res.json({ ok: true, message: "Push subscription registered" });
  } catch (err) {
    req.log.error({ err }, "Failed to register push subscription");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to register push subscription", detail });
  }
});

/**
 * DELETE /api/infinity/safety-watcher/push-subscriptions/:endpoint - Unregister a push subscription
 */
router.delete("/safety-watcher/push-subscriptions/:endpoint", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const endpoint = decodeURIComponent(req.params.endpoint);

    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.projectId, projectId), eq(pushSubscriptions.endpoint, endpoint)));

    res.json({ ok: true, message: "Push subscription removed" });
  } catch (err) {
    req.log.error({ err }, "Failed to remove push subscription");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to remove push subscription", detail });
  }
});

/**
 * GET /api/infinity/safety-watcher/vapid-public-key - Get VAPID public key for Web Push
 */
router.get("/safety-watcher/vapid-public-key", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const webPushService = getWebPushService();
    const publicKey = webPushService.getPublicKey();
    res.json({ ok: true, publicKey });
  } catch (err) {
    req.log.error({ err }, "Failed to get VAPID public key");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to get VAPID public key", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/test-finding - Create a test safety finding
 */
router.post("/safety-watcher/test-finding", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const { ruleId = "test_rule", severity = "warning", title = "Test Finding", description = "This is a test finding" } = req.body;

    const watcher = getSafetyWatcher({ projectId });

    // Emit a test event that will trigger the rule
    await watcher.emitEvent({
      id: `test-${Date.now()}`,
      timestamp: new Date(),
      source: "test",
      type: "test:finding",
      payload: {
        ruleId,
        severity,
        title,
        description,
        taskId: "test-task",
      },
    });

    res.json({ ok: true, message: "Test finding event emitted" });
  } catch (err) {
    req.log.error({ err }, "Failed to create test finding");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to create test finding", detail });
  }
});

/**
 * POST /api/infinity/safety-watcher/cleanup - Clean up old notifications
 */
router.post("/safety-watcher/cleanup", async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const projectId = getProjectId(req);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const days = parseInt(req.body.days as string) || 30;

    const inAppService = getInAppNotificationService();
    await inAppService.initialize(projectId);

    const deletedCount = await inAppService.cleanupOldNotifications(projectId, days);

    res.json({ ok: true, deletedCount });
  } catch (err) {
    req.log.error({ err }, "Failed to cleanup notifications");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to cleanup notifications", detail });
  }
});

/**
 * Helper: Mask sensitive string for logging/display
 */
function maskString(str: string): string {
  if (str.length <= 8) return "***";
  return str.slice(0, 4) + "***" + str.slice(-4);
}

/**
 * Helper: Mask sensitive config values
 */
function maskSensitiveConfig(config: Record<string, any>): Record<string, any> {
  const masked = { ...config };
  const sensitiveKeys = ["apiKey", "secret", "token", "password", "key", "auth", "p256dh"];

  for (const key of Object.keys(masked)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      masked[key] = "***";
    }
  }
  return masked;
}

export default router;