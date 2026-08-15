import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clock,
  FileText,
  Loader2,
  Link2,
  Plus,
  Pin,
  PinOff,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface ResearchJobRecord {
  id: string;
  projectId: string;
  researchJobId: string;
  createdAt: string;
  job: {
    id: string;
    title: string;
    prompt: string;
    mode: "agent" | "normal" | "both";
    depth: "standard" | "deep" | "quantum" | "omni";
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    progress: number;
    phase: string;
    log: string;
    notes: string;
    report: string;
    gemConversationId: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  };
}

interface ResearchFindingRecord {
  id: string;
  projectId: string;
  researchJobId: string;
  excerpt: string;
  pinned: boolean;
  createdAt: string;
}

interface ProjectResearchProps {
  projectId: string;
  onBack: () => void;
}

const STATUS_META: Record<ResearchJobRecord["job"]["status"], { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-secondary text-muted-foreground" },
  running: { label: "Running", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  completed: { label: "Completed", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", className: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  cancelled: { label: "Cancelled", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
};

function formatDate(value: string | null, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function asResearch(payload: unknown): ResearchJobRecord[] {
  if (Array.isArray(payload)) return payload as ResearchJobRecord[];
  if (typeof payload === "object" && payload !== null && Array.isArray((payload as { research?: unknown }).research)) {
    return (payload as { research: ResearchJobRecord[] }).research;
  }
  return [];
}

function asFindings(payload: unknown): ResearchFindingRecord[] {
  if (Array.isArray(payload)) return payload as ResearchFindingRecord[];
  if (typeof payload === "object" && payload !== null && Array.isArray((payload as { findings?: unknown }).findings)) {
    return (payload as { findings: ResearchFindingRecord[] }).findings;
  }
  return [];
}

export function ProjectResearch({ projectId, onBack }: ProjectResearchProps) {
  const { t, lang } = useI18n();
  const locale = lang === "nl" ? "nl-NL" : "en-GB";
  const [research, setResearch] = useState<ResearchJobRecord[]>([]);
  const [findings, setFindings] = useState<ResearchFindingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState<ResearchJobRecord | null>(null);
  const [associating, setAssociating] = useState(false);
  const [associateJobId, setAssociateJobId] = useState("");
  const [savingFinding, setSavingFinding] = useState<string | null>(null);
  const [newFindingText, setNewFindingText] = useState("");
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null);

  const loadResearch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/research`, { signal });
      if (!response.ok) throw new Error("Could not load research");
      setResearch(asResearch(await response.json()));
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  const loadFindings = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/research/findings`, { signal });
      if (!response.ok) throw new Error("Could not load findings");
      setFindings(asFindings(await response.json()));
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadResearch(controller.signal);
      void loadFindings(controller.signal);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadResearch, loadFindings]);

  const associateJob = async () => {
    const jobId = associateJobId.trim();
    if (!jobId || associating) return;
    setAssociating(true);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchJobId: jobId }),
      });
      if (!response.ok) throw new Error("Could not associate research job");
      const { research: newResearch } = await response.json() as { research: ResearchJobRecord };
      setResearch((current) => [newResearch, ...current]);
      setAssociateJobId("");
    } catch {
      setError(true);
    } finally {
      setAssociating(false);
    }
  };

  const saveFinding = async (jobId: string) => {
    const excerpt = newFindingText.trim();
    if (!excerpt || savingFinding) return;
    setSavingFinding(jobId);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/research/${encodeURIComponent(jobId)}/findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excerpt }),
      });
      if (!response.ok) throw new Error("Could not save finding");
      const { finding } = await response.json() as { finding: ResearchFindingRecord };
      setFindings((current) => [finding, ...current]);
      setNewFindingText("");
    } catch {
      setError(true);
    } finally {
      setSavingFinding(null);
    }
  };

  const togglePinFinding = async (finding: ResearchFindingRecord) => {
    if (busyFindingId) return;
    setBusyFindingId(finding.id);
    const previous = finding.pinned;
    setFindings((current) => current.map((f) => (f.id === finding.id ? { ...f, pinned: !previous } : f)));
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/research/findings/${encodeURIComponent(finding.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !previous }),
      });
      if (!response.ok) throw new Error("Could not update finding");
    } catch {
      setFindings((current) => current.map((f) => (f.id === finding.id ? { ...f, pinned: previous } : f)));
      setError(true);
    } finally {
      setBusyFindingId(null);
    }
  };

  const deleteFinding = async (finding: ResearchFindingRecord) => {
    if (busyFindingId || !window.confirm(t("projectResearch.deleteFindingConfirm"))) return;
    setBusyFindingId(finding.id);
    try {
      const response = await fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}/research/findings/${encodeURIComponent(finding.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not delete finding");
      setFindings((current) => current.filter((f) => f.id !== finding.id));
    } catch {
      setError(true);
    } finally {
      setBusyFindingId(null);
    }
  };

  const openJobDetail = (job: ResearchJobRecord) => {
    setSelectedJob(job);
  };

  const filteredResearch = useMemo(() => {
    if (!searchQuery.trim()) return research;
    const q = searchQuery.toLowerCase();
    return research.filter((r) =>
      r.job.title.toLowerCase().includes(q) ||
      r.job.prompt.toLowerCase().includes(q) ||
      r.job.phase.toLowerCase().includes(q)
    );
  }, [research, searchQuery]);

  const filteredFindings = useMemo(() => {
    if (!searchQuery.trim()) return findings;
    const q = searchQuery.toLowerCase();
    return findings.filter((f) => f.excerpt.toLowerCase().includes(q));
  }, [findings, searchQuery]);

  if (selectedJob) {
    const job = selectedJob.job;
    const status = STATUS_META[job.status];
    const jobFindings = findings.filter((f) => f.researchJobId === job.id);

    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 sm:px-6 lg:px-10 lg:pt-7">
          <button
            type="button"
            onClick={() => setSelectedJob(null)}
            className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("projectResearch.back")}
          </button>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="liquid-glass rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex-1 min-w-0">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-500">
                  <BookOpen className="h-4 w-4" />
                  {t("projectResearch.eyebrow")}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl truncate">{job.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className={`rounded-full px-2.5 py-0.5 ${status.className}`}>{status.label}</span>
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    <Clock className="h-3 w-3" />
                    {formatDate(job.createdAt, locale)}
                  </span>
                  {job.completedAt && (
                    <span className="inline-flex items-center gap-1 text-[11px]">
                      <Check className="h-3 w-3" />
                      {formatDate(job.completedAt, locale)}
                    </span>
                  )}
                </div>
              </div>
              {job.gemConversationId && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {t("projectResearch.openExpert")}
                </button>
              )}
            </div>
          </motion.div>

          {error && (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
              <span>{t("projectResearch.loadError")}</span>
              <button type="button" onClick={() => { void loadResearch(); void loadFindings(); }} className="rounded-full border border-current/20 px-3 py-1.5 font-medium transition hover:bg-rose-500/10">{t("projectResearch.retry")}</button>
            </div>
          )}

          <div className="mt-5 space-y-6">
            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="text-lg font-semibold text-foreground">{t("projectResearch.report")}</h2>
              <div className="mt-3 liquid-glass rounded-2xl border border-border/40 p-4 prose prose-sm dark:prose-invert max-w-none">
                {job.report ? (
                  <div dangerouslySetInnerHTML={{ __html: job.report.replace(/\n/g, "<br/>") }} />
                ) : (
                  <p className="text-muted-foreground">{t("projectResearch.loading")}</p>
                )}
              </div>
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">{t("projectResearch.notes")}</h2>
              </div>
              <div className="mt-3 liquid-glass rounded-2xl border border-border/40 p-4 prose prose-sm dark:prose-invert max-w-none">
                {job.notes ? (
                  <div dangerouslySetInnerHTML={{ __html: job.notes.replace(/\n/g, "<br/>") }} />
                ) : (
                  <p className="text-muted-foreground">{t("projectResearch.loading")}</p>
                )}
              </div>
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">{t("projectResearch.log")}</h2>
              </div>
              <div className="mt-3 liquid-glass rounded-2xl border border-border/40 p-4 prose prose-sm dark:prose-invert max-w-none max-h-96 overflow-y-auto font-mono text-xs">
                <pre className="whitespace-pre-wrap">{job.log || "—"}</pre>
              </div>
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">{t("projectResearch.findingsTitle")}</h2>
              </div>

              <div className="mt-3 liquid-glass rounded-2xl border border-border/40 p-4">
                <textarea
                  value={newFindingText}
                  onChange={(e) => setNewFindingText(e.target.value)}
                  placeholder={t("projectResearch.saveFindingPlaceholder")}
                  rows={3}
                  className="w-full rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40 resize-none"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveFinding(job.id)}
                    disabled={!newFindingText.trim() || savingFinding === job.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {savingFinding === job.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    {t("projectResearch.saveFindingBtn")}
                  </button>
                </div>
              </div>

              {jobFindings.length === 0 ? (
                <div className="mt-4 liquid-glass rounded-2xl border border-border/40 p-8 text-center">
                  <p className="text-sm text-muted-foreground">{t("projectResearch.findingsEmpty")}</p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {jobFindings.map((finding) => {
                    const isBusy = busyFindingId === finding.id;
                    return (
                      <motion.article layout key={finding.id} className="liquid-glass rounded-2xl border border-border/40 p-4 transition hover:border-primary/30">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-foreground">{finding.excerpt}</p>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDate(finding.createdAt, locale)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void togglePinFinding(finding)}
                              disabled={isBusy}
                              className={`rounded-full p-1.5 transition ${finding.pinned ? "text-amber-500" : "text-muted-foreground hover:bg-secondary hover:text-foreground"} disabled:opacity-50`}
                              aria-label={finding.pinned ? t("projectResearch.unpinFinding") : t("projectResearch.pinFinding")}
                            >
                              {finding.pinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteFinding(finding)}
                              disabled={isBusy}
                              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
                              aria-label={t("projectResearch.deleteFinding")}
                            >
                              {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </div>
              )}
            </motion.section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 sm:px-6 lg:px-10 lg:pt-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("projectResearch.back")}
        </button>

        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/70 p-6 shadow-apple-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-500">
                <BookOpen className="h-4 w-4" />
                {t("projectResearch.eyebrow")}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t("projectResearch.title")}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("projectResearch.description")}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{research.length} runs</span>
              <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">{findings.length} findings</span>
            </div>
          </div>
        </motion.header>

        {error && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
            <span>{t("projectResearch.loadError")}</span>
            <button type="button" onClick={() => { void loadResearch(); void loadFindings(); }} className="rounded-full border border-current/20 px-3 py-1.5 font-medium transition hover:bg-rose-500/10">{t("projectResearch.retry")}</button>
          </div>
        )}

        <div className="mt-5">
          <div className="liquid-glass rounded-2xl border border-border/40 p-4">
            <div className="flex items-center gap-2">
              <label htmlFor="research-search" className="sr-only">{t("projectResearch.searchPlaceholder")}</label>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  id="research-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("projectResearch.searchPlaceholder")}
                  className="w-full rounded-xl border border-border/50 bg-background/70 pl-10 pr-4 py-2 text-sm text-foreground outline-none focus:border-primary/40"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground/50 hover:text-foreground"
                    aria-label={t("projectResearch.clearSearch")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 liquid-glass rounded-2xl border border-dashed border-border/60 bg-card/40 p-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={associateJobId}
              onChange={(e) => setAssociateJobId(e.target.value)}
              placeholder={t("projectResearch.associatePlaceholder")}
              className="flex-1 rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
            />
            <button
              type="button"
              onClick={() => void associateJob()}
              disabled={!associateJobId.trim() || associating}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 shrink-0"
            >
              {associating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {t("projectResearch.associateBtn")}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground text-center">{t("projectResearch.emptyDescription")}</p>
        </div>

        {loading ? (
          <div className="flex min-h-[35vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />{t("projectResearch.loading")}</div>
        ) : filteredResearch.length === 0 ? (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="liquid-glass mt-5 flex min-h-[32vh] flex-col items-center justify-center rounded-3xl border border-border/40 p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500"><BookOpen className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{t("projectResearch.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("projectResearch.emptyDescription")}</p>
          </motion.section>
        ) : (
          <div className="mt-5 space-y-3">
            {filteredResearch.map((r) => {
              const job = r.job;
              const status = STATUS_META[job.status];
              return (
                <motion.article layout key={r.id} className="liquid-glass rounded-2xl border border-border/40 p-4 transition hover:border-primary/30" onClick={() => openJobDetail(r)}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium text-foreground truncate">{job.title}</h3>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground/80 truncate">{job.prompt}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/60">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(job.createdAt, locale)}</span>
                        {job.completedAt && <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />{formatDate(job.completedAt, locale)}</span>}
                        <span className="inline-flex items-center gap-1">{job.progress}%</span>
                      </div>
                    </div>
                    <FileText className="shrink-0 h-5 w-5 text-muted-foreground/50" />
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