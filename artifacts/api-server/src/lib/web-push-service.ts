/**
 * Web Push Service — VAPID-based push notifications using Web Push Protocol
 *
 * Uses the `web-push` library for VAPID authentication and push delivery.
 * Works with Service Worker push subscriptions.
 * Budget: $0 — uses free VAPID keys and browser Push API.
 */

import webPush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptions } from "@workspace/db/schema/safety-watcher.js";
import { eq, and } from "drizzle-orm";

export interface PushSubscription {
  id: string;
  projectId: string;
  userId?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PushPayload {
  projectId: string;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
  requireInteraction?: boolean;
  silent?: boolean;
  vibrate?: number[];
  timestamp?: number;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export class WebPushService {
  private vapidKeys: VapidKeys | null = null;
  private initialized = false;
  private subject: string = "mailto:safety@infinity.local";

  async initialize(projectId: string): Promise<void> {
    if (this.initialized) return;

    // Load or generate VAPID keys
    await this.loadOrGenerateVapidKeys(projectId);

    // Configure web-push library
    webPush.setVapidDetails(
      this.subject,
      this.vapidKeys!.publicKey,
      this.vapidKeys!.privateKey
    );

    this.initialized = true;
  }

  private async loadOrGenerateVapidKeys(projectId: string): Promise<void> {
    // In production, load from secure storage or environment
    // For now, generate deterministic keys per project
    const crypto = await import("crypto");

    // Generate keys from project ID (deterministic for same project)
    const hash = crypto.createHash("sha256").update(`infinity-vapid-${projectId}`).digest();
    const privateKey = hash.slice(0, 32).toString("base64url");
    const publicKey = crypto.createECDH("prime256v1");
    publicKey.setPrivateKey(Buffer.from(privateKey, "base64url"));
    const pubKey = publicKey.getPublicKey("", "compressed");

    this.vapidKeys = {
      publicKey: pubKey.toString("base64url"),
      privateKey,
    };

    // In production, you would also store the public key for the client to use
    // This could be in a config endpoint: GET /api/infinity/safety-watcher/vapid-key
  }

  getVapidPublicKey(): string {
    if (!this.vapidKeys) {
      throw new Error("WebPushService not initialized");
    }
    return this.vapidKeys.publicKey;
  }

  async subscribe(
    projectId: string,
    subscription: PushSubscription,
    userId?: string
  ): Promise<void> {
    await db.insert(pushSubscriptions).values({
      ...subscription,
      projectId,
      userId,
    }).onConflictDoUpdate({
      target: [pushSubscriptions.endpoint, pushSubscriptions.projectId],
      set: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: subscription.userAgent,
        updatedAt: new Date(),
      },
    });
  }

  async unsubscribe(projectId: string, endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(
      and(
        eq(pushSubscriptions.projectId, projectId),
        eq(pushSubscriptions.endpoint, endpoint)
      )
    );
  }

  async getSubscriptions(projectId: string, userId?: string): Promise<PushSubscription[]> {
    const where = userId
      ? and(eq(pushSubscriptions.projectId, projectId), eq(pushSubscriptions.userId, userId))
      : eq(pushSubscriptions.projectId, projectId);

    return db.select().from(pushSubscriptions).where(where);
  }

  async send(payload: PushPayload): Promise<{ success: number; failed: number; errors: string[] }> {
    if (!this.initialized) {
      throw new Error("WebPushService not initialized");
    }

    const subscriptions = await this.getSubscriptions(payload.projectId);
    const results = { success: 0, failed: 0, errors: [] as string[] };

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || "/icons/notification-icon-192.png",
      badge: payload.badge || "/icons/notification-badge-72.png",
      tag: payload.tag || "safety-notification",
      data: payload.data || {},
      actions: payload.actions,
      requireInteraction: payload.requireInteraction ?? true,
      silent: payload.silent ?? false,
      vibrate: payload.vibrate || [200, 100, 200],
      timestamp: payload.timestamp || Date.now(),
    });

    // Send to all subscriptions in parallel with concurrency limit
    const concurrency = 10;
    for (let i = 0; i < subscriptions.length; i += concurrency) {
      const batch = subscriptions.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (sub) => {
          try {
            await webPush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth,
                },
              },
              pushPayload,
              {
                vapidDetails: {
                  subject: this.subject,
                  publicKey: this.vapidKeys!.publicKey,
                  privateKey: this.vapidKeys!.privateKey,
                },
                TTL: 24 * 60 * 60, // 24 hours
              }
            );
            results.success++;
          } catch (error) {
            results.failed++;
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            results.errors.push(`Subscription ${sub.id}: ${errMsg}`);

            // Handle expired/invalid subscriptions
            if (errMsg.includes("410") || errMsg.includes("404") || errMsg.includes("expired")) {
              await this.unsubscribe(payload.projectId, sub.endpoint);
            }
          }
        })
      );
    }

    return results;
  }

  async sendToUser(projectId: string, userId: string, payload: Omit<PushPayload, "projectId">): Promise<{ success: number; failed: number }> {
    const subscriptions = await this.getSubscriptions(projectId, userId);
    let success = 0, failed = 0;

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || "/icons/notification-icon-192.png",
      badge: payload.badge || "/icons/notification-badge-72.png",
      tag: payload.tag || "safety-notification",
      data: payload.data || {},
      actions: payload.actions,
      requireInteraction: payload.requireInteraction ?? true,
      silent: payload.silent ?? false,
      vibrate: payload.vibrate || [200, 100, 200],
      timestamp: payload.timestamp || Date.now(),
    });

    for (const sub of subscriptions) {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          pushPayload,
          {
            vapidDetails: {
              subject: this.subject,
              publicKey: this.vapidKeys!.publicKey,
              privateKey: this.vapidKeys!.privateKey,
            },
            TTL: 24 * 60 * 60,
          }
        );
        success++;
      } catch (error) {
        failed++;
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        if (errMsg.includes("410") || errMsg.includes("404") || errMsg.includes("expired")) {
          await this.unsubscribe(projectId, sub.endpoint);
        }
      }
    }

    return { success, failed };
  }

  destroy(): void {
    this.vapidKeys = null;
    this.initialized = false;
  }
}

// Export singleton factory
let webPushInstance: WebPushService | null = null;

export function getWebPushService(): WebPushService {
  if (!webPushInstance) {
    webPushInstance = new WebPushService();
  }
  return webPushInstance;
}

export function resetWebPushService(): void {
  if (webPushInstance) {
    webPushInstance.destroy();
    webPushInstance = null;
  }
}