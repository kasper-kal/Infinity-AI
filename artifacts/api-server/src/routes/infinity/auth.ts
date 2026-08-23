import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { db, accounts, sessions } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { invalidateAllSessions, revokeSession } from "../../middleware/auth-middleware";
import { loginRateLimiter, registerRateLimiter, passwordRateLimiter, authMeRateLimiter } from "../../middleware/rate-limit";

// Load environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "../../../../.env.local") });
config({ path: path.join(__dirname, "../../../../.env") });
config({ path: path.join(__dirname, "../../../.env") });

const router = Router();

// Password hashing cost
const BCRYPT_ROUNDS = 12;

// Session cookie options
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: "/",
};

/**
 * POST /api/infinity/auth/register
 * Register a new account
 */
router.post("/auth/register", registerRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, displayName } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    }

    // Check if account already exists
    const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: "An account with this email already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create account
    const [account] = await db
      .insert(accounts)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        displayName: displayName?.trim() || email.split("@")[0],
      })
      .returning();

    // Create session
    const token = randomUUID();
    await db.insert(sessions).values({
      token,
      accountId: account.id,
      expiresAt: new Date(Date.now() + COOKIE_OPTIONS.maxAge),
    });

    // Set session cookie
    res.cookie("infinity_session", token, COOKIE_OPTIONS);

    return res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
      },
    });
  } catch (err) {
    console.error("[Auth] Register error:", err);
    return res.status(500).json({ success: false, error: "Registration failed" });
  }
});

/**
 * POST /api/infinity/auth/login
 * Login with email and password
 */
router.post("/auth/login", loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required" });
    }

    // Find account
    const [account] = await db.select().from(accounts).where(eq(accounts.email, email.toLowerCase())).limit(1);
    if (!account) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }

    // Verify password
    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }

    // Create session
    const token = randomUUID();
    await db.insert(sessions).values({
      token,
      accountId: account.id,
      expiresAt: new Date(Date.now() + COOKIE_OPTIONS.maxAge),
    });

    // Set session cookie
    res.cookie("infinity_session", token, COOKIE_OPTIONS);

    return res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
      },
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    return res.status(500).json({ success: false, error: "Login failed" });
  }
});

/**
 * POST /api/infinity/auth/logout
 * Logout current session
 */
router.post("/auth/logout", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.infinity_session;
    if (token) {
      await db.delete(sessions).where(eq(sessions.token, token));
    }
    res.clearCookie("infinity_session", COOKIE_OPTIONS);
    return res.json({ success: true });
  } catch (err) {
    console.error("[Auth] Logout error:", err);
    return res.status(500).json({ success: false, error: "Logout failed" });
  }
});

/**
 * GET /api/infinity/auth/me
 * Get current authenticated account
 */
router.get("/auth/me", authMeRateLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.infinity_session;
    if (!token) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [session] = await db
      .select({ accountId: sessions.accountId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1);

    if (!session || (session.expiresAt && session.expiresAt < new Date())) {
      if (session) {
        await db.delete(sessions).where(eq(sessions.token, token));
      }
      res.clearCookie("infinity_session", COOKIE_OPTIONS);
      return res.status(401).json({ success: false, error: "Session expired" });
    }

    const [account] = await db.select().from(accounts).where(eq(accounts.id, session.accountId)).limit(1);
    if (!account) {
      return res.status(401).json({ success: false, error: "Account not found" });
    }

    return res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
      },
    });
  } catch (err) {
    console.error("[Auth] Me error:", err);
    return res.status(500).json({ success: false, error: "Failed to get account" });
  }
});

/**
 * PUT /api/infinity/auth/profile
 * Update account profile (display name, avatar, email)
 * Email change invalidates all other sessions for security
 */
