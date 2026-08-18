import { db, gmailTokens } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

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

/** Fetch unread Gmail context for live context injection. */
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