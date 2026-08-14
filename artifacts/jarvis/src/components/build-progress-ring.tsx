import { motion } from 'framer-motion';
import { Check, Loader2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface BuildProgressRingProps {
  /** Total number of build steps (tool-call / progress items). */
  total: number;
  /** Number of completed steps. */
  completed: number;
  /** Current active step label, if any. */
  currentLabel?: string;
  status: 'working' | 'waiting' | 'done' | 'error' | 'cancelled';
  /** Elapsed time in ms (used for the small clock under the ring). */
  elapsedMs?: number;
  /** Pulse the ring while the build is actively running. */
  pulse?: boolean;
}

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Phase 0 UI Unfuck — progress ring shown top-center on mobile.
 * Displays current step / total, pulses on active, and shows a
 * terminal state (done / error / cancelled) icon when finished.
 */
export function BuildProgressRing({
  total,
  completed,
  currentLabel,
  status,
  elapsedMs = 0,
  pulse = false,
}: BuildProgressRingProps) {
  const { t } = useI18n();
  const size = 56;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = Math.max(total, 1);
  const progress = Math.min(1, completed / safeTotal);
  const offset = circumference * (1 - progress);

  const isTerminal = status === 'done' || status === 'error' || status === 'cancelled';
  const ringColor =
    status === 'error'
      ? 'var(--build-accent-error)'
      : status === 'cancelled'
        ? 'var(--build-accent-warning)'
        : status === 'done'
          ? 'var(--build-accent-success)'
          : 'var(--build-accent-read)';

  return (
    <div className="flex flex-col items-center gap-1" aria-live="polite" aria-label={t('studio.build.progressRingLabel') || 'Build progress'}>
      <div className="relative" style={{ width: size, height: size }}>
        {pulse && !isTerminal && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 0 ${ringColor}` }}
            animate={{ boxShadow: [`0 0 0 0px ${ringColor}00`, `0 0 0 8px ${ringColor}00`] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <svg width={size} height={size} className="-rotate-90" role="img">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--build-border)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset var(--build-transition-normal), stroke var(--build-transition-normal)' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {status === 'done' ? (
            <Check className="h-5 w-5 text-[var(--build-accent-success)]" />
          ) : status === 'error' ? (
            <X className="h-5 w-5 text-[var(--build-accent-error)]" />
          ) : status === 'cancelled' ? (
            <X className="h-4 w-4 text-[var(--build-accent-warning)]" />
          ) : status === 'waiting' ? (
            <span className="text-[11px] font-semibold tabular-nums text-[var(--build-accent-shell)]">
              {completed}/{total}
            </span>
          ) : (
            <span className="text-[11px] font-semibold tabular-nums text-[var(--build-accent-read)]">
              {completed}
            </span>
          )}
        </div>
      </div>
      {currentLabel && !isTerminal && (
        <p className="max-w-[60vw] truncate text-center text-[10px] text-muted-foreground">
          {currentLabel}
        </p>
      )}
      {!isTerminal && (
        <p className="text-[9px] font-mono tabular-nums text-muted-foreground/70">
          {formatElapsed(elapsedMs)} · {completed}/{total}
        </p>
      )}
    </div>
  );
}