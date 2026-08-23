import { Router } from "express";
import { buildErrorDetail } from "../../lib/error-detail";
import { infinityConfig } from "../../config/infinity";

const router = Router();

router.post("/speak", async (req, res) => {
  const startMs = Date.now();
  const { text } = req.body as { text: string };

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    const err = new Error("ELEVENLABS_API_KEY is not set");
    const detail = buildErrorDetail(err, req, 500, startMs);
    res.status(500).json({ error: "ELEVENLABS_API_KEY is not set", detail });
    return;
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${infinityConfig.ttsVoiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: infinityConfig.ttsModel,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      req.log.error({ status: response.status, errText }, "ElevenLabs TTS failed");
      // Pull the human-readable reason out of ElevenLabs' JSON error body so
      // the frontend can tell the user *why* (invalid key, quota, voice not
      // found, model retired, etc.) instead of a generic "please try again".
      let reason = `ElevenLabs returned HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errText) as { detail?: { message?: string }; message?: string };
        reason = parsed.detail?.message ?? parsed.message ?? reason;
      } catch { /* keep default */ }
      const err = new Error(`ElevenLabs TTS failed (${response.status}): ${reason}`);
      const detail = buildErrorDetail(err, req, 500, startMs);
      res.status(500).json({ error: `Speech synthesis failed, ${reason}`, detail });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const audioBase64 = buffer.toString("base64");

    res.json({ audio: audioBase64, contentType: "audio/mpeg" });
  } catch (err) {
    req.log.error({ err }, "ElevenLabs TTS failed");
    const e = err instanceof Error ? err : new Error(String(err));
    const detail = buildErrorDetail(e, req, 500, startMs);
    res.status(500).json({ error: "Speech synthesis failed. Please try again.", detail });
  }
});

export default router;
