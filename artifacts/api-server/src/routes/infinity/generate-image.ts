import { Router } from "express";
import { buildErrorDetail } from "../../lib/error-detail";

const router = Router();

const NVIDIA_IMAGE_URL = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell";

function getImageApiKey(): string {
  // Prefer the dedicated image key, fall back to the LLM key (same NIM account)
  return process.env["NVIDIA_IMAGE_API_KEY"] ?? process.env["OPENAI_LLM_API_KEY"] ?? "";
}

router.post("/generate-image", async (req, res) => {
  const startMs = Date.now();
  const { prompt, width, height, steps } = req.body as {
    prompt?: string;
    width?: number;
    height?: number;
    steps?: number;
  };

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const apiKey = getImageApiKey();
  if (!apiKey) {
    res.status(500).json({ error: "Image generation API key not configured" });
    return;
  }

  try {
    // Build the request body for flux.1-schnell (pure text-to-image, fast)
    // cfg_scale must be 0 for schnell; only width/height (no aspect_ratio)
    const body: Record<string, unknown> = {
      prompt: prompt.slice(0, 10000),
      cfg_scale: 0,
      samples: 1,
      seed: 0,
      steps: steps ?? 4,
      width: width ?? 1024,
      height: height ?? 1024,
    };

    const apiRes = await fetch(NVIDIA_IMAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for image gen
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => "Unknown error");
      req.log.error({ status: apiRes.status, body: errText }, "Image generation API error");
      res.status(502).json({
        error: `Image generation failed (${apiRes.status})`,
        detail: buildErrorDetail(
          new Error(`NVIDIA NIM image API returned ${apiRes.status}: ${errText.slice(0, 500)}`),
          req,
          502,
          startMs,
        ),
      });
      return;
    }

    const data = (await apiRes.json()) as {
      artifacts?: { base64: string; mime_type: string }[];
      image?: string;
      images?: string[];
    };

    // Extract the generated image, NVIDIA NIM returns artifacts[].base64
    let imageBase64: string | null = null;
    let mimeType = "image/png";

    if (data.artifacts && data.artifacts.length > 0) {
      imageBase64 = data.artifacts[0].base64;
      mimeType = data.artifacts[0].mime_type ?? "image/png";
    } else if (data.image) {
      imageBase64 = data.image;
    } else if (data.images && data.images.length > 0) {
      imageBase64 = data.images[0];
    }

    if (!imageBase64) {
      req.log.error({ data }, "No image in API response");
      res.status(502).json({ error: "Image generation returned no image data" });
      return;
    }

    // Persist the generated image through the storage layer (local disk or
    // R2) so it survives reloads and shows up in the Gallery. Best-effort:
    // if persistence fails the image still streams to the user immediately.
    let fileKey: string | null = null;
    try {
      const { persistFile } = await import("../../lib/storage");
      const persisted = await persistFile({
        data: Buffer.from(imageBase64, "base64"),
        mimeType,
        name: "generated-image",
        kind: "image",
        owner: "infinity",
      });
      if (persisted) fileKey = persisted.key;
    } catch {
      // Persistence is best-effort, never block image generation on it.
    }

    res.json({
      image: `data:${mimeType};base64,${imageBase64}`,
      mimeType,
      fileKey,
      imageUrl: fileKey ? `/api/files/${encodeURIComponent(fileKey)}` : undefined,
    });
  } catch (err) {
    req.log.error({ err }, "Image generation request failed");
    const detail = buildErrorDetail(err instanceof Error ? err : new Error(String(err)), req, 500, startMs);
    res.status(500).json({ error: "Image generation failed", detail });
  }
});

export default router;
