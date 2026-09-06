/**
 * LLM Key Storage Interface
 * Provides CRUD operations for LLM keys with metadata, failover chains, and cost tracking
 */

import { db, llmKeys, secrets } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import type { LlmKey } from "@workspace/db";

export interface LLMKey {
  id: string;
  userId: string;
  label: string;
  provider: string;
  encryptedKey: string;
  modelAccess: string[];
  rateLimit: { requestsPerMinute: number; tokensPerMinute: number };
  budget: { monthlyLimit: number; alertThresholds: number[] };
  isDefault: boolean;
  failoverChain: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsed?: Date;
  lastTested?: Date;
}

export interface LLMKeyUsage {
  id: string;
  keyId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  taskCategory?: string;
  timestamp: Date;
}

function rowToLLMKey(row: any): LLMKey {
  return {
    id: row.id,
    userId: row.accountId,
    label: row.name,
    provider: row.provider,
    encryptedKey: row.apiKey,
    modelAccess: row.modelAccess || [row.model],
    rateLimit: row.rateLimit || { requestsPerMinute: 60, tokensPerMinute: 100000 },
    budget: row.budget || { monthlyLimit: 100, alertThresholds: [0.5, 0.8, 0.95] },
    isDefault: row.isDefault || false,
    failoverChain: row.failoverChain || [],
    isActive: row.enabled !== false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
    lastUsed: row.lastUsedAt,
    lastTested: row.lastTested,
  };
}

export const storage = {
  /**
   * Get all LLM keys for a user
   */
  async getLLMKeys(userId: string): Promise<LLMKey[]> {
    const rows = await db
      .select()
      .from(llmKeys)
      .where(and(eq(llmKeys.accountId, userId), eq(llmKeys.source, "user-api")))
      .orderBy(desc(llmKeys.createdAt));
    return rows.map(rowToLLMKey);
  },

  /**
   * Create a new LLM key
   */
  async createLLMKey(data: {
    userId: string;
    label: string;
    provider: string;
    encryptedKey: string;
    modelAccess?: string[];
    rateLimit?: { requestsPerMinute: number; tokensPerMinute: number };
    budget?: { monthlyLimit: number; alertThresholds: number[] };
    isDefault?: boolean;
    failoverChain?: string[];
    isActive?: boolean;
  }): Promise<LLMKey> {
    // If setting as default, unset other defaults first
    if (data.isDefault) {
      await db
        .update(llmKeys)
        .set({ isDefault: false })
        .where(and(eq(llmKeys.accountId, data.userId), eq(llmKeys.source, "user-api")));
    }

    const [inserted] = await db
      .insert(llmKeys)
      .values({
        accountId: data.userId,
        name: data.label,
        baseUrl: this.getProviderBaseUrl(data.provider),
        apiKey: data.encryptedKey,
        model: data.modelAccess?.[0] || this.getDefaultModel(data.provider),
        modelAccess: data.modelAccess || [],
        rateLimit: data.rateLimit,
        budget: data.budget,
        isDefault: data.isDefault || false,
        failoverChain: data.failoverChain || [],
        enabled: data.isActive !== false,
        source: "user-api",
        scopes: ["llm"],
      })
      .returning();

    return rowToLLMKey(inserted);
  },

  /**
   * Get a specific LLM key by ID
   */
  async getLLMKey(keyId: string): Promise<LLMKey | null> {
    const [row] = await db
      .select()
      .from(llmKeys)
      .where(eq(llmKeys.id, keyId))
      .limit(1);
    return row ? rowToLLMKey(row) : null;
  },

  /**
   * Update an LLM key
   */
  async updateLLMKey(
    keyId: string,
    data: Partial<Pick<LLMKey, "label" | "modelAccess" | "rateLimit" | "budget" | "isDefault" | "failoverChain" | "isActive">>
  ): Promise<LLMKey | null> {
    // If setting as default, unset other defaults first
    if (data.isDefault) {
      const key = await this.getLLMKey(keyId);
      if (key) {
        await db
          .update(llmKeys)
          .set({ isDefault: false })
          .where(and(eq(llmKeys.accountId, key.userId), eq(llmKeys.source, "user-api")));
      }
    }

    const updateData: any = {};
    if (data.label !== undefined) updateData.name = data.label;
    if (data.modelAccess !== undefined) {
      updateData.modelAccess = data.modelAccess;
      updateData.model = data.modelAccess[0];
    }
    if (data.rateLimit !== undefined) updateData.rateLimit = data.rateLimit;
    if (data.budget !== undefined) updateData.budget = data.budget;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
    if (data.failoverChain !== undefined) updateData.failoverChain = data.failoverChain;
    if (data.isActive !== undefined) updateData.enabled = data.isActive;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(llmKeys)
      .set(updateData)
      .where(eq(llmKeys.id, keyId))
      .returning();

    return updated ? rowToLLMKey(updated) : null;
  },

  /**
   * Delete an LLM key
   */
  async deleteLLMKey(keyId: string): Promise<void> {
    await db.delete(llmKeys).where(eq(llmKeys.id, keyId));
  },

  /**
   * Set an LLM key as default for a user
   */
  async setDefaultLLMKey(userId: string, keyId: string): Promise<void> {
    await db
      .update(llmKeys)
      .set({ isDefault: false })
      .where(and(eq(llmKeys.accountId, userId), eq(llmKeys.source, "user-api")));

    await db
      .update(llmKeys)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(llmKeys.id, keyId));
  },

  /**
   * Get the default LLM key for a user
   */
  async getDefaultLLMKey(userId: string): Promise<LLMKey | null> {
    const [row] = await db
      .select()
      .from(llmKeys)
      .where(and(eq(llmKeys.accountId, userId), eq(llmKeys.source, "user-api"), eq(llmKeys.isDefault, true)))
      .limit(1);
    return row ? rowToLLMKey(row) : null;
  },

  /**
   * Get usage statistics for a key
   */
  async getLLMKeyUsage(keyId: string, days: number = 30): Promise<LLMKeyUsage[]> {
    // This would typically query a usage tracking table
    // For now, return empty array - usage tracking can be added later
    return [];
  },

  // Helper methods
  getProviderBaseUrl(provider: string): string {
    const baseUrls: Record<string, string> = {
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com/v1",
      google: "https://generativelanguage.googleapis.com/v1beta",
      ollama: "http://localhost:11434/v1",
      openrouter: "https://openrouter.ai/api/v1",
      lmstudio: "http://localhost:1234/v1",
      custom: "",
    };
    return baseUrls[provider] || "";
  },

  getDefaultModel(provider: string): string {
    const models: Record<string, string> = {
      openai: "gpt-4o-mini",
      anthropic: "claude-3-5-haiku",
      google: "gemini-1.5-flash",
      ollama: "llama3.1:8b",
      openrouter: "openrouter/auto",
      lmstudio: "local-model",
      custom: "custom-model",
    };
    return models[provider] || "unknown";
  },
};

export default storage;