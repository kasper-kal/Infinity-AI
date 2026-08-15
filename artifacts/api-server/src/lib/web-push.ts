/**
 * Web Push backend, real system notifications that arrive even when the tab
 * is closed.
 *
 * How it works (all free, no external service account needed):
 *   - The browser subscribes via PushManager using our VAPID public key.
 *   - The subscription (endpoint + keys) is stored in Postgres.
 *   - When something finishes (deep research expert ready), we send an
 *     encrypted push message to each endpoint with the `web-push` library.
 *     The browser's built-in push service (FCM/autopush/APNs) delivers it and
 *     wakes the service worker, which shows the system notification.
 *
 * The VAPID keypair is generated once and persisted in jarvis_settings, so
 * subscriptions stay valid across server restarts.
 */

import webPush from "web-push";
import { db, pushSubscriptions, jarvisSettings } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { logger } from "./logger";

const VAPID_SUBJECT = "mailto:jarvis@localhost";
const VAPID_PUBLIC_KEY = "vapid_public_key";
const VAPID_PRIVATE_KEY = "vapid_private_key";

let cachedKeys: { publicKey: string; privateKey: string } | null = null;

async function upsertSetting(key: string, value: string): Promise<void> {
  await db
    .insert(jarvisSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: jarvisSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/** Get (or lazily create + persist) the VAPID keypair and prime web-push. */
export async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cachedKeys) return cachedKeys;

  const rows = await db
    .select()
    .from(jarvisSettings)
    .where(or(eq(jarvisSettings.key, VAPID_PUBLIC_KEY), eq(jarvisSettings.key, VAPID_PRIVATE_KEY)));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  let keys = { publicKey: map[VAPID_PUBLIC_KEY] ?? "", privateKey: map[VAPID_PRIVATE_KEY] ?? "" };
  if (!keys.publicKey || !keys.privateKey) {
    keys = webPush.generateVAPIDKeys();
    await upsertSetting(VAPID_PUBLIC_KEY, keys.publicKey);
    await upsertSetting(VAPID_PRIVATE_KEY, keys.privateKey);
    logger.info("Generated + persisted a new VAPID keypair for Web Push.");
  }

  webPush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  cachedKeys = keys;
  return keys;
}

/** Public half for the browser to subscribe with. */
export async function getVapidPublicKey(): Promise<string> {
  return (await ensureVapidKeys()).publicKey;
}

/** Store (or refresh) a browser push subscription. */
export async function subscribe(
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent: string,
): Promise<void> {
  await ensureVapidKeys();
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh, auth, userAgent: userAgent.slice(0, 500) })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh, auth, userAgent: userAgent.slice(0, 500) },
    });
}

/** Remove a browser push subscription (e.g. user disabled notifications). */
export async function unsubscribe(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/**
 * Send a push notification to every stored subscription.
 * Dead subscriptions (410/404 from the push service) are pruned.
 * Never throws, the research engine calls this fire-and-forget.
 */
export async function notifyAll(title: string, body: string, url = "/"): Promise<{ sent: number; failed: number }> {
  try {
    await ensureVapidKeys();
    const rows = await db.select().from(pushSubscriptions);
    if (rows.length === 0) return { sent: 0, failed: 0 };

    const payload = JSON.stringify({ title, body, url });
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await webPush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
          { TTL: 7 * 24 * 3600, urgency: "high" },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 410 || status === 404) {
          // Subscription is gone, prune it.
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, row.endpoint)).catch(() => {});
        }
        failed += 1;
      }
    }
    logger.info({ sent, failed }, "Push notification round finished");
    return { sent, failed };
  } catch (err) {
    logger.warn({ err }, "Push notification round failed");
    return { sent: 0, failed: 0 };
  }
}
