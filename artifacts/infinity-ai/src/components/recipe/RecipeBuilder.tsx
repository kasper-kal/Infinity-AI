"use client";

/**
 * RecipeBuilder
 * Visual builder for creating/editing recipes.
 * Add steps, configure parameters, set output schema, version, and publish.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useRecipes, type Recipe, type RecipeParameter, type RecipeStep } from "@/hooks/useRecipes";

export interface RecipeBuilderProps {
  existing?: Recipe | null;
  onDone?: (recipe: Recipe) => void;
  onCancel?: () => void;
}

const PARAM_TYPES: RecipeParameter["type"][] = ["string", "number", "boolean", "array", "object"];
const MODEL_CATEGORIES = ["general", "coding", "research", "review", "documentation", "git", "configuration", "explanation"];

const emptyRecipe = (): Recipe => ({
  name: "",
  description: "",
  version: "1.0.0",
  type: "standard",
  parameters: [],
  steps: [],
  tags: [],
  isPublic: false,
  isBuiltIn: false,
});

export function RecipeBuilder({ existing, onDone, onCancel }: RecipeBuilderProps) {
  const { t } = useI18n();
  const { createRecipe, updateRecipe, publishRecipe } = useRecipes({ autoLoad: false });

  const [draft, setDraft] = React.useState<Recipe>(existing ? { ...existing, name: existing.name + " (copy)" } : emptyRecipe());
  const [tagInput, setTagInput] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<"steps" | "parameters" | "output">(
    existing?.type === "deep-research" ? "steps" : "steps"
  );
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<Recipe | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const patch = <K extends keyof Recipe>(key: K, val: Recipe[K]) => setDraft((d) => ({ ...d, [key]: val }));

  // ── Steps ────────────────────────────────────────────────────────────────
  const addStep = () => {
    const step: RecipeStep = {
      id: `step-${draft.steps.length}-${Date.now().toString(36).slice(-4)}`,
      prompt: "",
      modelCategory: "general",
      tools: [],
      outputKey: `output_${draft.steps.length}`,
    };
    patch("steps", [...draft.steps, step]);
  };

  const updateStep = (index: number, updates: Partial<RecipeStep>) => {
    patch(
      "steps",
      draft.steps.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  };

  const removeStep = (index: number) => {
    patch("steps", draft.steps.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    const steps = [...draft.steps];
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    patch("steps", steps);
  };

  // ── Parameters ───────────────────────────────────────────────────────────
  const addParameter = () => {
    const param: RecipeParameter = {
      name: `param_${draft.parameters.length + 1}`,
      type: "string",
      required: false,
      description: "",
    };
    patch("parameters", [...draft.parameters, param]);
  };

  const updateParameter = (index: number, updates: Partial<RecipeParameter>) => {
    patch(
      "parameters",
      draft.parameters.map((p, i) => (i === index ? { ...p, ...updates } : p))
    );
  };

  const removeParameter = (index: number) => {
    patch("parameters", draft.parameters.filter((_, i) => i !== index));
  };

  // ── Tags ─────────────────────────────────────────────────────────────────
  const addTag = () => {
    const val = tagInput.trim();
    if (!val || draft.tags.includes(val)) return;
    patch("tags", [...draft.tags, val]);
    setTagInput("");
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!draft.name.trim()) return t("recipes.errors.requiredName");
    if (draft.steps.length === 0) return t("recipes.errors.requiredSteps");
    const missingPrompt = draft.steps.some((s) => !s.prompt.trim());
    if (missingPrompt) return t("recipes.errors.requiredPrompt");
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload: Partial<Recipe> = {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        parameters: draft.parameters,
        steps: draft.steps,
        outputSchema: draft.outputSchema,
        tags: draft.tags,
      };
      if (draft.type === "deep-research") {
        payload.deepResearchConfig = draft.deepResearchConfig || {
          researchSteps: 5,
          outputFormat: "markdown",
        };
      }

      let result: Recipe | null = null;
      if (existing?.id) {
        result = await updateRecipe(existing.id, payload);
      } else {
        result = await createRecipe(payload);
      }

      if (!result) {
        setError(t("recipes.errors.save"));
        return;
      }
      setSaved(result);
      if (draft.isPublic && result.id) {
        await publishRecipe(result.id);
      }
      onDone?.(result);
    } finally {
      setSaving(false);
    }
  };

  // ── Typo helper ──────────────────────────────────────────────────────────
  const inputCls =
    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors";

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border bg-card p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-semibold">{t("recipes.savedTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {saved.name} v{saved.version}
          </p>
        </div>
        <button type="button" onClick={() => setSaved(null)} className="btn btn--primary">
          {t("recipes.buildAnother")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header + basic fields */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{existing ? t("recipes.editTitle") : t("recipes.buildTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("recipes.buildSubtitle")}</p>
        </div>
        <button type="button" onClick={onCancel} className="btn btn--ghost btn--sm">
          {t("recipes.close")}
        </button>
      </div>

      {/* Basic info */}
      <div className="rounded-xl border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium">{t("recipes.name")} *</label>
            <input
              className={inputCls}
              value={draft.name}
              onChange={(e) => patch("name", e.target.value)}
              placeholder={t("recipes.namePlaceholder")}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium">{t("recipes.description")}</label>
            <textarea
              className={cn(inputCls, "min-h-[60px]")}
              value={draft.description || ""}
              onChange={(e) => patch("description", e.target.value)}
              placeholder={t("recipes.descriptionPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t("recipes.type")}</label>
            <select
              className={cn(inputCls, "cursor-pointer")}
              value={draft.type}
              onChange={(e) => patch("type", e.target.value as Recipe["type"])}
            >
              <option value="standard">{t("recipes.standard")}</option>
              <option value="deep-research">{t("recipes.deepResearch")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t("recipes.tags")}</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5">
              {draft.tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                  {tag}
                  <button
                    type="button"
                    onClick={() => patch("tags", draft.tags.filter((x) => x !== tag))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="flex-1 min-w-[70px] bg-transparent text-sm outline-none"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder={draft.tags.length === 0 ? t("recipes.tagsPlaceholder") : ""}
              />
            </div>
          </div>
          {/* Deep-research config */}
          {draft.type === "deep-research" && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("recipes.researchSteps")}</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className={inputCls}
                  value={draft.deepResearchConfig?.researchSteps ?? 5}
                  onChange={(e) =>
                    patch("deepResearchConfig", {
                      ...draft.deepResearchConfig,
                      researchSteps: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("recipes.outputFormat")}</label>
                <select
                  className={cn(inputCls, "cursor-pointer")}
                  value={draft.deepResearchConfig?.outputFormat || "markdown"}
                  onChange={(e) =>
                    patch("deepResearchConfig", {
                      ...draft.deepResearchConfig,
                      outputFormat: e.target.value as "markdown" | "json" | "pdf" | "html",
                    })
                  }
                >
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                  <option value="html">HTML</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        {(["steps", "parameters", "output"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "steps"
              ? `${t("recipes.steps")} (${draft.steps.length})`
              : tab === "parameters"
                ? `${t("recipes.parameters")} (${draft.parameters.length})`
                : t("recipes.outputSchema")}
          </button>
        ))}
      </div>

      {/* Tab: STEPS */}
      {activeTab === "steps" && (
        <div className="space-y-3">
          {draft.type === "deep-research" && (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-600">
              {t("recipes.deepResearchHint")}
              <div className="mt-1 text-[11px] text-muted-foreground">{draft.steps[0]?.prompt ? "" : t("recipes.deepResearchStepHint")}</div>
            </div>
          )}
          {draft.steps.map((step, i) => (
            <div key={step.id} className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                  {i + 1}
                </span>
                <input
                  className={cn(inputCls, "min-w-0")}
                  value={step.prompt}
                  onChange={(e) => updateStep(i, { prompt: e.target.value })}
                  placeholder={t("recipes.promptPlaceholder")}
                />
                <div className="flex gap-0.5">
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="btn btn--ghost btn--sm disabled:opacity-40" aria-label={t("recipes.moveUp")}>
                    ↑
                  </button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1} className="btn btn--ghost btn--sm disabled:opacity-40" aria-label={t("recipes.moveDown")}>
                    ↓
                  </button>
                  <button type="button" onClick={() => removeStep(i)} className="btn btn--ghost btn--sm text-destructive" aria-label={t("recipes.remove")}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">{t("recipes.model")}</label>
                  <select
                    className={cn(inputCls, "cursor-pointer text-xs")}
                    value={step.modelCategory || "general"}
                    onChange={(e) => updateStep(i, { modelCategory: e.target.value })}
                  >
                    {MODEL_CATEGORIES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">{t("recipes.outputKey")}</label>
                  <input
                    className={cn(inputCls, "text-xs")}
                    value={step.outputKey || ""}
                    onChange={(e) => updateStep(i, { outputKey: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">{t("recipes.condition")}</label>
                  <input
                    className={cn(inputCls, "text-xs")}
                    value={step.condition || ""}
                    onChange={(e) => updateStep(i, { condition: e.target.value })}
                    placeholder="e.g. params.includeExamples"
                  />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addStep} className="w-full rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
            + {t("recipes.addStep")}
          </button>
        </div>
      )}

      {/* Tab: PARAMETERS */}
      {activeTab === "parameters" && (
        <div className="space-y-3">
          {draft.parameters.map((param, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-12">
              <input
                className={cn(inputCls, "text-xs sm:col-span-3")}
                value={param.name}
                onChange={(e) => updateParameter(i, { name: e.target.value })}
                placeholder={t("recipes.paramName")}
              />
              <select
                className={cn(inputCls, "cursor-pointer text-xs sm:col-span-2")}
                value={param.type}
                onChange={(e) => updateParameter(i, { type: e.target.value as RecipeParameter["type"] })}
              >
                {PARAM_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </select>
              <input
                className={cn(inputCls, "text-xs sm:col-span-4")}
                value={param.description || ""}
                onChange={(e) => updateParameter(i, { description: e.target.value })}
                placeholder={t("recipes.paramDesc")}
              />
              <label className="flex items-center gap-1.5 text-xs sm:col-span-2">
                <input
                  type="checkbox"
                  checked={param.required}
                  onChange={(e) => updateParameter(i, { required: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                {t("recipes.required")}
              </label>
              <button
                type="button"
                onClick={() => removeParameter(i)}
                className="btn btn--ghost btn--sm text-destructive sm:col-span-1"
                aria-label={t("recipes.remove")}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" onClick={addParameter} className="w-full rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
            + {t("recipes.addParameter")}
          </button>
        </div>
      )}

      {/* Tab: OUTPUT */}
      {activeTab === "output" && (
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-4">
            <label className="text-xs font-medium">{t("recipes.outputSchema")}</label>
            <textarea
              className={cn(inputCls, "mt-2 min-h-[120px] font-mono text-xs")}
              value={draft.outputSchema ? JSON.stringify(draft.outputSchema, null, 2) : ""}
              onChange={(e) => {
                try {
                  patch("outputSchema", e.target.value ? JSON.parse(e.target.value) : undefined);
                } catch {
                  // keep last valid
                }
              }}
              placeholder={JSON.stringify({ type: "object", properties: {} }, null, 2)}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t("recipes.outputSchemaHint")}</p>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={draft.isPublic}
              onChange={(e) => patch("isPublic", e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t("recipes.publishMarketplace")}
          </label>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <button type="button" onClick={save} disabled={saving} className="btn btn--primary disabled:opacity-50">
          {saving ? t("recipes.saving") : existing ? t("recipes.saveChanges") : t("recipes.buildRecipe")}
        </button>
      </div>
    </div>
  );
}