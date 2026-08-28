import { Router } from "express";
import { db, infinitySettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildErrorDetail } from "../../lib/error-detail";
import { infinityConfig } from "../../config/infinity";

const router = Router();

const ALLOWED_KEYS = [
  "weather_location",
  "calendar_ics_url_1",
  "calendar_ics_url_2",
  "calendar_ics_url_3",
  "calendar_ics_url_4",
  "calendar_ics_url_5",
  "calendar_name_1",
  "calendar_name_2",
  "calendar_name_3",
  "calendar_name_4",
  "calendar_name_5",
  "personality",
  "auto_personality",
  "custom_personality_prompt",
  "web_search_enabled",
  "google_calendar_enabled",
  "user_profile",
  "default_framework",
] as const;
type SettingKey = (typeof ALLOWED_KEYS)[number];

/** GET /api/infinity/settings, returns all settings as a key→value map */
router.get("/settings", async (req, res) => {
  const startMs = Date.now();
  try {
    const rows = await db.select().from(infinitySettings);
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;
    res.json(map);
  } catch (err) {
    req.log.error({ err }, "Failed to read settings");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to read settings", detail });
  }
});

/** PUT /api/infinity/settings, upsert one or more settings */
router.put("/settings", async (req, res) => {
  const startMs = Date.now();
  const body = req.body as Partial<Record<SettingKey, string>>;

  const entries = Object.entries(body).filter(([k]) =>
    ALLOWED_KEYS.includes(k as SettingKey),
  ) as [SettingKey, string][];

  if (entries.length === 0) {
    res.status(400).json({ error: "No valid settings provided" });
    return;
  }

  try {
    for (const [key, value] of entries) {
      if (value === "" || value === null) {
        await db.delete(infinitySettings).where(eq(infinitySettings.key, key));
      } else {
        await db
          .insert(infinitySettings)
          .values({ key, value, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: infinitySettings.key,
            set: { value, updatedAt: new Date() },
          });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save settings");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Failed to save settings", detail });
  }
});

/** GET /api/infinity/system-prompt, returns the system prompt (power user visibility) */
router.get("/system-prompt", (_req, res) => {
  res.json({
    prompt: infinityConfig.systemPrompt,
    model: infinityConfig.llmModel,
    voice: infinityConfig.ttsVoiceId,
    ttsModel: infinityConfig.ttsModel,
  });
});

export default router;
