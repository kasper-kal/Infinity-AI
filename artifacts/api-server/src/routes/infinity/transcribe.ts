import { Router } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { execFile } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { buildErrorDetail } from "../../lib/error-detail";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const NVIDIA_ASR_BASE_URL = "https://ai.api.nvidia.com/v1";

function getWhisperClient(): OpenAI {
  const apiKey = process.env["OPENAI_WHISPER_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_WHISPER_API_KEY is not set");
  return new OpenAI({ apiKey, baseURL: NVIDIA_ASR_BASE_URL });
}

/** Convert any browser audio (webm/opus, wav, ogg) to 16 kHz mono FLAC via ffmpeg. */
async function convertToFlac(
  inputBuffer: Buffer,
  mimeType: string,
): Promise<Buffer> {
  const id = randomUUID();
  const ext = mimeType.includes("wav")
    ? "wav"
    : mimeType.includes("ogg")
      ? "ogg"
      : "webm";
  const inputPath = path.join(tmpdir(), `jarvis-in-${id}.${ext}`);
  const outputPath = path.join(tmpdir(), `jarvis-out-${id}.flac`);

  await writeFile(inputPath, inputBuffer);

  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-i", inputPath, "-ar", "16000", "-ac", "1", "-y", outputPath],
      (_err, _stdout, stderr) => {
        if (_err) reject(new Error(`ffmpeg conversion failed: ${stderr}`));
        else resolve();
      },
    );
  });

  const flacBuffer = await readFile(outputPath);
  await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  return flacBuffer;
}

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  const startMs = Date.now();
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  try {
    const mimeType = req.file.mimetype || "audio/webm";

    req.log.info(
      { mimeType, size: req.file.size },
      "Converting audio to FLAC for Whisper",
    );
    const flacBuffer = await convertToFlac(req.file.buffer, mimeType);

    const client = getWhisperClient();

    req.log.info({ flacBytes: flacBuffer.length }, "Sending to NVIDIA Whisper via REST");

    const file = await toFile(flacBuffer, "audio.flac", { type: "audio/flac" });

    const transcription = await client.audio.transcriptions.create({
      file,
      model: "openai/whisper-large-v3",
    });

    const transcript = transcription.text ?? "";
    req.log.info({ transcript }, "Transcription complete");
    res.json({ transcript });
  } catch (err) {
    req.log.error({ err }, "Whisper transcription failed");
    const e = err instanceof Error ? err : new Error(String(err));
    const detail = buildErrorDetail(e, req, 500, startMs);
    res.status(500).json({ error: "Transcription failed. Please try again.", detail });
  }
});

export default router;
