'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Brain, Zap, Archive, FileText, Clock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface CompactionEvent {
  id: string;
  timestamp: string;
  level: 1 | 2 | 3 | 4;
  levelName: string;
  trigger: 'token-budget' | 'step-count' | 'context-size' | 'manual';
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  messagesCompacted: number;
  preservedItems: {
    userInstructions: number;
    projectInstructions: number;
    fileMapFiles: number;
    errorPatterns: number;
    decisions: number;
    currentPlan: boolean;
    originalGoal: boolean;
  };
  description: string;
  durationMs: number;
}

interface CompactionHistoryProps {
  /** Project/workspace ID or conversation ID */
  projectId: string;
  /** Type of resource: 'build' for project/workspace, 'chat' for conversation */
  type?: 'build' | 'chat';
  /** Optional: initial events (if pre-fetched) */
  initialEvents?: CompactionEvent[];
  /** Optional: custom className */
  className?: string;
  /** Optional: max events to show initially */
  maxInitialEvents?: number;
}

const LEVEL_CONFIG = {
  1: { name: 'Summarize History', icon: FileText, color: 'amber', bg: 'bg-amber-400/20', border: 'border-amber-400/30', text: 'text-amber-400' },
  2: { name: 'Compress Working', icon: Archive, color: 'orange', bg: 'bg-orange-400/20', border: 'border-orange-400/30', text: 'text-orange-400' },
  3: { name: 'Goal + State', icon: Brain, color: 'rose', bg: 'bg-rose-400/20', border: 'border-rose-400/30', text: 'text-rose-400' },
  4: { name: 'Emergency Minimal', icon: Zap, color: 'red', bg: 'bg-red-400/20', border: 'border-red-400/30', text: 'text-red-400' },
};

const TRIGGER_LABELS = {
  'token-budget': 'Token Budget',
  'step-count': 'Step Count',
  'context-size': 'Context Size',
  'manual': 'Manual',
};

const TRIGGER_ICONS = {
  'token-budget': Brain,
  'step-count': FileText,
  'context-size': Archive,
  'manual': Clock,
};

