"use client";

/**
 * BatchQueue
 * Batch conversion queue with progress bars, cancel, and download.
 * Phase 41 — @File Convert command
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { BatchResult } from "@/hooks/useFileConverter";

export interface BatchFile {
  name: string;
  data: string; // base64
  size: number;
  status: "pending" | "converting" | "done" | "error";
  result?: BatchResult;
  progress?: number;
}

export interface BatchQueueProps {
  files: BatchFile[];
  targetFormat: string;
  onConvert: () => void;
  onCancel: () => void;
  onRemove: (index: number) => void;
  onDownload: (file: BatchFile) => void;
  onDownloadAll: () => void;
  converting: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BatchQueue({
  files,
  targetFormat,
  onConvert,
  onCancel,
  onRemove,
  onDownload,
  onDownloadAll,
  converting,
}: BatchQueueProps) {
  const { t } = useI18n();
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {t("fileConvert.batchTitle")}
          <span className="ml-2 text-xs text-muted-foreground">
            {files.length} {t("fileConvert.files")}{" "}
            {doneCount > 0 && `• ${doneCount} ${t("fileConvert.done")}`}
            {errorCount > 0 && (
              <span className="text-destructive">
                {" "}• {errorCount} {t("fileConvert.errors")}
              </span>
            )}
          </span>
        </div>
        <div className="flex gap-1">
          {doneCount > 0 && (
            <button
              type="button"
              onClick={onDownloadAll}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
            >
              {t("fileConvert.downloadAll")}
            </button>
          )}
          {converting ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground hover:bg-destructive/90"
            >
              {t("fileConvert.cancel")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConvert}
              disabled={files.length === 0}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t("fileConvert.convertAll")} → .{targetFormat}
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border">
        {files.map((file, idx) => (
          <div
            key={`${file.name}-${idx}`}
            className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
          >
            {/* Status indicator */}
            <div
              className={cn(
                "h-2 w-2 rounded-full flex-shrink-0",
                file.status === "done" && "bg-green-500",
                file.status === "error" && "bg-destructive",
                file.status === "converting" && "animate-pulse bg-yellow-500",
                file.status === "pending" && "bg-muted"
              )}
            />

            {/* File info */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{file.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {formatBytes(file.size)}
                {file.result && (
                  <span>
                    {" → "}
                    {file.result.ok
                      ? `${file.result.format?.toUpperCase()} ${formatBytes(file.result.size || 0)}`
                      : file.result.error}
                  </span>
                )}
              </div>
              {/* Progress bar */}
              {file.status === "converting" && typeof file.progress === "number" && (
                <div className="mt-0.5 h-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round(file.progress * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-0.5">
              {file.status === "done" && file.result?.ok && (
                <button
                  type="button"
                  onClick={() => onDownload(file)}
                  className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted"
                  title={t("fileConvert.download")}
                >
                  ↓
                </button>
              )}
              {!converting && (
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10"
                  title={t("fileConvert.remove")}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
