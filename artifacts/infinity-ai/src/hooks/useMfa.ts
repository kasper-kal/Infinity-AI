/**
 * useMfa Hook — Phase 42 (Passkeys + TOTP)
 *
 * Client-side API + WebAuthn ceremony helpers for the MFA settings panel and
 * the two-step login challenge. All management endpoints live under the public
 * `/api/auth/mfa` mount and are authorized by the session cookie (management)
 * or a short-lived pending-login token (challenge).
 *
 * WebAuthn browser ceremonies run through @simplewebauthn/browser so the
 * server and client share the same credential/challenge model.
 */

import { useCallback } from "react";
import {
  startRegistration,
  startAuthentication,
  browserSupportsPasskeys,
} from "@simplewebauthn/browser";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

// ============================================================================
// TYPES
// ============================================================================

export interface MfaPasskey {
  id: string;
  credentialId: string;
  name: string;
  aaguid: string;
  deviceType: string;
  counter: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface BackupCodeStatus {
  codeHash: string;
  used: boolean;
  usedAt?: string | null;
}

export interface MfaStatus {
  passkeys: boolean;
  passkeyCount: number;
  totp: boolean;
  totpConfigured: boolean;
  backupCodes: BackupCodeStatus[];
  backupCodeCount: number;
}

export interface TotpSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

// ============================================================================
// LOW-LEVEL REQUEST HELPER
// ============================================================================

const API_BASE = "/api/auth/mfa";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: options.body
      ? { "Content-Type": "application/json", ...(options.headers || {}) }
      : options.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

function jsonBody<T>(data: T): RequestInit {
  return { method: "POST", body: JSON.stringify(data) };
}

// ============================================================================
// WEB AUTHN BROWSER HELPERS
// ============================================================================

/**
 * Full passkey registration ceremony:
 *  1. POST /webauthn/register/begin → options
 *  2. navigator.credentials.create() via @simplewebauthn/browser startRegistration
 *  3. POST /webauthn/register/finish → verified credential persisted
 */
async function runPasskeyRegistration(opts?: {
  origin?: string;
  rpID?: string;
  name?: string;
}): Promise<string> {
  const { origin, rpID, name } = opts || {};
  const begin = await request<{ success: boolean; options: PublicKeyCredentialCreationOptionsJSON }>(
    "/webauthn/register/begin",
    jsonBody({ origin, rpID }),
  );
  const registrationResponse: RegistrationResponseJSON = await startRegistration({ optionsJSON: begin.options });
  const finish = await request<{ success: boolean; credentialId?: string }>(
    "/webauthn/register/finish",
    jsonBody({ response: registrationResponse, name, origin, rpID }),
  );
  return finish.credentialId || "";
}

/**
 * Full passkey authentication ceremony (two-step login):
 *  1. POST /webauthn/authenticate/begin with the pending token → options
 *  2. navigator.credentials.get() via @simplewebauthn/browser startAuthentication
 *  3. POST /webauthn/authenticate/finish → session created
 */
async function runPasskeyAuthentication(opts: {
  pendingToken: string;
  origin?: string;
  rpID?: string;
  rememberDevice?: boolean;
  fingerprint?: string;
}): Promise<{ success: boolean; mfaVerified: boolean; method: string }> {
  const { pendingToken, origin, rpID, rememberDevice, fingerprint } = opts;
  const begin = await request<{ success: boolean; options: PublicKeyCredentialRequestOptionsJSON }>(
    "/webauthn/authenticate/begin",
    jsonBody({ pendingToken, origin, rpID }),
  );
  const assertion: AuthenticationResponseJSON = await startAuthentication({ optionsJSON: begin.options });
  return request("/webauthn/authenticate/finish", jsonBody({ pendingToken, response: assertion, rememberDevice, fingerprint, origin, rpID }));
}

// ============================================================================
// HOOK
// ============================================================================

export function useMfa() {
  /** Load the full MFA status snapshot for the settings panel. */
  const fetchStatus = useCallback(async (): Promise<MfaStatus | null> => {
    try {
      const data = await request<{ success: boolean; mfa: MfaStatus }>("/status");
      return data.mfa || null;
    } catch (err) {
      console.error("Failed to load MFA status:", err);
      return null;
    }
  }, []);

  const startTotpSetup = useCallback(async (): Promise<TotpSetupResult | null> => {
    try {
      const data = await request<{ success: boolean } & TotpSetupResult>("/totp/setup", { method: "POST" });
      return data || null;
    } catch (err) {
      console.error("Failed to start TOTP setup:", err);
      return null;
    }
  }, []);

  const confirmTotp = useCallback(async (code: string): Promise<boolean> => {
    try {
      await request<{ success: boolean }>("/totp/confirm", jsonBody({ code }));
      return true;
    } catch (err) {
      console.error("Failed to confirm TOTP:", err);
      return false;
    }
  }, []);

  const disableTotp = useCallback(async (): Promise<string | null> => {
    try {
      await request<{ success: boolean }>("/totp/disable", { method: "POST" });
      return null;
    } catch (err) {
      console.error("Failed to disable TOTP:", err);
      return err instanceof Error ? err.message : "Failed to disable TOTP";
    }
  }, []);

  const rotateBackupCodes = useCallback(async (): Promise<{ codes: string[] | null; error: string | null }> => {
    try {
      const data = await request<{ success: boolean; backupCodes: string[] }>("/totp/rotate-backup", { method: "POST" });
      return { codes: data.backupCodes || null, error: null };
    } catch (err) {
      console.error("Failed to rotate backup codes:", err);
      return { codes: null, error: err instanceof Error ? err.message : "Failed to rotate backup codes" };
    }
  }, []);

  const registerPasskey = useCallback(
    async (opts?: { origin?: string; rpID?: string; name?: string }): Promise<string | null> => {
      try {
        await runPasskeyRegistration(opts);
        return null;
      } catch (err) {
        console.error("Failed to register passkey:", err);
        return err instanceof Error ? err.message : "Failed to register passkey";
      }
    },
    [],
  );

  const listPasskeys = useCallback(async (): Promise<MfaPasskey[]> => {
    try {
      const data = await request<{ success: boolean; passkeys: MfaPasskey[] }>("/passkeys");
      return data.passkeys || [];
    } catch (err) {
      console.error("Failed to list passkeys:", err);
      return [];
    }
  }, []);

  const renamePasskey = useCallback(async (id: string, name: string): Promise<boolean> => {
    try {
      await request<{ success: boolean }>(`/passkeys/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      return true;
    } catch (err) {
      console.error("Failed to rename passkey:", err);
      return false;
    }
  }, []);

  const deletePasskey = useCallback(async (id: string): Promise<boolean> => {
    try {
      await request<{ success: boolean }>(`/passkeys/${id}`, { method: "DELETE" });
      return true;
    } catch (err) {
      console.error("Failed to delete passkey:", err);
      return false;
    }
  }, []);

  const clearTrustedDevices = useCallback(async (): Promise<string | null> => {
    try {
      await request<{ success: boolean }>("/trusted/clear", { method: "POST" });
      return null;
    } catch (err) {
      console.error("Failed to clear trusted devices:", err);
      return err instanceof Error ? err.message : "Failed to clear trusted devices";
    }
  }, []);

  // ── Challenge helpers (two-step login) ───────────────────────────────────
  const verifyTotpCode = useCallback(
    async (pendingToken: string, code: string, opts?: { rememberDevice?: boolean; fingerprint?: string }): Promise<boolean> => {
      try {
        await request<{ success: boolean }>("/totp/verify", jsonBody({ pendingToken, code, ...opts }));
        return true;
      } catch (err) {
        console.error("Failed to verify TOTP code:", err);
        return false;
      }
    },
    [],
  );

  const verifyBackupCode = useCallback(
    async (pendingToken: string, code: string, opts?: { rememberDevice?: boolean; fingerprint?: string }): Promise<boolean> => {
      try {
        await request<{ success: boolean }>("/totp/backup", jsonBody({ pendingToken, code, ...opts }));
        return true;
      } catch (err) {
        console.error("Failed to verify backup code:", err);
        return false;
      }
    },
    [],
  );

  const authenticateWithPasskey = useCallback(
    async (pendingToken: string, opts?: { origin?: string; rpID?: string; rememberDevice?: boolean; fingerprint?: string }) => {
      try {
        return await runPasskeyAuthentication({ pendingToken, ...opts });
      } catch (err) {
        console.error("Failed to authenticate with passkey:", err);
        return { success: false, mfaVerified: false, method: "passkey" };
      }
    },
    [],
  );

  return {
    fetchStatus,
    startTotpSetup,
    confirmTotp,
    disableTotp,
    rotateBackupCodes,
    registerPasskey,
    listPasskeys,
    renamePasskey,
    deletePasskey,
    clearTrustedDevices,
    verifyTotpCode,
    verifyBackupCode,
    authenticateWithPasskey,
    browserSupportsPasskeys,
  };
}
