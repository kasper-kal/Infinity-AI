import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen, X, Loader2, Sparkles, CheckCircle2, XCircle, Play,
  Wand2, RefreshCw, Download, FileText, Trash2, KeyRound, ChevronDown,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { ensurePushSubscription } from '@/lib/push';
import { haptics } from '@/lib/haptics';

/** Mirrors the server-side book_jobs row (fields the UI needs). */
export interface BookJob {
  id: string;
  title: string;
  idea: string;
  language: string;
  pageCount: number;
  wordsPerPage: number;
  chunkSize: number;
  critiquePasses: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  phase: string;
  log: string;
  plan: string;
  manuscript: string;
  samples: string;
  apiKey: string | null; // masked ••••last4
  baseUrl: string | null;
  model: string | null;
  pdfFile: string | null;
  error: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface BookPlan {
  title: string;
  summary: string;
  chapters: { title: string; summary: string; pages: number }[];
}

interface BookSampleMeta {
  file: string;
  kind: 'txt' | 'pdf';
  language: 'en' | 'nl' | 'other';
  chars: number;
  error: string | null;
}

interface BookStudioProps {
  open: boolean;
  onClose: () => void;
  jobs: BookJob[];
  onStarted?: (job: BookJob) => void;
  onCancel?: (jobId: string) => void;
}

const STATUS_STYLE: Record<BookJob['status'], { color: string; icon: 'spin' | 'ok' | 'err' | 'idle' }> = {
  queued: { color: 'text-amber-500/80', icon: 'idle' },
  running: { color: 'text-primary', icon: 'spin' },
  completed: { color: 'text-green-500', icon: 'ok' },
  failed: { color: 'text-red-500', icon: 'err' },
  cancelled: { color: 'text-muted-foreground/50', icon: 'err' },
};

function buildByo(apiKey: string, baseUrl: string, model: string): { apiKey: string; baseUrl: string; model: string } | null {
  if (!apiKey.trim() && !baseUrl.trim() && !model.trim()) return null;
  return { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() };
}

/** Download the manuscript as book.txt from the browser (no server round-trip). */
function downloadManuscript(job: BookJob) {
  const blob = new Blob([job.manuscript || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'book.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BookStudio({ open, onClose, jobs, onStarted, onCancel }: BookStudioProps) {
  const { t } = useI18n();

  // ── Setup state ──
  const [idea, setIdea] = useState('');
  const [language, setLanguage] = useState<'en' | 'nl' | 'other'>('en');
  const [pageCount, setPageCount] = useState(120);
  const [wordsPerPage, setWordsPerPage] = useState(250);
  const [chunkSize, setChunkSize] = useState(10);
  const [critiquePasses, setCritiquePasses] = useState(2);

  // ── BYO key ──
  const [byoOpen, setByoOpen] = useState(false);
  const [byoApiKey, setByoApiKey] = useState('');
  const [byoBaseUrl, setByoBaseUrl] = useState('');
  const [byoModel, setByoModel] = useState('');

  // ── Plan + job flow ──
  const [samples, setSamples] = useState<BookSampleMeta[] | null>(null);
  const [plan, setPlan] = useState<BookPlan | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [revising, setRevising] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'setup' | 'plan' | 'jobs'>('setup');

  // Fresh start every time the studio opens (settings persist in the inputs).
  useEffect(() => {
    if (open) {
      setPlan(null);
      setFeedback('');
      setFeedbackOpen(false);
      setError('');
      setStep('setup');
      fetch('/api/jarvis/book/samples')
        .then((r) => (r.ok ? r.json() : null))
        .then((s: BookSampleMeta[] | null) => { if (s) setSamples(s); })
        .catch(() => setSamples([]));
    }
  }, [open]);

  const requestNotifications = () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  };

  const handlePlan = async () => {
    haptics.light();
    if (!idea.trim()) return;
    const byo = buildByo(byoApiKey, byoBaseUrl, byoModel);
    if (byo && (!byo.apiKey || !byo.baseUrl || !byo.model)) {
      setError(t('book.byoMissing') as string);
      return;
    }
    requestNotifications();
    setPlanning(true);
    setError('');
    try {
      const res = await fetch('/api/jarvis/book/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: idea.trim(),
          language,
          pageCount,
          byo,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? t('book.planError', { error: String(res.status) }));
        return;
      }
      setPlan(data.plan as BookPlan);
      setStep('plan');
    } catch {
      setError('Network error, is the server running?');
    } finally {
      setPlanning(false);
    }
  };

  const handleRevise = async () => {
    haptics.light();
    if (!plan || !feedback.trim()) return;
    const byo = buildByo(byoApiKey, byoBaseUrl, byoModel);
    setRevising(true);
    setError('');
    try {
      const res = await fetch('/api/jarvis/book/plan/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim(), language, pageCount, plan, feedback: feedback.trim(), byo }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Could not revise the plan');
        return;
      }
      setPlan(data.plan as BookPlan);
      setFeedback('');
      setFeedbackOpen(false);
    } catch {
      setError('Network error, is the server running?');
    } finally {
      setRevising(false);
    }
  };

