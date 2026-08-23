import { useEffect, useState } from 'react';
import { Timer, Pause, Play, X } from 'lucide-react';
import type { ServerTimer } from '@/hooks/use-timer-orchestration';

interface TimerStripProps {
  timers: ServerTimer[];
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Durable timer strip, shows every server-side timer as a compact pill above
 * the orb. Countdowns derive from the server's wall-clock `fireAt`, so the
 * remaining time stays correct across reloads; cancel/pause/resume go back to
 * the server. The strip only renders when at least one timer is live.
 */
export function TimerStrip({ timers, onCancel, onPause, onResume }: TimerStripProps) {
  // Re-render every second so countdowns tick from server fireAt.
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  if (timers.length === 0) return null;

  const now = Date.now();

  return (
    <div className="mb-4 flex flex-col items-center gap-2 w-full max-w-xs">
      {timers.map((t) => {
        const remainingSec =
          t.status === 'active' && t.fireAt
            ? Math.max(0, Math.ceil((new Date(t.fireAt).getTime() - now) / 1000))
            : Math.max(0, t.remainingSeconds ?? 0);
        const done = remainingSec <= 0;
        return (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-full border border-border/60 bg-card/80 backdrop-blur px-3 py-1.5 text-[12px]"
          >
            <Timer className={`w-3.5 h-3.5 ${t.status === 'paused' ? 'text-amber-400' : 'text-primary'} ${t.status === 'active' && !done ? 'animate-pulse' : ''}`} />
            <span className="font-mono tabular-nums">
              {done ? 'Done!' : formatTime(remainingSec)}
            </span>
            {t.label && <span className="text-muted-foreground truncate max-w-[8rem]">{t.label}</span>}
            {t.status === 'active' && !done && (
              <button onClick={() => onPause(t.id)} aria-label="Pause timer" className="text-muted-foreground hover:text-foreground transition-colors">
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
            {t.status === 'paused' && (
              <button onClick={() => onResume(t.id)} aria-label="Resume timer" className="text-muted-foreground hover:text-foreground transition-colors">
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={() => onCancel(t.id)} aria-label="Cancel timer" className="text-muted-foreground hover:text-red-400 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
