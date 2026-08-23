import { Router } from "express";
import { db, appSecrets } from "@workspace/db";
import { eq } from "drizzle-orm";
import { invalidateKeyPool } from "../../lib/llm-client";

const router = Router();

/**
 * Every secret the app can use, with which env var each maps to and where
 * it's read. This powers the in-app API Keys status list.
 */
export const KNOWN_SECRETS: {
  env: string;
  label: string;
  description: string;
  /** If set, the value should look like this (for validation hints). */
  prefix?: string;
  /** LLM pool keys need the pool invalidated when they change. */
  llmPool?: boolean;
}[] = [
  { env: "OPENROUTER_API_KEY", label: "OpenRouter", description: "Free auto-router LLM, primary model (openrouter/free). Supports image vision.", prefix: "sk-or-", llmPool: true },
  { env: "OPENROUTER_MODEL", label: "OpenRouter model", description: "Override model, e.g. openrouter/auto. Defaults to openrouter/free.", llmPool: true },
  { env: "OPENAI_LLM_API_KEY", label: "OpenAI / NVIDIA key", description: "Fallback LLM key (openai/gpt-oss-120b via NVIDIA NIM).", llmPool: true },
  { env: "ELEVENLABS_API_KEY", label: "ElevenLabs", description: "Voice, text-to-speech (British male voice).", prefix: "sk_" },
  { env: "TAVILY_API_KEY", label: "Tavily", description: "Web search + fact-checking against the internet.", prefix: "tvly-" },
  { env: "FIGMA_ACCESS_TOKEN", label: "Figma", description: "Design-to-code, fetch real fonts/colors from Figma links." },
  // Weather needs no key: powered by Open-Meteo (free, no API key).
  { env: "GMAIL_CLIENT_ID", label: "Gmail client ID", description: "Google OAuth, calendar + email integration." },
  { env: "GMAIL_CLIENT_SECRET", label: "Gmail client secret", description: "Google OAuth secret for Gmail." },
  { env: "SPOTIFY_CLIENT_ID", label: "Spotify client ID", description: "Spotify OAuth integration." },
  { env: "SPOTIFY_CLIENT_SECRET", label: "Spotify client secret", description: "Spotify OAuth secret." },
  { env: "WEB_SEARCH_API_KEY", label: "Web search (alt)", description: "Alternative to Tavily for web search." },
  { env: "DATABASE_URL", label: "Database", description: "Postgres connection string, required for chat/history/memory.", prefix: "postgres" },
];

/** Mask a secret for display: "sk-or-••••••••WXYZ". */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 6)}••••••••${value.slice(-4)}`;
}

/**
 * Inject all DB-stored secrets into process.env. Called at boot (and on every
 * write) so existing `process.env.X` read sites pick up in-app keys. DB values
 * win over file/env values, the user explicitly chose them in-app.
 */
export async function injectDbSecretsIntoEnv(): Promise<void> {
  try {
    const rows = await db.select().from(appSecrets);
    for (const row of rows) {
      process.env[row.key] = row.value;
    }
    if (rows.length > 0) invalidateKeyPool();
  } catch (err) {
    // DB unreachable, keep whatever env already provides.
    console.error("[secrets] inject skipped:", err instanceof Error ? err.message : err);
  }
}

/** Status of a single known secret from the live env. */
export function secretStatus(env: string): { configured: boolean; masked: string | null; source: "env" | "db" | "none" } {
  const raw = process.env[env];
  if (!raw) return { configured: false, masked: null, source: "none" };
  return { configured: true, masked: maskSecret(raw), source: "db" }; // loaded from DB at boot, or env, both live in process.env now
}

/** GET, known keys + their live status. Secrets never leave the server. */
router.get("/secrets", async (req, res) => {
  try {
    const rows = await db.select().from(appSecrets);
    const dbKeys = new Set(rows.map((r) => r.key));
    const items = KNOWN_SECRETS.map((k) => {
      const s = secretStatus(k.env);
      return {
        env: k.env,
        label: k.label,
        description: k.description,
        prefix: k.prefix ?? null,
        configured: s.configured,
        masked: s.masked,
        source: dbKeys.has(k.env) ? "db" : s.source,
      };
    });
    res.json({ items, databaseConfigured: !!process.env["DATABASE_URL"] });
  } catch (err) {
    req.log.error({ err }, "Failed to list secrets");
    res.status(500).json({ error: "Failed to list secrets" });
  }
});

/** PUT, upsert a secret (sets it in the DB AND process.env immediately). */
router.put("/secrets/:key", async (req, res) => {
  try {
    const key = (req.params.key ?? "").trim().toUpperCase();
    const known = KNOWN_SECRETS.find((k) => k.env === key);
    if (!known) {
      res.status(400).json({ error: `Unknown key "${key}". Known keys: ${KNOWN_SECRETS.map((k) => k.env).join(", ")}` });
      return;
    }
    const { value, description } = req.body as { value?: string; description?: string };
    if (!value || !value.trim()) {
      res.status(400).json({ error: "value is required" });
      return;
    }
    const clean = value.trim();
    // Validate format hints so a typo'd key is caught immediately.
    if (known.prefix && !clean.startsWith(known.prefix)) {
      res.status(400).json({ error: `${key} usually starts with "${known.prefix}", double-check you pasted the full key.` });
      return;
    }
    await db
      .insert(appSecrets)
      .values({ key, value: clean, description: description ?? known.description })
      .onConflictDoUpdate({ target: appSecrets.key, set: { value: clean, description: description ?? known.description, updatedAt: new Date() } });
    // Make it live immediately, no restart needed.
    process.env[key] = clean;
    if (known.llmPool) invalidateKeyPool();
    req.log.info({ key }, "Secret saved");
    res.json({ ok: true, masked: maskSecret(clean) });
  } catch (err) {
    req.log.error({ err }, "Failed to save secret");
    res.status(500).json({ error: "Failed to save secret" });
  }
});

/** DELETE, remove a stored secret (process.env keeps its value until restart). */
router.delete("/secrets/:key", async (req, res) => {
  try {
    const key = (req.params.key ?? "").trim().toUpperCase();
    await db.delete(appSecrets).where(eq(appSecrets.key, key));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete secret");
    res.status(500).json({ error: "Failed to delete secret" });
  }
});

export default router;
