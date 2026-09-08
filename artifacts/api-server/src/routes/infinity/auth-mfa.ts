/**
 * PHASE 42: MFA API routes (TOTP + Passkeys)
 *
 * Grouped by access:
 *  - Management routes (setup, list, rename, delete, rotate backup codes)
 *    require a full session; the router is mounted under the public `/api/auth`
 *    mount point but each management route guards itself with `requireAuth`.
 *  - Challenge routes (finishing the two-step login) are public; they are
 *    authorized by the short-lived pending-login token instead of a session.
 *
 * Mounted in app.ts at `/api/auth` (public) alongside the login router, so
 * management paths are `/api/auth/mfa/...` and challenge paths are also
 * `/api/auth/mfa/...`. Login detection lives in auth.ts.
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { mfaPasskeys, mfaTotpSecrets, mfaPendingLogins } from "@workspace/db/schema/auth-mfa.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth-middleware";
import { loginRateLimiter } from "../../middleware/rate-limit";
import { totpStore } from "../../lib/totp";
import { webauthn, type RegistrationResponseJSON, type AuthenticationResponseJSON } from "../../lib/webauthn";
import {
  createSessionForAccount,
  getMfaMethods,
  getValidPendingLogin,
  tryConsumePendingLogin,
  issueTrustedDevice,
  clearTrustedDevices,
} from "../../lib/mfa-login";

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// Management: TOTP
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/mfa/totp/setup
 * Begin TOTP setup → secret, otpauth URL, QR data-URL + fresh backup codes.
 * Re-running replaces the pending (unconfirmed) secret.
 */
router.post("/mfa/totp/setup", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.accountId!;
    const email = req.account!.email;
    const setup = await totpStore.generateSetup(accountId, email);
    return res.json({ success: true, ...setup });
  } catch (err) {
    console.error("[mfa] TOTP setup error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to start TOTP setup" });
  }
});

/**
 * POST /api/auth/mfa/totp/confirm
 * Verify the first TOTP code the user scanned → enables TOTP.
 */
router.post("/mfa/totp/confirm", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) return res.status(400).json({ success: false, error: "Code is required" });
    const result = await totpStore.verifyAndConfirm(req.accountId!, code);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error === "not_configured" ? "TOTP not configured" : "Invalid code",
      });
    }
    return res.json({ success: true, confirmedAt: result.confirmedAt });
  } catch (err) {
    console.error("[mfa] TOTP confirm error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to confirm TOTP" });
  }
});

/**
 * POST /api/auth/mfa/totp/rotate-backup
 * Issue a fresh set of backup codes for an enabled TOTP account.
 */
router.post("/mfa/totp/rotate-backup", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await totpStore.rotateBackupCodes(req.accountId!);
    if (!result.success) return res.status(400).json({ success: false, error: "TOTP not configured" });
    return res.json({ success: true, backupCodes: result.backupCodes });
  } catch (err) {
    console.error("[mfa] rotate backup codes error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to rotate backup codes" });
  }
});

/**
 * POST /api/auth/mfa/totp/disable
 * Disable TOTP entirely.
 */
router.post("/mfa/totp/disable", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await totpStore.disable(req.accountId!);
    return res.json({ success: true });
  } catch (err) {
    console.error("[mfa] disable TOTP error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to disable TOTP" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Management: Passkeys
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/mfa/webauthn/register/begin
 * Generate registration options for navigator.credentials.create().
 */
router.post("/mfa/webauthn/register/begin", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.accountId!;
    const existing = await db
      .select({ credentialId: mfaPasskeys.credentialId, transports: mfaPasskeys.transports })
      .from(mfaPasskeys)
      .where(eq(mfaPasskeys.accountId, accountId));

    const options = await webauthn.startRegistration({
      accountId,
      userId: accountId,
      userName: req.account!.email,
      userDisplayName: req.account!.displayName || req.account!.email,
      excludeCredentials: existing.map((e) => ({
        credentialId: e.credentialId,
        transports: (e.transports as unknown as string[]) || [],
      })),
      origin: (req.body as { origin?: string | string[] })?.origin,
      rpID: (req.body as { rpID?: string })?.rpID,
    });
    return res.json({ success: true, options });
  } catch (err) {
    console.error("[mfa] webauthn register begin error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to start passkey registration" });
  }
});

/**
 * POST /api/auth/mfa/webauthn/register/finish
 * Verify attestation + persist the new passkey.
 */
router.post("/mfa/webauthn/register/finish", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body as {
      response?: RegistrationResponseJSON;
      name?: string;
      origin?: string | string[];
      rpID?: string;
    };
    if (!body.response) return res.status(400).json({ success: false, error: "Registration response is required" });

    const result = await webauthn.finishRegistration(req.accountId!, body.response);
    if (!result.verified) return res.status(400).json({ success: false, error: "Passkey verification failed" });

    const info = result.registrationInfo;
    await db.insert(mfaPasskeys).values({
      accountId: req.accountId!,
      credentialId: info.credentialId,
      publicKey: info.publicKeyBase64Url,
      counter: info.counter,
      transports: info.transports as unknown as Record<string, unknown>[],
      aaguid: info.aaguid,
      name: (body.name || "Passkey").slice(0, 64),
      deviceType: info.deviceType,
      backedUp: info.backedUp,
      userVerified: info.userVerified,
      lastUsedAt: new Date(),
    });

    return res.json({ success: true, credentialId: info.credentialId });
  } catch (err) {
    console.error("[mfa] webauthn register finish error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to save passkey" });
  }
});

