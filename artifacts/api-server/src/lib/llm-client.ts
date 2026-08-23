/**
 * LLM Key Manager, multi-provider key rotation.
 *
 * The pool is built from two sources:
 *   1. Env keys  , OPENAI_LLM_API_KEY (+ _2 … _9, with optional matching
 *                   OPENAI_LLM_BASE_URL / OPENAI_LLM_BASE_URL_2 …). Always
 *                   available; health is tracked in memory.
 *   2. DB keys   , rows added in Settings → LLM Keys (per-provider base URL +
 *                   model). Health/stats persist across restarts.
 *
 * Behaviour:
 *   - Each key is tried 4 times with a 5s cooldown between attempts before
 *     the next key is used. Every error class is retried the full 4 times;
 *     a key is only quarantined after all 4 attempts have failed.
 *   - `runWithLLM` retries across keys automatically; a quota error on key A
 *     silently tries key B. The user only ever sees an error when EVERY key
 *     has genuinely failed, and a push notification is sent saying so.
 *   - Chat and voice use MANUAL mode instead (`resolveManualKey` +
 *     `runOnceWithKey`): one attempt on the chosen key, then the user decides
 *     to retry the same key or move to the next one.
 *   - Keys are quarantined per error class: 401/403 → 24h (bad key),
 *     402/429/quota → 45min, bad model → 30min, transient → 5min.
 *   - `getHealthyKeys()` returns [] when everything is cooling, callers
 *     (deep research) can then pause + notify + auto-resume.
 */

import OpenAI from "openai";
import { db, llmKeys } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { infinityConfig } from "../config/infinity";
import { logger } from "./logger";
import { notifyAll } from "./web-push";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export type KeyStatus = "healthy" | "cooling" | "quarantined";

export interface LlmKeyEntry {
  id: string;                 // uuid for DB keys, "env-1"… for env keys
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  priority: number;
  source: "env" | "llm-provider" | "user-api";
  status: KeyStatus;
  coolDownUntil: number | null; // epoch ms
  uses: number;
  failures: number;
  /** Provider identifier for cost tracking (e.g., "openrouter", "nvidia", "ollama") */
  provider?: string;
  /** Cost per 1k tokens in USD (0 for free tiers) */
  costPer1kTokens?: number;
}

/** How many times each API key is tried before moving to the next key. */
export const LLM_KEY_ATTEMPTS = 4;
/** Cooldown in milliseconds between attempts on the same key. */
export const LLM_KEY_ATTEMPT_COOLDOWN_MS = 5_000;

/** Throttle the all-keys-failed push notification to one per minute. */
let lastAllFailedNotifiedAt = 0;
const ALL_FAILED_NOTIFY_THROTTLE_MS = 60_000;

export class LLMAllKeysCoolingError extends Error {
  constructor(message?: string) {
    super(message ?? "All LLM keys are currently cooling down (quota/rate limits).");
    this.name = "LLMAllKeysCoolingError";
  }
}

/** Thrown when a single explicit key test fails (Settings → test button). */
export class LlmKeyTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmKeyTestError";
  }
}

/* ── env-virtual keys ─────────────────────────────────────────── */

interface EnvHealth { status: KeyStatus; coolDownUntil: number | null; uses: number; failures: number }
const envHealth = new Map<string, EnvHealth>();

function envKeyEntries(): LlmKeyEntry[] {
  const out: LlmKeyEntry[] = [];

  // OpenRouter (optional but preferred when set), the free auto-router
  // model `openrouter/free` picks the best free provider per request and
  // routes to a vision-capable model automatically when an image is sent.
  const openRouterKey = process.env["OPENROUTER_API_KEY"];
  if (openRouterKey) {
    const h = envHealth.get(openRouterKey);
    out.push({
      id: "env-openrouter",
      name: "Env: OpenRouter (free auto-router)",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: openRouterKey,
      model: process.env["OPENROUTER_MODEL"] ?? "openrouter/free",
      enabled: true,
      priority: 1, // highest, tried first, NVIDIA keys become failover
      source: "env",
      status: h?.status ?? "healthy",
      coolDownUntil: h?.coolDownUntil ?? null,
      uses: h?.uses ?? 0,
      failures: h?.failures ?? 0,
      provider: "openrouter",
      costPer1kTokens: 0, // free tier
    });
  }

  for (let i = 1; i <= 9; i++) {
    const apiKey = process.env[i === 1 ? "OPENAI_LLM_API_KEY" : `OPENAI_LLM_API_KEY_${i}`];
    if (!apiKey) continue;
    const baseUrl = process.env[i === 1 ? "OPENAI_LLM_BASE_URL" : `OPENAI_LLM_BASE_URL_${i}`] ?? NVIDIA_BASE_URL;
    const h = envHealth.get(apiKey);
    let provider = "nvidia";
    let costPer1kTokens = 0; // NVIDIA NIM is free
    if (baseUrl.includes("openrouter")) {
      provider = "openrouter";
      costPer1kTokens = 0;
    } else if (baseUrl.includes("ollama") || baseUrl.includes("localhost:11434")) {
      provider = "ollama";
      costPer1kTokens = 0;
    } else if (baseUrl.includes("vllm")) {
      provider = "vllm";
      costPer1kTokens = 0;
    }
    out.push({
      id: `env-${i}`,
      name: i === 1 ? "Env: primary LLM key" : `Env: LLM key #${i}`,
      baseUrl,
      apiKey,
      model: infinityConfig.llmModel,
      enabled: true,
      priority: 100 - i,
      source: "env",
      status: h?.status ?? "healthy",
      coolDownUntil: h?.coolDownUntil ?? null,
      uses: h?.uses ?? 0,
      failures: h?.failures ?? 0,
      provider,
      costPer1kTokens,
    });
  }
  return out;
}

