"use client";

/**
 * ConversionOptions
 * Format-specific conversion options for the File Converter.
 * Phase 41 — @File Convert command
 */

import * as React from "react";
import { useI18n } from "@/lib/i18n";

export interface ConversionOptionsProps {
  sourceFormat: string;
  targetFormat: string;
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
  disabled?: boolean;
}

/** Returns the relevant option fields for a given source→target pair. */
function getOptionFields(from: string, to: string): OptionField[] {
  // Image options
  const imageFormats = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "tiff", "bmp"]);
  if (imageFormats.has(from) || imageFormats.has(to)) {
    return [
      { key: "quality", label: "Quality", type: "number", min: 1, max: 100, default: 80, hint: "1-100" },
      { key: "width", label: "Width (px)", type: "number", min: 1, max: 10000, default: undefined, hint: "auto" },
      { key: "height", label: "Height (px)", type: "number", min: 1, max: 10000, default: undefined, hint: "auto" },
    ];
  }
  // Video options
  const videoFormats = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
  if (videoFormats.has(to)) {
    return [
      { key: "bitrate", label: "Bitrate (kbps)", type: "number", min: 32, max: 50000, default: undefined, hint: "auto" },
      { key: "preset", label: "Preset", type: "select", options: ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"], default: "medium" },
    ];
  }
  // Audio options
  const audioFormats = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);
  if (audioFormats.has(to)) {
    return [
      { key: "bitrate", label: "Bitrate (kbps)", type: "number", min: 32, max: 500, default: undefined, hint: "auto" },
      { key: "sampleRate", label: "Sample Rate (Hz)", type: "select", options: ["8000", "16000", "22050", "44100", "48000"], default: "44100" },
    ];
  }
  // No special options for data/document formats
  return [];
}

interface OptionField {
  key: string;
  label: string;
  type: "number" | "select";
  min?: number;
  max?: number;
  options?: string[];
  default?: unknown;
  hint?: string;
}

export function ConversionOptions({
  sourceFormat,
  targetFormat,
  options,
  onChange,
  disabled,
}: ConversionOptionsProps) {
  const { t } = useI18n();
  const fields = React.useMemo(
    () => getOptionFields(sourceFormat, targetFormat),
    [sourceFormat, targetFormat]
  );

  if (fields.length === 0) return null;

  const update = (key: string, value: unknown) => {
    const next = { ...options };
    if (value === "" || value === undefined || value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        {t("fileConvert.options")}
      </label>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-0.5">
            <label className="text-[11px] text-muted-foreground">
              {field.label}
              {field.hint && <span className="ml-1 opacity-60">({field.hint})</span>}
            </label>
            {field.type === "number" ? (
              <input
                type="number"
                disabled={disabled}
                min={field.min}
                max={field.max}
                value={typeof options[field.key] === "number" ? (options[field.key] as number) : ""}
                placeholder={field.default != null ? String(field.default) : ""}
                className="w-full rounded border bg-background px-2 py-1 text-sm"
                onChange={(e) => {
                  const v = e.target.value === "" ? undefined : Number(e.target.value);
                  update(field.key, v);
                }}
              />
            ) : (
              <select
                disabled={disabled}
                value={String(options[field.key] ?? field.default ?? "")}
                className="w-full rounded border bg-background px-2 py-1 text-sm"
                onChange={(e) => update(field.key, e.target.value)}
              >
                {field.default === undefined && <option value="">auto</option>}
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
