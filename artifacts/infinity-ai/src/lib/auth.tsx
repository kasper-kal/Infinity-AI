/**
 * AuthProvider + useAuth — real account session management for the frontend.
 *
 * Backed by the (already complete) backend auth system:
 *   GET  /api/auth/me                     → current account (if session cookie valid)
 *   POST /api/auth/register               → create account + session
 *   POST /api/auth/login                  → password sign-in; returns mfaRequired when the
 *                                            account has second factors and the device isn't trusted
 *   POST /api/auth/logout                 → destroy session
 *   PUT  /api/auth/profile                → update displayName / email / avatarUrl
 *   PUT  /api/auth/password               → change password (invalidates all other sessions)
 *   POST /api/auth/revoke-sessions        → revoke all other sessions
 *
 * Two-step MFA: login() stores the pending-login payload returned by the API.
 * The login view completes the factor through useMfa()'s challenge helpers and
 * calls completeMfa() to refresh the account and clear the pending state.
 *
 * Guest mode: the app historically runs without an account (primary user has no
 * accounts row). A persistent guest flag lets the whole app stay usable, while
 * auth is a first-class real flow for anyone who signs in.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface AuthAccount {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PendingLogin {
  pendingToken: string;
  methods: string[];
  passkeyCount?: number;
  account?: { email?: string; displayName?: string } | null;
  trustedDevice: boolean;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface LoginResult {
  ok: boolean;
  error?: string;
  mfaRequired?: boolean;
}

export interface AuthContextValue {
  /** Session state */
  status: AuthStatus;
  account: AuthAccount | null;
  /** Persistent guest mode (use the app without an account) */
  guest: boolean;
  /** Pending two-step MFA login (set by login() when the API asks for a factor) */
  pendingLogin: PendingLogin | null;
  isMfaPending: boolean;

  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Complete the second factor; returns true when the session is now valid. */
  completeMfa: () => Promise<boolean>;
  cancelMfa: () => void;
  register: (opts: { email: string; password: string; displayName?: string }) => Promise<LoginResult>;
  logout: () => Promise<void>;
  updateProfile: (updates: { displayName?: string; email?: string; avatarUrl?: string | null }) => Promise<{ ok: boolean; error?: string }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  revokeAllSessions: () => Promise<boolean>;
  enterGuest: () => void;
  exitGuest: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GUEST_KEY = "infinity-auth-guest";
const FINGERPRINT_KEY = "infinity-device-fingerprint";

/** Stable per-browser fingerprint used for the "trust this device" cookie. */
export function getDeviceFingerprint(): string {
  let fp = localStorage.getItem(FINGERPRINT_KEY);
  if (!fp) {
    fp = (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
    localStorage.setItem(FINGERPRINT_KEY, fp);
  }
  return fp;
}

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string })?.error || `Request failed (${res.status})`;
}

function parseAccount(data: unknown): AuthAccount | null {
  const acct = (data as { account?: Partial<AuthAccount> })?.account;
  if (!acct?.id || !acct.email) return null;
  return {
    id: acct.id as string,
    email: acct.email as string,
    displayName: (acct.displayName as string) || "",
    avatarUrl: (acct.avatarUrl as string | null) || null,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [guest, setGuest] = useState<boolean>(() => localStorage.getItem(GUEST_KEY) === "1");
  const [pendingLogin, setPendingLogin] = useState<PendingLogin | null>(null);

  /** Load the current session from the server. */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        const acct = parseAccount(data);
        if (acct) {
          setAccount(acct);
          setStatus("authenticated");
          return;
        }
      }
      setAccount(null);
      setStatus("unauthenticated");
    } catch {
      setAccount(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, skipMfa: true }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data?.error || "Invalid email or password" };

        if (data.mfaRequired) {
          setPendingLogin({
            pendingToken: data.pendingToken as string,
            methods: (data.methods as string[]) || [],
            passkeyCount: data.passkeyCount as number | undefined,
            account: (data.account as { email?: string; displayName?: string }) || null,
            trustedDevice: !!data.trustedDevice,
          });
          // Refresh account once the challenge completes (session is created then).
          return { ok: true, mfaRequired: true };
        }

        const acct = parseAccount(data);
        setAccount(acct);
        setStatus("authenticated");
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Is the API server running?" };
      }
    },
    [],
  );

  const completeMfa = useCallback(async (): Promise<boolean> => {
    let ok = false;
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        ok = !!parseAccount(data);
        if (ok) setAccount(parseAccount(data));
      }
    } catch {
      ok = false;
    }
    setPendingLogin(null);
    if (ok) setStatus("authenticated");
    return ok;
  }, []);

  const cancelMfa = useCallback(() => setPendingLogin(null), []);

  const register = useCallback(
    async (opts: { email: string; password: string; displayName?: string }): Promise<LoginResult> => {
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data?.error || "Registration failed" };
        const acct = parseAccount(data);
        setAccount(acct);
        setStatus("authenticated");
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Is the API server running?" };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // even if the call fails, clear local state
    }
    setAccount(null);
    setPendingLogin(null);
    setStatus("unauthenticated");
  }, []);

  const updateProfile = useCallback(
    async (updates: { displayName?: string; email?: string; avatarUrl?: string | null }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data?.error || "Failed to update profile" };
        const acct = parseAccount(data);
        if (acct) setAccount(acct);
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error" };
      }
    },
    [],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        if (res.ok) return { ok: true };
        return { ok: false, error: await readError(res) };
      } catch {
        return { ok: false, error: "Network error" };
      }
    },
    [],
  );

  const revokeAllSessions = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/revoke-sessions", { method: "POST" });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const enterGuest = useCallback(() => {
    localStorage.setItem(GUEST_KEY, "1");
    setGuest(true);
  }, []);

  const exitGuest = useCallback(() => {
    localStorage.removeItem(GUEST_KEY);
    setGuest(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      guest,
      pendingLogin,
      isMfaPending: !!pendingLogin,
      refresh,
      login,
      completeMfa,
      cancelMfa,
      register,
      logout,
      updateProfile,
      changePassword,
      revokeAllSessions,
      enterGuest,
      exitGuest,
    }),
    [status, account, guest, pendingLogin, refresh, login, completeMfa, cancelMfa, register, logout, updateProfile, changePassword, revokeAllSessions, enterGuest, exitGuest],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}