/* ── DB keys with a short cache ───────────────────────────────── */

interface PoolRow {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  priority: number;
  status: KeyStatus;
  coolDownUntil: Date | null;
  uses: number;
  failures: number;
  source: "llm-provider" | "user-api";
  projectId: string | null;
  scopes: string[] | null;
}

function toEntry(r: PoolRow): LlmKeyEntry {
  let provider = "llm-provider";
  let costPer1kTokens = 0;
  const baseUrl = r.baseUrl.toLowerCase();
  if (baseUrl.includes("openrouter")) {
    provider = "openrouter";
    costPer1kTokens = 0; // free tier
  } else if (baseUrl.includes("nvidia")) {
    provider = "nvidia";
    costPer1kTokens = 0; // free tier
  } else if (baseUrl.includes("ollama") || baseUrl.includes("localhost:11434")) {
    provider = "ollama";
    costPer1kTokens = 0;
  } else if (baseUrl.includes("vllm")) {
    provider = "vllm";
    costPer1kTokens = 0;
  } else if (baseUrl.includes("groq")) {
    provider = "groq";
    costPer1kTokens = 0; // free tier
  } else if (baseUrl.includes("api.openai.com")) {
    provider = "openai";
    costPer1kTokens = 0.0015; // rough estimate
  } else if (baseUrl.includes("anthropic")) {
    provider = "anthropic";
    costPer1kTokens = 0.003; // rough estimate
  }

  return {
    id: r.id,
    name: r.name,
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    model: r.model,
    enabled: r.enabled,
    priority: r.priority,
    source: r.source === "user-api" ? "user-api" : "llm-provider",
    status: r.status,
    coolDownUntil: r.coolDownUntil ? r.coolDownUntil.getTime() : null,
    uses: r.uses,
    failures: r.failures,
    provider,
    costPer1kTokens,
  };
}

let poolCache: { rows: PoolRow[]; at: number } | null = null;
const POOL_TTL_MS = 5000;

/** Invalidate the pool cache (called by the CRUD routes after mutations). */
export function invalidateKeyPool(): void {
  poolCache = null;
}

async function dbKeyEntries(): Promise<LlmKeyEntry[]> {
  if (poolCache && Date.now() - poolCache.at < POOL_TTL_MS) {
    return poolCache.rows.map((r) => toEntry(r));
  }
  try {
    const rows = await db.select().from(llmKeys).orderBy(asc(llmKeys.priority), asc(llmKeys.createdAt));
    const mapped = rows.map((r) => ({
      id: r.id,
      name: r.name,
      baseUrl: r.baseUrl,
      apiKey: r.apiKey,
      model: r.model,
      enabled: r.enabled,
      priority: r.priority,
      status: r.status as KeyStatus,
      coolDownUntil: r.coolDownUntil,
      uses: r.uses,
      failures: r.failures,
      source: r.source as "llm-provider" | "user-api",
      projectId: r.projectId,
      scopes: r.scopes,
    }));
    poolCache = { rows: mapped, at: Date.now() };
    return mapped.map((r) => toEntry(r));
  } catch {
    // DB unavailable (e.g. migration not run yet), fall back to env keys only.
    return [];
  }
}

/** Effective status, a key whose cooldown has passed is healthy again. */
function effectiveStatus(k: LlmKeyEntry): KeyStatus {
  if (!k.enabled) return "quarantined"; // treated as unavailable
  if (k.coolDownUntil && Date.now() < k.coolDownUntil) return k.status;
  return "healthy";
}

export function isHealthy(k: LlmKeyEntry): boolean {
  return effectiveStatus(k) === "healthy";
}

