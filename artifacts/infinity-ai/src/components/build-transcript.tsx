import { useState, useRef, useEffect, type RefObject } from 'react';
import { ChevronDown, Code2, Copy, FileText, Loader2, Terminal, Globe, Check, X, Sparkles, Clock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import '@/lib/build-ui-theme.css';

export type ToolCallType = 'read' | 'write' | 'shell' | 'browser' | 'edit' | 'search' | 'task' | 'other';

export interface ToolCall {
  id: string;
  type: ToolCallType;
  title: string;
  description?: string;
  input?: Record<string, unknown>;
  output?: string | Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: {
    filePath?: string;
    command?: string;
    url?: string;
    linesChanged?: number;
    bytesWritten?: number;
  };
  nested?: ToolCall[];
}

export interface BuildTranscriptProps {
  toolCalls: ToolCall[];
  onToolCallClick?: (call: ToolCall) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  autoScroll?: boolean;
  filterType?: ToolCallType | 'all';
  filterStatus?: ToolCall['status'] | 'all';
}

const TYPE_CONFIG: Record<ToolCallType, { icon: typeof Code2; label: string; color: string; bgColor: string }> = {
  read: { icon: FileText, label: 'Read', color: 'text-[var(--build-accent-read)]', bgColor: 'bg-[var(--build-accent-read)]/10 border-[var(--build-accent-read)]/30' },
  write: { icon: FileText, label: 'Write', color: 'text-[var(--build-accent-write)]', bgColor: 'bg-[var(--build-accent-write)]/10 border-[var(--build-accent-write)]/30' },
  edit: { icon: Code2, label: 'Edit', color: 'text-[var(--build-accent-edit)]', bgColor: 'bg-[var(--build-accent-edit)]/10 border-[var(--build-accent-edit)]/30' },
  shell: { icon: Terminal, label: 'Shell', color: 'text-[var(--build-accent-shell)]', bgColor: 'bg-[var(--build-accent-shell)]/10 border-[var(--build-accent-shell)]/30' },
  browser: { icon: Globe, label: 'Browser', color: 'text-[var(--build-accent-browser)]', bgColor: 'bg-[var(--build-accent-browser)]/10 border-[var(--build-accent-browser)]/30' },
  search: { icon: Sparkles, label: 'Search', color: 'text-[var(--build-accent-search)]', bgColor: 'bg-[var(--build-accent-search)]/10 border-[var(--build-accent-search)]/30' },
  task: { icon: Code2, label: 'Task', color: 'text-[var(--build-accent-task)]', bgColor: 'bg-[var(--build-accent-task)]/10 border-[var(--build-accent-task)]/30' },
  other: { icon: Sparkles, label: 'Tool', color: 'text-muted-foreground', bgColor: 'bg-secondary border-border' },
};

const STATUS_CONFIG: Record<ToolCall['status'], { icon: typeof Check; label: string }> = {
  pending: { icon: Sparkles, label: 'Pending' },
  running: { icon: Loader2, label: 'Running' },
  completed: { icon: Check, label: 'Completed' },
  error: { icon: X, label: 'Error' },
  cancelled: { icon: X, label: 'Cancelled' },
};

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
};

