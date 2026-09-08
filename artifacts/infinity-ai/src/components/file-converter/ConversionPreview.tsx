"use client";

/**
 * ConversionPreview
 * Before/after preview for file conversions.
 * Shows image thumbnails, text diff, or file size comparison.
 * Phase 41 — @File Convert command
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { FileInfo, ConversionResult } from "@/hooks/useFileConverter";

export interface ConversionPreviewProps {
  sourceInfo: FileInfo | null;
  result: ConversionResult | null;
  sourceDataUrl?: string | null;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimension(d: { width: number; height: number } | undefined): string {
  if (!d) return "";
  return `${d.width}×${d.height}`;
}

export function ConversionPreview({
  sourceInfo,
  result,
  sourceDataUrl,
  className,
}: ConversionPreviewProps) {
  const { t } = useI18n();

  if (!sourceInfo && !result) {
    return (
      <div className={cn("rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground", className)}>
        {t("fileConvert.noPreview")}
      </div>
    );
  }

  const resultDataUrl = result?.data
    ? `data:${result.mime};base64,${result.data}`
    : null;

  const isImage = (f: string) =>
    ["png", "jpg", "jpeg", "webp", "gif", "avif", "tiff", "bmp", "svg"].includes(f);

  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-xs font-medium text-muted-foreground">
        {t("fileConvert.preview")}
      </label>
      <div className="grid grid-cols-2 gap-2">
        {/* Source preview */}
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">
            {t("fileConvert.source")}
          </div>
          {sourceInfo && (
            <div className="space-y-0.5 text-xs">
              <div>
                <span className="text-muted-foreground">Format:</span>{" "}
                {sourceInfo.format.toUpperCase()}
              </div>
              <div>
                <span className="text-muted-foreground">Size:</span>{" "}
                {formatBytes(sourceInfo.size)}
              </div>
              {sourceInfo.dimensions && (
                <div>
                  <span className="text-muted-foreground">Dimensions:</span>{" "}
                  {formatDimension(sourceInfo.dimensions)}
                </div>
              )}
              {sourceInfo.rows != null && (
                <div>
                  <span className="text-muted-foreground">Rows:</span>{" "}
                  {sourceInfo.rows}
                </div>
              )}
              {sourceInfo.characters != null && (
                <div>
                  <span className="text-muted-foreground">Characters:</span>{" "}
                  {sourceInfo.characters.toLocaleString()}
                </div>
              )}
            </div>
          )}
          {sourceInfo && isImage(sourceInfo.format) && sourceDataUrl && (
            <img
              src={sourceDataUrl}
              alt="Source"
              className="mt-2 max-h-24 rounded object-contain"
            />
          )}
        </div>

        {/* Result preview */}
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">
            {t("fileConvert.result")}
          </div>
          {result ? (
            <div className="space-y-0.5 text-xs">
              <div>
                <span className="text-muted-foreground">Format:</span>{" "}
                {result.format.toUpperCase()}
              </div>
              <div>
                <span className="text-muted-foreground">Size:</span>{" "}
                {formatBytes(result.size)}
              </div>
              {result.meta?.width && result.meta?.height && (
                <div>
                  <span className="text-muted-foreground">Dimensions:</span>{" "}
                  {formatDimension({
                    width: result.meta.width as number,
                    height: result.meta.height as number,
                  })}
                </div>
              )}
              {sourceInfo && (
                <div>
                  <span className="text-muted-foreground">Ratio:</span>{" "}
                  {result.size > 0
                    ? `${((result.size / sourceInfo.size) * 100).toFixed(0)}%`
                    : "—"}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {t("fileConvert.noResult")}
            </div>
          )}
          {result && isImage(result.format) && resultDataUrl && (
            <img
              src={resultDataUrl}
              alt="Result"
              className="mt-2 max-h-24 rounded object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}
