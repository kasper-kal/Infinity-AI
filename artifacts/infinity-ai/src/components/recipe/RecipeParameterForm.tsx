"use client";

/**
 * RecipeParameterForm
 * Auto-generated form from recipe parameter schema.
 * Renders inputs based on parameter type (string, number, boolean, array, enum, object).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { RecipeParameter } from "@/hooks/useRecipes";

export interface RecipeParameterFormProps {
  parameters: RecipeParameter[];
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onSubmit?: () => void;
  submitLabel?: string;
  compact?: boolean;
}

function ParameterInput({
  param,
  value,
  onChange,
}: {
  param: RecipeParameter;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const base = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors";

  // Boolean toggle
  if (param.type === "boolean") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          value ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
            value ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    );
  }

  // Enum select
  if (param.enum && param.enum.length > 0) {
    return (
      <select
        className={cn(base, "cursor-pointer")}
        value={String(value ?? param.default ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        {param.default === undefined && <option value="">—</option>}
        {param.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  // Number input
  if (param.type === "number") {
    return (
      <input
        type="number"
        className={base}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        placeholder={param.description}
      />
    );
  }

  // Array input — comma-separated
  if (param.type === "array") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <input
        className={base}
        value={arr.join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value === ""
              ? []
              : e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
          )
        }
        placeholder={(param.description || "Comma-separated values")}
      />
    );
  }

  // Object input — JSON textarea
  if (param.type === "object") {
    return (
      <textarea
        className={cn(base, "min-h-[80px] font-mono text-xs")}
        value={value === undefined ? "" : JSON.stringify(value, null, 2)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            // Keep previous value if invalid JSON
          }
        }}
        placeholder='{"json": "object"}'
      />
    );
  }

  // Default: text input (string)
  return (
    <input
      className={base}
      type="text"
      value={value === undefined ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={param.description || param.name}
    />
  );
}

export function RecipeParameterForm({
  parameters,
  value,
  onChange,
  onSubmit,
  submitLabel,
  compact,
}: RecipeParameterFormProps) {
  const { t } = useI18n();

  // Initialize defaults
  React.useEffect(() => {
    const next = { ...value };
    let changed = false;
    for (const param of parameters) {
      if (param.default !== undefined && next[param.name] === undefined) {
        next[param.name] = param.default;
        changed = true;
      }
    }
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parameters]);

  const allRequiredFilled = parameters
    .filter((p) => p.required)
    .every((p) => value[p.name] !== undefined && value[p.name] !== "" && value[p.name] !== null);

  return (
    <div className={cn("space-y-4", compact && "space-y-2")}>
      <div className={cn("grid gap-4", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
        {parameters.map((param) => (
          <div key={param.name} className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              {param.name}
              {param.required ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground font-normal">({t("recipes.optional")})</span>
              )}
            </label>
            <ParameterInput
              param={param}
              value={value[param.name]}
              onChange={(val) => onChange({ ...value, [param.name]: val })}
            />
            {param.description && param.enum?.length === 0 && (
              <p className="text-[11px] text-muted-foreground">{param.description}</p>
            )}
          </div>
        ))}
      </div>

      {onSubmit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!allRequiredFilled || parameters.length === 0}
            className="btn btn--primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitLabel || t("recipes.run")}
          </button>
        </div>
      )}
    </div>
  );
}