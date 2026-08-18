import { Router } from "express";
import { db, gmailTokens } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";

const router = Router();

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

function getRedirectUri(): string {
  // Prefer an explicit override (stable across dev domain rotations and deploys)
  if (process.env["GOOGLE_REDIRECT_URI"]) return process.env["GOOGLE_REDIRECT_URI"];
  const domain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DOMAINS"] ?? "localhost:8080";
  return `https://${domain}/api/jarvis/gmail/callback`;
}

function getClientId(): string {
  const id = process.env["GOOGLE_CLIENT_ID"];
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set");
  return id;
}

function getClientSecret(): string {
  const s = process.env["GOOGLE_CLIENT_SECRET"];
  if (!s) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return s;
}

/** GET /api/jarvis/gmail/auth, start OAuth flow */
router.get("/gmail/auth", (_req, res) => {
  const clientId = getClientId();
  const redirectUri = getRedirectUri();

  // Diagnostic log, shows length and last 4 chars so we can verify the exact value
  const last4 = clientId.slice(-4);
  logger.info(
    { clientIdLength: clientId.length, clientIdSuffix: last4, redirectUri },
    "Redirecting to Google OAuth",
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/** GET /api/jarvis/gmail/callback, Google redirects here with ?code= */
router.get("/gmail/callback", async (req, res) => {
  const code = req.query["code"] as string | undefined;
  if (!code) {
    res.status(400).send("Missing code");
    return;
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: getClientId(),
        client_secret: getClientSecret(),
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      error?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      logger.error({ tokenData }, "Gmail OAuth token exchange failed");
      res.send("<script>window.close();</script><p>Auth failed. Close this tab.</p>");
      return;
    }

    // Get user email
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as { email?: string };

    const expiresAt = Date.now() + (tokenData.expires_in ?? 3600) * 1000;

    await db
      .insert(gmailTokens)
      .values({
        id: "default",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        email: profile.email ?? "unknown",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: gmailTokens.id,
        set: {
          accessToken: tokenData.access_token,
          // Only update refreshToken if a new one was issued
          ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {}),
          expiresAt,
          email: profile.email ?? "unknown",
          updatedAt: new Date(),
        },
      });

    // Close the popup and signal success to the opener
    res.send(`
      <html><body>
        <p>Gmail connected! You can close this tab.</p>
        <script>
          if (window.opener) { window.opener.postMessage('gmail_connected', '*'); }
          setTimeout(() => window.close(), 1000);
        </script>
      </body></html>
    `);
  } catch (err) {
    logger.error({ err }, "Gmail callback error");
    res.status(500).send("Authentication failed. Close this tab and try again.");
  }
});

/** GET /api/jarvis/gmail/status */
router.get("/gmail/status", async (_req, res) => {
  try {
    const [row] = await db.select().from(gmailTokens).where(eq(gmailTokens.id, "default"));
    if (!row) { res.json({ connected: false }); return; }
    res.json({ connected: true, email: row.email });
  } catch {
    res.json({ connected: false });
  }
});

/** DELETE /api/jarvis/gmail/disconnect */
router.delete("/gmail/disconnect", async (_req, res) => {
  try {
    await db.delete(gmailTokens).where(eq(gmailTokens.id, "default"));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

// ─── Internal helper used by live-context ────────────────────────────────────

async function refreshAccessToken(row: typeof gmailTokens.$inferSelect): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: row.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    await db.update(gmailTokens).set({ accessToken: data.access_token, expiresAt, updatedAt: new Date() }).where(eq(gmailTokens.id, "default"));
    return data.access_token;
  } catch {
    return null;
  }
}

export async function getGmailContext(): Promise<string | null> {
  try {
    const [row] = await db.select().from(gmailTokens).where(eq(gmailTokens.id, "default"));
    if (!row) return null;

    // Refresh token if expiring within 5 minutes
    let accessToken = row.accessToken;
    if (row.expiresAt < Date.now() + 5 * 60 * 1000) {
      accessToken = (await refreshAccessToken(row)) ?? accessToken;
    }

    // Fetch up to 8 unread emails from inbox
    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+in:inbox&maxResults=8",
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(6000) },
    );
    if (!listRes.ok) return null;
    const listData = await listRes.json() as { messages?: { id: string }[] };
    const ids = listData.messages ?? [];
    if (ids.length === 0) return "Gmail: No unread emails in inbox.";

    // Fetch each message (metadata only, fast)
    const emails = await Promise.all(
      ids.map(async ({ id }) => {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) },
        );
        if (!r.ok) return null;
        const msg = await r.json() as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string };
        const headers = msg.payload?.headers ?? [];
        const get = (name: string) => headers.find(h => h.name === name)?.value ?? "";
        return `From: ${get("From")}\nSubject: ${get("Subject")}\nSnippet: ${msg.snippet ?? ""}`;
      }),
    );

    const valid = emails.filter(Boolean) as string[];
    if (valid.length === 0) return null;
    return `Gmail unread (${valid.length}):\n\n${valid.join("\n\n---\n\n")}`;
  } catch {
    return null;
  }
}

export default router;
