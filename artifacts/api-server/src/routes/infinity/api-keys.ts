import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { db, llmKeys, sessions, accounts } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { invalidateKeyPool } from "../../lib/llm-client";

/**
 * Helper: Get accountId from session cookie
 */
async function getAccountIdFromSession(req: Request): Promise<string | null> {
  const token = req.cookies?.infinity_session;
  if (!token) return null;

  const [session] = await db
    .select({ accountId: sessions.accountId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1);

  if (!session || (session.expiresAt && session.expiresAt < new Date())) {
    if (session) {
      await db.delete(sessions).where(eq(sessions.token, token));
    }
    return null;
  }

  return session.accountId;
}

const router = Router();

/**
 * POST /api/infinity/api-keys
 * Create a new user API key for headless/CLI access
 * Requires session auth (cookie)
 */
router.post("/api-keys", async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountIdFromSession(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: "Session required" });
    }

    const { name, projectId, scopes, expiresInDays } = req.body as {
      name?: string;
      projectId?: string;
      scopes?: string[];
      expiresInDays?: number;
    };

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "Key name is required" });
    }

    // Generate API key
    const apiKey = `inf_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 8)}`;

    const [key] = await db
      .insert(llmKeys)
      .values({
        name: name.trim().slice(0, 100),
        baseUrl: "https://api.infinity.local", // placeholder for user-api keys
        apiKey,
        model: "infinity-cli",
        enabled: true,
        priority: 0,
        source: "user-api",
        projectId: projectId || "default",
        scopes: scopes || ["build:read", "build:write", "project:read"],
        accountId,
      })
      .returning();

    invalidateKeyPool();

    // Return the key ONLY ONCE - user must save it
    return res.status(201).json({
      success: true,
      key: {
        id: key.id,
        name: key.name,
        apiKey, // Only returned once!
        projectId: key.projectId,
        scopes: key.scopes,
        createdAt: key.createdAt,
      },
      warning: "Save this API key now. It will not be shown again.",
    });
  } catch (err) {
    console.error("[API Keys] Create error:", err);
    return res.status(500).json({ success: false, error: "Failed to create API key" });
  }
});

/**
 * GET /api/infinity/api-keys
 * List user's API keys (never returns the actual key)
 */
router.get("/api-keys", async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountIdFromSession(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const keys = await db
      .select()
      .from(llmKeys)
      .where(and(eq(llmKeys.source, "user-api"), eq(llmKeys.accountId, accountId)))
      .orderBy(llmKeys.createdAt);

    // Mask the keys
    const maskedKeys = keys.map((k) => ({
      id: k.id,
      name: k.name,
      projectId: k.projectId,
      scopes: k.scopes,
      enabled: k.enabled,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      // Never return the actual key
      maskedKey: `${k.apiKey.slice(0, 8)}••••••••${k.apiKey.slice(-4)}`,
    }));

    return res.json({ success: true, keys: maskedKeys });
  } catch (err) {
    console.error("[API Keys] List error:", err);
    return res.status(500).json({ success: false, error: "Failed to list API keys" });
  }
});

/**
 * PUT /api/infinity/api-keys/:id
 * Update an API key (name, scopes, enabled)
 */
router.put("/api-keys/:id", async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountIdFromSession(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [existing] = await db.select().from(llmKeys).where(and(eq(llmKeys.id, req.params.id as string), eq(llmKeys.accountId, accountId)));
    if (!existing || existing.source !== "user-api") {
      return res.status(404).json({ success: false, error: "API key not found" });
    }

    const { name, scopes, enabled, projectId } = req.body as {
      name?: string;
      scopes?: string[];
      enabled?: boolean;
      projectId?: string;
    };

    const patch: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) patch.name = name.trim().slice(0, 100);
    if (Array.isArray(scopes)) patch.scopes = scopes;
    if (typeof enabled === "boolean") patch.enabled = enabled;
    if (typeof projectId === "string") patch.projectId = projectId;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: "Nothing to update" });
    }

    const [key] = await db.update(llmKeys).set(patch).where(and(eq(llmKeys.id, req.params.id as string), eq(llmKeys.accountId, accountId))).returning();
    invalidateKeyPool();

    return res.json({
      success: true,
      key: {
        id: key.id,
        name: key.name,
        projectId: key.projectId,
        scopes: key.scopes,
        enabled: key.enabled,
        createdAt: key.createdAt,
      },
    });
  } catch (err) {
    console.error("[API Keys] Update error:", err);
    return res.status(500).json({ success: false, error: "Failed to update API key" });
  }
});

/**
 * DELETE /api/infinity/api-keys/:id
 * Delete an API key
 */
router.delete("/api-keys/:id", async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountIdFromSession(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [existing] = await db.select().from(llmKeys).where(and(eq(llmKeys.id, req.params.id as string), eq(llmKeys.accountId, accountId)));
    if (!existing || existing.source !== "user-api") {
      return res.status(404).json({ success: false, error: "API key not found" });
    }

    await db.delete(llmKeys).where(and(eq(llmKeys.id, req.params.id as string), eq(llmKeys.accountId, accountId)));
    invalidateKeyPool();

    return res.json({ success: true });
  } catch (err) {
    console.error("[API Keys] Delete error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete API key" });
  }
});

/**
 * POST /api/infinity/api-keys/:id/regenerate
 * Regenerate an API key (invalidates the old one)
 */
router.post("/api-keys/:id/regenerate", async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountIdFromSession(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const [existing] = await db.select().from(llmKeys).where(and(eq(llmKeys.id, req.params.id as string), eq(llmKeys.accountId, accountId)));
    if (!existing || existing.source !== "user-api") {
      return res.status(404).json({ success: false, error: "API key not found" });
    }

    // Generate new API key
    const newApiKey = `inf_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 8)}`;

    const [key] = await db
      .update(llmKeys)
      .set({ apiKey: newApiKey })
      .where(and(eq(llmKeys.id, req.params.id as string), eq(llmKeys.accountId, accountId)))
      .returning();

    invalidateKeyPool();

    // Return the new key ONLY ONCE
    return res.json({
      success: true,
      key: {
        id: key.id,
        name: key.name,
        apiKey: newApiKey, // Only returned once!
        projectId: key.projectId,
        scopes: key.scopes,
      },
      warning: "Save this API key now. It will not be shown again.",
    });
  } catch (err) {
    console.error("[API Keys] Regenerate error:", err);
    return res.status(500).json({ success: false, error: "Failed to regenerate API key" });
  }
});

export default router;