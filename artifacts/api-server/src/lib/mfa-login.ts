/**
 * PHASE 42: shared MFA login helpers — used by both the login flow (auth.ts)
 * and the challenge endpoints (auth-mfa.ts).
 *
 * Two-step login model:
 *   1. Password verified → if the account has MFA methods enabled and the
 *      device isn't trusted, issue a short-lived `mfa_pending_logins` row +
 *      token. NO session cookie is set yet.
 *   2. The frontend completes the challenge (passkey / TOTP / backup code)
 *      using the pending token. On success we consume the token and create the
 *      real session cookie here.
 */

import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import type { Response } from "express";
import { db } from "@workspace/db";
import { sessions, accounts } from "@workspace/db";
import { mfaPendingLogins, mfaTrustedDevices, mfaPasskeys, mfaTotpSecrets } from "@workspace/db/schema/auth-mfa.js";
import { eq, lt, and } from "drizzle-orm";

export const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const TRUSTED_DEVICE_COOKIE = "infinity_trusted_device";
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: "/",
};

/** Create a real session for an account and set the session cookie. */
export async function createSessionForAccount(accountId: string, res: Response): Promise<void> {
  const token = randomUUID();
  await db.insert(sessions).values({
    token,
    accountId,
    expiresAt: new Date(Date.now() + COOKIE_OPTIONS.maxAge),
  });
  res.cookie("infinity_session", token, COOKIE_OPTIONS);
}

/** What second-factor methods does an account have enabled? */
export async function getMfaMethods(accountId: string): Promise<{
  passkeys: boolean;
  passkeyCount: number;
  totp: boolean;
  backup: boolean;
}> {
  const [passkeys, totp] = await Promise.all([
    db.select({ id: mfaPasskeys.id }).from(mfaPasskeys).where(eq(mfaPasskeys.accountId, accountId)),
    db.select({ id: mfaTotpSecrets.id, confirmedAt: mfaTotpSecrets.confirmedAt })
      .from(mfaTotpSecrets)
      .where(eq(mfaTotpSecrets.accountId, accountId))
      .limit(1),
  ]);
  const backup = !!(totp.length > 0 && totp[0].confirmedAt);
  return {
    passkeys: passkeys.length > 0,
    passkeyCount: passkeys.length,
    totp: totp.length > 0 && !!totp[0].confirmedAt,
    backup,
  };
}

/** Issue a pending-login token (two-step login step one). */
export async function createPendingLogin(account: { id: string; email: string }, methods: string[]): Promise<string> {
  const token = randomUUID().replace(/-/g, "");
  await db.insert(mfaPendingLogins).values({
    token,
    accountId: account.id,
    email: account.email,
    requestedMethods: methods,
    expiresAt: new Date(Date.now() + PENDING_LOGIN_TTL_MS),
  });
  // opportunistically clean up stale rows
  await db.delete(mfaPendingLogins).where(lt(mfaPendingLogins.expiresAt, new Date()));
  return token;
}

/** Fetch a valid (unused, not expired) pending-login row. */
export async function getValidPendingLogin(token: string) {
  const [row] = await db
    .select()
    .from(mfaPendingLogins)
    .where(and(eq(mfaPendingLogins.token, token), eq(mfaPendingLogins.usedAt, null)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;
  return row;
}

/**
 * Atomically mark a pending-login row used — only succeeds once (race-safe).
 * Returns true if this call won the race (the token is now consumed).
 */
export async function tryConsumePendingLogin(token: string): Promise<boolean> {
  const result = await db
    .update(mfaPendingLogins)
    .set({ usedAt: new Date() })
    .where(and(eq(mfaPendingLogins.token, token), eq(mfaPendingLogins.usedAt, null)));
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Trusted devices ("remember this device for 30 days")
// ============================================================================

function fingerprintHash(fingerprint: string): string {
  return crypto.createHash("sha256").update("infinity-trusted:" + fingerprint).digest("hex");
}

export async function isTrustedDevice(accountId: string, fingerprint: string): Promise<boolean> {
  if (!fingerprint) return false;
  const hash = fingerprintHash(fingerprint);
  const [row] = await db
    .select({ id: mfaTrustedDevices.id, expiresAt: mfaTrustedDevices.expiresAt })
    .from(mfaTrustedDevices)
    .where(and(eq(mfaTrustedDevices.accountId, accountId), eq(mfaTrustedDevices.deviceFingerprint, hash)))
    .limit(1);
  if (!row) return false;
  if (row.expiresAt && row.expiresAt < new Date()) return false;
  return true;
}

export async function issueTrustedDevice(accountId: string, fingerprint: string, res: Response): Promise<void> {
  if (!fingerprint) return;
  const exists = await isTrustedDevice(accountId, fingerprint);
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS);
  if (!exists) {
    await db
      .insert(mfaTrustedDevices)
      .values({ accountId, deviceFingerprint: fingerprintHash(fingerprint), expiresAt })
      .onConflictDoNothing();
  }
  res.cookie(TRUSTED_DEVICE_COOKIE, fingerprint, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TRUSTED_DEVICE_TTL_MS,
    path: "/",
  });
}

export async function clearTrustedDevices(accountId: string): Promise<void> {
  await db.delete(mfaTrustedDevices).where(eq(mfaTrustedDevices.accountId, accountId));
}