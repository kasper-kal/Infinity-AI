import { Request, Response, NextFunction } from "express";
import { db, sessions, accounts } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Extend Express Request to include account info
 */
export interface AuthenticatedRequest extends Request {
  accountId?: string;
  account?: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    scopes: string[];
    createdAt: Date;
  };
}

/**
 * Middleware: Require valid session cookie
 * Attaches req.accountId and req.account on success
 * Returns 401 if no valid session
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.cookies?.["session_id"];
    if (!sessionId) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }

    const now = new Date();
    const [session] = await db
      .select({
        id: sessions.id,
        accountId: sessions.accountId,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
      .limit(1);

    if (!session) {
      res.status(401).json({ success: false, error: "Session expired or invalid" });
      return;
    }

    // Check if session was revoked
    if (session.revokedAt) {
      res.status(401).json({ success: false, error: "Session revoked" });
      return;
    }

    const [account] = await db
      .select({
        id: accounts.id,
        email: accounts.email,
        displayName: accounts.displayName,
        avatarUrl: accounts.avatarUrl,
        scopes: accounts.scopes,
        createdAt: accounts.createdAt,
      })
      .from(accounts)
      .where(eq(accounts.id, session.accountId))
      .limit(1);

    if (!account) {
      res.status(401).json({ success: false, error: "Account not found" });
      return;
    }

    // Cast scopes from jsonb (unknown) to string[]
    const accountScopes = (account.scopes as unknown as string[]) || [];

    req.accountId = session.accountId;
    req.account = {
      ...account,
      scopes: accountScopes,
    };
    next();
  } catch (err) {
    logger.error({ err }, "Auth middleware error");
    res.status(500).json({ success: false, error: "Authentication error" });
  }
}

/**
 * Middleware: Require specific scope
 * Must be used AFTER requireAuth (or optionalAuth that sets account)
 * Returns 403 if scope not granted
 */
export function requireScope(scope: string | string[]) {
  const requiredScopes = Array.isArray(scope) ? scope : [scope];

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.account) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }

    const accountScopes = req.account.scopes || [];
    const hasScope = requiredScopes.every((s) => accountScopes.includes(s));

    if (!hasScope) {
      res.status(403).json({
        success: false,
        error: `Insufficient scope: requires ${requiredScopes.join(", ")}`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware: Optional authentication
 * Attaches req.accountId and req.account if valid session exists
 * Continues without error if no session (for public endpoints)
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.cookies?.["session_id"];
    if (!sessionId) {
      next();
      return;
    }

    const now = new Date();
    const [session] = await db
      .select({
        id: sessions.id,
        accountId: sessions.accountId,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
      .limit(1);

    if (!session || session.revokedAt) {
      next();
      return;
    }

    const [account] = await db
      .select({
        id: accounts.id,
        email: accounts.email,
        displayName: accounts.displayName,
        avatarUrl: accounts.avatarUrl,
        scopes: accounts.scopes,
        createdAt: accounts.createdAt,
      })
      .from(accounts)
      .where(eq(accounts.id, session.accountId))
      .limit(1);

    if (!account) {
      next();
      return;
    }

    // Cast scopes from jsonb (unknown) to string[]
    const accountScopes = (account.scopes as unknown as string[]) || [];

    req.accountId = session.accountId;
    req.account = {
      ...account,
      scopes: accountScopes,
    };

    next();
  } catch (err) {
    logger.error({ err }, "Optional auth middleware error");
    next(); // Don't block on auth errors for optional auth
  }
}

/**
 * Helper: Get accountId from request (works with both requireAuth and optionalAuth)
 */
export function getAccountId(req: AuthenticatedRequest): string | null {
  return req.accountId ?? null;
}

/**
 * Helper: Check if request has specific scope
 */
export function hasScope(req: AuthenticatedRequest, scope: string): boolean {
  return req.account?.scopes?.includes(scope) ?? false;
}

/**
 * Invalidate all sessions for an account (on email change, 2FA change, security settings change)
 * Sets revokedAt to now for all active sessions
 */
export async function invalidateAllSessions(accountId: string): Promise<number> {
  const now = new Date();
  const result = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
  return result.rowCount ?? 0;
}

/**
 * Revoke a specific session by token
 */
export async function revokeSession(sessionToken: string): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.token, sessionToken), isNull(sessions.revokedAt)));
  return (result.rowCount ?? 0) > 0;
}