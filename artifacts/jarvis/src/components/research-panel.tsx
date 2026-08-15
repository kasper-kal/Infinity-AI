import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BrainCircuit,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Play,
  Sparkles,
  Rocket,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { ensurePushSubscription } from '@/lib/push';
import { haptics } from '@/lib/haptics';

/** Mirrors the server-side research_jobs row (fields the UI needs). */
export interface ResearchJob {
  id: string;
  title: string;
  prompt: string;
  mode: 'agent' | 'normal' | 'both';
  depth: 'standard' | 'deep' | 'quantum' | 'omni';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  phase: string;
  log: string;
  notes: string;
  report: string;
  gemSystemPrompt: string;
  gemConversationId: string | null;
  phasesCompleted: number;
  error: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface ResearchPanelProps {
  jobs: ResearchJob[];
  onClose: () => void;
  /** Open a conversation (the finished expert chat) in the main feed. */
  onOpenExpert: (conversationId: string) => void;
  /** Fired right after a job is started, lets Home refresh + notify. */
  onStarted?: (job: ResearchJob) => void;
  /** Fired when the user cancels a running job. */
  onCancel?: (jobId: string) => void;
}

const DEPTH_INFO: Record<ResearchJob['depth'], { label: string; hint: string }> = {
  standard: { label: 'Standard', hint: '~5-12 hours' },
  deep: { label: 'Deep', hint: '~1-3 days' },
  quantum: { label: 'Quantum', hint: '~1 week+, no limit' },
  omni: { label: 'Omni', hint: '~weeks, never truly ends' },
};

/** Shape returned by GET /api/jarvis/research/estimate. */
interface ResearchEstimate {
  depth: ResearchJob['depth'];
  phases: { min: number; max: number };
  sleepSec: { min: number; max: number };
  searches: { min: number; max: number };
  totalHours: { min: number; max: number };
}

const STATUS_STYLE: Record<ResearchJob['status'], { color: string; icon: 'spin' | 'ok' | 'err' | 'idle' }> = {
  queued: { color: 'text-amber-500/80', icon: 'idle' },
  running: { color: 'text-primary', icon: 'spin' },
  completed: { color: 'text-green-500', icon: 'ok' },
  failed: { color: 'text-red-500', icon: 'err' },
  cancelled: { color: 'text-muted-foreground/50', icon: 'err' },
};

export function ResearchPanel({ jobs, onClose, onOpenExpert, onStarted, onCancel }: ResearchPanelProps) {
  const { t } = useI18n();
  const [goal, setGoal] = useState('');
  const [depth, setDepth] = useState<ResearchJob['depth']>('standard');
  const [mode, setMode] = useState<'agent' | 'normal' | 'both'>('agent');
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [estimate, setEstimate] = useState<ResearchEstimate | null>(null);

  // Fetch the cost/duration estimate whenever the depth tier changes, so the
  // confirmation card can tell the user how long the job will really run.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jarvis/research/estimate?depth=${depth}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((e: ResearchEstimate | null) => { if (!cancelled) setEstimate(e); })
      .catch(() => { if (!cancelled) setEstimate(null); });
    return () => { cancelled = true; };
  }, [depth]);

  const requestNotifications = useCallback(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const handleStartClick = () => {
    haptics.light();
    if (!goal.trim()) return;
    requestNotifications();
    setConfirming(true);
  };

  const handleConfirm = async () => {
    haptics.medium?.();
    setStarting(true);
    // Enable real push notifications (system notification even with the tab closed).
    await ensurePushSubscription();
    try {
      const res = await fetch('/api/jarvis/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: goal.trim(), title: goal.trim().slice(0, 60), mode, depth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error ?? `Failed to start research (${res.status})`);
        return;
      }
      const job = (await res.json()) as ResearchJob;
      setGoal('');
      setConfirming(false);
      onStarted?.(job);
    } catch {
      alert('Network error, is the server running?');
    } finally {
      setStarting(false);
    }
  };

  const lastLogLines = (log: string) => log.split('\n').filter(Boolean).slice(-3);

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
      className="fixed z-50 right-4 top-16 sm:top-20 bottom-24 sm:bottom-24 w-[calc(100vw-2rem)] max-w-sm flex flex-col rounded-2xl border border-border/60 bg-background/90 backdrop-blur-xl shadow-apple-lg overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-primary" />
          <span className="text-[12px] font-semibold tracking-wide">{t('research.title')}</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-secondary/70 text-muted-foreground transition-colors" aria-label="Close research">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {/* ── Start form / confirmation ── */}
        <AnimatePresence mode="wait">
          {confirming ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] font-semibold">{t('research.confirmTitle')}</p>
                  <p className="text-[11px] text-muted-foreground/80 leading-relaxed mt-1">{t('research.confirmBody')}</p>
                </div>
              </div>
              <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2 text-[12px] leading-relaxed max-h-20 overflow-y-auto">
                {goal}
              </div>
              {estimate && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed space-y-0.5">
                  <p className="font-mono text-[10px] tracking-widest text-primary/80 font-semibold mb-1">ESTIMATE</p>
                  <p className="text-muted-foreground/90">~{estimate.phases.min}-{estimate.phases.max} phases · {estimate.searches.min}-{estimate.searches.max} web searches</p>
                  <p className="text-muted-foreground/90">Roughly {estimate.totalHours.min}-{estimate.totalHours.max} hours of wall time (runs in the background)</p>
                  {(depth === 'quantum' || depth === 'omni') && (
                    <p className="text-amber-500/90 mt-1">⚠️ This tier is designed to run for days and will consume significant API quota. Consider a lower depth.</p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { haptics.light(); setConfirming(false); }}
                  disabled={starting}
                  className="flex-1 px-3 py-2 rounded-lg border border-border/50 text-[11px] font-medium text-muted-foreground hover:bg-secondary/70 transition-colors disabled:opacity-40"
                >
                  {t('research.cancel')}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={starting}
                  className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
                  {t('research.confirm')}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-3"
            >
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                placeholder={t('research.placeholder')}
                className="w-full rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none resize-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                maxLength={8000}
              />
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50">{t('research.depth')}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(DEPTH_INFO) as ResearchJob['depth'][]).map((d) => (
                    <button
                      key={d}
                      onClick={() => { haptics.light(); setDepth(d); }}
                      className={`px-2 py-1.5 rounded-lg border text-center transition-all ${
                        depth === d
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border/40 text-muted-foreground/60 hover:text-foreground'
                      }`}
                    >
                      <p className="text-[11px] font-semibold">{DEPTH_INFO[d].label}</p>
                      <p className="text-[9px] text-muted-foreground/50">{DEPTH_INFO[d].hint}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mr-1">{t('research.mode')}</p>
                {(['agent', 'normal', 'both'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { haptics.light(); setMode(m); }}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all ${
                      mode === m
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border/40 text-muted-foreground/60 hover:text-foreground'
                    }`}
                  >
                    {m === 'agent' ? t('research.mode.agent') : m === 'normal' ? t('research.mode.normal') : t('research.mode.both')}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground/50 leading-relaxed -mt-1">
                {mode === 'both' ? t('research.mode.both.hint') : mode === 'agent' ? t('research.mode.agent.hint') : t('research.mode.normal.hint')}
              </p>
              <button
                onClick={handleStartClick}
                disabled={!goal.trim()}
                className="w-full px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                {t('research.start')}
              </button>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed text-center">
                Runs in the background for hours, you can close this tab. Jarvis notifies you when the expert is ready.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Jobs list ── */}
        <div className="space-y-2 pt-1">
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50">{t('research.jobs')}</p>
          {jobs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/50 italic px-1">{t('research.noJobs')}</p>
          ) : (
            jobs.map((job) => {
              const style = STATUS_STYLE[job.status];
              return (
                <div key={job.id} className="rounded-xl border border-border/40 bg-card/50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium truncate flex-1">{job.title}</p>
                    <span className={`flex items-center gap-1 text-[10px] font-mono ${style.color}`}>
                      {style.icon === 'spin' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {style.icon === 'ok' && <CheckCircle2 className="w-3 h-3" />}
                      {style.icon === 'err' && <XCircle className="w-3 h-3" />}
                      {t(`research.status.${job.status}`)}
                    </span>
                  </div>

                  {(job.status === 'queued' || job.status === 'running') && (
                    <>
                      <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          animate={{ width: `${Math.max(2, job.progress)}%` }}
                          transition={{ duration: 0.4 }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 leading-snug line-clamp-2">{job.phase}</p>
                      <div className="text-[9px] font-mono text-muted-foreground/40 space-y-0.5 leading-relaxed">
                        {lastLogLines(job.log).map((line, i) => (
                          <p key={i} className="truncate">{line}</p>
                        ))}
                      </div>
                    </>
                  )}

                  {job.status === 'completed' && (
                    <p className="text-[10px] text-muted-foreground/60 leading-relaxed line-clamp-3">{job.report.slice(0, 220)}…</p>
                  )}
                  {job.status === 'failed' && (
                    <p className="text-[10px] text-red-400/80 leading-relaxed line-clamp-2">{job.error ?? 'Research failed'}</p>
                  )}

                  <div className="flex gap-1.5 pt-0.5">
                    {(job.status === 'queued' || job.status === 'running') && onCancel && (
                      <button
                        onClick={() => { haptics.light(); onCancel(job.id); }}
                        className="px-2.5 py-1.5 rounded-lg border border-border/40 text-[10px] font-medium text-muted-foreground/70 hover:text-red-400 hover:border-red-400/40 transition-colors flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> {t('research.cancelJob')}
                      </button>
                    )}
                    {job.status === 'completed' && job.gemConversationId && (
                      <button
                        onClick={() => { haptics.light(); onOpenExpert(job.gemConversationId!); }}
                        className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 text-[10px] font-semibold hover:bg-primary/20 transition-colors flex items-center gap-1"
                      >
                        <Sparkles className="w-3 h-3" /> {t('research.openExpert')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </motion.div>
  );
}