  const handleApprove = async () => {
    haptics.medium?.();
    if (!plan) return;
    const byo = buildByo(byoApiKey, byoBaseUrl, byoModel);
    setStarting(true);
    setError('');
    await ensurePushSubscription();
    try {
      const res = await fetch('/api/jarvis/book/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: idea.trim(),
          language,
          pageCount,
          wordsPerPage,
          chunkSize,
          critiquePasses,
          plan,
          byo,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Failed to start (${res.status})`);
        return;
      }
      setPlan(null);
      setStep('jobs');
      onStarted?.(data as BookJob);
    } catch {
      setError('Network error, is the server running?');
    } finally {
      setStarting(false);
    }
  };

  const totalPlanPages = plan?.chapters.reduce((sum, c) => sum + (c.pages || 0), 0) ?? 0;
  const sampleLangs = samples ? Array.from(new Set(samples.filter((s) => s.error === null).map((s) => s.language === 'other' ? '?' : s.language.toUpperCase()))).join(' · ') : '';

  const lastLogLines = (log: string) => log.split('\n').filter(Boolean).slice(-3);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-2 backdrop-blur-md sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border/50 bg-background shadow-apple-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-border/40 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 dark:bg-rose-400/15 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-rose-500 dark:text-rose-400" strokeWidth={1.9} />
                </div>
                <div>
                  <p className="text-base font-semibold leading-tight">{t('book.title')}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-snug">{t('book.subtitle')}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-full hover:bg-muted/50 text-muted-foreground transition-colors" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 sm:p-5 space-y-4">
              {/* Step indicator */}
              <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest text-muted-foreground/50">
                <span className={step === 'setup' ? 'text-primary' : ''}>{t('book.step.setup')}</span>
                <span className="text-muted-foreground/30">→</span>
                <span className={step === 'plan' ? 'text-primary' : ''}>{t('book.step.plan')}</span>
                <span className="text-muted-foreground/30">→</span>
                <span className={step === 'jobs' ? 'text-primary' : ''}>{t('book.step.jobs')}</span>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-400/90 leading-relaxed">
                  {error}
                </div>
              )}

              {/* ── Setup card ── */}
              <div className="rounded-2xl border border-border/40 bg-card/50 p-4 space-y-3">
                <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50">{t('book.ideaLabel')}</p>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={3}
                  placeholder={t('book.ideaPlaceholder')}
                  maxLength={8000}
                  className="w-full rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none resize-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-1.5">{t('book.language')}</p>
                    <div className="flex gap-1.5">
                      {(['en', 'nl', 'other'] as const).map((l) => (
                        <button
                          key={l}
                          onClick={() => { haptics.light(); setLanguage(l); }}
                          className={`flex-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                            language === l ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground/60 hover:text-foreground'
                          }`}
                        >
                          {l === 'en' ? t('book.languageEn') : l === 'nl' ? t('book.languageNl') : t('book.languageOther')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-1.5">{t('book.pages')} · <span className="text-primary">{pageCount}</span></p>
                    <input
                      type="range" min={20} max={400} step={10} value={pageCount}
                      onChange={(e) => setPageCount(Number(e.target.value))}
                      className="w-full accent-primary mt-2"
                    />
                  </div>

                  <div>
                    <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-1.5">{t('book.wordsPerPage')}</p>
                    <input
                      type="number" min={100} max={400} step={25} value={wordsPerPage}
                      onChange={(e) => setWordsPerPage(Number(e.target.value))}
                      className="w-full rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-[12px] outline-none focus:border-primary/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-1.5">{t('book.chunkSize')}</p>
                    <div className="flex gap-1.5">
                      {[5, 10, 15, 20].map((n) => (
                        <button
                          key={n}
                          onClick={() => { haptics.light(); setChunkSize(n); }}
                          className={`flex-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                            chunkSize === n ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground/60 hover:text-foreground'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-1.5">{t('book.critiquePasses')}</p>
                    <div className="flex gap-1.5">
                      {[0, 1, 2, 3].map((n) => (
                        <button
                          key={n}
                          onClick={() => { haptics.light(); setCritiquePasses(n); }}
                          className={`flex-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                            critiquePasses === n ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground/60 hover:text-foreground'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* BYO key */}
                <div className="rounded-xl border border-border/40 bg-background/40">
                  <button
                    onClick={() => { haptics.light(); setByoOpen(!byoOpen); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-[12px] font-medium text-muted-foreground"
                  >
                    <span className="flex items-center gap-2"><KeyRound className="w-3.5 h-3.5" /> {t('book.byo')}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${byoOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {byoOpen && (
                    <div className="px-3 pb-3 space-y-2">
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{t('book.byoHint')}</p>
                      <input value={byoApiKey} onChange={(e) => setByoApiKey(e.target.value)} placeholder={t('book.byoKey')} type="password" autoComplete="off" className="w-full rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-[12px] font-mono outline-none focus:border-primary/50 placeholder:text-muted-foreground/40" />
                      <input value={byoBaseUrl} onChange={(e) => setByoBaseUrl(e.target.value)} placeholder={t('book.byoBaseUrl')} autoComplete="off" className="w-full rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-[12px] font-mono outline-none focus:border-primary/50 placeholder:text-muted-foreground/40" />
                      <input value={byoModel} onChange={(e) => setByoModel(e.target.value)} placeholder={t('book.byoModel')} autoComplete="off" className="w-full rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-[12px] font-mono outline-none focus:border-primary/50 placeholder:text-muted-foreground/40" />
                    </div>
                  )}
                </div>

                {/* Style samples indicator */}
                <div className="rounded-xl border border-border/40 bg-background/40 px-3 py-2.5">
                  <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50">{t('book.samples')}</p>
                  {samples === null ? (
                    <p className="text-[11px] text-muted-foreground/50 mt-1">…</p>
                  ) : samples.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/50 mt-1 italic">{t('book.samplesEmpty')}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/80 mt-1">
                      {t('book.samplesCount', { count: samples.filter((s) => s.error === null).length, langs: sampleLangs })}
                      <span className="text-muted-foreground/40"> — {samples.filter((s) => s.error === null).slice(0, 6).map((s) => s.file).join(', ')}</span>
                    </p>
                  )}
                </div>

                <button
                  onClick={handlePlan}
                  disabled={!idea.trim() || planning}
                  className="w-full px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {planning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {planning ? t('book.planning') : t('book.planBtn')}
                </button>
              </div>

              {/* ── Plan card ── */}
              {plan && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-primary/25 bg-primary/[0.03] p-4 space-y-3">
                  <p className="text-[10px] font-mono tracking-widest text-primary/70">{t('book.planTitle')}</p>
                  <div>
                    <p className="text-lg font-semibold leading-tight">{plan.title}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">{t('book.planSummary')}</p>
                    <p className="text-[12px] leading-relaxed text-muted-foreground/80 mt-0.5">{plan.summary}</p>
                  </div>
                  <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mt-1">
                    {t('book.planChapters', { n: plan.chapters.length })} · {t('book.planPagesTotal', { pages: totalPlanPages })}
                  </p>
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-2">
                    {plan.chapters.map((c, i) => (
                      <div key={i} className="flex gap-2 text-[11px]">
                        <span className="text-primary/70 font-mono flex-shrink-0 mt-px">{i + 1}.</span>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground/90">{c.title} <span className="text-muted-foreground/40 font-mono">({c.pages}p)</span></p>
                          <p className="text-muted-foreground/70 leading-snug">{c.summary}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Change-something loop */}
                  {feedbackOpen ? (
                    <div className="space-y-2 pt-1">
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        rows={2}
                        placeholder={t('book.planChangePlaceholder')}
                        maxLength={2000}
                        className="w-full rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-[12px] leading-relaxed outline-none resize-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { haptics.light(); setFeedbackOpen(false); setFeedback(''); }}
                          disabled={revising}
                          className="px-3 py-2 rounded-lg border border-border/50 text-[11px] font-medium text-muted-foreground hover:bg-secondary/70 transition-colors disabled:opacity-40"
                        >
                          {t('research.cancel')}
                        </button>
                        <button
                          onClick={handleRevise}
                          disabled={!feedback.trim() || revising}
                          className="flex-1 px-3 py-2 rounded-lg bg-primary/15 text-primary border border-primary/30 text-[11px] font-semibold hover:bg-primary/25 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                        >
                          {revising ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          {revising ? t('book.planChanging') : t('book.planReview')}
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground/50 italic">{t('book.planChangedHint')}</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => { haptics.light(); setFeedbackOpen(true); }}
                        className="px-3 py-2 rounded-lg border border-border/50 text-[11px] font-medium text-muted-foreground hover:bg-secondary/70 transition-colors"
                      >
                        {t('book.planChange')}
                      </button>
                      <button
                        onClick={handleApprove}
                        disabled={starting}
                        className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
                      >
                        {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        {starting ? t('book.starting') : t('book.planApprove')}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── Jobs list ── */}
              <div className="space-y-2 pt-1">
                <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50">{t('book.step.jobs')}</p>
                {jobs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/50 italic px-1">{t('book.jobsEmpty')}</p>
                ) : (
                  jobs.map((job) => {
                    const style = STATUS_STYLE[job.status];
                    return (
                      <div key={job.id} className="rounded-2xl border border-border/40 bg-card/50 p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium truncate flex-1">{job.title}</p>
                          <span className={`flex items-center gap-1 text-[10px] font-mono flex-shrink-0 ${style.color}`}>
                            {style.icon === 'spin' && <Loader2 className="w-3 h-3 animate-spin" />}
                            {style.icon === 'ok' && <CheckCircle2 className="w-3 h-3" />}
                            {style.icon === 'err' && <XCircle className="w-3 h-3" />}
                            {t(`book.status.${job.status}`)}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground/40">
                          {job.pageCount}p · {job.language} · {job.model ?? (job.apiKey ? 'BYO' : 'Infinity key')}
                        </p>

                        {(job.status === 'queued' || job.status === 'running') && (
                          <>
                            <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                              <motion.div className="h-full rounded-full bg-primary" animate={{ width: `${Math.max(2, job.progress)}%` }} transition={{ duration: 0.4 }} />
                            </div>
                            <p className="text-[10px] text-muted-foreground/60 leading-snug line-clamp-2">{job.phase}</p>
                            <div className="text-[9px] font-mono text-muted-foreground/40 space-y-0.5 leading-relaxed">
                              {lastLogLines(job.log).map((line, i) => (
                                <p key={i} className="truncate">{line}</p>
                              ))}
                            </div>
                          </>
                        )}

                        {job.status === 'failed' && (
                          <p className="text-[10px] text-red-400/80 leading-relaxed line-clamp-2">{job.error ?? 'Book failed'}</p>
                        )}

                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {(job.status === 'queued' || job.status === 'running') && onCancel && (
                            <button
                              onClick={() => { haptics.light(); onCancel(job.id); }}
                              className="px-2.5 py-1.5 rounded-lg border border-border/40 text-[10px] font-medium text-muted-foreground/70 hover:text-red-400 hover:border-red-400/40 transition-colors flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> {t('book.cancelJob')}
                            </button>
                          )}
                          {job.status === 'completed' && job.pdfFile && (
                            <a
                              href={`/api/jarvis/book/jobs/${job.id}/pdf`}
                              download
                              className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 text-[10px] font-semibold hover:bg-primary/20 transition-colors flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" /> {t('book.downloadPdf')}
                            </a>
                          )}
                          {job.status === 'completed' && job.manuscript && (
                            <button
                              onClick={() => { haptics.light(); downloadManuscript(job); }}
                              className="px-2.5 py-1.5 rounded-lg border border-border/40 text-[10px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors flex items-center gap-1"
                            >
                              <FileText className="w-3 h-3" /> {t('book.downloadTxt')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <p className="text-[10px] text-muted-foreground/60 leading-relaxed text-center pt-1">
                <Sparkles className="w-3 h-3 inline mr-1 text-primary" />
                {t('book.runsInBackground')}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