export function CompactionHistory({
  projectId,
  type = 'build',
  initialEvents = [],
  className = '',
  maxInitialEvents = 10,
}: CompactionHistoryProps) {
  const { t } = useI18n();
  const [events, setEvents] = useState<CompactionEvent[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [totalCount, setTotalCount] = useState(initialEvents.length);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const endpoint = type === 'chat'
        ? `/api/infinity/chat/${encodeURIComponent(projectId)}/compaction-history`
        : `/api/infinity/build/${encodeURIComponent(projectId)}/compaction-history`;
      const response = await fetch(endpoint);
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events ?? []);
        setTotalCount(data.total ?? data.events?.length ?? 0);
      }
    } catch (err) {
      console.error('[CompactionHistory] fetch failed', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const displayedEvents = events.slice(0, maxInitialEvents);

  if (events.length === 0 && !loading) {
    return (
      <div className={`rounded-xl border border-border/50 bg-card p-4 ${className}`}>
        <div className="flex items-center justify-center h-32 text-center text-xs text-muted-foreground">
          <Brain className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
          <p>{t('studio.build.compactionNoHistory') || 'No compaction events yet'}</p>
          <p className="text-muted-foreground/50 mt-1">
            {t('studio.build.compactionNoHistoryDesc') || 'Compaction events will appear here when token limits are approached'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border/50 bg-card ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 p-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            {t('studio.build.compactionHistory') || 'Compaction History'}
          </h3>
          {totalCount > events.length && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {t('studio.build.compactionShowing', { shown: events.length, total: totalCount }) || `${events.length} / ${totalCount}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {loading && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
            title={t('studio.build.debugRefresh') || 'Refresh'}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('studio.build.debugRefresh') || 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Events list */}
      <div className="divide-y divide-border/50 max-h-[500px] overflow-auto">
        {displayedEvents.map((event) => {
          const config = LEVEL_CONFIG[event.level];
          const Icon = config.icon;
          const TriggerIcon = TRIGGER_ICONS[event.trigger];
          const isExpanded = expandedIds.has(event.id);

          return (
            <div key={event.id} className="p-3 hover:bg-white/[0.02] transition-colors">
              {/* Summary row */}
              <button
                type="button"
                onClick={() => toggleExpand(event.id)}
                className="w-full flex items-center gap-3 text-left p-1 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                {/* Level badge */}
                <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-semibold ${config.bg} ${config.border} ${config.text} border shrink-0`}>
                  <Icon className="h-2.5 w-2.5" />
                  L{event.level}
                </span>

                {/* Trigger */}
                <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-medium bg-secondary text-muted-foreground shrink-0`}>
                  <TriggerIcon className="h-2.5 w-2.5" />
                  {TRIGGER_LABELS[event.trigger]}
                </span>

                {/* Time */}
                <span className="flex-1 min-w-0 text-[10px] text-muted-foreground font-mono truncate">
                  {formatDate(event.timestamp)}
                </span>

                {/* Tokens saved */}
                <span className={`text-[10px] font-mono font-medium shrink-0 ${event.tokensSaved > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                  {event.tokensSaved > 0 ? '−' : ''}{formatTokens(event.tokensSaved)}
                </span>

                {/* Expand indicator */}
                <span className="text-muted-foreground/50 shrink-0">
                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </span>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 ml-10 pl-3 border-l border-border/50 animate-in fade-in slide-down-2 duration-200"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[10px]">
                    <div className="rounded-lg bg-background/50 p-2 border border-border/50">
                      <div className="text-muted-foreground/70">{t('studio.build.compactionTokensBefore') || 'Tokens Before'}</div>
                      <div className="font-mono font-medium text-foreground">{formatTokens(event.tokensBefore)}</div>
                    </div>
                    <div className="rounded-lg bg-background/50 p-2 border border-border/50">
                      <div className="text-muted-foreground/70">{t('studio.build.compactionTokensAfter') || 'Tokens After'}</div>
                      <div className="font-mono font-medium text-foreground">{formatTokens(event.tokensAfter)}</div>
                    </div>
                    <div className="rounded-lg bg-background/50 p-2 border border-border/50">
                      <div className="text-muted-foreground/70">{t('studio.build.compactionMessagesCompacted') || 'Messages Compacted'}</div>
                      <div className="font-mono font-medium text-foreground">{event.messagesCompacted}</div>
                    </div>
                    <div className="rounded-lg bg-background/50 p-2 border border-border/50">
                      <div className="text-muted-foreground/70">{t('studio.build.compactionDuration') || 'Duration'}</div>
                      <div className="font-mono font-medium text-foreground">{formatDuration(event.durationMs)}</div>
                    </div>
                  </div>

                  {/* Preserved items */}
                  <div className="mt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                      {t('studio.build.compactionPreserved') || 'Preserved Items'}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { key: 'userInstructions', label: t('studio.build.compactionUserInstructions') || 'User Instructions', icon: FileText },
                        { key: 'projectInstructions', label: t('studio.build.compactionProjectInstructions') || 'Project Instructions', icon: Archive },
                        { key: 'fileMapFiles', label: t('studio.build.compactionFileMap') || 'File Map', icon: Brain },
                        { key: 'errorPatterns', label: t('studio.build.compactionErrorPatterns') || 'Error Patterns', icon: Zap },
                        { key: 'decisions', label: t('studio.build.compactionDecisions') || 'Decisions', icon: ChevronDown },
                        { key: 'currentPlan', label: t('studio.build.compactionCurrentPlan') || 'Current Plan', icon: Clock },
                        { key: 'originalGoal', label: t('studio.build.compactionOriginalGoal') || 'Original Goal', icon: Brain },
                      ].map(({ key, label, icon: IconComp }) => {
                        const value = event.preservedItems[key as keyof typeof event.preservedItems];
                        const count = typeof value === 'boolean' ? (value ? 1 : 0) : value;
                        return count > 0 && (
                          <span key={key} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[9px] bg-background/50 border border-border/50 text-muted-foreground">
                            <IconComp className="h-2.5 w-2.5" />
                            <span className="font-medium text-foreground">{count}</span>
                            <span className="text-muted-foreground/70">{label}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Description */}
                  {event.description && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                        {t('studio.build.compactionDescription') || 'Description'}
                      </div>
                      <p className="text-[11px] text-foreground font-mono whitespace-pre-wrap">{event.description}</p>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          );
        })}

        {events.length > maxInitialEvents && (
          <div className="p-3 text-center border-t border-border/50">
            <button
              type="button"
              onClick={fetchHistory}
              className="text-xs text-primary hover:underline"
            >
              {t('studio.build.compactionLoadMore', { remaining: totalCount - maxInitialEvents }) || `Load ${totalCount - maxInitialEvents} more...`}
            </button>
          </div>
        )}
      </div>

      {/* Stats summary */}
      {events.length > 0 && (
        <div className="border-t border-border/50 p-3 bg-secondary/30">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            {t('studio.build.compactionStats') || 'Session Stats'}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            <div className="rounded-lg bg-background/50 p-2 border border-border/50 text-center">
              <div className="font-mono font-bold text-primary">{events.length}</div>
              <div className="text-muted-foreground/70">{t('studio.build.compactionTotalEvents') || 'Total Events'}</div>
            </div>
            <div className="rounded-lg bg-background/50 p-2 border border-border/50 text-center">
              <div className="font-mono font-bold text-emerald-400">
                {formatTokens(events.reduce((sum, e) => sum + e.tokensSaved, 0))}
              </div>
              <div className="text-muted-foreground/70">{t('studio.build.compactionTotalSaved') || 'Total Saved'}</div>
            </div>
            <div className="rounded-lg bg-background/50 p-2 border border-border/50 text-center">
              <div className="font-mono font-bold text-foreground">
                {events.reduce((sum, e) => sum + e.messagesCompacted, 0)}
              </div>
              <div className="text-muted-foreground/70">{t('studio.build.compactionTotalMessages') || 'Messages Compacted'}</div>
            </div>
            <div className="rounded-lg bg-background/50 p-2 border border-border/50 text-center">
              <div className="font-mono font-bold text-foreground">
                {formatDuration(events.reduce((sum, e) => sum + e.durationMs, 0))}
              </div>
              <div className="text-muted-foreground/70">{t('studio.build.compactionTotalTime') || 'Total Time'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Need to import motion for animations
import { motion } from 'framer-motion';