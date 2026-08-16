import { Request, Response, NextFunction } from "express";
import { db, llmKeys } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * API Key authentication middleware for headless/CLI access.
 *
 * Supports two types of API keys:
 * 1. User API keys stored in the llm_keys table (with `source: "user-api"`)
 * 2. Project-scoped build API keys (future enhancement)
 *
 * Usage: Add `Authorization: Bearer <api-key>` header
 * Or use `x-api-key: <api-key>` header
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Check for Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  let apiKey: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  }
  // Also support x-api-key header
  else if (req.headers["x-api-key"]) {
    apiKey = req.headers["x-api-key"] as string;
  }

  if (!apiKey) {
    res.status(401).json({
      success: false,
      error: "API key required. Provide via 'Authorization: Bearer <key>' or 'x-api-key: <key>' header.",
    });
    return;
  }

  try {
    // Look up the API key in the database
    // We'll store user API keys in llmKeys table with source="user-api"
    const keys = await db.select().from(llmKeys).where(eq(llmKeys.source, "user-api"));

    const matchingKey = keys.find(k => k.apiKey === apiKey && k.enabled !== false);

    if (!matchingKey) {
      res.status(401).json({
        success: false,
        error: "Invalid or disabled API key",
      });
      return;
    }

    // Attach key info to request for downstream use
    (req as any).apiKeyInfo = {
      id: matchingKey.id,
      name: matchingKey.name,
      projectId: matchingKey.projectId || "default",
      scopes: matchingKey.scopes || ["build:read", "build:write", "project:read"],
    };

    // Update last used timestamp
    await db.update(llmKeys).set({ lastUsedAt: new Date() }).where(eq(llmKeys.id, matchingKey.id));

    next();
  } catch (err) {
    console.error("[API Key Auth] Error:", err);
    res.status(500).json({ success: false, error: "Authentication error" });
  }
}

/**
 * Optional API key auth - doesn't fail if no key provided, but attaches info if valid
 */
export async function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  let apiKey: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  } else if (req.headers["x-api-key"]) {
    apiKey = req.headers["x-api-key"] as string;
  }

  if (!apiKey) {
    next();
    return;
  }

  try {
    const keys = await db.select().from(llmKeys).where(eq(llmKeys.source, "user-api"));
    const matchingKey = keys.find(k => k.apiKey === apiKey && k.enabled !== false);

    if (matchingKey) {
      (req as any).apiKeyInfo = {
        id: matchingKey.id,
        name: matchingKey.name,
        projectId: matchingKey.projectId || "default",
        scopes: matchingKey.scopes || ["build:read", "build:write", "project:read"],
      };
      await db.update(llmKeys).set({ lastUsedAt: new Date() }).where(eq(llmKeys.id, matchingKey.id));
    }
  } catch (err) {
    // Silently fail for optional auth
    console.error("[Optional API Key Auth] Error:", err);
  }

  next();
}

/**
 * Check if request has a specific scope
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKeyInfo = (req as any).apiKeyInfo;

    if (!apiKeyInfo) {
      res.status(401).json({ success: false, error: "API key required" });
      return;
    }

    const hasScope = requiredScopes.some(scope => apiKeyInfo.scopes?.includes(scope));

    if (!hasScope) {
      res.status(403).json({
        success: false,
        error: `Insufficient scope. Required: ${requiredScopes.join(" or ")}`
      });
      return;
    }

    next();
  };
}