/** All pool entries (env + DB), for the settings UI / stats. */
export async function listKeys(): Promise<LlmKeyEntry[]> {
  const dbKeys = await dbKeyEntries();
  const envKeys = envKeyEntries();
  // DB keys first (by priority), then env keys, avoid duplicate env ids.
  return [...dbKeys, ...envKeys].sort((a, b) => a.priority - b.priority);
}

/** Only the keys that may be used right now. */
export async function getHealthyKeys(): Promise<LlmKeyEntry[]> {
  const all = await listKeys();
  return all.filter(isHealthy);
}

/* ── health reporting ─────────────────────────────────────────── */

function classifyError(err: unknown): { status: KeyStatus; minutes: number } {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (status === 401 || status === 403 || /unauthorized|invalid api key|permissiondenied|forbidden/.test(msg)) {
    return { status: "quarantined", minutes: 24 * 60 };
  }
  if (status === 402 || status === 429 || /insufficient_quota|rate limit|quota|429|402|limit reached|daily limit|tokens per day/.test(msg)) {
    return { status: "cooling", minutes: 45 };
  }
  if (status === 400 || /model.*not found|no such model|does not exist|model not supported/.test(msg)) {
    return { status: "cooling", minutes: 30 };
  }
  return { status: "cooling", minutes: 5 };
}

