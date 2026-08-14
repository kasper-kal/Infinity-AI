import { motion } from 'framer-motion';
import '@/lib/build-ui-theme.css';

/**
 * Phase 0 UI Unfuck — skeleton screens replacing spinners.
 * Uses the build theme tokens and respects reduced motion.
 */

export function BuildSkeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`build-skeleton rounded-lg ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

export function BuildSkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${className}`} aria-hidden="true">
      <div className="flex items-center gap-3 mb-3">
        <BuildSkeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <BuildSkeleton className="h-4 w-3/4 rounded" />
          <BuildSkeleton className="h-3 w-1/2 rounded" />
        </div>
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: lines }).map((_, i) => (
          <BuildSkeleton key={i} className="h-3 w-full rounded" style={{ width: `${80 + Math.random() * 20}%` }} />
        ))}
      </div>
    </div>
  );
}

export function BuildSkeletonPlanCard({ className = '' }: { className?: string }) {
  return (
    <article className={`flex-shrink-0 flex flex-col gap-2 rounded-xl border border-border bg-secondary p-3 ${className}`} style={{ minWidth: 280, width: 280 }} aria-hidden="true">
      <div className="flex items-start gap-3">
        <BuildSkeleton className="h-8 w-8 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <BuildSkeleton className="h-4 w-3/4 rounded" />
          <BuildSkeleton className="h-3 w-1/2 rounded" />
          <BuildSkeleton className="h-2 w-2/3 rounded" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <BuildSkeleton className="h-5 w-20 rounded-full" />
        <BuildSkeleton className="h-5 w-24 rounded-full" />
      </div>
    </article>
  );
}

export function BuildSkeletonToolCall({ className = '' }: { className?: string }) {
  return (
    <div className={`build-transcript-card ${className}`} aria-hidden="true">
      <div className="flex w-full items-start gap-3 rounded-xl border p-3">
        <BuildSkeleton className="h-8 w-8 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <BuildSkeleton className="h-4 w-1/3 rounded-full" />
            <BuildSkeleton className="h-4 w-16 rounded-full" />
            <BuildSkeleton className="h-4 w-14 rounded-full" />
          </div>
          <BuildSkeleton className="h-3 w-3/4 rounded" />
          <div className="flex items-center gap-3 text-[10px]">
            <BuildSkeleton className="h-3 w-32 rounded" />
            <BuildSkeleton className="h-3 w-24 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function BuildSkeletonPlanView({ count = 4 }: { count?: number }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden" aria-hidden="true">
      <div className="flex min-h-0 flex-col md:flex-row md:flex-wrap gap-3 p-3 pb-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden scrollbar-hide">
        {Array.from({ length: count }).map((_, i) => (
          <BuildSkeletonPlanCard key={i} />
        ))}
      </div>
    </div>
  );
}

export function BuildSkeletonTranscript({ count = 5 }: { count?: number }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <BuildSkeletonToolCall key={i} />
      ))}
    </div>
  );
}

export function BuildSkeletonDiffFile({ className = '' }: { className?: string }) {
  return (
    <article className={`diff-file rounded-xl border border-border bg-card overflow-hidden ${className}`} aria-hidden="true">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <BuildSkeleton className="h-5 w-5 rounded" />
        <BuildSkeleton className="h-4 w-48 rounded" />
        <div className="ml-auto flex items-center gap-2" />
      </header>
      <div className="max-h-[60vh] overflow-auto p-3 font-mono text-[12px]">
        <div className="space-y-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="diff-line flex">
              <BuildSkeleton className="w-10 h-4 rounded" />
              <BuildSkeleton className="w-10 h-4 rounded" />
              <BuildSkeleton className="flex-1 h-4 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function BuildSkeletonPreview({ className = '' }: { className?: string }) {
  return (
    <div className={`relative flex-1 overflow-auto bg-background ${className}`} style={{ backgroundColor: 'var(--color-background)' }} aria-hidden="true">
      <div className="absolute inset-0 flex items-center justify-center">
        <BuildSkeleton className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" style={{ animation: 'none' }} />
      </div>
    </div>
  );
}