router.put("/auth/profile", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.infinity_session;
    if (!token) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [session] = await db
      .select({ accountId: sessions.accountId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1);

    if (!session || (session.expiresAt && session.expiresAt < new Date())) {
      return res.status(401).json({ success: false, error: "Session expired" });
    }

    const { displayName, avatarUrl, email } = req.body as { displayName?: string; avatarUrl?: string; email?: string };

    const updates: Partial<typeof accounts.$inferInsert> = {};
    let emailChanged = false;
    if (displayName !== undefined) updates.displayName = displayName.trim().slice(0, 100);
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl.trim().slice(0, 500);
    if (email !== undefined) {
      const newEmail = email.toLowerCase().trim();
      // Check if email is already taken
      const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, newEmail)).limit(1);
      if (existing.length > 0 && existing[0].id !== session.accountId) {
        return res.status(409).json({ success: false, error: "An account with this email already exists" });
      }
      updates.email = newEmail;
      emailChanged = true;
    }
    updates.updatedAt = new Date();

    const [account] = await db
      .update(accounts)
      .set(updates)
      .where(eq(accounts.id, session.accountId))
      .returning();

    // Invalidate all other sessions if email changed (security)
    if (emailChanged) {
      await invalidateAllSessions(session.accountId);
      // Create new session for current client
      const newToken = randomUUID();
      await db.insert(sessions).values({
        token: newToken,
        accountId: account.id,
        expiresAt: new Date(Date.now() + COOKIE_OPTIONS.maxAge),
      });
      res.cookie("infinity_session", newToken, COOKIE_OPTIONS);
    }

    return res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
      },
    });
  } catch (err) {
    console.error("[Auth] Profile update error:", err);
    return res.status(500).json({ success: false, error: "Failed to update profile" });
  }
});

/**
 * PUT /api/infinity/auth/password
 * Change password
 */
router.put("/auth/password", passwordRateLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.infinity_session;
    if (!token) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [session] = await db
      .select({ accountId: sessions.accountId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1);

    if (!session || (session.expiresAt && session.expiresAt < new Date())) {
      return res.status(401).json({ success: false, error: "Session expired" });
    }

    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: "Current and new password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: "New password must be at least 8 characters" });
    }

    const [account] = await db.select().from(accounts).where(eq(accounts.id, session.accountId)).limit(1);
    if (!account) {
      return res.status(401).json({ success: false, error: "Account not found" });
    }

    const valid = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: "Current password is incorrect" });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.update(accounts).set({ passwordHash, updatedAt: new Date() }).where(eq(accounts.id, session.accountId));

    // Invalidate all other sessions for security
    await db.delete(sessions).where(eq(sessions.accountId, session.accountId));

    // Create new session
    const newToken = randomUUID();
    await db.insert(sessions).values({
      token: newToken,
      accountId: account.id,
      expiresAt: new Date(Date.now() + COOKIE_OPTIONS.maxAge),
    });

    res.cookie("infinity_session", newToken, COOKIE_OPTIONS);

    return res.json({ success: true });
  } catch (err) {
    console.error("[Auth] Password change error:", err);
    return res.status(500).json({ success: false, error: "Failed to change password" });
  }
});

/**
 * POST /api/infinity/auth/revoke-sessions
 * Revoke all other sessions for the current account (keep current session)
 */
router.post("/auth/revoke-sessions", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.infinity_session;
    if (!token) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [session] = await db
      .select({ accountId: sessions.accountId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1);

    if (!session || (session.expiresAt && session.expiresAt < new Date())) {
      return res.status(401).json({ success: false, error: "Session expired" });
    }

    // Revoke all other sessions (not current)
    const now = new Date();
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.accountId, session.accountId), ne(sessions.token, token)));

    return res.json({ success: true, message: "All other sessions revoked" });
  } catch (err) {
    console.error("[Auth] Revoke sessions error:", err);
    return res.status(500).json({ success: false, error: "Failed to revoke sessions" });
  }
});

/**
 * POST /api/infinity/auth/revoke-session/:sessionId
 * Revoke a specific session by its token
 */
router.post("/auth/revoke-session/:sessionId", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.infinity_session;
    if (!token) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [session] = await db
      .select({ accountId: sessions.accountId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1);

    if (!session || (session.expiresAt && session.expiresAt < new Date())) {
      return res.status(401).json({ success: false, error: "Session expired" });
    }

    const { sessionId } = req.params as { sessionId: string };

    // Can't revoke own current session via this endpoint
    if (sessionId === token) {
      return res.status(400).json({ success: false, error: "Cannot revoke current session, use logout instead" });
    }

    const success = await revokeSession(sessionId);
    if (!success) {
      return res.status(404).json({ success: false, error: "Session not found or already revoked" });
    }

    return res.json({ success: true, message: "Session revoked" });
  } catch (err) {
    console.error("[Auth] Revoke session error:", err);
    return res.status(500).json({ success: false, error: "Failed to revoke session" });
  }
});

export default router;