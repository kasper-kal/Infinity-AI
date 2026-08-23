import { Router } from "express";
import { getVapidPublicKey, subscribe, unsubscribe } from "../../lib/web-push";

const router = Router();

/** The VAPID public key the browser needs to create a push subscription. */
router.get("/push/vapid-key", async (req, res) => {
  try {
    const publicKey = await getVapidPublicKey();
    res.json({ publicKey });
  } catch (err) {
    req.log.error({ err }, "Failed to get VAPID public key");
    res.status(500).json({ error: "Failed to get VAPID public key" });
  }
});

/** Store a browser push subscription so we can notify this device. */
router.post("/push/subscribe", async (req, res) => {
  try {
    const { endpoint, p256dh, auth } = req.body as {
      endpoint?: string;
      p256dh?: string;
      auth?: string;
    };
    if (!endpoint || !p256dh || !auth) {
      res.status(400).json({ error: "endpoint, p256dh and auth are required" });
      return;
    }
    if (!endpoint.startsWith("http")) {
      res.status(400).json({ error: "invalid endpoint" });
      return;
    }
    await subscribe(endpoint, p256dh, auth, req.headers["user-agent"] ?? "");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to store push subscription");
    res.status(500).json({ error: "Failed to store push subscription" });
  }
});

/** Remove a browser push subscription. */
router.post("/push/unsubscribe", async (req, res) => {
  try {
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint) {
      res.status(400).json({ error: "endpoint is required" });
      return;
    }
    await unsubscribe(endpoint);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove push subscription");
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
});

export default router;
