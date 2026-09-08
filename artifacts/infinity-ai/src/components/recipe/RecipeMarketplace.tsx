"use client";

/**
 * RecipeMarketplace
 * Local-first marketplace for recipes.
 * Browse built-in + public recipes, search/filter by tag/type, import/export .recipe.json,
 * fork, publish, rate.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useRecipes, type Recipe } from "@/hooks/useRecipes";
import { RecipeRunner } from "./RecipeRunner";

export interface RecipeMarketplaceProps {
  onSelect?: (recipe: Recipe) => void;
  /** Callback when user wants to build a new recipe */
  onCreate?: () => void;
}

export function RecipeMarketplace({ onSelect, onCreate }: RecipeMarketplaceProps) {
  const { t } = useI18n();
  const {
    recipes,
    categories,
    loading,
    error,
    fetchRecipes,
    fetchCategories,
    importRecipe,
    rateRecipe,
    publishRecipe,
    unpublishRecipe,
  } = useRecipes();

  const [query, setQuery] = React.useState("");
  const [tag, setTag] = React.useState<string | null>(null);
  const [typeFilter, setTypeFilter] = React.useState<"all" | "standard" | "deep-research">("all");
  const [selected, setSelected] = React.useState<Recipe | null>(null);
  const [showDetail, setShowDetail] = React.useState<Recipe | null>(null);
  const [myRating, setMyRating] = React.useState<Record<string, number>>({});
  const [importError, setImportError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    let items = recipes;
    if (typeFilter !== "all") items = items.filter((r) => r.type === typeFilter);
    if (tag) items = items.filter((r) => r.tags.includes(tag));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      items = items.filter(
        (r) => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [recipes, typeFilter, tag, query]);

  const anyFilter = typeFilter !== "all" || tag !== null || query.trim() !== "";

  const rate = async (id: string, rating: number) => {
    const ok = await rateRecipe(id, rating);
    if (ok) {
      setMyRating((r) => ({ ...r, [id]: rating }));
      await fetchRecipes();
    }
  };

  const togglePublish = async (r: Recipe) => {
    if (!r.id) return;
    if (r.isPublic) {
      await unpublishRecipe(r.id);
    } else {
      await publishRecipe(r.id);
    }
    await fetchRecipes();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const result = await importRecipe(text);
      if (result) {
        await fetchRecipes();
      } else {
        setImportError(t("recipes.errors.import"));
      }
    } catch {
      setImportError(t("recipes.errors.import"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportRecipe = async (r: Recipe) => {
    if (!r.id) return;
    const json = await fetch(`/api/infinity/recipes/${r.id}/export`).then((res) => res.text());
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.name.replace(/[^a-z0-9]+/gi, "-")}.recipe.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Runner view (when a recipe is selected to run) ─────────────────────
  if (selected) {
    return (
      <div className="mx-auto max-w-2xl">
        <RecipeRunner
          recipe={selected}
          onBack={() => setSelected(null)}
          onFork={async (recipe) => {
            const res = await fetch(`/api/infinity/recipes/${selected.id}/fork`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: recipe.name + " (fork)" }),
            });
            if (res.ok) {
              await fetchRecipes();
              setSelected(null);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("recipes.searchPlaceholder")}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-input p-0.5">
          {(["all", "standard", "deep-research"] as const).map((ft) => (
            <button
              key={ft}
              type="button"
              onClick={() => setTypeFilter(ft)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                typeFilter === ft ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ft === "all" ? t("recipes.all") : ft === "standard" ? t("recipes.standard") : t("recipes.deepResearch")}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} className="btn btn--ghost btn--sm">
          {t("recipes.import")}
        </button>
        <input ref={fileRef} type="file" accept=".json,.recipe.json" className="hidden" onChange={handleImportFile} />
        {onCreate && (
          <button type="button" onClick={onCreate} className="btn btn--primary btn--sm">
            + {t("recipes.newRecipe")}
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setTag(tag === c ? null : c)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              tag === c
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {importError && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{importError}</div>}

      {/* Recipe grid */}
      {loading && recipes.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {anyFilter ? t("recipes.noResults") : t("recipes.noRecipes")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((recipe) => (
            <div key={recipe.id} className="group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
              {/* Card header */}
              <div className="flex items-start justify-between gap-2">
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    recipe.type === "deep-research"
                      ? "bg-violet-500/15 text-violet-600"
                      : "bg-sky-500/15 text-sky-600"
                  )}
                >
                  {recipe.type === "deep-research" ? t("recipes.deepResearch") : t("recipes.standard")}
                </span>
                <div className="flex gap-0.5">
                  {!recipe.isBuiltIn && (
                    <button
                      type="button"
                      onClick={() => togglePublish(recipe)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={recipe.isPublic ? t("recipes.unpublish") : t("recipes.publish")}
                    >
                      {recipe.isPublic ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6v6M10 14L20 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="4" y="10" width="16" height="11" rx="2" />
                          <path d="M8 10V7a4 4 0 118 0v3" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => exportRecipe(recipe)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t("recipes.export")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Title + description */}
              <button
                type="button"
                className="mt-2 text-left"
                onClick={() => setShowDetail(recipe)}
              >
                <h3 className="text-sm font-semibold leading-snug group-hover:text-primary transition-colors">
                  {recipe.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {recipe.description || t("recipes.noDescription")}
                </p>
              </button>

              {/* Tags */}
              <div className="mt-2 flex flex-wrap gap-1">
                {recipe.tags.slice(0, 3).map((tg) => (
                  <span key={tg} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {tg}
                  </span>
                ))}
                {recipe.tags.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{recipe.tags.length - 3}</span>
                )}
              </div>

              {/* Footer */}
              <div className="mt-3 flex items-center justify-between border-t pt-2.5">
                {/* Stars */}
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => rate(recipe.id!, star)}
                      className={cn(
                        "text-sm leading-none transition-colors",
                        (myRating[recipe.id!] || 0) >= star || (recipe.avgRating || 0) >= star
                          ? "text-amber-400"
                          : "text-muted-foreground/30 hover:text-amber-400/60"
                      )}
                      aria-label={`${star} star`}
                    >
                      ★
                    </button>
                  ))}
                  {(recipe.avgRating || 0) > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {recipe.avgRating?.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">v{recipe.version}</span>
                  <button type="button" onClick={() => setSelected(recipe)} className="btn btn--primary btn--sm">
                    {t("recipes.run")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail overlay */}
      {showDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDetail(null)}>
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{showDetail.name}</h3>
                <p className="text-xs text-muted-foreground">v{showDetail.version}</p>
              </div>
              <button type="button" onClick={() => setShowDetail(null)} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{showDetail.description}</p>

            <div className="mt-4 space-y-4">
              {showDetail.parameters.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("recipes.parameters")}
                  </h4>
                  <ul className="space-y-1">
                    {showDetail.parameters.map((p) => (
                      <li key={p.name} className="flex items-center gap-2 text-xs">
                        <code className="rounded bg-muted px-1.5 py-0.5">{p.name}</code>
                        <span className="text-muted-foreground">{p.type}</span>
                        {p.required && <span className="text-destructive">*</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showDetail.steps.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("recipes.steps")}
                  </h4>
                  <ol className="space-y-1 text-xs">
                    {showDetail.steps.map((s, i) => (
                      <li key={s.id} className="flex gap-2">
                        <span className="text-muted-foreground">{i + 1}.</span>
                        <span className="line-clamp-2">{s.prompt}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(showDetail);
                    setShowDetail(null);
                  }}
                  className="btn btn--primary"
                >
                  {t("recipes.run")}
                </button>
                {onSelect && (
                  <button type="button" onClick={() => onSelect(showDetail)} className="btn btn--ghost">
                    {t("recipes.use")}
                  </button>
                )}
                <button type="button" onClick={() => setShowDetail(null)} className="btn btn--ghost">
                  {t("recipes.close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}