async function reportSuccess(key: LlmKeyEntry): Promise<void> {
  if (key.source === "llm-provider" && key.id) {
    try {
      await db
        .update(llmKeys)
        .set({
          status: "healthy",
          coolDownUntil: null,
          failures: 0,
          uses: sql`${llmKeys.uses} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(llmKeys.id, key.id));
    } catch { /* stats are best-effort */ }
  } else {
    const h = envHealth.get(key.apiKey) ?? { status: "healthy" as KeyStatus, coolDownUntil: null, uses: 0, failures: 0 };
    h.status = "healthy";
    h.coolDownUntil = null;
    h.failures = 0;
    h.uses += 1;
    envHealth.set(key.apiKey, h);
  }
}

async function reportFailure(key: LlmKeyEntry, err: unknown): Promise<void> {
  const { status, minutes } = classifyError(err);
  const until = new Date(Date.now() + minutes * 60_000);
  if (key.source === "llm-provider" && key.id) {
    try {
      await db
        .update(llmKeys)
        .set({
          status,
          coolDownUntil: until,
          failures: sql`${llmKeys.failures} + 1`,
        })
        .where(eq(llmKeys.id, key.id));
    } catch { /* best-effort */ }
  } else {
    const h = envHealth.get(key.apiKey) ?? { status: "healthy" as KeyStatus, coolDownUntil: null, uses: 0, failures: 0 };
    h.status = status;
    h.coolDownUntil = until.getTime();
    h.failures += 1;
    envHealth.set(key.apiKey, h);
  }
  logger.warn({ key: key.name, status, minutes, err: err instanceof Error ? err.message.slice(0, 200) : String(err) }, "LLM key quarantined");
}

/* ── failover runner ──────────────────────────────────────────── */

/**
 * Run `fn(client, model)` with automatic failover across healthy keys.
 * - Tries the highest-priority healthy key first (OpenRouter when configured).
 * - Each key is tried LLM_KEY_ATTEMPTS times with a 10s cooldown between
 *   attempts. Only after all attempts fail does it move to the next key.
 * - Only throws LLMAllKeysCoolingError once every key has failed (or none are
 *   healthy), and sends a push notification reporting the total failure.
 */
export async function runWithLLM<T>(fn: (client: OpenAI, model: string) => Promise<T>): Promise<T> {
  const keys = await getHealthyKeys();
  if (keys.length === 0) {
    const firstFailure = new LLMAllKeysCoolingError();
    await notifyAllKeysFailed(firstFailure);
    throw firstFailure;
  }

  // Always try the highest-priority healthy key first (OpenRouter when
  // configured), then fail over down the list. Lower priority number =
  // higher priority. Removed round-robin: with OpenRouter configured the
  // user expects it to be THE model, not every-other-request.
  const order = [...keys].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  let lastErr: unknown = null;
  for (const key of order) {
    const client = new OpenAI({ apiKey: key.apiKey, baseURL: key.baseUrl });
    // Every error class is retried the full LLM_KEY_ATTEMPTS times on the
    // same key (rate limits often clear within tens of seconds), with a 10s
    // cooldown between attempts. The key is only quarantined once all
    // attempts on it have failed, then the next key is tried.
    for (let attempt = 0; attempt < LLM_KEY_ATTEMPTS; attempt++) {
      try {
        const result = await fn(client, key.model);
        await reportSuccess(key);
        return result;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const why = err instanceof Error ? err.message : String(err);
        lastErr = new Error(`${key.name} (${status ? `HTTP ${status}` : "network"}): ${why.slice(0, 200)}`);
        if (attempt < LLM_KEY_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, LLM_KEY_ATTEMPT_COOLDOWN_MS));
        }
      }
    }
    // All attempts on this key failed, quarantine it for the next run.
    await reportFailure(key, lastErr);
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const exhausted = new LLMAllKeysCoolingError(`All ${keys.length} LLM key(s) failed. ${detail.slice(0, 400)}`);
  await notifyAllKeysFailed(exhausted);
  throw exhausted;
}

/* ── manual (chat/voice) mode ─────────────────────────────────── */

/**
 * Pick the key for a manual chat/voice attempt.
 * - `keyId` given  : force-use that key, even if it is currently cooling or
 *                    quarantined. The user explicitly chose it, respect that.
 * - no `keyId`      : the best healthy key; if none are healthy, fall back to
 *                    the highest-priority key anyway so the user can decide
 *                    what to do from the manual retry error.
 * Throws LLMAllKeysCoolingError only when there are no keys at all.
 */
export async function resolveManualKey(keyId?: string): Promise<LlmKeyEntry> {
  const all = await listKeys();
  if (all.length === 0) {
    throw new LLMAllKeysCoolingError("No LLM keys are configured.");
  }
  if (keyId) {
    const key = all.find((k) => k.id === keyId);
    if (!key) throw new LLMAllKeysCoolingError(`LLM key \"${keyId}\" was not found.`);
    return key;
  }
  return all.find(isHealthy) ?? all[0];
}

/**
 * Run `fn(client, model)` exactly once against ONE specific key, the manual
 * mode used by chat and voice. Reports success/failure to the health pool
 * (so stats stay accurate), but never retries, never loops to the next key,
 * and never sends the all-keys-failed notification. The caller decides what
 * to do next and surfaces the manual retry choices to the user.
 */
export async function runOnceWithKey<T>(key: LlmKeyEntry, fn: (client: OpenAI, model: string) => Promise<T>): Promise<T> {
  const client = new OpenAI({ apiKey: key.apiKey, baseURL: key.baseUrl });
  try {
    const result = await fn(client, key.model);
    await reportSuccess(key);
    return result;
  } catch (err) {
    await reportFailure(key, err);
    throw err;
  }
}

/**
 * Push-notify that every API key has failed, throttled so a burst of
 * concurrent failing requests only produces one notification. Fire-and-forget,
 * never throws.
 */
async function notifyAllKeysFailed(err: Error): Promise<void> {
  const now = Date.now();
  if (now - lastAllFailedNotifiedAt < ALL_FAILED_NOTIFY_THROTTLE_MS) return;
  lastAllFailedNotifiedAt = now;
  try {
    await notifyAll(
      "Infinity failed with every API key",
      "Every configured AI provider failed. Infinity could not resume the request, please try again later.",
      "/",
    );
  } catch {
    // Notifications are best-effort, the error still propagates to the caller.
  }
  logger.warn({ err: err.message.slice(0, 300) }, "All LLM keys failed, notification sent");
}

/** Test a single key (Settings → Test). Throws LlmKeyTestError on failure. */

/* ── client façade ──────────────────────────────────────────────── */

/**
 * OpenAI-client façade over the key pool. Keeps existing
 * `client.chat.completions.create(...)` call sites unchanged while every
 * call transparently fails over across healthy keys (env + DB pool).
 * The pool overrides `model` per key; all other params pass through.
 */
export function pooledClient(): {
  chat: { completions: { create: (params: unknown) => Promise<any> } };
} {
  return {
    chat: {
      completions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (params: unknown) =>
          runWithLLM((client, model) =>
            client.chat.completions.create({
              ...(params as object),
              model,
            } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming | OpenAI.Chat.ChatCompletionCreateParamsStreaming),
          ) as Promise<any>,
      },
    },
  };
}

export async function testKey(keyId: string): Promise<{ ok: boolean; latencyMs: number; model: string; error?: string }> {
  const all = await listKeys();
  const key = all.find((k) => k.id === keyId);
  if (!key) throw new LlmKeyTestError("Key not found");
  const client = new OpenAI({ apiKey: key.apiKey, baseURL: key.baseUrl });
  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create({
      model: key.model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 4,
      temperature: 0,
    });
    const latencyMs = Date.now() - t0;
    const text = res.choices[0]?.message?.content ?? "";
    if (res.choices.length === 0 && !text) {
      throw new LlmKeyTestError("Model returned no output");
    }
    await reportSuccess(key);
    return { ok: true, latencyMs, model: key.model };
  } catch (err) {
    if (err instanceof LlmKeyTestError) throw err;
    await reportFailure(key, err);
    const status = (err as { status?: number })?.status;
    const msg = err instanceof Error ? err.message : String(err);
    throw new LlmKeyTestError(status ? `HTTP ${status}: ${msg.slice(0, 200)}` : msg.slice(0, 200));
  }
}
