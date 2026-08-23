import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface ProjectTaskRecord {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  dueAt: string | null;
  conversationId: string | null;
  fileId: string | null;
  memoryId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectTasksProps {
  projectId: string;
  onBack: () => void;
}

const STATUS_CYCLE: ProjectTaskRecord["status"][] = ["todo", "in_progress", "done"];
const PRIORITY_META: Record<ProjectTaskRecord["priority"], { label: string; className: string }> = {
  low: { label: "Low", className: "bg-secondary text-muted-foreground" },
  medium: { label: "Medium", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  high: { label: "High", className: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
};

function asTasks(payload: unknown): ProjectTaskRecord[] {
  if (Array.isArray(payload)) return payload as ProjectTaskRecord[];
  if (typeof payload === "object" && payload !== null && Array.isArray((payload as { tasks?: unknown }).tasks)) {
    return (payload as { tasks: ProjectTaskRecord[] }).tasks;
  }
  return [];
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function ProjectTasks({ projectId, onBack }: ProjectTasksProps) {
  const { t, lang } = useI18n();
  const locale = lang === "nl" ? "nl-NL" : "en-GB";
  const [tasks, setTasks] = useState<ProjectTaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<ProjectTaskRecord["priority"]>("medium");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/tasks`, { signal });
      if (!response.ok) throw new Error("Could not load tasks");
      setTasks(asTasks(await response.json()));
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadTasks(controller.signal), 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadTasks]);

  const createTask = async () => {
    const title = newTitle.trim();
    if (!title || busyId) return;
    setBusyId("__new__");
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, priority: newPriority }),
      });
      if (!response.ok) throw new Error("Could not create task");
      const { task } = await response.json() as { task: ProjectTaskRecord };
      setTasks((current) => [task, ...current]);
      setNewTitle("");
      setNewPriority("medium");
      setAdding(false);
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const cycleStatus = async (task: ProjectTaskRecord) => {
    if (busyId) return;
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length];
    setBusyId(task.id);
    const previous = task.status;
    setTasks((current) => current.map((t2) => (t2.id === task.id ? { ...t2, status: next } : t2)));
    try {
      const response = await fetch(`/api/jarvis/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error("Could not update task");
    } catch {
      setTasks((current) => current.map((t2) => (t2.id === task.id ? { ...t2, status: previous } : t2)));
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const deleteTask = async (task: ProjectTaskRecord) => {
    if (busyId || !window.confirm(t("projectTasks.deleteConfirm"))) return;
    setBusyId(task.id);
    try {
      const response = await fetch(`/api/jarvis/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete task");
      setTasks((current) => current.filter((t2) => t2.id !== task.id));
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => ({
    todo: tasks.filter((t2) => t2.status === "todo").length,
    in_progress: tasks.filter((t2) => t2.status === "in_progress").length,
    done: tasks.filter((t2) => t2.status === "done").length,
  }), [tasks]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 sm:px-6 lg:px-10 lg:pt-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('projectTasks.back')}
        </button>

        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-500">
                <CheckCircle2 className="h-4 w-4" />
                {t('projectTasks.eyebrow')}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('projectTasks.title')}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('projectTasks.description')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{t('projectTasks.countTodo', { n: counts.todo })}</span>
              <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">{t('projectTasks.countProgress', { n: counts.in_progress })}</span>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{t('projectTasks.countDone', { n: counts.done })}</span>
            </div>
          </div>
        </motion.header>

        {error && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
            <span>{t('projectTasks.loadError')}</span>
            <button type="button" onClick={() => void loadTasks()} className="rounded-full border border-current/20 px-3 py-1.5 font-medium transition hover:bg-rose-500/10">{t('projectTasks.retry')}</button>
          </div>
        )}

        <div className="mt-5">
          {adding ? (
            <div className="liquid-glass rounded-2xl border border-border/40 p-4">
              <input
                autoFocus
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void createTask(); if (event.key === "Escape") { setAdding(false); setNewTitle(""); } }}
                placeholder={t('projectTasks.newPlaceholder')}
                className="w-full rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {(["low", "medium", "high"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewPriority(p)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition ${newPriority === p ? PRIORITY_META[p].className : "bg-secondary/50 text-muted-foreground/70"}`}
                    >
                      {PRIORITY_META[p].label}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setAdding(false); setNewTitle(""); }} className="inline-flex items-center gap-1.5 rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" />{t('projectTasks.cancel')}</button>
                  <button type="button" onClick={() => void createTask()} disabled={!newTitle.trim() || busyId === "__new__"} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50">{busyId === "__new__" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{t('projectTasks.add')}</button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/40 px-4 py-3 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('projectTasks.addTask')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex min-h-[35vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />{t('projectTasks.loading')}</div>
        ) : tasks.length === 0 ? (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="liquid-glass mt-5 flex min-h-[32vh] flex-col items-center justify-center rounded-3xl border border-border/40 p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500"><CheckCircle2 className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{t('projectTasks.emptyTitle')}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('projectTasks.emptyDescription')}</p>
          </motion.section>
        ) : (
          <div className="mt-5 space-y-3">
            {tasks.map((task) => {
              const isBusy = busyId === task.id;
              const priority = PRIORITY_META[task.priority];
              const due = formatDate(task.dueAt, locale);
              return (
                <motion.article layout key={task.id} className="liquid-glass rounded-2xl border border-border/40 p-4 transition hover:border-primary/30">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void cycleStatus(task)}
                      disabled={isBusy}
                      className="mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
                      aria-label={t('projectTasks.cycleStatus')}
                    >
                      {task.status === "done" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : task.status === "in_progress" ? <Clock className="h-5 w-5 text-amber-500" /> : <Circle className="h-5 w-5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <h3 className={`text-sm font-medium ${task.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</h3>
                      {task.description && <p className="mt-1 text-xs leading-5 text-muted-foreground/80">{task.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/60">
                        <span className={`rounded-full px-2 py-0.5 ${priority.className}`}>{priority.label}</span>
                        {task.dueAt && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{due}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void deleteTask(task)}
                      disabled={isBusy}
                      className="shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
