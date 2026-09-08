"use client";

/**
 * RecipeStepProgress
 * Step-by-step progress display for recipe executions.
 * Deep research recipes show phases (research / synthesis / verify / format);
 * standard recipes show individual steps.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { ExecutionProgress, Recipe } from "@/hooks/useRecipes";

export interface RecipeStepProgressProps {
  recipe: Recipe;
  steps: ExecutionProgress[];
  status: "pending" | "running" | "complete" | "error" | "cancelled";
  error?: string;
  onCancel?: () => void;
  cancelling?: boolean;
}

function StatusIcon({ status }: { status: ExecutionProgress["status"] }) {
  switch (status) {
    case "complete":
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case "error":
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </span>
      );
    case "running":
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-[2px] border-primary border-t-transparent" />
        </span>
      );
    default:
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
        </span>
      );
  }
}

export function RecipeStepProgress({
  recipe,
  steps,
  status,
  error,
  onCancel,
  cancelling,
}: RecipeStepProgressProps) {
  const { t } = useI18n();

  // For deep research, group work into phases for friendlier display
  const deepResearch = recipe.type === "deep-research";

  // Build the phased view for deep research
  const phaseItems = React.useMemo(() => {
    if (!deepResearch) return null;

    const researchSteps = steps.filter((s) => s.stepId.startsWith("research"));
    const synthesis = steps.find((s) => s.stepId === "synthesis");
    const verification = steps.find((s) => s.stepId === "verification");
    const format = steps.find((s) => s.stepId === "format");

    const phases: { id: string; label: string; detail: string; status: ExecutionProgress["status"]; output?: unknown }[] = [];

    if (researchSteps.length > 0) {
      const completed = researchSteps.filter((s) => s.status === "complete").length;
      phases.push({
        id: "research",
        label: t("recipes.phaseResearch"),
        detail: `${completed}/${researchSteps.length}`,
        status:
          completed === researchSteps.length
            ? "complete"
            : researchSteps.some((s) => s.status === "running")
              ? "running"
              : researchSteps.some((s) => s.status === "error")
                ? "error"
                : "pending",
        output: researchSteps.map((s) => s.output),
      });
    }

    for (const s of [synthesis, verification, format]) {
      if (!s) continue;
      const key = s.stepId;
      const label =
        key === "synthesis"
          ? t("recipes.phaseSynthesize")
          : key === "verification"
            ? t("recipes.phaseVerify")
            : t("recipes.phaseFormat");
      phases.push({ id: key, label, detail: "", status: s.status, output: s.output });
    }

    return phases;
  }, [steps, deepResearch, t]);

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {status === "running" && onCancel && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="btn btn--ghost btn--sm disabled:opacity-50"
          >
            {cancelling ? t("recipes.cancelling") : t("recipes.cancel")}
          </button>
        </div>
      )}

      {phaseItems ? (
        // Deep research phased view
        <div className="space-y-2">
          {phaseItems.map((phase) => (
            <div
              key={phase.id}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                phase.status === "complete" && "border-emerald-500/20",
                phase.status === "running" && "border-primary/30 bg-primary/5",
                phase.status === "error" && "border-destructive/30",
                phase.status === "pending" && "border-muted bg-muted/30 opacity-60"
              )}
            >
              <div className="flex items-center gap-2.5">
                <StatusIcon status={phase.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{phase.label}</span>
                    {phase.detail && (
                      <span className="text-xs tabular-nums text-muted-foreground">{phase.detail}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Standard step list
        <div className="space-y-2">
          {steps.map((step) => (
            <div
              key={step.stepId}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                step.status === "complete" && "border-emerald-500/20",
                step.status === "running" && "border-primary/30 bg-primary/5",
                step.status === "error" && "border-destructive/30",
                step.status === "pending" && "border-muted bg-muted/30 opacity-60"
              )}
            >
              <div className="flex items-center gap-2.5">
                <StatusIcon status={step.status} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{step.stepId}</span>
                </div>
                {step.error && <span className="text-xs text-destructive truncate max-w-[40%]">{step.error}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "complete" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("recipes.completed")}
        </div>
      )}

      {status === "error" && !error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t("recipes.failed")}
        </div>
      )}
    </div>
  );
}