/**
 * ACP Authentication - API Key validation
 */

import { db, llmKeys } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface ACPAuthInfo {
  apiKeyId: string;
  name: string;
  projectId: string;
  scopes: string[];
}

export async function validateACPApiKey(apiKey: string): Promise<ACPAuthInfo | null> {
  try {
    const keys = await db.select().from(llmKeys).where(eq(llmKeys.source, "user-api"));
    const matchingKey = keys.find(k => k.apiKey === apiKey && k.enabled !== false);

    if (!matchingKey) {
      return null;
    }

    await db.update(llmKeys).set({ lastUsedAt: new Date() }).where(eq(llmKeys.id, matchingKey.id));

    return {
      apiKeyId: matchingKey.id,
      name: matchingKey.name,
      projectId: matchingKey.projectId || "default",
      scopes: matchingKey.scopes || ["build:read", "build:write", "project:read"],
    };
  } catch (err) {
    console.error("[ACP Auth] Error:", err);
    return null;
  }
}

export function hasScope(authInfo: ACPAuthInfo, requiredScope: string): boolean {
  return authInfo.scopes?.includes(requiredScope) || authInfo.scopes?.includes("*") === true;
}