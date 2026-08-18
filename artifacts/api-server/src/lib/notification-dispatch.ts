import { db, connectors } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createConnector } from "./connectors/base";
import { logger } from "./logger";

/** Send notification to all enabled connectors for a project/event */
export async function dispatchNotification(
  projectId: string,
  eventType: string,
  title: string,
  body: string,
  options?: { url?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  try {
    const projectConnectors = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), eq(connectors.enabled, true)));

    const notifyOn = ["build_completed", "build_failed", "research_completed", "scheduled_job_failed", "deployment_completed", "deployment_failed"];

    for (const connectorRecord of projectConnectors) {
      const notifyEvents = connectorRecord.notifyOn as string[] | undefined;
      const shouldNotify = notifyEvents?.includes(eventType) || notifyEvents?.includes("*");
      if (!shouldNotify) continue;

      try {
        const connector = await createConnector(
          connectorRecord.platform,
          connectorRecord.config as Record<string, any>,
          connectorRecord.projectId,
          connectorRecord.id
        );

        await connector.sendNotification({
          eventType,
          title,
          body,
          url: options?.url,
          metadata: { ...options?.metadata, projectId },
        });
      } catch (err) {
        logger.error({ err, connectorId: connectorRecord.id }, "Failed to send notification via connector");
      }
    }
  } catch (err) {
    logger.error({ err, projectId, eventType }, "Failed to dispatch notifications");
  }
}