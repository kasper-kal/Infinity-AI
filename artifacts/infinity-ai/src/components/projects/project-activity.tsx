import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Clock,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface ActivityRecord {
  id: string;
  projectId: string;
  type: string;
  description: string;
  createdAt: string;
}

interface ProjectActivityProps {
  projectId: string;
  onBack: () => void;
}

const ACTIVITY_ICONS: Record<string, string> = {
  project_created: "📁",
  conversation_started: "💬",
  file_uploaded: "📄",
  file_changed: "📝",
  research_completed: "🔬",
  memory_added: "🧠",
  memory_updated: "🧠",
  instruction_added: "📋",
  task_added: "✅",
  task_completed: "✅",
  agent_ran: "🤖",
};

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function getActivityIcon(type: string): string {
  return ACTIVITY_ICONS[type] || "📌";
}

function getActivityLabel(type: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const key = `projectActivity.type.${type}` as TranslationKey;
  try {
    return t(key);
  } catch {
    return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }
}

function asActivity(payload: unknown): ActivityRecord[] {
  if (Array.isArray(payload)) return payload as ActivityRecord[];
  if (typeof payload === "object" && payload !== null && Array.isArray((payload as { activity?: unknown }).activity)) {
    return (payload as { activity: ActivityRecord[] }).activity;
  }
  return [];
}

export function ProjectActivity({ projectId, onBack }: ProjectActivityProps) {
  const { t, lang } = useI18n();
  const locale = lang === "nl" ? "nl-NL" : "en-GB";
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadActivity = useCallback(async (signal?: AbortSignal, cursor?: string) => {
    const isLoadingMore = !!cursor;
    if (isLoadingMore) setLoadingMore(true);
    else setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/infinity/projects/${encodeURIComponent(projectId)}/activity?${params.toString()}`, { signal });
      if (!response.ok) throw new Error("Could not load activity");
      const data = await response.json();
      const items = asActivity(data.activity);
      const newCursor = data.nextCursor as string | null;
      if (isLoadingMore) {
        setActivity((current) => [...current, ...items]);
      } else {
        setActivity(items);
      }
      setNextCursor(newCursor);
      setHasMore(!!newCursor);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(true);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadActivity(controller.signal);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadActivity]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || !hasMore) return;
    const controller = new AbortController();
    await loadActivity(controller.signal, nextCursor);
  }, [loadActivity, nextCursor, loadingMore, hasMore]);

  const filteredActivity = useMemo(() => {
    if (!searchQuery.trim()) return activity;
    const q = searchQuery.toLowerCase();
    return activity.filter((a) =>
      a.description.toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q)
    );
  }, [activity, searchQuery]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 sm:px-6 lg:px-10 lg:pt-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("projectActivity.back")}
        </button>

        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-500">
                <span className="h-4 w-4">📋</span>
                {t("projectActivity.eyebrow")}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t("projectActivity.title")}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("projectActivity.description")}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{t("projectActivity.itemCount", { n: activity.length })}</span>
            </div>
          </div>
        </motion.header>

        {error && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
            <span>{t("projectActivity.loadError")}</span>
            <button type="button" onClick={() => void loadActivity()} className="rounded-full border border-current/20 px-3 py-1.5 font-medium transition hover:bg-rose-500/10">{t("projectActivity.retry")}</button>
          </div>
        )}

        <div className="mt-5">
          <div className="liquid-glass rounded-2xl border border-border/40 p-4">
            <div className="flex items-center gap-2">
              <label htmlFor="activity-search" className="sr-only">{t("projectActivity.searchPlaceholder")}</label>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  id="activity-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("projectActivity.searchPlaceholder")}
                  className="w-full rounded-xl border border-border/50 bg-background/70 pl-10 pr-4 py-2 text-sm text-foreground outline-none focus:border-primary/40"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground/50 hover:text-foreground"
                    aria-label={t("projectActivity.clearSearch")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[35vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />{t("projectActivity.loading")}</div>
        ) : filteredActivity.length === 0 ? (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="liquid-glass mt-5 flex min-h-[32vh] flex-col items-center justify-center rounded-3xl border border-border/40 p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500" style={{ fontSize: "2rem" }}>📋</span>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{t("projectActivity.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("projectActivity.emptyDescription")}</p>
          </motion.section>
        ) : (
          <div className="mt-5 space-y-3">
            {filteredActivity.map((item) => (
              <motion.article
                layout
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="liquid-glass rounded-2xl border border-border/40 p-4 transition hover:border-primary/30"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-xl" style={{ fontSize: "1.5rem" }}>
                    {getActivityIcon(item.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-foreground truncate">{getActivityLabel(item.type, t)}</h3>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground/80">{item.description}</p>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(item.createdAt, locale)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.article>
            ))}

            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/70 px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("projectActivity.loading")}
                    </>
                  ) : (
                    <>
                      <span>Load more</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}