/**
 * GET /api/auth/mfa/passkeys
 * List the account's passkeys.
 */
router.get("/mfa/passkeys", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        id: mfaPasskeys.id,
        credentialId: mfaPasskeys.credentialId,
        name: mfaPasskeys.name,
        aaguid: mfaPasskeys.aaguid,
        deviceType: mfaPasskeys.deviceType,
        counter: mfaPasskeys.counter,
        createdAt: mfaPasskeys.createdAt,
        lastUsedAt: mfaPasskeys.lastUsedAt,
      })
      .from(mfaPasskeys)
      .where(eq(mfaPasskeys.accountId, req.accountId!))
      .orderBy(mfaPasskeys.createdAt);
    return res.json({ success: true, passkeys: rows });
  } catch (err) {
    console.error("[mfa] list passkeys error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to list passkeys" });
  }
});

/**
 * PATCH /api/auth/mfa/passkeys/:id
 * Rename a passkey.
 */
router.patch("/mfa/passkeys/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) return res.status(400).json({ success: false, error: "Name is required" });
    await db
      .update(mfaPasskeys)
      .set({ name: name.slice(0, 64) })
      .where(and(eq(mfaPasskeys.id, req.params.id as string), eq(mfaPasskeys.accountId, req.accountId!)));
    return res.json({ success: true });
  } catch (err) {
    console.error("[mfa] rename passkey error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to rename passkey" });
  }
});

/**
 * DELETE /api/auth/mfa/passkeys/:id
 * Remove a passkey.
 */
router.delete("/mfa/passkeys/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await db
      .delete(mfaPasskeys)
      .where(and(eq(mfaPasskeys.id, req.params.id as string), eq(mfaPasskeys.accountId, req.accountId!)));
    return res.json({ success: true });
  } catch (err) {
    console.error("[mfa] delete passkey error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to delete passkey" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Management: status + trusted devices
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/auth/mfa/status
 * Full MFA status snapshot for the settings panel.
 */
router.get("/mfa/status", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.accountId!;
    const methods = await getMfaMethods(accountId);
    const totpStatus = await totpStore.getStatus(accountId);
    const backupStatus = await totpStore.listBackupCodeStatus(accountId);
    return res.json({
      success: true,
      mfa: {
        passkeys: methods.passkeys,
        passkeyCount: methods.passkeyCount,
        totp: methods.totp,
        totpConfigured: totpStatus.configured,
        backupCodes: backupStatus,
        backupCodeCount: backupStatus.length,
      },
    });
  } catch (err) {
    console.error("[mfa] status error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to load MFA status" });
  }
});

/**
 * POST /api/auth/mfa/trusted/clear
 * Forget all trusted devices + clear the local trusted-device cookie.
 */
router.post("/mfa/trusted/clear", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await clearTrustedDevices(req.accountId!);
    res.clearCookie("infinity_trusted_device", { path: "/" });
    return res.json({ success: true });
  } catch (err) {
    console.error("[mfa] clear trusted devices error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to clear trusted devices" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Challenge (public — authorized by pending-login token)
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/mfa/totp/verify
 * Finish login with a TOTP code.
 * Body: { pendingToken, code, rememberDevice?, fingerprint? }
 */
router.post("/mfa/totp/verify", loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { pendingToken, code, rememberDevice, fingerprint } = req.body as {
      pendingToken?: string; code?: string; rememberDevice?: boolean; fingerprint?: string;
    };
    if (!pendingToken || !code) return res.status(400).json({ success: false, error: "pendingToken and code are required" });

    const pending = await getValidPendingLogin(pendingToken);
    if (!pending) return res.status(401).json({ success: false, error: "Login session expired. Sign in again." });

    const ok = await totpStore.verifyCode(pending.accountId, code);
    if (!ok) return res.status(401).json({ success: false, error: "Invalid authenticator code" });

    if (!(await tryConsumePendingLogin(pendingToken))) {
      return res.status(401).json({ success: false, error: "Login session expired. Sign in again." });
    }
    await createSessionForAccount(pending.accountId, res);
    if (rememberDevice) await issueTrustedDevice(pending.accountId, fingerprint || "", res);
    return res.json({ success: true, mfaVerified: true, method: "totp" });
  } catch (err) {
    console.error("[mfa] totp verify error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to verify TOTP code" });
  }
});

/**
 * POST /api/auth/mfa/totp/backup
 * Finish login with a single-use backup code.
 * Body: { pendingToken, code, rememberDevice?, fingerprint? }
 */
