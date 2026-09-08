"use client";

/**
 * RecipeRunner
 * Parameter form → execution progress → result viewer for a single recipe.
 * Handles both standard (single step) and deep-research (multi-phase) recipes.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useRecipes, type Recipe, type ExecutionProgress } from "@/hooks/useRecipes";
import { RecipeParameterForm } from "./RecipeParameterForm";
import { RecipeStepProgress } from "./RecipeStepProgress";
import { RecipeResultViewer } from "./RecipeResultViewer";

export interface RecipeRunnerProps {
  recipe: Recipe;
  initialParameters?: Record<string, unknown>;
  onBack?: () => void;
  onFork?: (recipe: Recipe) => void;
  onSaveTemplate?: (params: Record<string, unknown>) => void;
}

type RunPhase = "form" | "running" | "result";

export function RecipeRunner({ recipe, initialParameters = {}, onBack, onFork, onSaveTemplate }: RecipeRunnerProps) {
  const { t } = useI18n();
  const { executeRecipe, getExecution, cancelExecution } = useRecipes({ autoLoad: false });

  const [phase, setPhase] = React.useState<RunPhase>("form");
  const [parameters, setParameters] = React.useState<Record<string, unknown>>(initialParameters);
  const [steps, setSteps] = React.useState<ExecutionProgress[]>([]);
  const [status, setStatus] = React.useState<"pending" | "running" | "complete" | "error" | "cancelled">("pending");
  const [result, setResult] = React.useState<unknown>(undefined);
  const [runError, setRunError] = React.useState<string | undefined>(undefined);
  const [runId, setRunId] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const run = async () => {
    setPhase("running");
    setStatus("running");
    setSteps([]);
    setRunError(undefined);

    const execution = await executeRecipe(recipe.id!, parameters);
    if (!execution) {
      setStatus("error");
      setRunError(t("recipes.errors.execute"));
      return;
    }

    setRunId(execution.id);
    setSteps(execution.result?.steps || []);
    setStatus(execution.status);

    // If the server returned a completed execution, show result immediately.
    if (execution.status === "complete") {
      setResult(execution.result?.output);
      setPhase("result");
      setStatus("complete");
      return;
    }

    // Otherwise poll until done.
    if (!pollRef.current) {
      pollRef.current = setInterval(async () => {
        if (!runId) return;
        const current = await getExecution(runId);
        if (!current) return;
        setSteps(current.result?.steps || []);
        setStatus(current.status);
        if (current.status === "complete") {
          setResult(current.result?.output);
          setPhase("result");
          stopPolling();
        }
        if (current.status === "error") {
          setRunError(current.error);
          setStatus("error");
          stopPolling();
        }
        if (current.status === "cancelled") {
          setStatus("cancelled");
          stopPolling();
        }
      }, 1500);
    }
  };

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  React.useEffect(() => () => stopPolling(), [stopPolling]);

  const cancel = async () => {
    setCancelling(true);
    if (runId) await cancelExecution(runId);
    setStatus("cancelled");
    stopPolling();
    setCancelling(false);
  };

  const rerun = () => {
    setPhase("form");
    setResult(undefined);
    setRunId(null);
  };

  const formatLabel = recipe.deepResearchConfig?.outputFormat || (recipe.type === "deep-research" ? "markdown" : "text");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("recipes.back")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div>
              <h2 className="text-lg font-semibold leading-tight">{recipe.name}</h2>
              <p className="text-xs text-muted-foreground">v{recipe.version}</p>
            </div>
          </div>
          {recipe.description && <p className="mt-1 text-sm text-muted-foreground">{recipe.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
              recipe.type === "deep-research"
                ? "bg-violet-500/15 text-violet-600"
                : "bg-sky-500/15 text-sky-600"
            )}
          >
            {recipe.type === "deep-research" ? t("recipes.deepResearch") : t("recipes.standard")}
          </span>
        </div>
      </div>

      {/* Phase: FORM */}
      {phase === "form" && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-4 text-sm font-medium">{t("recipes.parameters")}</h3>
          {recipe.parameters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("recipes.noParameters")}</p>
          ) : (
            <RecipeParameterForm
              parameters={recipe.parameters}
              value={parameters}
              onChange={setParameters}
              onSubmit={run}
              submitLabel={t("recipes.run")}
            />
          )}
          {recipe.parameters.length === 0 && (
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={run} className="btn btn--primary">
                {t("recipes.run")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase: RUNNING */}
      {phase === "running" && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-4 text-sm font-medium">{t("recipes.progress")}</h3>
          <RecipeStepProgress recipe={recipe} steps={steps} status={status} error={runError} onCancel={cancel} cancelling={cancelling} />
        </div>
      )}

      {/* Phase: RESULT */}
      {phase === "result" && (
        <div className="space-y-4">
          <RecipeResultViewer output={result} format={formatLabel as "markdown" | "json"} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={rerun} className="btn btn--primary">
              {t("recipes.rerun")}
            </button>
            {onFork && (
              <button
                type="button"
                onClick={() => onFork(recipe)}
                className="btn btn--ghost"
                title={t("recipes.forkHint")}
              >
                {t("recipes.fork")}
              </button>
            )}
            {onSaveTemplate && (
              <button type="button" onClick={() => onSaveTemplate(parameters)} className="btn btn--ghost">
                {t("recipes.saveTemplate")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}