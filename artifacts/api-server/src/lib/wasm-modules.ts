/**
 * Lazy-loaded heavy modules for the File Format Converter.
 *
 * Each loader caches its singleton after first use so the heavy binaries are
 * only pulled into memory when a conversion actually needs them. All modules
 * are free, open-source and run 100% locally — no cloud, $0 budget.
 *
 * Audio/video conversion uses `ffmpeg-static`, a precompiled static FFmpeg
 * binary (v7.x), executed as a child process. The browser-only `@ffmpeg/ffmpeg`
 * WASM build explicitly refuses Node (`exports.node` → empty.mjs), so the
 * binary is the reliable local path for a server runtime.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ============================================================================
// Sharp (images) — native lib, cached singleton
// ============================================================================
let sharpModule: typeof import("sharp") | null = null;
export async function ensureSharp(): Promise<typeof import("sharp")> {
  if (!sharpModule) {
    sharpModule = await import("sharp");
  }
  return sharpModule;
}

// ============================================================================
// SheetJS (spreadsheets) — pure JS, cached singleton
// ============================================================================
let sheetjsModule: typeof import("xlsx") | null = null;
export async function ensureSheetJS(): Promise<typeof import("xlsx")> {
  if (!sheetjsModule) {
    sheetjsModule = await import("xlsx");
  }
  return sheetjsModule;
}

// ============================================================================
// FFmpeg (audio/video) — static binary via ffmpeg-static
// ============================================================================
let cachedFfmpegPath: string | null = null;

/** Returns the absolute path to the static FFmpeg binary. */
export function ffmpegBinaryPath(): string {
  if (!cachedFfmpegPath) {
    const resolved = require("ffmpeg-static") as string | null | undefined;
    if (!resolved) {
      throw new Error("ffmpeg-static binary not found — re-run `pnpm rebuild ffmpeg-static` to download it");
    }
    cachedFfmpegPath = resolved;
  }
  return cachedFfmpegPath;
}

export async function ensureFFmpeg(): Promise<string> {
  return ffmpegBinaryPath();
}

export function isFFmpegReady(): boolean {
  try {
    return !!ffmpegBinaryPath();
  } catch {
    return false;
  }
}