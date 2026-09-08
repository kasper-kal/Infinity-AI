"use client";

/**
 * FormatSelector
 * Grouped output format selector for the File Converter.
 * Phase 41 — @File Convert command
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { FormatGroup } from "@/hooks/useFileConverter";

export interface FormatSelectorProps {
  groups: FormatGroup[];
  selected: string;
  onSelect: (format: string) => void;
  disabled?: boolean;
}

export function FormatSelector({ groups, selected, onSelect, disabled }: FormatSelectorProps) {
  const { t } = useI18n();
  const [expandedGroup, setExpandedGroup] = React.useState<string | null>(null);

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {t("fileConvert.outputFormat")}
      </label>
      <div className="max-h-64 overflow-y-auto rounded-md border bg-background">
        {groups.map((group) => (
          <div key={group.id}>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50",
                expandedGroup === group.id && "bg-muted/30"
              )}
              onClick={() =>
                setExpandedGroup(expandedGroup === group.id ? null : group.id)
              }
            >
              <span>{group.label}</span>
              <span className="text-xs text-muted-foreground">
                {expandedGroup === group.id ? "▲" : "▼"}
              </span>
            </button>
            {expandedGroup === group.id && (
              <div className="grid grid-cols-2 gap-0.5 px-2 pb-2">
                {group.formats.map((fmt) => (
                  <button
                    key={fmt.format}
                    type="button"
                    disabled={disabled}
                    className={cn(
                      "rounded px-2 py-1 text-left text-xs transition-colors",
                      selected === fmt.format
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => onSelect(fmt.format)}
                  >
                    {fmt.label}
                    <span className="ml-1 opacity-50">.{fmt.ext[0]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