const formatTimestamp = (ts: number) => {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

function ToolCallCard({
  call,
  depth = 0,
  onClick,
  expandedCalls,
  setExpandedCalls,
}: {
  call: ToolCall;
  depth?: number;
  onClick?: (call: ToolCall) => void;
  expandedCalls: Set<string>;
  setExpandedCalls: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const { t } = useI18n();
  const isExpanded = expandedCalls.has(call.id);
  const hasNested = call.nested && call.nested.length > 0;
  const typeConfig = TYPE_CONFIG[call.type] || TYPE_CONFIG.other;
  const statusConfig = STATUS_CONFIG[call.status];
  const Icon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasNested) {
      setExpandedCalls(prev => {
        const next = new Set(prev);
        if (next.has(call.id)) next.delete(call.id);
        else next.add(call.id);
        return next;
      });
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
    if (hasNested) return;
    onClick?.(call);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // silent fail
    }
  };

  return (
    <div className={`build-transcript-card ${isExpanded ? 'expanded' : ''}`} style={{ marginLeft: `${depth * 16}px` }}>
      <button
        type="button"
        onClick={toggleExpand}
        className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        disabled={!hasNested}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Collapse' : 'Expand'}
      >
        <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg" style={{ backgroundColor: `var(--build-accent-${call.type})` }}>
          <Icon className="h-4 w-4" style={{ color: `var(--build-accent-${call.type})` }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm text-foreground truncate">{call.title}</h4>
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${typeConfig.bgColor} ${typeConfig.color}`}>
              {typeConfig.label}
            </span>
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
              call.status === 'completed' ? 'border-[var(--build-status-done)]/30 bg-[var(--build-status-done)]/10 text-[var(--build-status-done)]' :
              call.status === 'running' ? 'border-[var(--build-status-working)]/30 bg-[var(--build-status-working)]/10 text-[var(--build-status-working)]' :
              call.status === 'error' ? 'border-[var(--build-status-error)]/30 bg-[var(--build-status-error)]/10 text-[var(--build-status-error)]' :
              call.status === 'cancelled' ? 'border-[var(--build-status-cancelled)]/30 bg-[var(--build-status-cancelled)]/10 text-[var(--build-status-cancelled)]' :
              'border-border bg-secondary text-muted-foreground'
            }`}>
              {statusConfig.label}
            </span>
          </div>

          {call.description && (
            <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{call.description}</p>
          )}

          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimestamp(call.startedAt)}
            </span>
            {call.durationMs !== undefined && (
              <span className="flex items-center gap-1 font-mono">
                <span className="text-primary/70">{formatDuration(call.durationMs)}</span>
              </span>
            )}
            {call.metadata?.filePath && (
              <span className="flex items-center gap-1 truncate max-w-[200px]">
                <FileText className="h-3 w-3" />
                <span className="font-mono">{call.metadata.filePath}</span>
              </span>
            )}
            {call.metadata?.command && (
              <span className="flex items-center gap-1 truncate max-w-[200px]">
                <Terminal className="h-3 w-3" />
                <span className="font-mono">{call.metadata.command}</span>
              </span>
            )}
            {call.metadata?.url && (
              <span className="flex items-center gap-1 truncate max-w-[200px]">
                <Globe className="h-3 w-3" />
                <span>{call.metadata.url}</span>
              </span>
            )}
          </div>
        </div>

        {hasNested && (
          <button
            type="button"
            onClick={toggleExpand}
            className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground"
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </button>

      {isExpanded && hasNested && (
        <div className="mt-2 ml-3 border-l-2 border-border/50 pl-3 space-y-2 animate-fade-in">
          {call.nested!.map(nested => (
            <ToolCallCard
              key={nested.id}
              call={nested}
              depth={depth + 1}
              onClick={onClick}
              expandedCalls={expandedCalls}
              setExpandedCalls={setExpandedCalls}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function BuildTranscript({
  toolCalls,
  onToolCallClick,
  onExpandAll,
  onCollapseAll,
  autoScroll = true,
  filterType = 'all',
  filterStatus = 'all',
}: BuildTranscriptProps) {
  const { t } = useI18n();
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ToolCallType | 'all'>(filterType);
  const [statusFilter, setStatusFilter] = useState<ToolCall['status'] | 'all'>(filterStatus);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new calls arrive
  const prevCountRef = useRef(toolCalls.length);
  useEffect(() => {
    if (autoScroll && toolCalls.length > prevCountRef.current) {
      const container = containerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
    prevCountRef.current = toolCalls.length;
  }, [toolCalls.length, autoScroll]);

  const filteredCalls = toolCalls.filter(call => {
    const typeMatch = filter === 'all' || call.type === filter;
    const statusMatch = statusFilter === 'all' || call.status === statusFilter;
    return typeMatch && statusMatch;
  });

  const handleExpandAll = () => {
    const allIds = new Set<string>();
    const collectIds = (calls: ToolCall[]) => {
      calls.forEach(c => {
        allIds.add(c.id);
        if (c.nested) collectIds(c.nested);
      });
    };
    collectIds(filteredCalls);
    setExpandedCalls(allIds);
    onExpandAll?.();
  };

  const handleCollapseAll = () => {
    setExpandedCalls(new Set());
    onCollapseAll?.();
  };

  const stats = {
    total: toolCalls.length,
    completed: toolCalls.filter(c => c.status === 'completed').length,
    running: toolCalls.filter(c => c.status === 'running').length,
    error: toolCalls.filter(c => c.status === 'error').length,
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header with filters */}
      <header className="flex-shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">{t('studio.build.transcriptTitle') || 'Transcript'}</h3>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {/* Type filter */}
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as ToolCallType | 'all')}
            className="rounded-lg border border-border bg-input px-2 py-1.5 text-[11px] text-foreground outline-none"
            aria-label="Filter by tool type"
          >
            <option value="all">{t('studio.build.filterAll') || 'All'}</option>
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="edit">Edit</option>
            <option value="shell">Shell</option>
            <option value="browser">Browser</option>
            <option value="search">Search</option>
            <option value="task">Task</option>
            <option value="other">Other</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ToolCall['status'] | 'all')}
            className="rounded-lg border border-border bg-input px-2 py-1.5 text-[11px] text-foreground outline-none"
            aria-label="Filter by status"
          >
            <option value="all">{t('studio.build.filterAll') || 'All'}</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="error">Error</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Stats badges */}
          <div className="flex items-center gap-1 ml-2">
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-mono text-emerald-400" title="Completed">
              {stats.completed}
            </span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-mono text-primary" title="Running">
              {stats.running}
            </span>
            <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-mono text-rose-400" title="Errors">
              {stats.error}
            </span>
          </div>

          {/* Expand/Collapse all */}
          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <button
              type="button"
              onClick={handleExpandAll}
              className="rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Expand all"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Collapse all"
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-180" />
            </button>
          </div>
        </div>
      </header>

      {/* Transcript feed */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 build-scrollbar-thin"
        role="log"
        aria-live="polite"
        aria-label={t('studio.build.transcriptFeed') || 'Build transcript'}
      >
        {filteredCalls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground/50">
            <Sparkles className="h-10 w-10 mb-3" />
            <p className="text-sm">{t('studio.build.transcriptEmpty') || 'No tool calls yet'}</p>
            <p className="text-[11px] mt-1">Start a build to see activity here</p>
          </div>
        ) : (
          filteredCalls.map(call => (
            <ToolCallCard
              key={call.id}
              call={call}
              onClick={onToolCallClick}
              expandedCalls={expandedCalls}
              setExpandedCalls={setExpandedCalls}
            />
          ))
        )}
      </div>

      {/* Bottom hint on mobile */}
      <style>{`
        .build-transcript-card {
          animation: build-fade-in var(--build-transition-normal);
        }
        .build-transcript-card.expanded > button + div {
          animation: build-slide-up var(--build-transition-spring);
        }
      `}</style>
    </div>
  );
}

// Re-export for convenience
export { ToolCallCard };