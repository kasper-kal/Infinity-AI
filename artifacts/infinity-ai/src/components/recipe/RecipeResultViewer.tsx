"use client";

/**
 * RecipeResultViewer
 * Formatted output viewer for recipe execution results.
 * Handles markdown, JSON, and plain text — with copy, download, and share.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";

export interface RecipeResultViewerProps {
  output?: unknown;
  format?: "markdown" | "json" | "text";
  onApply?: () => void;
  applyLabel?: string;
}

export function RecipeResultViewer({ output, format = "markdown", onApply, applyLabel }: RecipeResultViewerProps) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);

  if (output === undefined || output === null) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t("recipes.noOutput")}
      </div>
    );
  }

  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  const detectedFormat = format === "json" || (!format || format === "markdown" ? detectFormat(text) : format);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  };

  const download = () => {
    const ext = detectedFormat === "json" ? "json" : detectedFormat === "markdown" ? "md" : "txt";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recipe-output.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {detectedFormat}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={copy} className="btn btn--ghost btn--sm">
            {copied ? t("recipes.copied") : t("recipes.copy")}
          </button>
          <button type="button" onClick={download} className="btn btn--ghost btn--sm">
            {t("recipes.download")}
          </button>
          {onApply && (
            <button type="button" onClick={onApply} className="btn btn--primary btn--sm">
              {applyLabel || t("recipes.apply")}
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-lg border bg-background">
        {detectedFormat === "markdown" ? (
          <div className="p-5">
            <MarkdownRenderer content={text} />
          </div>
        ) : (
          <pre className="rounded-lg bg-muted/40 p-4 text-xs leading-relaxed whitespace-pre-wrap break-words">
            <code className="font-mono">{text}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

/** Heuristic: if it starts with { or [ → json; contains markdown markup → markdown; else text */
function detectFormat(text: string): "markdown" | "json" | "text" {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  // Rough markdown detection: headers, lists, code fences, bold
  if (
    /^#{1,6}\s/m.test(text) ||
    /\n```/m.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /\n[-*]\s/m.test(text) ||
    /\n>\s/m.test(text)
  ) {
    return "markdown";
  }
  return "text";
}