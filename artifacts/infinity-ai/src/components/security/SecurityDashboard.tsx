import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Key,
  Lock,
  Scan,
  ScanLine,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RotateCcw,
  Ban,
  Undo2,
  Package,
  FileSearch,
  ChevronDown,
  Check,
  Cpu,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

// ============================================================================
// TYPES
// ============================================================================

interface SecurityFinding {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  filePath: string;
  line: number;
  column: number;
  message: string;
  snippet?: string;
  confidence: number;
  falsePositive: boolean;
  suppressed: boolean;
}

interface DependencyVulnerability {
  id: string;
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  cve?: string;
  fixedIn?: string;
  url?: string;
}

interface SecretSummary {
  id: string;
  projectId: string;
  key: string;
  environment: 'development' | 'staging' | 'production';
  description?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
  hasValue: boolean;
}

interface DetectedSecret {
  type: string;
  value: string;
  filePath: string;
  line: number;
  column: number;
  confidence: number;
}

interface Suppression {
  id: string;
  ruleId?: string;
  filePath?: string;
  reason: string;
  createdAt: string;
  expiresAt?: string;
}

type SecurityTab = 'scanner' | 'secrets' | 'dependencies' | 'suppressions';

// ============================================================================
// COMPONENT
// ============================================================================

export function SecurityDashboard({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SecurityTab>('scanner');

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-1 border-b border-border bg-card p-2">
        {([
          { id: 'scanner', label: t('security.tabs.scanner'), icon: ScanLine },
          { id: 'secrets', label: t('security.tabs.secrets'), icon: Key },
          { id: 'dependencies', label: t('security.tabs.dependencies'), icon: Package },
          { id: 'suppressions', label: t('security.tabs.suppressions'), icon: Ban },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === tab.id
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]'
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'scanner' && <ScannerTab workspaceId={workspaceId} />}
        {activeTab === 'secrets' && <SecretsTab workspaceId={workspaceId} />}
        {activeTab === 'dependencies' && <DependenciesTab workspaceId={workspaceId} />}
        {activeTab === 'suppressions' && <SuppressionsTab workspaceId={workspaceId} />}
      </div>
    </div>
  );
}

// ============================================================================
// SCANNER TAB
// ============================================================================

function ScannerTab({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [gatePassed, setGatePassed] = useState<boolean | null>(null);
  const [semgrepAvailable, setSemgrepAvailable] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { response, data } = await apiJson<{
        findings: SecurityFinding[];
        gatePassed: boolean;
        semgrepAvailable: boolean;
      }>('/api/infinity/security/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (response.ok) {
        setFindings(data.findings ?? []);
        setGatePassed(data.gatePassed);
        setSemgrepAvailable(data.semgrepAvailable);
        setLastRun(new Date().toISOString());
      } else {
        setError('Failed to run security scan');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const suppressFinding = useCallback(async (finding: SecurityFinding, unsuppress: boolean) => {
    try {
      await apiJson(`/api/infinity/security/suppress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          ruleId: finding.ruleId,
          filePath: finding.filePath,
          reason: unsuppress ? '' : 'Manual suppression from dashboard',
        }),
      });
      setFindings((prev) =>
        prev.map((f) => (f.id === finding.id ? { ...f, suppressed: !unsuppress } : f))
      );
    } catch (err) {
      console.error('[Security] suppress failed', err);
    }
  }, [workspaceId]);

  const markFalsePositive = useCallback(async (finding: SecurityFinding) => {
    try {
      await apiJson(`/api/infinity/security/false-positive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          findingId: finding.id,
          isFalsePositive: !finding.falsePositive,
        }),
      });
      setFindings((prev) =>
        prev.map((f) => (f.id === finding.id ? { ...f, falsePositive: !f.falsePositive } : f))
      );
    } catch (err) {
      console.error('[Security] false positive mark failed', err);
    }
  }, [workspaceId]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  const severityColor: Record<SecurityFinding['severity'], string> = {
    critical: 'text-rose-400 bg-rose-400/10',
    high: 'text-orange-400 bg-orange-400/10',
    medium: 'text-amber-400 bg-amber-400/10',
    low: 'text-yellow-400 bg-yellow-400/10',
    info: 'text-blue-400 bg-blue-400/10',
  };

  const severityCount = findings.reduce((acc, f) => {
    if (!f.suppressed && !f.falsePositive) {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border bg-card p-3">
        <button
          type="button"
          onClick={runScan}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scan className="h-3.5 w-3.5" />}
          {loading ? t('security.scanner.running') : t('security.scanner.run')}
        </button>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastRun && (
            <span>{t('security.scanner.lastRun')}: {new Date(lastRun).toLocaleTimeString()}</span>
          )}
          <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            semgrepAvailable ? 'bg-emerald-400/10 text-emerald-400' : 'bg-amber-400/10 text-amber-400'
          }`}>
            {semgrepAvailable ? t('security.scanner.semgrepAvailable') : t('security.scanner.semgrepUnavailable')}
          </span>
        </div>

        <div className="flex-1" />

        {gatePassed !== null && (
          <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            gatePassed ? 'bg-emerald-400/10 text-emerald-400' : 'bg-rose-400/10 text-rose-400'
          }`}>
            {gatePassed ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {gatePassed ? t('security.scanner.gate.pass') : t('security.scanner.gate.fail')}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 m-3 rounded-lg bg-rose-400/10 border border-rose-400/30 px-3 py-2 text-xs text-rose-400">
          {error}
        </div>
      )}

      {/* Severity summary */}
      {findings.length > 0 && (
        <div className="shrink-0 grid grid-cols-5 gap-2 p-3">
          {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => (
            <div key={sev} className={`rounded-lg p-2 text-center ${severityColor[sev]}`}>
              <div className="text-lg font-bold">{(severityCount[sev] ?? 0)}</div>
              <div className="text-[10px] uppercase tracking-wider">{t(`security.scanner.severity.${sev}` as any)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Findings list */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {t('security.scanner.running')}
          </div>
        ) : findings.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground p-4">
            <div>
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
              {t('security.scanner.noResults')}
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {findings.map((finding) => (
              <div
                key={finding.id}
                className={`rounded-lg border border-border bg-card p-3 ${
                  finding.suppressed || finding.falsePositive ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityColor[finding.severity]}`}>
                    {t(`security.scanner.severity.${finding.severity}` as any)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground">{finding.ruleName}</span>
                      {finding.falsePositive && (
                        <span className="rounded bg-blue-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-blue-400">
                          {t('security.scanner.falsePositive')}
                        </span>
                      )}
                      {finding.suppressed && (
                        <span className="rounded bg-gray-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-gray-400">
                          {t('security.scanner.suppress')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{finding.message}</p>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                      <span>{finding.filePath}:{finding.line}</span>
                      <span>{t('security.scanner.confidence')}: {Math.round(finding.confidence * 100)}%</span>
                    </div>
                    {finding.snippet && (
                      <pre className="mt-2 rounded bg-background p-2 text-[10px] font-mono text-foreground/80 overflow-x-auto">
                        {finding.snippet}
                      </pre>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => suppressFinding(finding, finding.suppressed)}
                      className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-white/[0.06]"
                      title={finding.suppressed ? t('security.scanner.unsuppress') : t('security.scanner.suppress')}
                    >
                      {finding.suppressed ? <Undo2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => markFalsePositive(finding)}
                      className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-white/[0.06]"
                      title={t('security.scanner.falsePositive')}
                    >
                      {finding.falsePositive ? <XCircle className="h-3.5 w-3.5 text-blue-400" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SECRETS TAB
// ============================================================================

function SecretsTab({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [detected, setDetected] = useState<DetectedSecret[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [loadingDetect, setLoadingDetect] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState({
    key: '',
    value: '',
    environment: 'development' as SecretSummary['environment'],
    description: '',
    category: 'other',
  });
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<string>('');

  const fetchSecrets = useCallback(async () => {
    setLoadingSecrets(true);
    try {
      const { response, data } = await apiJson<{ secrets: SecretSummary[] }>(
        `/api/infinity/security/secrets/${encodeURIComponent(workspaceId)}`
      );
      if (response.ok) setSecrets(data.secrets ?? []);
    } catch (err) {
      console.error('[Security] fetch secrets failed', err);
    } finally {
      setLoadingSecrets(false);
    }
  }, [workspaceId]);

  const runDetection = useCallback(async () => {
    setLoadingDetect(true);
    try {
      const { response, data } = await apiJson<{ detected: DetectedSecret[] }>(
        `/api/infinity/security/secrets/${encodeURIComponent(workspaceId)}/detect`,
        { method: 'POST' }
      );
      if (response.ok) setDetected(data.detected ?? []);
    } catch (err) {
      console.error('[Security] detect secrets failed', err);
    } finally {
      setLoadingDetect(false);
    }
  }, [workspaceId]);

  const createSecret = useCallback(async () => {
    if (!newSecret.key || !newSecret.value) return;
    try {
      const { response } = await apiJson(`/api/infinity/security/secrets/${encodeURIComponent(workspaceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSecret),
      });
      if (response.ok) {
        setNewSecret({ key: '', value: '', environment: 'development', description: '', category: 'other' });
        setShowCreate(false);
        fetchSecrets();
      }
    } catch (err) {
      console.error('[Security] create secret failed', err);
    }
  }, [newSecret, workspaceId, fetchSecrets]);

  const deleteSecret = useCallback(async (id: string) => {
    try {
      const { response } = await apiJson(`/api/infinity/security/secrets/${encodeURIComponent(workspaceId)}/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) fetchSecrets();
    } catch (err) {
      console.error('[Security] delete secret failed', err);
    }
  }, [workspaceId, fetchSecrets]);

  const rotateSecret = useCallback(async (id: string, provider: string) => {
    try {
      await apiJson(`/api/infinity/security/secrets/${encodeURIComponent(workspaceId)}/${id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      fetchSecrets();
    } catch (err) {
      console.error('[Security] rotate secret failed', err);
    }
  }, [workspaceId, fetchSecrets]);

  const revealSecret = useCallback(async (id: string) => {
    try {
      const { response, data } = await apiJson<{ value: string }>(
        `/api/infinity/security/secrets/${encodeURIComponent(workspaceId)}/${id}/value`
      );
      if (response.ok) {
        setRevealedId(id);
        setRevealedValue(data.value ?? '');
      }
    } catch (err) {
      console.error('[Security] reveal secret failed', err);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSecrets();
    runDetection();
  }, [fetchSecrets, runDetection]);

  const envColor: Record<SecretSummary['environment'], string> = {
    development: 'text-blue-400 bg-blue-400/10',
    staging: 'text-amber-400 bg-amber-400/10',
    production: 'text-rose-400 bg-rose-400/10',
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border bg-card p-3">
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('security.secrets.create')}
        </button>
        <button
          type="button"
          onClick={runDetection}
          disabled={loadingDetect}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
        >
          {loadingDetect ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
          {t('security.secrets.detectRun')}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground font-medium">
          {t('security.secrets.neverExposed')}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-4">
        {/* Create form */}
        {showCreate && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">{t('security.secrets.key')}</label>
                <input
                  value={newSecret.key}
                  onChange={(e) => setNewSecret({ ...newSecret, key: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  placeholder="DATABASE_URL"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">{t('security.secrets.environment')}</label>
                <select
                  value={newSecret.environment}
                  onChange={(e) => setNewSecret({ ...newSecret, environment: e.target.value as SecretSummary['environment'] })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="development">{t('security.secrets.env.development')}</option>
                  <option value="staging">{t('security.secrets.env.staging')}</option>
                  <option value="production">{t('security.secrets.env.production')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">{t('security.secrets.value')}</label>
              <input
                type="password"
                value={newSecret.value}
                onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground font-mono"
                placeholder="••••••••"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">{t('security.secrets.description')}</label>
                <input
                  value={newSecret.description}
                  onChange={(e) => setNewSecret({ ...newSecret, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">{t('security.secrets.category')}</label>
                <select
                  value={newSecret.category}
                  onChange={(e) => setNewSecret({ ...newSecret, category: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="database">{t('security.secrets.categories.database')}</option>
                  <option value="api">{t('security.secrets.categories.api')}</option>
                  <option value="auth">{t('security.secrets.categories.auth')}</option>
                  <option value="storage">{t('security.secrets.categories.storage')}</option>
                  <option value="other">{t('security.secrets.categories.other')}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={createSecret}
                disabled={!newSecret.key || !newSecret.value}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {t('security.secrets.create')}
              </button>
            </div>
          </div>
        )}

        {/* Detected secrets warning */}
        {detected.length > 0 && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400">{t('security.secrets.detectTitle')}</span>
              <span className="ml-auto rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                {detected.length} {t('security.secrets.detected')}
              </span>
            </div>
            <div className="space-y-1">
              {detected.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                  <span className="rounded bg-rose-400/10 px-1.5 py-0.5 text-rose-400">{d.type}</span>
                  <span className="flex-1 truncate">{d.filePath}:{d.line}</span>
                  <span className="text-amber-400">{Math.round(d.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Secrets list */}
        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            {t('security.secrets.list')}
          </h4>
          {loadingSecrets ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          ) : secrets.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-4 text-center text-xs text-muted-foreground">
              {t('security.secrets.noSecrets')}
            </div>
          ) : (
            <div className="space-y-2">
              {secrets.map((secret) => (
                <div key={secret.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-3">
                    <Lock className="h-4 w-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground font-mono">{secret.key}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${envColor[secret.environment]}`}>
                          {t(`security.secrets.env.${secret.environment}` as any)}
                        </span>
                      </div>
                      {secret.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{secret.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      {revealedId === secret.id ? (
                        <span className="text-[10px] font-mono text-emerald-400 max-w-[150px] truncate">{revealedValue}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => revealSecret(secret.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-white/[0.06]"
                          title={t('security.secrets.decrypt')}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => rotateSecret(secret.id, 'generic')}
                        className="rounded p-1 text-muted-foreground hover:bg-white/[0.06]"
                        title={t('security.secrets.rotate')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSecret(secret.id)}
                        className="rounded p-1 text-rose-400 hover:bg-rose-400/10"
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DEPENDENCIES TAB
// ============================================================================

function DependenciesTab({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [vulnerabilities, setVulnerabilities] = useState<DependencyVulnerability[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastAudit, setLastAudit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { response, data } = await apiJson<{ vulnerabilities: DependencyVulnerability[] }>(
        `/api/infinity/security/dependencies/audit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId }),
        }
      );
      if (response.ok) {
        setVulnerabilities(data.vulnerabilities ?? []);
        setLastAudit(new Date().toISOString());
      } else {
        setError('Dependency audit failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    runAudit();
  }, [runAudit]);

  const severityColor: Record<DependencyVulnerability['severity'], string> = {
    critical: 'text-rose-400 bg-rose-400/10',
    high: 'text-orange-400 bg-orange-400/10',
    medium: 'text-amber-400 bg-amber-400/10',
    low: 'text-yellow-400 bg-yellow-400/10',
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border bg-card p-3">
        <button
          type="button"
          onClick={runAudit}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
          {loading ? t('security.dependencies.auditing') : t('security.dependencies.audit')}
        </button>
        {lastAudit && (
          <span className="text-xs text-muted-foreground">
            {t('security.scanner.lastRun')}: {new Date(lastAudit).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="shrink-0 m-3 rounded-lg bg-rose-400/10 border border-rose-400/30 px-3 py-2 text-xs text-rose-400">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {t('security.dependencies.auditing')}
          </div>
        ) : vulnerabilities.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground p-4">
            <div>
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
              {t('security.scanner.noResults')}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {vulnerabilities.map((vuln) => (
              <div key={vuln.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityColor[vuln.severity]}`}>
                    {vuln.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground font-mono">{vuln.package}</span>
                      <span className="text-[10px] text-muted-foreground">@{vuln.version}</span>
                      {vuln.cve && (
                        <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                          {vuln.cve}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{vuln.title}</p>
                    {vuln.fixedIn && (
                      <p className="text-[10px] text-emerald-400">
                        {t('security.dependencies.fixedIn')}: {vuln.fixedIn}
                      </p>
                    )}
                  </div>
                  {vuln.url && (
                    <a
                      href={vuln.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/[0.06]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SUPPRESSIONS TAB
// ============================================================================

function SuppressionsTab({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newSuppression, setNewSuppression] = useState({
    ruleId: '',
    filePath: '',
    reason: '',
    expiresAt: '',
  });

  const fetchSuppressions = useCallback(async () => {
    setLoading(true);
    try {
      const { response, data } = await apiJson<{ suppressions: Suppression[] }>(
        `/api/infinity/security/suppressions/${encodeURIComponent(workspaceId)}`
      );
      if (response.ok) setSuppressions(data.suppressions ?? []);
    } catch (err) {
      console.error('[Security] fetch suppressions failed', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const addSuppression = useCallback(async () => {
    if (!newSuppression.reason) return;
    try {
      const { response } = await apiJson(`/api/infinity/security/suppressions/${encodeURIComponent(workspaceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSuppression),
      });
      if (response.ok) {
        setNewSuppression({ ruleId: '', filePath: '', reason: '', expiresAt: '' });
        setShowAdd(false);
        fetchSuppressions();
      }
    } catch (err) {
      console.error('[Security] add suppression failed', err);
    }
  }, [newSuppression, workspaceId, fetchSuppressions]);

  const removeSuppression = useCallback(async (id: string) => {
    try {
      const { response } = await apiJson(`/api/infinity/security/suppressions/${encodeURIComponent(workspaceId)}/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) fetchSuppressions();
    } catch (err) {
      console.error('[Security] remove suppression failed', err);
    }
  }, [workspaceId, fetchSuppressions]);

  useEffect(() => {
    fetchSuppressions();
  }, [fetchSuppressions]);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border bg-card p-3">
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('security.secrets.addSuppression')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {showAdd && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">{t('security.scanner.rule')}</label>
                <input
                  value={newSuppression.ruleId}
                  onChange={(e) => setNewSuppression({ ...newSuppression, ruleId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  placeholder="optional"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">{t('security.scanner.file')}</label>
                <input
                  value={newSuppression.filePath}
                  onChange={(e) => setNewSuppression({ ...newSuppression, filePath: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  placeholder="optional"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">{t('security.secrets.suppressReason')}</label>
              <textarea
                value={newSuppression.reason}
                onChange={(e) => setNewSuppression({ ...newSuppression, reason: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={addSuppression}
                disabled={!newSuppression.reason}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {t('security.secrets.addSuppression')}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : suppressions.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-center text-xs text-muted-foreground">
            {t('security.secrets.noSecrets')}
          </div>
        ) : (
          <div className="space-y-2">
            {suppressions.map((supp) => (
              <div key={supp.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <Ban className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground">{supp.reason}</p>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1">
                      {supp.ruleId && <span className="font-mono">{supp.ruleId}</span>}
                      {supp.filePath && <span className="font-mono truncate">{supp.filePath}</span>}
                      <span>{new Date(supp.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSuppression(supp.id)}
                    className="shrink-0 rounded p-1 text-rose-400 hover:bg-rose-400/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// API HELPER
// ============================================================================

const apiJson = async <T,>(url: string, init?: RequestInit): Promise<{ response: Response; data: T }> => {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T;
  return { response, data };
};

// External link icon for dependencies
function ExternalLink(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