router.post("/mfa/totp/backup", loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { pendingToken, code, rememberDevice, fingerprint } = req.body as {
      pendingToken?: string; code?: string; rememberDevice?: boolean; fingerprint?: string;
    };
    if (!pendingToken || !code) return res.status(400).json({ success: false, error: "pendingToken and code are required" });

    const pending = await getValidPendingLogin(pendingToken);
    if (!pending) return res.status(401).json({ success: false, error: "Login session expired. Sign in again." });

    const result = await totpStore.verifyBackupCode(pending.accountId, code);
    if (!result.success) return res.status(401).json({ success: false, error: "Invalid backup code" });

    if (!(await tryConsumePendingLogin(pendingToken))) {
      return res.status(401).json({ success: false, error: "Login session expired. Sign in again." });
    }
    await createSessionForAccount(pending.accountId, res);
    if (rememberDevice) await issueTrustedDevice(pending.accountId, fingerprint || "", res);
    return res.json({ success: true, mfaVerified: true, method: "backup" });
  } catch (err) {
    console.error("[mfa] backup verify error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to verify backup code" });
  }
});

/**
 * POST /api/auth/mfa/webauthn/authenticate/begin
 * Generate authentication options for navigator.credentials.get() and persist
 * the challenge on the pending-login row.
 * Body: { pendingToken, rpID?, origin? }
 */
router.post("/mfa/webauthn/authenticate/begin", loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { pendingToken, rpID, origin } = req.body as {
      pendingToken?: string; rpID?: string; origin?: string | string[];
    };
    if (!pendingToken) return res.status(400).json({ success: false, error: "pendingToken is required" });

    const pending = await getValidPendingLogin(pendingToken);
    if (!pending) return res.status(401).json({ success: false, error: "Login session expired. Sign in again." });

    const rows = await db
      .select({ credentialId: mfaPasskeys.credentialId, transports: mfaPasskeys.transports })
      .from(mfaPasskeys)
      .where(eq(mfaPasskeys.accountId, pending.accountId));
    const allowCredentials = rows.map((r) => ({
      credentialId: r.credentialId,
      transports: (r.transports as unknown as string[]) || [],
    }));

    const { options, challenge } = await webauthn.startAuthentication({ rpID, origin, allowCredentials });

    // persist the challenge so finish can verify the assertion
    await db
      .update(mfaPendingLogins)
      .set({ challenge })
      .where(eq(mfaPendingLogins.token, pendingToken));

    return res.json({ success: true, options });
  } catch (err) {
    console.error("[mfa] webauthn auth begin error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to start passkey login" });
  }
});

/**
 * POST /api/auth/mfa/webauthn/authenticate/finish
 * Verify an authentication assertion and finish login.
 * Body: { pendingToken, response, rememberDevice?, fingerprint? }
 */
router.post("/mfa/webauthn/authenticate/finish", loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { pendingToken, response, rememberDevice, fingerprint } = req.body as {
      pendingToken?: string;
      response?: AuthenticationResponseJSON;
      rememberDevice?: boolean;
      fingerprint?: string;
    };
    if (!pendingToken || !response) {
      return res.status(400).json({ success: false, error: "pendingToken and response are required" });
    }

    const pending = await getValidPendingLogin(pendingToken);
    if (!pending) return res.status(401).json({ success: false, error: "Login session expired. Sign in again." });

    if (!pending.challenge) {
      return res.status(400).json({ success: false, error: "No passkey challenge. Start passkey login again." });
    }

    const credential = await db
      .select({
        id: mfaPasskeys.id,
        credentialId: mfaPasskeys.credentialId,
        publicKey: mfaPasskeys.publicKey,
        counter: mfaPasskeys.counter,
        transports: mfaPasskeys.transports,
      })
      .from(mfaPasskeys)
      .where(eq(mfaPasskeys.credentialId, response.id))
      .limit(1);
    if (credential.length === 0) {
      return res.status(401).json({ success: false, error: "Unknown passkey" });
    }

    const result = await webauthn.verifyAuthentication({
      response,
      expectedChallenge: pending.challenge,
      credential: {
        credentialId: credential[0].credentialId,
        publicKey: credential[0].publicKey,
        counter: credential[0].counter,
        transports: (credential[0].transports as unknown as string[]) || [],
      },
      origin: req.body?.origin,
      rpID: req.body?.rpID,
    });

    if (!result.verified) return res.status(401).json({ success: false, error: "Passkey authentication failed" });

    if (!(await tryConsumePendingLogin(pendingToken))) {
      return res.status(401).json({ success: false, error: "Login session expired. Sign in again." });
    }

    // update the counter for replay protection
    await db
      .update(mfaPasskeys)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(mfaPasskeys.id, credential[0].id));

    await createSessionForAccount(pending.accountId, res);
    if (rememberDevice) await issueTrustedDevice(pending.accountId, fingerprint || "", res);
    return res.json({ success: true, mfaVerified: true, method: "passkey", credentialId: result.authenticationInfo.credentialId });
  } catch (err) {
    console.error("[mfa] webauthn auth finish error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Failed to complete passkey login" });
  }
});

export default router;