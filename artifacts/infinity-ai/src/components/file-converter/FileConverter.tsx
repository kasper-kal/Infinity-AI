"use client";

/**
 * FileConverter
 * Main file converter panel for BuildView.
 * Supports single-file and batch conversion with drag-and-drop.
 * Phase 41 — @File Convert command
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useFileConverter, type FormatGroup, type FileInfo, type ConversionResult } from "@/hooks/useFileConverter";
import { FormatSelector } from "./FormatSelector";
import { ConversionOptions } from "./ConversionOptions";
import { ConversionPreview } from "./ConversionPreview";
import { BatchQueue, type BatchFile } from "./BatchQueue";

export interface FileConverterProps {
  projectId?: string | null;
}

type Mode = "single" | "batch";

export function FileConverter({ projectId }: FileConverterProps) {
  const { t } = useI18n();
  const { loading, error, detect, convert, convertBatch, getInfo, listFormats } = useFileConverter();

  const [mode, setMode] = React.useState<Mode>("single");
  const [groups, setGroups] = React.useState<FormatGroup[]>([]);
  const [sourceData, setSourceData] = React.useState<string | null>(null);
  const [sourceFilename, setSourceFilename] = React.useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = React.useState<FileInfo | null>(null);
  const [targetFormat, setTargetFormat] = React.useState("");
  const [conversionOptions, setConversionOptions] = React.useState<Record<string, unknown>>({});
  const [result, setResult] = React.useState<ConversionResult | null>(null);
  const [batchFiles, setBatchFiles] = React.useState<BatchFile[]>([]);
  const [batchConverting, setBatchConverting] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const batchInputRef = React.useRef<HTMLInputElement>(null);

  // Load format groups on mount
  React.useEffect(() => {
    listFormats().then((data) => {
      if (data?.groups) setGroups(data.groups);
    });
  }, [listFormats]);

  // Read file as base64
  const readFile = React.useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data URL prefix
        const base64 = result.split(",")[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle single file selection
  const handleFileSelect = React.useCallback(
    async (file: File) => {
      const data = await readFile(file);
      setSourceData(data);
      setSourceFilename(file.name);
      setResult(null);

      // Auto-detect and get info
      const [detected, info] = await Promise.all([
        detect(data, file.name),
        getInfo(data, file.name),
      ]);
      setSourceInfo(info);
      if (detected?.suggestedOutputs?.length && !targetFormat) {
        setTargetFormat(detected.suggestedOutputs[0]);
      }
    },
    [readFile, detect, getInfo, targetFormat]
  );

  // Handle batch file selection
  const handleBatchSelect = React.useCallback(
    async (files: FileList) => {
      const newBatch: BatchFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const data = await readFile(file);
        newBatch.push({
          name: file.name,
          data,
          size: file.size,
          status: "pending",
        });
      }
      setBatchFiles((prev) => [...prev, ...newBatch]);
    },
    [readFile]
  );

  // Drag-and-drop handlers
  const onDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = React.useCallback(() => setDragOver(false), []);

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      if (mode === "batch" || files.length > 1) {
        setMode("batch");
        handleBatchSelect(files);
      } else {
        handleFileSelect(files[0]);
      }
    },
    [mode, handleFileSelect, handleBatchSelect]
  );

  // Convert single file
  const handleConvert = React.useCallback(async () => {
    if (!sourceData || !targetFormat) return;
    const res = await convert(sourceData, targetFormat, {
      from: sourceInfo?.format,
      filename: sourceFilename ?? undefined,
      conversionOptions,
    });
    setResult(res);
  }, [sourceData, targetFormat, sourceInfo, sourceFilename, conversionOptions, convert]);

  // Convert batch
  const handleBatchConvert = React.useCallback(async () => {
    if (batchFiles.length === 0 || !targetFormat) return;
    setBatchConverting(true);

    const filesToConvert = batchFiles.filter((f) => f.status === "pending" || f.status === "error");
    const results = await convertBatch(
      filesToConvert.map((f) => ({ data: f.data, name: f.name })),
      targetFormat,
      conversionOptions
    );

    // Merge results back
    setBatchFiles((prev) =>
      prev.map((f) => {
        if (f.status !== "pending" && f.status !== "error") return f;
        const res = results.find((r) => r.name === f.name);
        if (res) {
          return { ...f, status: res.ok ? "done" : "error", result: res, progress: 1 };
        }
        return f;
      })
    );
    setBatchConverting(false);
  }, [batchFiles, targetFormat, conversionOptions, convertBatch]);

  // Download helper
  const downloadFile = React.useCallback((data: string, filename: string, mime: string) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadResult = React.useCallback(() => {
    if (!result || !sourceFilename) return;
    const baseName = sourceFilename.replace(/\.[^.]+$/, "");
    downloadFile(result.data, `${baseName}.${result.ext}`, result.mime);
  }, [result, sourceFilename, downloadFile]);

  const handleDownloadBatchFile = React.useCallback(
    (file: BatchFile) => {
      if (!file.result?.ok || !file.result.data) return;
      const baseName = file.name.replace(/\.[^.]+$/, "");
      downloadFile(file.result.data, `${baseName}.${file.result.format}`, file.result.mime || "application/octet-stream");
    },
    [downloadFile]
  );

  const handleDownloadAll = React.useCallback(() => {
    batchFiles.forEach((f) => {
      if (f.status === "done" && f.result?.ok && f.result.data) {
        handleDownloadBatchFile(f);
      }
    });
  }, [batchFiles, handleDownloadBatchFile]);

  const sourceDataUrl = sourceData && sourceInfo
    ? `data:${sourceInfo.mime || "application/octet-stream"};base64,${sourceData}`
    : null;

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Mode tabs */}
      <div className="flex items-center gap-1 border-b px-1 pt-1">
        {(["single", "batch"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={cn(
              "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
              mode === m
                ? "border-b border-primary -mb-px text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setMode(m)}
          >
            {m === "single" ? t("fileConvert.singleMode") : t("fileConvert.batchMode")}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Drop zone / file picker */}
        <div
          className={cn(
            "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer",
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
          )}
          onClick={() =>
            mode === "single" ? fileInputRef.current?.click() : batchInputRef.current?.click()
          }
        >
          <div className="text-2xl mb-1 opacity-40">📄</div>
          <div className="text-sm text-muted-foreground">
            {mode === "single"
              ? t("fileConvert.dropSingle")
              : t("fileConvert.dropBatch")}
          </div>
          <div className="text-[11px] text-muted-foreground/60 mt-1">
            {t("fileConvert.orClick")}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
            e.target.value = "";
          }}
        />
        <input
          ref={batchInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleBatchSelect(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Single mode */}
        {mode === "single" && (
          <>
            {/* Format selector */}
            {groups.length > 0 && (
              <FormatSelector
                groups={groups}
                selected={targetFormat}
                onSelect={setTargetFormat}
                disabled={loading}
              />
            )}

            {/* Options */}
            {sourceInfo && targetFormat && (
              <ConversionOptions
                sourceFormat={sourceInfo.format}
                targetFormat={targetFormat}
                options={conversionOptions}
                onChange={setConversionOptions}
                disabled={loading}
              />
            )}

            {/* Convert button */}
            {sourceData && targetFormat && (
              <button
                type="button"
                onClick={handleConvert}
                disabled={loading}
                className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? t("fileConvert.converting") : t("fileConvert.convert")}
                {" → "}
                .{targetFormat}
              </button>
            )}

            {/* Preview */}
            <ConversionPreview
              sourceInfo={sourceInfo}
              result={result}
              sourceDataUrl={sourceDataUrl}
            />

            {/* Download button */}
            {result && (
              <button
                type="button"
                onClick={handleDownloadResult}
                className="w-full rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50"
              >
                {t("fileConvert.download")} ({result.format.toUpperCase()},{" "}
                {(result.size / 1024).toFixed(1)} KB)
              </button>
            )}
          </>
        )}

        {/* Batch mode */}
        {mode === "batch" && (
          <>
            {groups.length > 0 && (
              <FormatSelector
                groups={groups}
                selected={targetFormat}
                onSelect={setTargetFormat}
                disabled={batchConverting}
              />
            )}

            <BatchQueue
              files={batchFiles}
              targetFormat={targetFormat}
              onConvert={handleBatchConvert}
              onCancel={() => setBatchConverting(false)}
              onRemove={(idx) =>
                setBatchFiles((prev) => prev.filter((_, i) => i !== idx))
              }
              onDownload={handleDownloadBatchFile}
              onDownloadAll={handleDownloadAll}
              converting={batchConverting}
            />
          </>
        )}
      </div>
    </div>
  );
}
