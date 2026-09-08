/**
 * useFileConverter Hook
 * React hook for interacting with the File Format Conversion API
 * Phase 41 — @File Convert command
 */

import { useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";

// ============================================================================
// TYPES
// ============================================================================

export interface FormatInfo {
  format: string;
  family: string;
  label: string;
  ext: string[];
  mime: string[];
}

export interface FormatGroup {
  id: string;
  label: string;
  formats: FormatInfo[];
}

export interface DetectionResult {
  format: string;
  confidence: number;
  suggestedOutputs: string[];
  method: "magic" | "extension" | "sniff";
}

export interface ConversionResult {
  data: string; // base64
  format: string;
  mime: string;
  ext: string;
  size: number;
  meta?: Record<string, unknown>;
}

export interface FileInfo {
  format: string;
  name?: string;
  size: number;
  mime?: string;
  dimensions?: { width: number; height: number };
  pages?: number;
  characters?: number;
  lines?: number;
  rows?: number;
  meta?: Record<string, unknown>;
}

export interface BatchResult {
  name: string;
  ok: boolean;
  format?: string;
  mime?: string;
  size?: number;
  data?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

// ============================================================================
// HOOK
// ============================================================================

const API_BASE = "/api/infinity/file-convert";

export function useFileConverter() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      const message = err instanceof Error ? err.message : fallback;
      setError(message);
      console.error(fallback, err);
      return message;
    },
    []
  );

  /** Detect the format of a file from its base64 data */
  const detect = useCallback(
    async (data: string, filename?: string): Promise<DetectionResult | null> => {
      try {
        const response = await fetch(`${API_BASE}/detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data, filename }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        handleError(err, t("fileConvert.errors.detect"));
        return null;
      }
    },
    [handleError, t]
  );

  /** Convert a file from one format to another */
  const convert = useCallback(
    async (
      data: string,
      to: string,
      options?: { from?: string; filename?: string; conversionOptions?: Record<string, unknown> }
    ): Promise<ConversionResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/convert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data,
            to,
            from: options?.from,
            filename: options?.filename,
            options: options?.conversionOptions,
          }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || `HTTP ${response.status}`);
        }
        return await response.json();
      } catch (err) {
        handleError(err, t("fileConvert.errors.convert"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [handleError, t]
  );

  /** Batch-convert multiple files */
  const convertBatch = useCallback(
    async (
      files: Array<{ data: string; name: string }>,
      to: string,
      options?: Record<string, unknown>
    ): Promise<BatchResult[]> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files, to, options }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || `HTTP ${response.status}`);
        }
        const data = await response.json();
        return data.results || [];
      } catch (err) {
        handleError(err, t("fileConvert.errors.batch"));
        return [];
      } finally {
        setLoading(false);
      }
    },
    [handleError, t]
  );

  /**
   * Convert with live server-streamed progress (POST /convert-stream).
   * Emits onProgress(percent) as SSE events arrive; resolves with the final
   * ConversionResult (or null on error).
   */
  const convertStream = useCallback(
    async (
      data: string,
      to: string,
      options: { from?: string; filename?: string; conversionOptions?: Record<string, unknown> },
      onProgress?: (percent: number) => void
    ): Promise<ConversionResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/convert-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data,
            to,
            from: options?.from,
            filename: options?.filename,
            options: options?.conversionOptions,
          }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || `HTTP ${response.status}`);
        }

        // Parse the SSE stream (POST response body is a text/event-stream).
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Streaming not supported in this browser");
        const decoder = new TextDecoder();
        let buffer = "";
        let result: ConversionResult | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE events separated by blank lines
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
            const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const event = eventLine?.slice(7).trim() ?? "message";
            const payload = JSON.parse(dataLine.slice(6).trim());
            if (event === "progress") {
              onProgress?.(Number(payload.percent ?? 0));
            } else if (event === "done") {
              result = payload as ConversionResult;
            } else if (event === "error") {
              throw new Error(payload?.error || "Conversion failed");
            }
          }
        }
        onProgress?.(100);
        if (!result) throw new Error(t("fileConvert.errors.convert"));
        return result;
      } catch (err) {
        handleError(err, t("fileConvert.errors.convert"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [handleError, t]
  );

  /** Get file metadata/info */
  const getInfo = useCallback(
    async (data: string, filename?: string): Promise<FileInfo | null> => {
      try {
        const response = await fetch(`${API_BASE}/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data, filename }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        handleError(err, t("fileConvert.errors.info"));
        return null;
      }
    },
    [handleError, t]
  );

  /** List all supported formats */
  const listFormats = useCallback(
    async (): Promise<{ groups: FormatGroup[]; total: number } | null> => {
      try {
        const response = await fetch(`${API_BASE}/formats`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        handleError(err, t("fileConvert.errors.formats"));
        return null;
      }
    },
    [handleError, t]
  );

  /** List output formats supported for a given input format */
  const listSupportedOutputs = useCallback(
    async (from: string): Promise<string[]> => {
      try {
        const response = await fetch(`${API_BASE}/formats/supported/${from}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.supported || [];
      } catch (err) {
        handleError(err, t("fileConvert.errors.formats"));
        return [];
      }
    },
    [handleError, t]
  );

  return {
    loading,
    error,
    detect,
    convert,
    convertStream,
    convertBatch,
    getInfo,
    listFormats,
    listSupportedOutputs,
  };
}
