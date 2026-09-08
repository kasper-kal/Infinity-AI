"use client";

/**
 * RecipePanel
 * Main recipe view for BuildView: toggles between Marketplace and Builder.
 * Some recipes open directly in the runner via the runnerOverride prop
 * (used by the Command Palette / agent-suggested recipes).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useRecipes, type Recipe } from "@/hooks/useRecipes";
import { RecipeMarketplace } from "./RecipeMarketplace";
import { RecipeBuilder } from "./RecipeBuilder";
import { RecipeRunner } from "./RecipeRunner";

export interface RecipePanelProps {
  /** Direct-open a recipe in the runner (e.g. agent suggestion) */
  openRecipeId?: string | null;
  onOpenRecipe?: (id: string) => void;
  /** Optional project context (recipes are global; passed for parity with other panels) */
  projectId?: string | null;
}

type View = "marketplace" | "builder" | "runner";

export function RecipePanel({ openRecipeId, onOpenRecipe, projectId }: RecipePanelProps) {
  const { t } = useI18n();
  const { recipes, getRecipe } = useRecipes();

  const [view, setView] = React.useState<View>("marketplace");
  const [editing, setEditing] = React.useState<Recipe | null>(null);
  const [running, setRunning] = React.useState<Recipe | null>(null);

  const openRecipe = React.useCallback(
    (recipe: Recipe) => {
      setRunning(recipe);
      setView("runner");
      onOpenRecipe?.(recipe.id || "");
    },
    [onOpenRecipe]
  );

  // Handle direct-open recipe
  React.useEffect(() => {
    if (!openRecipeId) return;
    const found = recipes.find((r) => r.id === openRecipeId);
    if (found) {
      openRecipe(found);
    } else {
      getRecipe(openRecipeId).then((r) => {
        if (r) openRecipe(r);
      });
    }
  }, [openRecipeId, recipes, getRecipe, openRecipe]);

  const openBuilder = () => {
    setEditing(null);
    setView("builder");
  };

  const openEdit = (recipe: Recipe) => {
    setEditing(recipe);
    setView("builder");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Mobile-ish tab bar */}
      <div className="flex items-center gap-1 border-b px-1 pt-1">
        <button
          type="button"
          onClick={() => {
            setView("marketplace");
            setRunning(null);
          }}
          className={cn(
            "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
            view === "marketplace" ? "border-b border-primary -mb-px text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("recipes.marketplace")}
        </button>
        <button
          type="button"
          onClick={openBuilder}
          className={cn(
            "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
            view === "builder" ? "border-b border-primary -mb-px text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("recipes.builder")}
        </button>
        {view === "runner" && running && (
          <button
            type="button"
            onClick={() => setView("marketplace")}
            className="rounded-t-lg px-3 py-2 text-sm font-medium text-foreground border-b border-primary -mb-px"
          >
            {running.name}
          </button>
        )}
        <div className="ml-auto pr-2">
          <span className="text-[11px] text-muted-foreground">
            {t("recipes.count", { count: recipes.length })}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {view === "marketplace" && (
          <RecipeMarketplace
            onCreate={openBuilder}
            onSelect={openRecipe}
          />
        )}
        {view === "builder" && (
          <div className="mx-auto max-w-3xl">
            <RecipeBuilder
              existing={editing}
              onCancel={() => setView("marketplace")}
              onDone={() => setView("marketplace")}
            />
          </div>
        )}
        {view === "runner" && running && (
          <div className="mx-auto max-w-2xl">
            <RecipeRunner recipe={running} onBack={() => setView("marketplace")} />
          </div>
        )}
      </div>
    </div>
  );
}