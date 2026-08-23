import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Send, Sparkles, Square, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type BuildProgressStatus = 'working' | 'waiting' | 'done' | 'error' | 'cancelled';
interface BuildProgressItem {
  id: string;
  role: 'user' | 'Infinity';
  message: string;
  status: BuildProgressStatus;
  createdAt: number;
}

interface BuildProgressPanelProps {
  open: boolean;
  items: BuildProgressItem[];
  status: BuildProgressStatus;
  startedAt: number | null;
  clock: number;
  onOpen: () => void;
  onClose: () => void;
  onCancel: () => void;
}

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

function ProgressRing({ completed, total, active }: { completed: number; total: number; active: boolean }) {
  const size = 28;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.min(1, completed / total) : 0;
  const offset = circumference * (1 - pct);
  const displayTotal = total > 0 ? total : Math.max(completed, 1);
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${active ? 'build-animate-pulse' : ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Progress: ${completed} of ${displayTotal} steps complete`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--build-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--build-accent-read)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset var(--build-transition-normal)' }}
        />
      </svg>
      <span className="absolute font-mono text-[8px] font-semibold text-foreground">{completed}/{displayTotal}</span>
    </span>
  );
}

export function BuildProgressPanel({ open, items, status, startedAt, clock, onOpen, onClose, onCancel }: BuildProgressPanelProps) {
  const { t } = useI18n();
  const [liveClock, setLiveClock] = useState(clock);

  useEffect(() => {
    setLiveClock(clock);
    if (status !== 'working' && status !== 'waiting') return;
    const timer = window.setInterval(() => setLiveClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [clock, status]);

  if (!open) {
    if (items.length === 0) return null;
    const completed = items.filter(i => i.status === 'done').length;
    return createPortal(
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onOpen(); }}
        className="fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-full border border-primary/30 bg-card px-3 py-2 text-xs text-foreground shadow-2xl"
        style={{ paddingBottom: 'calc(12px + var(--build-safe-bottom))' }}
      >
        <ProgressRing completed={completed} total={items.length} active={status === 'working'} />
        <span>{t('studio.build.progressOpen')}</span>
      </button>,
      document.body,
    );
  }

  const statusLabel = status === 'working'
    ? t('studio.build.progressWorking')
    : status === 'waiting'
      ? t('studio.build.progressWaiting')
      : status === 'done'
        ? t('studio.build.progressDone')
        : status === 'cancelled'
          ? t('studio.build.progressCancelled')
          : t('studio.build.progressError');

  const completed = items.filter(i => i.status === 'done').length;

  return createPortal(
    <aside
      onClick={(event) => event.stopPropagation()}
      className="fixed bottom-4 right-4 z-[90] flex max-h-[min(72vh,560px)] w-[calc(100vw-2rem)] max-w-[390px] flex-col overflow-hidden rounded-2xl border border-primary/30 bg-card/95 shadow-2xl backdrop-blur-xl"
      aria-label={t('studio.build.progressTitle')}
      aria-live="polite"
      style={{ paddingBottom: 'var(--build-safe-bottom)' }}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-3">
        <span className="rounded-lg bg-primary/15 p-1.5 text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-foreground">{t('studio.build.progressTitle')}</p><p className="text-[10px] text-muted-foreground">{statusLabel}</p></div>
        <ProgressRing completed={completed} total={items.length} active={status === 'working'} />
        <span className="font-mono text-[10px] text-muted-foreground">{startedAt ? formatElapsed(liveClock - startedAt) : '00:00'}</span>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground" aria-label={t('studio.build.progressClose')}><X className="h-3.5 w-3.5" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {items.map((item) => <div key={item.id} className={`flex gap-2 ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[88%] rounded-xl border px-3 py-2 ${item.role === 'user' ? 'border-primary/30 bg-primary/15 text-foreground' : item.status === 'error' ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : item.status === 'cancelled' ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-border bg-secondary text-muted-foreground'}`}>
            <div className="flex items-start gap-2"><span className="mt-0.5 shrink-0">{item.role === 'user' ? <Send className="h-3 w-3 text-primary" /> : item.status === 'working' ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : item.status === 'error' ? <X className="h-3 w-3 text-rose-400" /> : item.status === 'cancelled' ? <Square className="h-3 w-3 text-amber-300" /> : item.status === 'waiting' ? <Sparkles className="h-3 w-3 text-primary" /> : <Check className="h-3 w-3 text-emerald-400" />}</span><p className="whitespace-pre-wrap text-[11px] leading-5">{item.message}</p></div>
            <p className="mt-1 text-right font-mono text-[9px] text-muted-foreground/60">+{startedAt ? formatElapsed(item.createdAt - startedAt) : '00:00'}</p>
          </div>
        </div>)}
      </div>
      <footer className="flex items-center gap-2 border-t border-border px-3 py-2">
        {(status === 'working' || status === 'waiting') ? <button type="button" onClick={onCancel} className="flex items-center gap-1.5 rounded-lg border border-rose-400/30 px-2.5 py-1.5 text-[10px] text-rose-300 hover:bg-rose-400/10"><Square className="h-3 w-3" />{t('studio.build.progressCancel')}</button> : <span className="text-[10px] text-muted-foreground">{statusLabel}</span>}
        <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground">{t('studio.build.progressClose')}</button>
      </footer>
    </aside>,
    document.body,
  );
}
