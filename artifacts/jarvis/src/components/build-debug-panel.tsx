import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpDown,
  Bug,
  Copy,
  Download,
  Filter,
  RefreshCw,
  Trash2,
  X,
  ChevronDown,
  Check,
  ExternalLink,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type BuildEventType =
  | 'plan_start'
  | 'plan_ready'
  | 'step_start'
  | 'tool_call'
  | 'tool_result'
  | 'verify_start'
  | 'verify_result'
  | 'checkpoint'
  | 'snapshot'
  | 'error'
  | 'retry'
  | 'info';

interface BuildEvent {
  ts: string;
  seq: number;
  type: BuildEventType;
  projectId: string;
  label: string;
  data?: Record<string, unknown> | null;
  durationMs?: number;
  step?: string;
}

interface TelemetrySummary {
  summary: string;
}

interface TelemetryCount {
  total: number;
}

const TYPE_COLORS: Record<BuildEventType, string> = {
  plan_start: 'text-blue-400',
  plan_ready: 'text-emerald-400',
  step_start: 'text-cyan-400',
  tool_call: 'text-purple-400',
  tool_result: 'text-amber-400',
  verify_start: 'text-indigo-400',
  verify_result: 'text-violet-400',
  checkpoint: 'text-sky-400',
  snapshot: 'text-teal-400',
  error: 'text-rose-400',
  retry: 'text-orange-400',
  info: 'text-muted-foreground',
};

const TYPE_LABELS: Record<BuildEventType, string> = {
  plan_start: 'plan_start',
  plan_ready: 'plan_ready',
  step_start: 'step_start',
  tool_call: 'tool_call',
  tool_result: 'tool_result',
  verify_start: 'verify_start',
  verify_result: 'verify_result',
  checkpoint: 'checkpoint',
  snapshot: 'snapshot',
  error: 'error',
  retry: 'retry',
  info: 'info',
};

