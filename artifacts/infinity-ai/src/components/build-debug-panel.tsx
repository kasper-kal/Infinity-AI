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
  Share2,
  GitBranch,
  Archive,
  Link,
  Loader2,
  Shield,
  HardDrive,
  GitMerge,
  AlertTriangle,
  Zap,
  ListChecks,
  Brain,
  Wrench,
  Cpu,
  BarChart2,
  History,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { TokenUsageGauge } from '@/components/build/TokenUsageGauge';
import { CompactionHistory } from '@/components/build/CompactionHistory';

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
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  // Phase 5.3 Edge Cases
  const [edgeCasesBusy, setEdgeCasesBusy] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<{
    ok: boolean;
    checks: Record<string, boolean>;
    issues: string[];
  } | null>(null);
  const [diskSpaceInfo, setDiskSpaceInfo] = useState<{
    freeBytes: number;
    totalBytes: number;
    usedPercent: number;
    critical: boolean;
    warning: boolean;
  } | null>(null);
  const [queueStatus, setQueueStatus] = useState<{ waiting: number; processing: boolean } | null>(null);
  const [edgeCasesList, setEdgeCasesList] = useState<Array<{
    id: string;
    type: string;
    timestamp: string;
    severity: string;
    message: string;
    details: Record<string, unknown>;
    resolved: boolean;
    resolvedAt?: string;
    resolution?: string;
  }>>([]);
  const [rateLimitInfo, setRateLimitInfo] = useState<{ allowed: boolean; retryAfterMs?: number } | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainResult, setExplainResult] = useState<{ explanation: string; rootCause: string; fixes: Array<{ title: string; description: string; code?: string }> } | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [fixResult, setFixResult] = useState<{ fixes: Array<{ file: string; oldCode: string; newCode: string; explanation: string; confidence: number }> } | null>(null);

  const fetchLive = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const { response, data } = await apiJson<{ events?: BuildEvent[] }>(
        `/api/infinity/build/telemetry/${encodeURIComponent(workspaceId)}?limit=500`
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
        `/api/infinity/build/telemetry/${encodeURIComponent(workspaceId)}/all`
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
        `/api/infinity/build/telemetry/${encodeURIComponent(workspaceId)}/summary`
      );
      if (response.ok) setSummary(data.summary ?? '');
    } catch (err) {
      console.error('[DebugPanel] summary fetch failed', err);
    }
  }, [workspaceId]);

  const fetchCount = useCallback(async () => {
    try {
      const { response, data } = await apiJson<TelemetryCount>(
        `/api/infinity/build/telemetry/${encodeURIComponent(workspaceId)}/count`
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
      const { response } = await apiJson(`/api/infinity/build/telemetry/${encodeURIComponent(workspaceId)}/all`);
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
      const { response } = await apiJson(`/api/infinity/build/telemetry/${encodeURIComponent(workspaceId)}`, {
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

  const handleExportZip = async () => {
    setExportBusy('zip');
    try {
      const { response, data } = await apiJson<Blob>(
        `/api/infinity/build/export/zip/${encodeURIComponent(workspaceId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ includeNodeModules: false, includeGit: false }) }
      );
      if (response.ok && data) {
        const blob = data instanceof Blob ? data : new Blob([JSON.stringify(data)], { type: 'application/zip' });
        downloadBlob(blob, `build-${workspaceId}-${Date.now()}.zip`);
      } else {
        console.error('[DebugPanel] zip export failed', data);
      }
    } catch (err) {
      console.error('[DebugPanel] zip export failed', err);
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportTarGz = async () => {
    setExportBusy('tar-gz');
    try {
      const { response, data } = await apiJson<Blob>(
        `/api/infinity/build/export/tar-gz/${encodeURIComponent(workspaceId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ includeNodeModules: false, includeGit: false }) }
      );
      if (response.ok && data) {
        const blob = data instanceof Blob ? data : new Blob([JSON.stringify(data)], { type: 'application/gzip' });
        downloadBlob(blob, `build-${workspaceId}-${Date.now()}.tar.gz`);
      } else {
        console.error('[DebugPanel] tar.gz export failed', data);
      }
    } catch (err) {
      console.error('[DebugPanel] tar.gz export failed', err);
    } finally {
      setExportBusy(null);
    }
  };

  const handleShare = async () => {
    setShareBusy(true);
    try {
      const { response, data } = await apiJson<ShareResponse>(
        `/api/infinity/build/share/${encodeURIComponent(workspaceId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      if (response.ok && data.shareUrl) {
        setShareUrl(data.shareUrl);
        await navigator.clipboard.writeText(data.shareUrl);
        setCopyFlash(true);
        setTimeout(() => setCopyFlash(false), 2000);
      }
    } catch (err) {
      console.error('[DebugPanel] share failed', err);
    } finally {
      setShareBusy(false);
    }
  };

  const handleClone = async () => {
    const targetProjectId = window.prompt('Target project ID (optional, leave blank for auto-generated):');
    if (targetProjectId === null) return; // user cancelled
    setCloneBusy(true);
    try {
      const { response, data } = await apiJson<CloneResponse>(
        `/api/infinity/build/clone/${encodeURIComponent(workspaceId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetProjectId: targetProjectId || undefined }) }
      );
      if (response.ok && data.targetProjectId) {
        alert(`Build cloned to ${data.targetProjectId}`);
      }
    } catch (err) {
      console.error('[DebugPanel] clone failed', err);
    } finally {
      setCloneBusy(false);
    }
  };

  // Phase 5.3 Edge Cases handlers
  const handlePreflight = async () => {
    setEdgeCasesBusy('preflight');
    try {
      const { response, data } = await apiJson<{
        ok: boolean;
        checks: Record<string, boolean>;
        issues: string[];
      }>(`/api/infinity/build/preflight/${encodeURIComponent(workspaceId)}`);
      if (response.ok) {
        setPreflightResult(data);
        alert(data.ok ? t('studio.build.edgePreflightOk') : t('studio.build.edgePreflightIssues', { issues: data.issues.join(', ') }));
      }
    } catch (err) {
      console.error('[DebugPanel] preflight failed', err);
    } finally {
      setEdgeCasesBusy(null);
    }
  };

  const handleDiskSpace = async () => {
    setEdgeCasesBusy('disk');
    try {
      const { response, data } = await apiJson<{
        freeBytes: number;
        totalBytes: number;
        usedPercent: number;
        critical: boolean;
        warning: boolean;
      }>(`/api/infinity/build/disk-space/${encodeURIComponent(workspaceId)}`);
      if (response.ok) {
        setDiskSpaceInfo(data);
      }
    } catch (err) {
      console.error('[DebugPanel] disk space failed', err);
    } finally {
      setEdgeCasesBusy(null);
    }
  };

  const handleQueueStatus = async () => {
    setEdgeCasesBusy('queue');
    try {
      const { response, data } = await apiJson<{ waiting: number; processing: boolean }>(
        `/api/infinity/build/queue/${encodeURIComponent(workspaceId)}`
      );
      if (response.ok) {
        setQueueStatus(data);
      }
    } catch (err) {
      console.error('[DebugPanel] queue status failed', err);
    } finally {
      setEdgeCasesBusy(null);
    }
  };

  const handleEdgeCasesList = async () => {
    setEdgeCasesBusy('edge-cases');
    try {
      const { response, data } = await apiJson<{ edgeCases: Array<{
        id: string;
        type: string;
        timestamp: string;
        severity: string;
        message: string;
        details: Record<string, unknown>;
        resolved: boolean;
        resolvedAt?: string;
        resolution?: string;
      }> }>(`/api/infinity/build/edge-cases/${encodeURIComponent(workspaceId)}`);
      if (response.ok) {
        setEdgeCasesList(data.edgeCases);
      }
    } catch (err) {
      console.error('[DebugPanel] edge cases list failed', err);
    } finally {
      setEdgeCasesBusy(null);
    }
  };

  const handleRateLimit = async () => {
    setEdgeCasesBusy('rate-limit');
    try {
      const { response, data } = await apiJson<{ allowed: boolean; retryAfterMs?: number }>(
        `/api/infinity/build/rate-limit/${encodeURIComponent(workspaceId)}?maxRequests=10&windowMs=60000`
      );
      if (response.ok) {
        setRateLimitInfo(data);
      }
    } catch (err) {
      console.error('[DebugPanel] rate limit failed', err);
    } finally {
      setEdgeCasesBusy(null);
    }
  };

  const handleExplainError = async () => {
    // Find the most recent error event
    const errorEvent = events.find(e => e.type === 'error');
    if (!errorEvent) {
      alert('No error found in telemetry to explain');
      return;
    }

    setExplainBusy(true);
    try {
      const { response, data } = await apiJson<{
        explanation: string;
        rootCause: string;
        fixes: Array<{ title: string; description: string; code?: string }>;
      }>(`/api/infinity/local-model/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: errorEvent.label,
          context: errorEvent.data ? JSON.stringify(errorEvent.data) : undefined,
        }),
      });
      if (response.ok) {
        setExplainResult(data);
      }
    } catch (err) {
      console.error('[DebugPanel] explain error failed', err);
    } finally {
      setExplainBusy(false);
    }
  };

  const handleFixError = async () => {
    // Find the most recent error event
    const errorEvent = events.find(e => e.type === 'error');
    if (!errorEvent) {
      alert('No error found in telemetry to fix');
      return;
    }

    setFixBusy(true);
    try {
      const { response, data } = await apiJson<{
        fixes: Array<{ file: string; oldCode: string; newCode: string; explanation: string; confidence: number }>;
      }>(`/api/infinity/local-model/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: errorEvent.label,
          context: errorEvent.data ? JSON.stringify(errorEvent.data) : undefined,
        }),
      });
      if (response.ok) {
        setFixResult(data);
      }
    } catch (err) {
      console.error('[DebugPanel] fix error failed', err);
    } finally {
      setFixBusy(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

          {/* Export / Share / Clone */}
          <div className="flex items-center gap-1.5 border-l border-border pl-2.5 ml-2">
            <button
              type="button"
              onClick={handleExportZip}
              disabled={exportBusy === 'zip'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.debugExportZip') || 'Export ZIP'}
            >
              <Archive className="h-3.5 w-3.5" />
              {exportBusy === 'zip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">ZIP</span>}
            </button>
            <button
              type="button"
              onClick={handleExportTarGz}
              disabled={exportBusy === 'tar-gz'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.debugExportTar') || 'Export tar.gz'}
            >
              <Archive className="h-3.5 w-3.5" />
              {exportBusy === 'tar-gz' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">tar.gz</span>}
            </button>
            <button
              type="button"
              onClick={handleShare}
              disabled={shareBusy}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.debugShare') || 'Share'}
            >
              <Share2 className="h-3.5 w-3.5" />
              {shareBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.debugShare') || 'Share'}</span>}
            </button>
            <button
              type="button"
              onClick={handleClone}
              disabled={cloneBusy}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.debugClone') || 'Clone'}
            >
              <GitBranch className="h-3.5 w-3.5" />
              {cloneBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.debugClone') || 'Clone'}</span>}
            </button>
          </div>

          {/* Edge Cases (Phase 5.3) */}
          <div className="flex items-center gap-1.5 border-l border-border pl-2.5 ml-2">
            <button
              type="button"
              onClick={handlePreflight}
              disabled={edgeCasesBusy === 'preflight'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.edgePreflight') || 'Preflight Check'}
            >
              <Shield className="h-3.5 w-3.5" />
              {edgeCasesBusy === 'preflight' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.edgePreflight') || 'Preflight'}</span>}
            </button>
            <button
              type="button"
              onClick={handleDiskSpace}
              disabled={edgeCasesBusy === 'disk'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.edgeDiskSpace') || 'Disk Space'}
            >
              <HardDrive className="h-3.5 w-3.5" />
              {edgeCasesBusy === 'disk' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.edgeDiskSpace') || 'Disk'}</span>}
            </button>
            <button
              type="button"
              onClick={handleQueueStatus}
              disabled={edgeCasesBusy === 'queue'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.edgeQueue') || 'Queue'}
            >
              <ListChecks className="h-3.5 w-3.5" />
              {edgeCasesBusy === 'queue' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.edgeQueue') || 'Queue'}</span>}
            </button>
            <button
              type="button"
              onClick={handleEdgeCasesList}
              disabled={edgeCasesBusy === 'edge-cases'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.edgeCases') || 'Edge Cases'}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {edgeCasesBusy === 'edge-cases' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.edgeCases') || 'Edge Cases'}</span>}
            </button>
            <button
              type="button"
              onClick={handleRateLimit}
              disabled={edgeCasesBusy === 'rate-limit'}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.edgeRateLimit') || 'Rate Limit'}
            >
              <Zap className="h-3.5 w-3.5" />
              {edgeCasesBusy === 'rate-limit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.edgeRateLimit') || 'Rate Limit'}</span>}
            </button>
          </div>

          {/* Local Model AI (Phase 19) */}
          <div className="flex items-center gap-1.5 border-l border-border pl-2.5 ml-2">
            <button
              type="button"
              onClick={handleExplainError}
              disabled={explainBusy}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.localExplain') || 'Explain Error'}
            >
              <Brain className="h-3.5 w-3.5" />
              {explainBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.localExplain') || 'Explain'}</span>}
            </button>
            <button
              type="button"
              onClick={handleFixError}
              disabled={fixBusy}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              title={t('studio.build.localFix') || 'Fix with Local AI'}
            >
              <Wrench className="h-3.5 w-3.5" />
              {fixBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="hidden sm:inline">{t('studio.build.localFix') || 'Fix with AI'}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="shrink-0 border-b border-border bg-secondary/50 px-3 py-2 text-[10px] text-muted-foreground">
        {t('studio.build.debugDesc')}
      </div>

      {/* Edge Cases Status Display (Phase 5.3) */}
      {(preflightResult || diskSpaceInfo || queueStatus || edgeCasesList.length > 0 || rateLimitInfo) && (
        <div className="shrink-0 border-b border-border bg-secondary/50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('studio.build.edgeStatus') || 'Edge Cases Status'}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[10px] font-mono">
            {preflightResult && (
              <div className="rounded-lg bg-background p-2 border border-border/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <Shield className="h-3 w-3" />
                  <span className="font-medium text-foreground">{t('studio.build.edgePreflight') || 'Preflight'}</span>
                  <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${preflightResult.ok ? 'bg-emerald-400/20 text-emerald-400' : 'bg-rose-400/20 text-rose-400'}`}>
                    {preflightResult.ok ? 'OK' : 'ISSUES'}
                  </span>
                </div>
                {!preflightResult.ok && preflightResult.issues.length > 0 && (
                  <ul className="ml-4 space-y-0.5 text-rose-400">
                    {preflightResult.issues.map((issue, i) => (
                      <li key={i}>• {issue}</li>
                    ))}
                  </ul>
                )}
                {preflightResult.ok && (
                  <p className="text-emerald-400 text-[10px]">All checks passed</p>
                )}
              </div>
            )}
            {diskSpaceInfo && (
              <div className="rounded-lg bg-background p-2 border border-border/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <HardDrive className="h-3 w-3" />
                  <span className="font-medium text-foreground">{t('studio.build.edgeDiskSpace') || 'Disk Space'}</span>
                  <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${diskSpaceInfo.critical ? 'bg-rose-400/20 text-rose-400' : diskSpaceInfo.warning ? 'bg-amber-400/20 text-amber-400' : 'bg-emerald-400/20 text-emerald-400'}`}>
                    {diskSpaceInfo.critical ? 'CRITICAL' : diskSpaceInfo.warning ? 'LOW' : 'OK'}
                  </span>
                </div>
                <div className="text-muted-foreground space-y-0.5">
                  <div>Free: {formatBytes(diskSpaceInfo.freeBytes)} / {formatBytes(diskSpaceInfo.totalBytes)}</div>
                  <div>Used: {diskSpaceInfo.usedPercent.toFixed(1)}%</div>
                </div>
              </div>
            )}
            {queueStatus && (
              <div className="rounded-lg bg-background p-2 border border-border/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <ListChecks className="h-3 w-3" />
                  <span className="font-medium text-foreground">{t('studio.build.edgeQueue') || 'Queue'}</span>
                  <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${queueStatus.processing ? 'bg-amber-400/20 text-amber-400' : 'bg-emerald-400/20 text-emerald-400'}`}>
                    {queueStatus.processing ? 'BUSY' : 'IDLE'}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  Waiting: {queueStatus.waiting} task{queueStatus.waiting !== 1 ? 's' : ''}
                </div>
              </div>
            )}
            {edgeCasesList.length > 0 && (
              <div className="rounded-lg bg-background p-2 border border-border/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3 w-3" />
                  <span className="font-medium text-foreground">{t('studio.build.edgeCases') || 'Edge Cases'}</span>
                  <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold bg-rose-400/20 text-rose-400">
                    {edgeCasesList.length} open
                  </span>
                </div>
                <ul className="ml-4 space-y-0.5 text-muted-foreground max-h-32 overflow-auto">
                  {edgeCasesList.slice(0, 5).map((ec) => (
                    <li key={ec.id} className="truncate">
                      • [{ec.type}] {ec.message}
                    </li>
                  ))}
                  {edgeCasesList.length > 5 && (
                    <li className="text-muted-foreground/50">...and {edgeCasesList.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            {rateLimitInfo && (
              <div className="rounded-lg bg-background p-2 border border-border/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap className="h-3 w-3" />
                  <span className="font-medium text-foreground">{t('studio.build.edgeRateLimit') || 'Rate Limit'}</span>
                  <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${rateLimitInfo.allowed ? 'bg-emerald-400/20 text-emerald-400' : 'bg-rose-400/20 text-rose-400'}`}>
                    {rateLimitInfo.allowed ? 'ALLOWED' : 'LIMITED'}
                  </span>
                </div>
                {!rateLimitInfo.allowed && rateLimitInfo.retryAfterMs && (
                  <div className="text-amber-400 text-[10px]">
                    Retry in {Math.ceil(rateLimitInfo.retryAfterMs / 1000)}s
                  </div>
                )}
                {rateLimitInfo.allowed && (
                  <div className="text-emerald-400 text-[10px]">Requests available</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Local Model AI Results (Phase 19) */}
      {(explainResult || fixResult) && (
        <div className="shrink-0 border-b border-border bg-secondary/50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('studio.build.localResults') || 'Local AI Results'}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {explainResult && (
              <div className="rounded-lg bg-background p-3 border border-border/50 max-h-64 overflow-auto">
                <div className="flex items-center gap-1.5 mb-2">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium text-foreground">{t('studio.build.localExplain') || 'Error Explanation'}</span>
                </div>
                <div className="space-y-3 text-[11px]">
                  <div>
                    <span className="font-medium text-muted-foreground">{t('studio.build.localExplanation') || 'Explanation:'}</span>
                    <p className="mt-1 text-foreground whitespace-pre-wrap">{explainResult.explanation}</p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">{t('studio.build.localRootCause') || 'Root Cause:'}</span>
                    <p className="mt-1 text-foreground whitespace-pre-wrap">{explainResult.rootCause}</p>
                  </div>
                  {explainResult.fixes && explainResult.fixes.length > 0 && (
                    <div>
                      <span className="font-medium text-muted-foreground">{t('studio.build.localFixes') || 'Suggested Fixes:'}</span>
                      <ul className="mt-1 ml-4 space-y-1.5 list-disc text-foreground">
                        {explainResult.fixes.map((fix, i) => (
                          <li key={i} className="space-y-1">
                            <span className="font-medium">{fix.title}</span>
                            <p className="text-muted-foreground/80">{fix.description}</p>
                            {fix.code && (
                              <pre className="mt-1 rounded bg-background/50 p-2 font-mono text-[10px] overflow-auto whitespace-pre-wrap"><code>{fix.code}</code></pre>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
            {fixResult && (
              <div className="rounded-lg bg-background p-3 border border-border/50 max-h-64 overflow-auto">
                <div className="flex items-center gap-1.5 mb-2">
                  <Wrench className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="font-medium text-foreground">{t('studio.build.localFix') || 'Proposed Fixes'}</span>
                </div>
                <div className="space-y-3 text-[11px]">
                  {fixResult.fixes && fixResult.fixes.length > 0 ? (
                    fixResult.fixes.map((fix, i) => (
                      <div key={i} className="rounded border border-border/50 p-2 bg-background/50">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-medium text-foreground">{fix.file}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${fix.confidence > 0.7 ? 'bg-emerald-400/20 text-emerald-400' : fix.confidence > 0.4 ? 'bg-amber-400/20 text-amber-400' : 'bg-rose-400/20 text-rose-400'}`}>
                            {Math.round(fix.confidence * 100)}%
                          </span>
                        </div>
                        <p className="text-muted-foreground/80 text-[10px] mb-2">{fix.explanation}</p>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div className="rounded bg-rose-400/10 p-2">
                            <div className="font-medium text-rose-400 mb-1">{t('studio.build.localOldCode') || 'Old Code'}</div>
                            <pre className="font-mono whitespace-pre-wrap overflow-auto max-h-32"><code>{fix.oldCode}</code></pre>
                          </div>
                          <div className="rounded bg-emerald-400/10 p-2">
                            <div className="font-medium text-emerald-400 mb-1">{t('studio.build.localNewCode') || 'New Code'}</div>
                            <pre className="font-mono whitespace-pre-wrap overflow-auto max-h-32"><code>{fix.newCode}</code></pre>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-center py-4">{t('studio.build.localNoFixes') || 'No fixes proposed'}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Token Usage Gauge (Phase 32) */}
      <div className="shrink-0 border-b border-border bg-secondary/50 p-3">
        <TokenUsageGauge
          workspaceId={workspaceId}
          className="w-full"
        />
      </div>

      {/* Compaction History (Phase 32) */}
      <div className="shrink-0 border-b border-border bg-secondary/50 p-3">
        <CompactionHistory
          projectId={workspaceId}
          className="w-full"
        />
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

interface ExportManifest {
  timestamp: string;
  version: string;
  projectId: string;
  workspaceId: string;
  fileCount: number;
  totalSize: number;
  files: Array<{
    path: string;
    size: number;
    type: "file" | "directory";
    modified?: string;
  }>;
  checkpoints?: Array<{
    id: string;
    iteration: number;
    completed: number;
    createdAt: string;
  }>;
  snapshots?: Array<{
    id: string;
    iteration: number;
    sizeBytes: number;
    createdAt: string;
  }>;
  telemetryEventCount?: number;
}

interface ShareResponse {
  ok: boolean;
  shareUrl?: string;
  shareToken?: string;
  expiresAt?: string;
  error?: string;
}

interface CloneResponse {
  ok: boolean;
  targetProjectId?: string;
  worktreePath?: string;
  branch?: string;
  checkpointId?: string;
  error?: string;
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const apiJson = async <T,>(url: string, init?: RequestInit): Promise<{ response: Response; data: T }> => {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T;
  return { response, data };
};