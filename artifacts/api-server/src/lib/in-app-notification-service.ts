/**
 * In-App Notification Service — Real-time notifications within the Infinity app
 *
 * Uses SSE (Server-Sent Events) for real-time delivery to connected clients.
 * Stores notifications in database for persistence and history.
 * Budget: $0 — uses existing SSE infrastructure.
 */

import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { safetyNotifications, inAppNotifications } from "@workspace/db/schema/safety-watcher.js";
import { eq, and, desc, gte, lt, sql, count } from "drizzle-orm";

export interface InAppNotification {
  id: string;
  projectId: string;
  notificationId: string;
  severity: "info" | "warning" | "critical" | "emergency";
  title: string;
  message: string;
  details?: Record<string, unknown>;
  source: string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp: Date;
  read: boolean;
  dismissed: boolean;
  createdAt: Date;
}

export interface CreateInAppNotificationParams {
  projectId: string;
  notificationId: string;
  severity: "info" | "warning" | "critical" | "emergency";
  title: string;
  message: string;
  details?: Record<string, unknown>;
  source: string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp: Date;
}

export interface NotificationQuery {
  projectId: string;
  limit?: number;
  offset?: number;
  severity?: "info" | "warning" | "critical" | "emergency";
  unreadOnly?: boolean;
  since?: Date;
}

export interface NotificationStats {
  total: number;
  unread: number;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
}

export class InAppNotificationService extends EventEmitter {
  private sseClients: Map<string, Set<any>> = new Map(); // projectId -> Set of response objects
  private initialized = false;

  async initialize(projectId: string): Promise<void> {
    this.initialized = true;
    this.emit("initialized", { projectId });
  }

  /**
   * Create a new in-app notification
   */
  async create(params: CreateInAppNotificationParams): Promise<InAppNotification> {
    const notification: InAppNotification = {
      id: crypto.randomUUID(),
      ...params,
      read: false,
      dismissed: false,
      createdAt: new Date(),
    };

    // Store in database
    await db.insert(inAppNotifications).values(notification as any);

    // Broadcast to connected SSE clients
    this.broadcastToProject(params.projectId, {
      type: "notification_created",
      notification,
    });

    this.emit("created", notification);
    return notification;
  }

