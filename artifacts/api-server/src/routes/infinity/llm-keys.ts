import { Router } from "express";
import { db, llmKeys } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listKeys, testKey, invalidateKeyPool, NVIDIA_BASE_URL, LlmKeyTestError, type LlmKeyEntry } from "../../lib/llm-client";
import { infinityConfig } from "../../config/infinity";

const router = Router();

/** Mask a key for display: "nvapi-••••••••••••WXYZ". */
function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 6)}••••••••${apiKey.slice(-4)}`;
}

/** Public shape, never includes the raw apiKey. */
function publicEntry(k: LlmKeyEntry) {
  return {
    id: k.id,
    name: k.name,
    baseUrl: k.baseUrl,
    model: k.model,
    enabled: k.enabled,
    priority: k.priority,
    source: k.source,
    status: k.status,
    coolDownUntil: k.coolDownUntil,
    uses: k.uses,
    failures: k.failures,
    maskedKey: maskKey(k.apiKey),
  };
}

/** List all keys (env + DB) with stats. Secrets stay server-side. */
router.get("/llm-keys", async (req, res) => {
  try {
    const keys = await listKeys();
    res.json(keys.map(publicEntry));
  } catch (err) {
    req.log.error({ err }, "Failed to list LLM keys");
    res.status(500).json({ error: "Failed to list LLM keys" });
  }
});

/** Add a new provider key. */
router.post("/llm-keys", async (req, res) => {
  try {
    const { name, baseUrl, apiKey, model, priority } = req.body as {
      name?: string; baseUrl?: string; apiKey?: string; model?: string; priority?: number;
    };
    if (!name || !name.trim()) { res.status(400).json({ error: "name is required" }); return; }
    if (!apiKey || !apiKey.trim()) { res.status(400).json({ error: "apiKey is required" }); return; }
    if (!baseUrl || !baseUrl.trim().startsWith("http")) { res.status(400).json({ error: "a valid baseUrl is required" }); return; }
    const [row] = await db
      .insert(llmKeys)
      .values({
        name: name.trim().slice(0, 100),
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        apiKey: apiKey.trim(),
        model: (model?.trim() || infinityConfig.llmModel).slice(0, 200),
        priority: Number.isFinite(priority) ? Math.max(0, Math.floor(priority as number)) : 0,
      })
      .returning();
    invalidateKeyPool();
    req.log.info({ keyId: row.id, name: row.name }, "LLM key added");
    res.json(publicEntry({
      id: row.id, name: row.name, baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model,
      enabled: row.enabled, priority: row.priority, source: "llm-provider", status: row.status,
      coolDownUntil: row.coolDownUntil ? row.coolDownUntil.getTime() : null,
      uses: row.uses, failures: row.failures,
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to add LLM key");
    res.status(500).json({ error: "Failed to add LLM key" });
  }
});

/** Update a DB key (name/baseUrl/model/enabled/priority; apiKey optional to keep). */
router.put("/llm-keys/:id", async (req, res) => {
  try {
    const [existing] = await db.select().from(llmKeys).where(eq(llmKeys.id, req.params.id));
    if (!existing) { res.status(404).json({ error: "Key not found" }); return; }
    const { name, baseUrl, apiKey, model, enabled, priority } = req.body as {
      name?: string; baseUrl?: string; apiKey?: string; model?: string; enabled?: boolean; priority?: number;
    };
    const patch: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) patch.name = name.trim().slice(0, 100);
    if (typeof baseUrl === "string" && baseUrl.trim().startsWith("http")) patch.baseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (typeof apiKey === "string" && apiKey.trim()) patch.apiKey = apiKey.trim();
    if (typeof model === "string" && model.trim()) patch.model = model.trim().slice(0, 200);
    if (typeof enabled === "boolean") patch.enabled = enabled;
    if (typeof priority === "number" && Number.isFinite(priority)) patch.priority = Math.max(0, Math.floor(priority));
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
    const [row] = await db.update(llmKeys).set(patch).where(eq(llmKeys.id, req.params.id)).returning();
    invalidateKeyPool();
    res.json(publicEntry({
      id: row.id, name: row.name, baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model,
      enabled: row.enabled, priority: row.priority, source: "llm-provider", status: row.status,
      coolDownUntil: row.coolDownUntil ? row.coolDownUntil.getTime() : null,
      uses: row.uses, failures: row.failures,
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to update LLM key");
    res.status(500).json({ error: "Failed to update LLM key" });
  }
});

/** Delete a DB key. */
router.delete("/llm-keys/:id", async (req, res) => {
  try {
    await db.delete(llmKeys).where(eq(llmKeys.id, req.params.id));
    invalidateKeyPool();
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete LLM key");
    res.status(500).json({ error: "Failed to delete LLM key" });
  }
});

/** Test a key (env or DB) with a tiny completion. */
router.post("/llm-keys/:id/test", async (req, res) => {
  try {
    const result = await testKey(req.params.id);
    res.json(result);
  } catch (err) {
    if (err instanceof LlmKeyTestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to test LLM key");
    res.status(500).json({ error: "Failed to test LLM key" });
  }
});

export default router;
export { NVIDIA_BASE_URL };