export function BuildDebugPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [filterType, setFilterType] = useState<BuildEventType | 'all'>('all');
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [count, setCount] = useState<number>(0);
  const [copyFlash, setCopyFlash] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const loadingRef = useRef(false);

  const fetchLive = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const { response, data } = await apiJson<{ events?: BuildEvent[] }>(
        `/api/jarvis/build/telemetry/${encodeURIComponent(workspaceId)}?limit=500`
      );
      if (response.ok) setEvents(data.events ?? []);
    } catch (err) {
      console.error('[DebugPanel] live fetch failed', err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [workspaceId]);

  const fetchReplay = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const { response, data } = await apiJson<{ events?: BuildEvent[] }>(
        `/api/jarvis/build/telemetry/${encodeURIComponent(workspaceId)}/all`
      );
      if (response.ok) setEvents(data.events ?? []);
    } catch (err) {
      console.error('[DebugPanel] replay fetch failed', err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [workspaceId]);

  const fetchSummary = useCallback(async () => {
    try {
      const { response, data } = await apiJson<TelemetrySummary>(
        `/api/jarvis/build/telemetry/${encodeURIComponent(workspaceId)}/summary`
      );
      if (response.ok) setSummary(data.summary ?? '');
    } catch (err) {
      console.error('[DebugPanel] summary fetch failed', err);
    }
  }, [workspaceId]);

  const fetchCount = useCallback(async () => {
    try {
      const { response, data } = await apiJson<TelemetryCount>(
        `/api/jarvis/build/telemetry/${encodeURIComponent(workspaceId)}/count`
      );
      if (response.ok) setCount(data.total ?? 0);
    } catch (err) {
      console.error('[DebugPanel] count fetch failed', err);
    }
  }, [workspaceId]);

  const handleRefresh = () => {
    if (mode === 'live') fetchLive();
    else fetchReplay();
    fetchSummary();
    fetchCount();
  };

  const handleExport = async () => {
    try {
      const { response } = await apiJson(`/api/jarvis/build/telemetry/${encodeURIComponent(workspaceId)}/all`);
      if (!response.ok) return;
      const blob = new Blob([JSON.stringify({ events: response.json() })], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `build-telemetry-${workspaceId}-${Date.now()}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[DebugPanel] export failed', err);
    }
  };

  const handleCopySummary = async () => {
    if (!summary) return;
    await navigator.clipboard.writeText(summary);
    setCopyFlash(true);
    setTimeout(() => setCopyFlash(false), 1500);
  };

  const handleClear = async () => {
    if (!window.confirm(t('studio.build.debugClearConfirm'))) return;
    try {
      const { response } = await apiJson(`/api/jarvis/build/telemetry/${encodeURIComponent(workspaceId)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setEvents([]);
        setSummary('');
        setCount(0);
      }
    } catch (err) {
      console.error('[DebugPanel] clear failed', err);
    }
    setClearConfirm(false);
  };

  const filteredEvents = events.filter((e) => filterType === 'all' || e.type === filterType);

  // Auto-fetch on mount and mode change
  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{t('studio.build.debugTitle')}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary p-1">
            <button
              type="button"
              onClick={() => setMode('live')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition ${
                mode === 'live'
                  ? 'bg-background text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {t('studio.build.debugLive')}
            </button>
            <button
              type="button"
              onClick={() => setMode('replay')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition ${
                mode === 'replay'
                  ? 'bg-background text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('studio.build.debugReplay')}
            </button>
          </div>

          {/* Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen(!filterOpen)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
              aria-expanded={filterOpen}
            >
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('studio.build.debugFilter')}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>
            {filterOpen && (
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 z-[10] min-w-[160px] rounded-xl border border-border bg-card p-1.5 shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => { setFilterType('all'); setFilterOpen(false); }}
                    className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition ${
                      filterType === 'all' ? 'bg-background text-white' : 'text-muted-foreground hover:bg-white/[0.06]'
                    }`}
                  >
                    {filterType === 'all' && <Check className="h-3 w-3 text-primary" />}
                    {t('studio.build.debugFilterAll')}
                  </button>
                  {(Object.keys(TYPE_LABELS) as BuildEventType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setFilterType(type); setFilterOpen(false); }}
                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition ${TYPE_COLORS[type]} ${
                        filterType === type ? 'bg-background text-white' : 'hover:bg-white/[0.06]'
                      }`}
                    >
                      {filterType === type && <Check className="h-3 w-3" />}
                      {TYPE_LABELS[type]}
                    </button>
                  ))}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Count */}
          <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[10px] text-muted-foreground">
            {t('studio.build.debugCount', { n: count })}
          </span>

          {/* Actions */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
            title={t('studio.build.debugRefresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('studio.build.debugRefresh')}</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
            title={t('studio.build.debugExport')}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('studio.build.debugExport')}</span>
          </button>

          <button
            type="button"
            onClick={handleCopySummary}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
            title={t('studio.build.debugCopy')}
          >
            <Copy className="h-3.5 w-3.5" />
            {copyFlash ? (
              <span className="text-emerald-400">{t('studio.build.debugCopied')}</span>
            ) : (
              <span className="hidden sm:inline">{t('studio.build.debugCopy')}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setClearConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-400/10 px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-400/20"
            title={t('studio.build.debugClear')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('studio.build.debugClear')}</span>
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="shrink-0 border-b border-border bg-secondary/50 px-3 py-2 text-[10px] text-muted-foreground">
        {t('studio.build.debugDesc')}
      </div>

      {/* Summary / Events */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'replay' && summary && (
          <div className="border-b border-border bg-secondary/50 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('studio.build.debugSummary')}</span>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-background p-2 font-mono text-[10px] text-foreground whitespace-pre-wrap">{summary}</pre>
          </div>
        )}

        {events.length === 0 && !loading && (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground p-4">
            {t('studio.build.debugSummaryEmpty')}
          </div>
        )}

        {loading && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            {t('studio.build.debugSummaryGenerating')}
          </div>
        )}

        {filteredEvents.length > 0 && (
          <div className="h-full overflow-auto font-mono text-[10px]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="sticky top-0 bg-card/80 backdrop-blur-sm border-b border-border text-[9px] uppercase tracking-widest text-muted-foreground">
                  <th className="w-10 text-left px-2 py-1">{t('studio.build.debugSeq')}</th>
                  <th className="w-28 text-left px-2 py-1">{t('studio.build.debugTime')}</th>
                  <th className="w-24 text-left px-2 py-1">{t('studio.build.debugType')}</th>
                  <th className="w-20 text-left px-2 py-1">{t('studio.build.debugStep')}</th>
                  <th className="text-left px-2 py-1">{t('studio.build.debugLabel')}</th>
                  <th className="w-24 text-right px-2 py-1">{t('studio.build.debugDuration')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={event.seq} className="border-b border-border/50 hover:bg-white/[0.02]">
                    <td className="px-2 py-1 text-muted-foreground/50 font-mono">{event.seq}</td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {new Date(event.ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}
                    </td>
                    <td className="px-2 py-1">
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold ${TYPE_COLORS[event.type]}`}>
                        {TYPE_LABELS[event.type]}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground/70 font-mono">
                      {event.step ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-foreground min-w-0 truncate max-w-xs" title={event.label}>
                      {event.label}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground/60 font-mono">
                      {event.durationMs != null ? `${event.durationMs} ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredEvents.length < events.length && (
              <div className="p-2 text-center text-[10px] text-muted-foreground border-t border-border">
                {t('studio.build.debugEmpty')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clear confirm modal */}
      {clearConfirm && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setClearConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="max-w-md w-full rounded-2xl border border-border bg-card p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-2">
                <Trash2 className="h-5 w-5 text-rose-400" />
                <h3 className="text-sm font-semibold text-foreground">{t('studio.build.debugClear')}</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">{t('studio.build.debugClearConfirm')}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setClearConfirm(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white"
                >
                  <Trash2 className="h-3 w-3" />
                  {t('studio.build.debugClear')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

const apiJson = async <T,>(url: string, init?: RequestInit): Promise<{ response: Response; data: T }> => {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T;
  return { response, data };
};