  /**
   * Get notifications for a project
   */
  async getNotifications(query: NotificationQuery): Promise<InAppNotification[]> {
    let dbQuery = db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.projectId, query.projectId))
      .orderBy(desc(inAppNotifications.timestamp))
      .limit(query.limit || 100)
      .offset(query.offset || 0);

    if (query.severity) {
      dbQuery = dbQuery.where(eq(inAppNotifications.severity, query.severity));
    }

    if (query.unreadOnly) {
      dbQuery = dbQuery.where(eq(inAppNotifications.read, false));
    }

    if (query.since) {
      dbQuery = dbQuery.where(gte(inAppNotifications.timestamp, query.since));
    }

    return dbQuery;
  }

  /**
   * Mark notification as read
   */
  async markAsRead(projectId: string, notificationId: string): Promise<boolean> {
    const result = await db
      .update(inAppNotifications)
      .set({ read: true })
      .where(
        and(
          eq(inAppNotifications.projectId, projectId),
          eq(inAppNotifications.notificationId, notificationId)
        )
      );

    this.broadcastToProject(projectId, {
      type: "notification_read",
      notificationId,
    });

    return (result.rowCount || 0) > 0;
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(projectId: string, notificationIds: string[]): Promise<number> {
    if (notificationIds.length === 0) return 0;

    const result = await db
      .update(inAppNotifications)
      .set({ read: true })
      .where(
        and(
          eq(inAppNotifications.projectId, projectId),
          sql`${inAppNotifications.notificationId} IN (${notificationIds.map(() => "?").join(",")})`,
          ...notificationIds
        )
      );

    this.broadcastToProject(projectId, {
      type: "notifications_read",
      notificationIds,
    });

    return result.rowCount || 0;
  }

  /**
   * Mark all notifications as read for a project
   */
  async markAllAsRead(projectId: string): Promise<number> {
    const result = await db
      .update(inAppNotifications)
      .set({ read: true })
      .where(
        and(
          eq(inAppNotifications.projectId, projectId),
          eq(inAppNotifications.read, false)
        )
      );

    this.broadcastToProject(projectId, {
      type: "all_notifications_read",
    });

    return result.rowCount || 0;
  }

  /**
   * Dismiss a notification (hide from default view)
   */
  async dismiss(projectId: string, notificationId: string): Promise<boolean> {
    const result = await db
      .update(inAppNotifications)
      .set({ dismissed: true })
      .where(
        and(
          eq(inAppNotifications.projectId, projectId),
          eq(inAppNotifications.notificationId, notificationId)
        )
      );

    this.broadcastToProject(projectId, {
      type: "notification_dismissed",
      notificationId,
    });

    return (result.rowCount || 0) > 0;
  }

  /**
   * Delete a notification permanently
   */
  async delete(projectId: string, notificationId: string): Promise<boolean> {
    const result = await db
      .delete(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.projectId, projectId),
          eq(inAppNotifications.notificationId, notificationId)
        )
      );

    this.broadcastToProject(projectId, {
      type: "notification_deleted",
      notificationId,
    });

    return (result.rowCount || 0) > 0;
  }

  /**
   * Get notification statistics
   */
  async getStats(projectId: string, since?: Date): Promise<NotificationStats> {
    const where = since
      ? and(eq(inAppNotifications.projectId, projectId), gte(inAppNotifications.timestamp, since))
      : eq(inAppNotifications.projectId, projectId);

    const [totalResult, unreadResult, severityResult, sourceResult] = await Promise.all([
      db.select({ count: count() }).from(inAppNotifications).where(where),
      db.select({ count: count() }).from(inAppNotifications).where(
        and(where, eq(inAppNotifications.read, false))
      ),
      db
        .select({
          severity: inAppNotifications.severity,
          count: count(),
        })
        .from(inAppNotifications)
        .where(where)
        .groupBy(inAppNotifications.severity),
      db
        .select({
          source: inAppNotifications.source,
          count: count(),
        })
        .from(inAppNotifications)
        .where(where)
        .groupBy(inAppNotifications.source),
    ]);

    const bySeverity: Record<string, number> = {};
    for (const row of severityResult) {
      bySeverity[row.severity] = Number(row.count);
    }

    const bySource: Record<string, number> = {};
    for (const row of sourceResult) {
      bySource[row.source] = Number(row.count);
    }

    return {
      total: Number(totalResult[0]?.count || 0),
      unread: Number(unreadResult[0]?.count || 0),
      bySeverity,
      bySource,
    };
  }

  /**
   * Register an SSE client for real-time updates
   */
  registerSSEClient(projectId: string, response: any): void {
    if (!this.sseClients.has(projectId)) {
      this.sseClients.set(projectId, new Set());
    }
    this.sseClients.get(projectId)!.add(response);

    // Send initial connection event
    this.sendSSEEvent(response, {
      type: "connected",
      projectId,
      timestamp: new Date().toISOString(),
    });

    // Handle client disconnect
    response.on("close", () => {
      this.unregisterSSEClient(projectId, response);
    });
  }

  /**
   * Unregister an SSE client
   */
  unregisterSSEClient(projectId: string, response: any): void {
    const clients = this.sseClients.get(projectId);
    if (clients) {
      clients.delete(response);
      if (clients.size === 0) {
        this.sseClients.delete(projectId);
      }
    }
  }

  /**
   * Broadcast an event to all SSE clients for a project
   */
  broadcastToProject(projectId: string, event: any): void {
    const clients = this.sseClients.get(projectId);
    if (!clients) return;

    for (const client of clients) {
      this.sendSSEEvent(client, event);
    }
  }

  /**
   * Send an SSE event to a specific client
   */
  private sendSSEEvent(response: any, event: any): void {
    try {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      // Client likely disconnected
      console.warn("Failed to send SSE event:", error);
    }
  }

  /**
   * Get connected client count for a project
   */
  getConnectedClients(projectId: string): number {
    return this.sseClients.get(projectId)?.size || 0;
  }

  /**
   * Clean up old notifications (older than specified days)
   */
  async cleanupOldNotifications(projectId: string, daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await db
      .delete(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.projectId, projectId),
          lt(inAppNotifications.timestamp, cutoffDate)
        )
      );

    return result.rowCount || 0;
  }

  /**
   * Create a system notification (for internal events)
   */
  async createSystemNotification(
    projectId: string,
    type: "info" | "warning" | "critical" | "emergency",
    title: string,
    message: string,
    details?: Record<string, unknown>
  ): Promise<InAppNotification> {
    return this.create({
      projectId,
      notificationId: crypto.randomUUID(),
      severity: type,
      title,
      message,
      details,
      source: "system",
      timestamp: new Date(),
    });
  }

  destroy(): void {
    // Close all SSE connections
    for (const [projectId, clients] of this.sseClients) {
      for (const client of clients) {
        try {
          client.end();
        } catch {
          // Ignore errors
        }
      }
    }
    this.sseClients.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

let inAppNotificationServiceInstance: InAppNotificationService | null = null;

export function getInAppNotificationService(): InAppNotificationService {
  if (!inAppNotificationServiceInstance) {
    inAppNotificationServiceInstance = new InAppNotificationService();
  }
  return inAppNotificationServiceInstance;
}

export function resetInAppNotificationService(): void {
  if (inAppNotificationServiceInstance) {
    inAppNotificationServiceInstance.destroy();
    inAppNotificationServiceInstance = null;
  }
}