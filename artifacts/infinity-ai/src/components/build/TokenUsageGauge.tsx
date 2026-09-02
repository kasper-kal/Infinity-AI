'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

interface TokenUsageGaugeProps {
  /** Workspace/project ID to fetch token data for */
  workspaceId: string;
  /** Optional: show detailed breakdown */
  showDetails?: boolean;
  /** Optional: show warning thresholds */
  showThresholds?: boolean;
  /** Optional: custom className */
  className?: string;
  /** Optional: compact mode for small spaces */
  compact?: boolean;
}

interface TokenUsageData {
  used: number;
  limit: number;
  model?: string;
  contextWindow?: number;
}

export function TokenUsageGauge({
  workspaceId,
  showDetails = true,
  showThresholds = true,
  className = '',
  compact = false,
}: TokenUsageGaugeProps) {
  const { t } = useI18n();
  const [data, setData] = useState<TokenUsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchTokenUsage = async () => {
      try {
        const response = await fetch(`/api/infinity/build/${encodeURIComponent(workspaceId)}/token-usage`);
        if (response.ok) {
          const result = await response.json();
          if (mounted) setData(result);
        }
      } catch (err) {
        console.error('[TokenUsageGauge] fetch failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchTokenUsage();
    const interval = setInterval(fetchTokenUsage, 5000); // Poll every 5 seconds

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [workspaceId]);

  const used = data?.used ?? 0;
  const limit = data?.limit ?? (data?.contextWindow ?? 200000);
  const { t } = useI18n();

  const percentUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  // Threshold levels (matching backend COMPACTION_LEVELS)
  const WARNING_THRESHOLD = 70;   // Level 1 - Summarize History
  const COMPACT_THRESHOLD = 80;   // Level 2 - Compress Working Context
  const GOAL_STATE_THRESHOLD = 90; // Level 3 - Goal + State Only
  const EMERGENCY_THRESHOLD = 95;  // Level 4 - Emergency Minimal

  const getStatus = () => {
    if (percentUsed >= EMERGENCY_THRESHOLD) return 'emergency';
    if (percentUsed >= GOAL_STATE_THRESHOLD) return 'goal-state';
    if (percentUsed >= COMPACT_THRESHOLD) return 'compact';
    if (percentUsed >= WARNING_THRESHOLD) return 'warning';
    return 'ok';
  };

  const status = getStatus();

  const statusConfig = {
    ok: { color: 'text-emerald-400', bg: 'bg-emerald-400', label: t('studio.build.tokenStatusOk') || 'OK' },
    warning: { color: 'text-amber-400', bg: 'bg-amber-400', label: t('studio.build.tokenStatusWarning') || 'Warning' },
    compact: { color: 'text-orange-400', bg: 'bg-orange-400', label: t('studio.build.tokenStatusCompact') || 'Compacting' },
    'goal-state': { color: 'text-rose-400', bg: 'bg-rose-400', label: t('studio.build.tokenStatusGoalState') || 'Goal+State' },
    emergency: { color: 'text-red-400', bg: 'bg-red-400', label: t('studio.build.tokenStatusEmergency') || 'Emergency' },
  }[status];

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="relative w-32 h-2 rounded-full bg-border/50 overflow-hidden flex-1 max-w-[120px]">
          <div
            className={`h-full ${statusConfig.bg} transition-all duration-500 ease-out`}
            style={{ width: `${percentUsed}%` }}
          />
          {showThresholds && (
            <>
              <div className="absolute top-full left-[70%] mt-0.5 transform -translate-x-1/2">
                <span className="text-[8px] text-amber-400 font-mono">70%</span>
              </div>
              <div className="absolute top-full left-[80%] mt-0.5 transform -translate-x-1/2">
                <span className="text-[8px] text-orange-400 font-mono">80%</span>
              </div>
              <div className="absolute top-full left-[90%] mt-0.5 transform -translate-x-1/2">
                <span className="text-[8px] text-rose-400 font-mono">90%</span>
              </div>
              <div className="absolute top-full left-[95%] mt-0.5 transform -translate-x-1/2">
                <span className="text-[8px] text-red-400 font-mono">95%</span>
              </div>
            </>
          )}
        </div>
        <span className={`text-[10px] font-mono font-semibold ${statusConfig.color} whitespace-nowrap`}>
          {percentUsed.toFixed(0)}%
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border/50 bg-card p-3 ${className}`}>
      {/* Main gauge */}
      <div className="mb-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('studio.build.tokenUsage') || 'Token Usage'}
          </span>
          <span className={`text-[10px] font-mono font-semibold ${statusConfig.color}`}>
            {percentUsed.toFixed(1)}% ({formatTokens(used)} / {formatTokens(limit)})
          </span>
        </div>

        <div className="relative h-3 rounded-full bg-border/50 overflow-hidden">
          {/* Threshold markers */}
          {showThresholds && (
            <>
              <div
                className="absolute top-0 bottom-0 left-[70%] w-px bg-amber-400/50"
                style={{ left: '70%' }}
                title={`${t('studio.build.tokenThresholdWarning') || 'Warning'} (70%)`}
              />
              <div
                className="absolute top-0 bottom-0 left-[80%] w-px bg-orange-400/50"
                style={{ left: '80%' }}
                title={`${t('studio.build.tokenThresholdCompact') || 'Compact'} (80%)`}
              />
              <div
                className="absolute top-0 bottom-0 left-[90%] w-px bg-rose-400/50"
                style={{ left: '90%' }}
                title={`${t('studio.build.tokenThresholdGoalState') || 'Goal+State'} (90%)`}
              />
              <div
                className="absolute top-0 bottom-0 left-[95%] w-px bg-red-400/50"
                style={{ left: '95%' }}
                title={`${t('studio.build.tokenThresholdEmergency') || 'Emergency'} (95%)`}
              />
            </>
          )}

          {/* Progress bar */}
          <div
            className={`h-full ${statusConfig.bg} transition-all duration-500 ease-out relative`}
            style={{ width: `${percentUsed}%` }}
          >
            {/* Status indicator at end of bar */}
            {percentUsed > 5 && (
              <span
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] font-semibold text-white/90 whitespace-nowrap"
                style={{ transform: 'translateY(-50%)' }}
              >
                {statusConfig.label}
              </span>
            )}
          </div>
        </div>

        {/* Threshold labels */}
        {showThresholds && (
          <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground font-mono">
            <span>{t('studio.build.tokenThresholdWarning') || 'Warning'}: 70%</span>
            <span>{t('studio.build.tokenThresholdCompact') || 'Compact'}: 80%</span>
            <span>{t('studio.build.tokenThresholdGoalState') || 'Goal+State'}: 90%</span>
            <span>{t('studio.build.tokenThresholdEmergency') || 'Emergency'}: 95%</span>
          </div>
        )}
      </div>

      {/* Detailed breakdown */}
      {showDetails && (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg bg-background/50 p-2 border border-border/50">
            <div className="text-muted-foreground/70">{t('studio.build.tokenUsed') || 'Used'}</div>
            <div className="font-mono font-medium text-foreground">{formatTokens(used)}</div>
          </div>
          <div className="rounded-lg bg-background/50 p-2 border border-border/50">
            <div className="text-muted-foreground/70">{t('studio.build.tokenRemaining') || 'Remaining'}</div>
            <div className="font-mono font-medium text-foreground">{formatTokens(Math.max(0, limit - used))}</div>
          </div>
          <div className="rounded-lg bg-background/50 p-2 border border-border/50">
            <div className="text-muted-foreground/70">{t('studio.build.tokenLimit') || 'Limit'}</div>
            <div className="font-mono font-medium text-foreground">{formatTokens(limit)}</div>
          </div>
          <div className="rounded-lg bg-background/50 p-2 border border-border/50">
            <div className="text-muted-foreground/70">{t('studio.build.tokenStatus') || 'Status'}</div>
            <div className={`font-mono font-medium ${statusConfig.color}`}>{statusConfig.label}</div>
          </div>
        </div>
      )}

      {/* Level indicators */}
      <div className={`mt-3 pt-3 border-t border-border/50 ${showDetails ? '' : 'hidden'}`}>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          {t('studio.build.compactionLevels') || 'Compaction Levels'}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { level: 1, threshold: 70, label: t('studio.build.level1') || 'L1: Summarize', color: 'amber' },
            { level: 2, threshold: 80, label: t('studio.build.level2') || 'L2: Compress', color: 'orange' },
            { level: 3, threshold: 90, label: t('studio.build.level3') || 'L3: Goal+State', color: 'rose' },
            { level: 4, threshold: 95, label: t('studio.build.level4') || 'L4: Emergency', color: 'red' },
          ].map(({ level, threshold, label, color }) => (
            <span
              key={level}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[9px] font-medium transition-all ${
                percentUsed >= threshold
                  ? `bg-${color}-400/20 text-${color}-400 border border-${color}-400/30`
                  : 'bg-background/50 text-muted-foreground/60 border border-border/50'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${percentUsed >= threshold ? `bg-${color}-400` : 'bg-transparent border border-current'}`} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}