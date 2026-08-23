/**
 * Web Push helper, registers the service worker and subscribes this browser
 * to real system notifications (they arrive even when the tab is closed).
 *
 * Safe to call anywhere: returns false (no throw) when unsupported, denied,
 * or the server is unreachable. Requires a secure (HTTPS) origin or localhost.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Ensure this browser is subscribed for push notifications.
 * - Requests permission if not yet decided (call from a user gesture).
 * - Registers /sw.js, subscribes with the server's VAPID key, stores the
 *   subscription server-side.
 * Returns true when subscribed (or already subscribed).
 */
export async function ensurePushSubscription(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (typeof Notification === 'undefined') return false;

    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const res = await fetch('/api/jarvis/push/vapid-key');
      if (!res.ok) return false;
      const { publicKey } = (await res.json()) as { publicKey?: string };
      if (!publicKey) return false;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const p256dh = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');
    if (!p256dh || !auth) return false;

    const res = await fetch('/api/jarvis/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64(p256dh),
        auth: arrayBufferToBase64(auth),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
