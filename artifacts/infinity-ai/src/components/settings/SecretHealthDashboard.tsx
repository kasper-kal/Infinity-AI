/**
 * Secret Health Dashboard — Visual health status for LLM API keys
 *
 * Displays keys grouped by provider with health indicators,
 * priority, last used, and action buttons for health checks/rotation.
 */

import React, { useState } from "react";
import { Button, Badge, IconButton } from "@/components/ui";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export interface SecretHealthDashboardProps {
  /** Array of LLM secrets from the API */
  secrets: Array<{
    id: string;
    provider: string;
    model?: string;
    name: string;
    health: 'healthy' | 'cooling' | 'quarantined';
    priority: number;
    source: 'user-api' | 'project-pool' | 'global-pool';
    lastUsed?: string;
    lastHealthCheck: string;
    coolingUntil?: string;
    quarantineReason?: string;
    rotationCount: number;
    metadata: Record<string, unknown>;
    accountId?: string;
    scopes?: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  /** Callback when health check is requested */
  onHealthCheck: (id: string) => void;
  /** Callback when rotation is requested */
  onRotate: (id: string) => void;
  /** Callback when edit is requested */
  onEdit: (secret: SecretHealthDashboardProps['secrets'][0]) => void;
  /** Callback when delete is requested */
  onDelete: (id: string) => void;
  /** Project ID for project-scoped operations */
  projectId?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google (Gemini)',
  groq: 'Groq',
  custom: 'Custom',
};

const HEALTH_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  cooling: 'Cooling',
  quarantined: 'Quarantined',
};

const HEALTH_VARIANTS: Record<'healthy' | 'cooling' | 'quarantined', 'default' | 'secondary' | 'destructive' | 'outline'> = {
  healthy: 'default',
  cooling: 'secondary',
  quarantined: 'destructive',
};

const SOURCE_LABELS: Record<string, string> = {
  'user-api': 'User API Key',
  'project-pool': 'Project Pool',
  'global-pool': 'Global Pool',
};

const getProviderIcon = (provider: string) => {
  switch (provider) {
    case 'openai':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      );
    case 'anthropic':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      );
    case 'google':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.545 10.239v3.821h5.445c-.871 2.287-3.434 3.997-6.545 3.997-3.972 0-7.2-3.228-7.2-7.2s3.228-7.2 7.2-7.2c2.163 0 3.945.964 5.197 2.357l3.337-3.337C19.554 1.283 16.401 0 12.545 0 7.181 0 2.903 4.36 2.415 9.757l5.493 1.624c.471-2.637 2.79-4.638 5.637-4.638 3.524 0 6.369 2.92 6.369 6.522 0 2.15-.96 3.934-2.396 5.076z"/>
        </svg>
      );
    case 'groq':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
  }
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return 'Never';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'Just now';
  } catch {
    return 'Unknown';
  }
};

const getHealthIndicator = (health: 'healthy' | 'cooling' | 'quarantined') => {
  const colors = {
    healthy: 'bg-green-500',
    cooling: 'bg-yellow-500',
    quarantined: 'bg-red-500',
  };
  return <span className={`w-2 h-2 rounded-full ${colors[health]}`} aria-hidden="true" />;
};

export const SecretHealthDashboard: React.FC<SecretHealthDashboardProps> = ({
  secrets,
  onHealthCheck,
  onRotate,
  onEdit,
  onDelete,
  projectId,
}) => {
  const { t } = useI18n();
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  // Group secrets by provider
  const secretsByProvider = secrets.reduce((acc, secret) => {
    if (!acc[secret.provider]) {
      acc[secret.provider] = [];
    }
    acc[secret.provider].push(secret);
    return acc;
  }, {} as Record<string, typeof secrets>);

  const providerKeys = Object.keys(secretsByProvider);

  if (providerKeys.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 opacity-50">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
        <p className="text-lg">No LLM API keys configured</p>
        <p className="text-sm">Add keys to enable AI self-management</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {providerKeys.map((provider) => {
        const providerSecrets = secretsByProvider[provider];
        const isExpanded = expandedProviders.has(provider);
        const healthyCount = providerSecrets.filter(s => s.health === 'healthy').length;
        const coolingCount = providerSecrets.filter(s => s.health === 'cooling').length;
        const quarantinedCount = providerSecrets.filter(s => s.health === 'quarantined').length;

        return (
          <div key={provider} className="border border-border-primary/50 rounded-lg overflow-hidden">
            {/* Provider Header */}
            <button
              onClick={() => {
                setExpandedProviders(prev => {
                  const next = new Set(prev);
                  if (next.has(provider)) next.delete(provider);
                  else next.add(provider);
                  return next;
                });
                haptics.light();
              }}
              className="w-full p-4 flex items-center justify-between gap-4 hover:bg-bg-elevated/30 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-accent/10 text-accent-foreground">
                  {getProviderIcon(provider)}
                </span>
                <div>
                  <h4 className="font-medium">{PROVIDER_LABELS[provider] || provider}</h4>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{providerSecrets.length} key{providerSecrets.length !== 1 ? 's' : ''}</span>
                    {healthyCount > 0 && <Badge variant="default" className="text-xs">{healthyCount} healthy</Badge>}
                    {coolingCount > 0 && <Badge variant="secondary" className="text-xs">{coolingCount} cooling</Badge>}
                    {quarantinedCount > 0 && <Badge variant="destructive" className="text-xs">{quarantinedCount} quarantined</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </button>

            {/* Provider Secrets - Collapsible */}
            <div
              style={{
                maxHeight: isExpanded ? '1000px' : '0',
                opacity: isExpanded ? 1 : 0,
                overflow: 'hidden',
                transition: 'max-height 0.3s ease, opacity 0.2s ease',
              }}
            >
              <div className="px-4 pb-4 space-y-3 border-t border-border-primary/30">
                {providerSecrets.map((secret) => (
                  <div
                    key={secret.id}
                    className="p-4 rounded-lg border border-border-primary/50 bg-bg-elevated/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <h5 className="font-medium truncate">{secret.name}</h5>
                          <Badge variant={HEALTH_VARIANTS[secret.health]}>
                            <span className="flex items-center gap-1">
                              {getHealthIndicator(secret.health)}
                              {HEALTH_LABELS[secret.health]}
                            </span>
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            Priority: {secret.priority}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {SOURCE_LABELS[secret.source] || secret.source}
                          </Badge>
                        </div>

                        {secret.model && (
                          <div className="text-sm text-muted-foreground mb-1">
                            Model: <code className="bg-bg-elevated/50 px-1 rounded">{secret.model}</code>
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                          <span>Last used: {formatDate(secret.lastUsed)}</span>
                          <span>Health check: {formatDate(secret.lastHealthCheck)}</span>
                          <span>Rotations: {secret.rotationCount}</span>
                          {secret.coolingUntil && (
            <span className="text-yellow-500">
              Cooling until: {formatDate(secret.coolingUntil)}
            </span>
          )}
                          {secret.quarantineReason && (
            <span className="text-red-500">
              Quarantined: {secret.quarantineReason}
            </span>
          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onHealthCheck(secret.id)}
                          disabled={secret.health === 'quarantined'}
                          title="Run health check"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                          </svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRotate(secret.id)}
                          disabled={secret.health === 'quarantined'}
                          title="Rotate key"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                          </svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(secret)}
                          title="Edit"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:bg-red-500/10"
                          onClick={() => onDelete(secret.id)}
                          title="Delete"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SecretHealthDashboard;