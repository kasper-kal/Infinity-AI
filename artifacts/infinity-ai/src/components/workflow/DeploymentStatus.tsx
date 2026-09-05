/**
 * DeploymentStatus — Shows deployment result with URL, logs, and verification status
 */

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { CheckCircle, AlertCircle, ExternalLink, Copy, Loader2, Terminal, Server, Globe, Shield, Database } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface DeploymentStatusProps {
  result: any;
  t: any;
}

export const DeploymentStatus: React.FC<DeploymentStatusProps> = ({ result, t }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const fetchLogs = useCallback(async () => {
    if (!result?.deploymentId) return;
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/infinity/workflow/${result.workflowId}/deployment/${result.deploymentId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  }, [result?.workflowId, result?.deploymentId]);

  useEffect(() => {
    if (result?.deploymentId) {
      fetchLogs();
    }
  }, [fetchLogs]);

  const statusConfig = {
    success: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10', label: t('workflow.deployStatus.success') },
    failed: { icon: AlertCircle, color: 'text-destructive', bg: 'bg-destructive/10', label: t('workflow.deployStatus.failed') },
    running: { icon: Loader2, color: 'text-brand-400', bg: 'bg-brand-500/10', label: t('workflow.deployStatus.running') },
    pending: { icon: Loader2, color: 'text-muted-foreground', bg: 'bg-muted', label: t('workflow.deployStatus.pending') },
  };

  const status = result?.status || 'pending';
  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${config.bg}`}>
          <StatusIcon className={`w-6 h-6 ${config.color} ${status === 'running' ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">{config.label}</span>
            {result?.url && (
              <Badge variant="success" className="text-sm">
                <Globe className="w-3 h-3 mr-1" />
                {t('workflow.live')}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {result?.provider ? `${t('workflow.provider')}: ${result.provider}` : ''}
            {result?.deploymentId && ` • ${t('workflow.deploymentId')}: ${result.deploymentId.slice(0, 8)}...`}
          </p>
        </div>
        {result?.url && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => window.open(result.url, '_blank')}
            className="flex-shrink-0"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {t('workflow.openSite')}
          </Button>
        )}
      </div>

      {/* Key Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard
          label={t('workflow.url')}
          value={result?.url || t('workflow.notAvailable')}
          icon={<Globe className="w-5 h-5" />}
          action={result?.url ? () => copyToClipboard(result.url, t('workflow.url')) : null}
          actionLabel={copied === t('workflow.url') ? t('common.copied') : t('common.copy')}
          t={t}
        />
        <InfoCard
          label={t('workflow.provider')}
          value={result?.provider || t('workflow.notAvailable')}
          icon={<Server className="w-5 h-5" />}
          t={t}
        />
        <InfoCard
          label={t('workflow.database')}
          value={result?.database || t('workflow.notAvailable')}
          icon={<Database className="w-5 h-5" />}
          t={t}
        />
        <InfoCard
          label={t('workflow.ssl')}
          value={result?.ssl ? t('workflow.enabled') : t('workflow.disabled')}
          icon={<Shield className="w-5 h-5" />}
          t={t}
        />
      </div>

      {/* Tabs for details */}
      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="summary">{t('workflow.summary')}</TabsTrigger>
          <TabsTrigger value="logs">{t('workflow.logs')}</TabsTrigger>
          <TabsTrigger value="config">{t('workflow.configuration')}</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <div className="space-y-3">
            <h4 className="font-medium">{t('workflow.deploymentSummary')}</h4>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('workflow.workflowId')}</dt>
                <dd className="font-mono">{result?.workflowId?.slice(0, 12)}...</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('workflow.deploymentId')}</dt>
                <dd className="font-mono">{result?.deploymentId?.slice(0, 12)}...</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('workflow.startedAt')}</dt>
                <dd>{result?.startedAt ? new Date(result.startedAt).toLocaleString() : t('workflow.unknown')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('workflow.completedAt')}</dt>
                <dd>{result?.completedAt ? new Date(result.completedAt).toLocaleString() : t('workflow.unknown')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('workflow.duration')}</dt>
                <dd>{result?.duration ? `${(result.duration / 1000).toFixed(1)}s` : t('workflow.unknown')}</dd>
              </div>
            </dl>
          </div>

          {result?.environment && (
            <div className="space-y-2">
              <h4 className="font-medium">{t('workflow.environmentVariables')}</h4>
              <div className="p-3 bg-muted rounded font-mono text-sm max-h-40 overflow-y-auto">
                {Object.entries(result.environment).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground">{key}</span>
                    <span>{typeof value === 'string' && value.length > 20 ? value.slice(0, 20) + '...' : value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">{t('workflow.deploymentLogs')}</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchLogs}
              disabled={loadingLogs}
            >
              <Loader2 className={`w-4 h-4 mr-1 ${loadingLogs ? 'animate-spin' : ''}`} />
              {loadingLogs ? t('common.loading') : t('workflow.refreshLogs')}
            </Button>
          </div>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm max-h-96 overflow-y-auto">
            {logs.length > 0 ? (
              logs.map((log, i) => (
                <div key={i} className="text-muted-foreground">{log}</div>
              ))
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                {loadingLogs ? t('workflow.loadingLogs') : t('workflow.noLogsYet')}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="config" className="mt-4 space-y-4">
          {result?.config && (
            <div className="space-y-3">
              <h4 className="font-medium">{t('workflow.deploymentConfig')}</h4>
              <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(result.config, null, 2)}
              </pre>
            </div>
          )}

          {result?.buildConfig && (
            <div className="space-y-3">
              <h4 className="font-medium">{t('workflow.buildConfig')}</h4>
              <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(result.buildConfig, null, 2)}
              </pre>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

interface InfoCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  action?: () => void;
  actionLabel?: string;
  t: any;
}

const InfoCard: React.FC<InfoCardProps> = ({ label, value, icon, action, actionLabel, t }) => (
  <Card className="p-4">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-mono text-sm truncate">{value}</div>
      </div>
      {action && (
        <Button
          variant="ghost"
          size="sm"
          onClick={action}
          className="flex-shrink-0 h-8 w-8 p-0"
        >
          {actionLabel === t('common.copied') ? (
            <CheckCircle className="w-4 h-4 text-green-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      )}
    </div>
  </Card>
);

export default DeploymentStatus;