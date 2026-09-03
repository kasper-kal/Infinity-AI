/**
 * AI Management Tab — Settings UI for AI Self-Management
 *
 * Provides UI for:
 * - LLM API Key health dashboard (SecretHealthDashboard)
 * - AI-proposed settings changes with confirmation workflow
 * - Adding/managing LLM API keys
 * - Health check and rotation actions
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, IconButton, Input, Select, Dialog, AlertDialog, Tabs, TabsList, TabsTrigger, TabsContent, Badge } from "@/components/ui";
import { SecretHealthDashboard, SecretHealthDashboardProps } from "./SecretHealthDashboard";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export interface AIManagementTabProps {
  /** Project ID for project-scoped settings/secrets */
  projectId?: string;
}

/** LLM Secret (API Key) from backend */
interface LLMSecret {
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
}

/** AI-proposed setting change */
interface SettingProposal {
  id: string;
  key: string;
  currentValue: unknown;
  proposedValue: unknown;
  reasoning: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  expiresAt?: string;
}

/** AI-proposed secret operation */
interface SecretProposal {
  id: string;
  operation: 'create' | 'rotate' | 'delete' | 'update-health';
  secretId?: string;
  provider?: string;
  model?: string;
  name?: string;
  reasoning: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  expiresAt?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google (Gemini)',
  groq: 'Groq',
  custom: 'Custom',
};

const HEALTH_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  healthy: 'default',
  cooling: 'secondary',
  quarantined: 'destructive',
};

const SOURCE_LABELS: Record<string, string> = {
  'user-api': 'User API Key',
  'project-pool': 'Project Pool',
  'global-pool': 'Global Pool',
};

export const AIManagementTab: React.FC<AIManagementTabProps> = ({ projectId }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'secrets' | 'settings' | 'proposals'>('secrets');
  const [loading, setLoading] = useState(true);
  const [secrets, setSecrets] = useState<LLMSecret[]>([]);
  const [settingProposals, setSettingProposals] = useState<SettingProposal[]>([]);
  const [secretProposals, setSecretProposals] = useState<SecretProposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [addSecretDialogOpen, setAddSecretDialogOpen] = useState(false);
  const [editSecretId, setEditSecretId] = useState<string | null>(null);
  const [deleteSecretId, setDeleteSecretId] = useState<string | null>(null);

  // Form state for adding/editing secrets
  const [secretForm, setSecretForm] = useState({
    provider: 'openai',
    model: '',
    name: '',
    apiKey: '',
    priority: 0,
    source: 'project-pool' as 'user-api' | 'project-pool' | 'global-pool',
  });

  // Fetch all data on mount
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch secrets
      const secretsRes = await fetch(`/api/infinity/ai-management/secrets?projectId=${projectId || ''}`, {
        credentials: 'include',
      });
      if (secretsRes.ok) {
        const data = await secretsRes.json();
        setSecrets(data.secrets || []);
      } else {
        console.error('[AI Management] Failed to fetch secrets:', await secretsRes.text());
      }

      // Fetch setting proposals
      const settingsProposalsRes = await fetch(`/api/infinity/ai-management/settings/proposals?projectId=${projectId || ''}`, {
        credentials: 'include',
      });
      if (settingsProposalsRes.ok) {
        const data = await settingsProposalsRes.json();
        setSettingProposals(data.proposals || []);
      }

      // Fetch secret proposals
      const secretProposalsRes = await fetch(`/api/infinity/ai-management/secrets/proposals?projectId=${projectId || ''}`, {
        credentials: 'include',
      });
      if (secretProposalsRes.ok) {
        const data = await secretProposalsRes.json();
        setSecretProposals(data.proposals || []);
      }
    } catch (err) {
      console.error('[AI Management] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load AI management data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Secret management
  const handleAddSecret = async () => {
    try {
      const response = await fetch(`/api/infinity/ai-management/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          projectId,
          ...secretForm,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add secret');
      }

      setAddSecretDialogOpen(false);
      resetSecretForm();
      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Add secret error:', err);
      alert(err instanceof Error ? err.message : 'Failed to add secret');
    }
  };

  const handleUpdateSecret = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/secrets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          projectId,
          name: secretForm.name,
          priority: secretForm.priority,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update secret');
      }

      setEditSecretId(null);
      setAddSecretDialogOpen(false);
      resetSecretForm();
      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Update secret error:', err);
      alert(err instanceof Error ? err.message : 'Failed to update secret');
    }
  };

  const handleDeleteSecret = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/secrets/${id}?projectId=${projectId || ''}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete secret');
      }

      setDeleteSecretId(null);
      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Delete secret error:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete secret');
    }
  };

  const handleHealthCheck = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/secrets/${id}/health-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Health check failed');
      }

      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Health check error:', err);
      alert(err instanceof Error ? err.message : 'Health check failed');
    }
  };

  const handleRotateSecret = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/secrets/${id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Rotation failed');
      }

      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Rotate error:', err);
      alert(err instanceof Error ? err.message : 'Rotation failed');
    }
  };

  const handleEditSecret = (secret: LLMSecret) => {
    setSecretForm({
      provider: secret.provider,
      model: secret.model || '',
      name: secret.name,
      apiKey: '',
      priority: secret.priority,
      source: secret.source,
    });
    setEditSecretId(secret.id);
    setAddSecretDialogOpen(true);
  };

  const handleOpenDeleteSecret = (id: string) => {
    setDeleteSecretId(id);
  };

  const resetSecretForm = () => {
    setSecretForm({
      provider: 'openai',
      model: '',
      name: '',
      apiKey: '',
      priority: 0,
      source: 'project-pool',
    });
    setEditSecretId(null);
  };

  // Setting proposal actions
  const handleConfirmSettingProposal = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/settings/proposals/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to confirm proposal');
      }

      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Confirm setting proposal error:', err);
      alert(err instanceof Error ? err.message : 'Failed to confirm');
    }
  };

  const handleRejectSettingProposal = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/settings/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject proposal');
      }

      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Reject setting proposal error:', err);
      alert(err instanceof Error ? err.message : 'Failed to reject');
    }
  };

  // Secret proposal actions
  const handleConfirmSecretProposal = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/secrets/proposals/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to confirm proposal');
      }

      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Confirm secret proposal error:', err);
      alert(err instanceof Error ? err.message : 'Failed to confirm');
    }
  };

  const handleRejectSecretProposal = async (id: string) => {
    try {
      const response = await fetch(`/api/infinity/ai-management/secrets/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject proposal');
      }

      await fetchAllData();
      haptics.success();
    } catch (err) {
      console.error('[AI Management] Reject secret proposal error:', err);
      alert(err instanceof Error ? err.message : 'Failed to reject');
    }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-500">
        <p>{error}</p>
        <Button variant="outline" className="mt-4" onClick={fetchAllData}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t('settings.aiManagement')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('settings.aiManagementDescription')}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="secrets">
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              {t('settings.llmKeys')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="settings">
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 17.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              {t('settings.aiProposedSettings')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="proposals">
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              {t('settings.proposedOperations')}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Secrets Tab */}
        <TabsContent value="secrets" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">{t('settings.llmKeys')}</h3>
            <Button onClick={() => { resetSecretForm(); setAddSecretDialogOpen(true); }} icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
              {t('settings.addKey')}
            </Button>
          </div>

          <SecretHealthDashboard
            secrets={secrets}
            onHealthCheck={handleHealthCheck}
            onRotate={handleRotateSecret}
            onEdit={handleEditSecret}
            onDelete={handleOpenDeleteSecret}
            projectId={projectId}
          />

          {/* Add/Edit Secret Dialog */}
          <Dialog
            open={addSecretDialogOpen}
            onClose={() => { setAddSecretDialogOpen(false); resetSecretForm(); }}
            title={editSecretId ? 'Edit LLM API Key' : 'Add LLM API Key'}
            description={editSecretId ? 'Update key configuration' : 'Add a new LLM API key to the pool'}
            size="lg"
          >
            <div className="space-y-4 max-w-lg">
              <Select
                label="Provider"
                value={secretForm.provider}
                onChange={(e) => setSecretForm(prev => ({ ...prev, provider: e.target.value }))}
                options={[
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'anthropic', label: 'Anthropic' },
                  { value: 'google', label: 'Google (Gemini)' },
                  { value: 'groq', label: 'Groq' },
                  { value: 'custom', label: 'Custom' },
                ]}
                fullWidth
              />
              <Input
                label="Model (optional)"
                value={secretForm.model}
                onChange={(e) => setSecretForm(prev => ({ ...prev, model: e.target.value }))}
                placeholder="e.g., gpt-4, claude-3-opus, gemini-pro"
                fullWidth
              />
              <Input
                label="Display Name"
                value={secretForm.name}
                onChange={(e) => setSecretForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Production OpenAI Key"
                fullWidth
                required
              />
              {!editSecretId && (
                <Input
                  label="API Key"
                  value={secretForm.apiKey}
                  onChange={(e) => setSecretForm(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-... or your API key"
                  type="password"
                  fullWidth
                  required
                />
              )}
              <Input
                label="Priority"
                type="number"
                value={secretForm.priority}
                onChange={(e) => setSecretForm(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                placeholder="0"
                fullWidth
                helperText="Higher priority keys are preferred for requests"
              />
              <Select
                label="Source"
                value={secretForm.source}
                onChange={(e) => setSecretForm(prev => ({ ...prev, source: e.target.value as 'user-api' | 'project-pool' | 'global-pool' }))}
                options={[
                  { value: 'project-pool', label: 'Project Pool' },
                  { value: 'global-pool', label: 'Global Pool' },
                  { value: 'user-api', label: 'User API Key' },
                ]}
                fullWidth
              />
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => { setAddSecretDialogOpen(false); resetSecretForm(); }}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={editSecretId ? () => handleUpdateSecret(editSecretId) : handleAddSecret}
                loading={editSecretId || addSecretDialogOpen}
              >
                {editSecretId ? 'Save Changes' : 'Add Key'}
              </Button>
            </div>
          </Dialog>

          {/* Delete Confirmation */}
          <AlertDialog
            open={!!deleteSecretId}
            onClose={() => setDeleteSecretId(null)}
            title={t('settings.deleteKey')}
            description="Are you sure? This cannot be undone."
            confirmText={t('common.delete')}
            cancelText={t('common.cancel')}
            onConfirm={() => deleteSecretId && handleDeleteSecret(deleteSecretId)}
            variant="danger"
          />
        </TabsContent>

        {/* Settings Proposals Tab */}
        <TabsContent value="settings" className="mt-4">
          <div className="space-y-4">
            <h3 className="text-lg font-medium">{t('settings.aiProposedSettings')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('settings.aiProposedSettingsDescription')}
            </p>

            {settingProposals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 opacity-50">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 17.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
                <p className="text-lg">No pending proposals</p>
                <p className="text-sm">AI will propose setting changes here for your review</p>
              </div>
            ) : (
              <div className="space-y-3">
                {settingProposals.map((proposal) => (
                  <ConfirmationDialog
                    key={proposal.id}
                    title={`Proposed: ${proposal.key}`}
                    description={proposal.reasoning}
                    details={{
                      current: JSON.stringify(proposal.currentValue, null, 2),
                      proposed: JSON.stringify(proposal.proposedValue, null, 2),
                    }}
                    status={proposal.status}
                    onConfirm={() => handleConfirmSettingProposal(proposal.id)}
                    onReject={() => handleRejectSettingProposal(proposal.id)}
                    confirmText={t('common.confirm')}
                    rejectText={t('common.reject')}
                    loading={proposal.status !== 'pending'}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Secret Proposals Tab */}
        <TabsContent value="proposals" className="mt-4">
          <div className="space-y-4">
            <h3 className="text-lg font-medium">{t('settings.proposedOperations')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('settings.proposedOperationsDescription')}
            </p>

            {secretProposals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 opacity-50">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <p className="text-lg">No pending operations</p>
                <p className="text-sm">AI will propose key operations here for your review</p>
              </div>
            ) : (
              <div className="space-y-3">
                {secretProposals.map((proposal) => (
                  <ConfirmationDialog
                    key={proposal.id}
                    title={`${proposal.operation.toUpperCase()}: ${proposal.provider || ''} ${proposal.model ? `(${proposal.model})` : ''} ${proposal.name ? `- ${proposal.name}` : ''}`}
                    description={proposal.reasoning}
                    details={{
                      operation: proposal.operation,
                      provider: proposal.provider,
                      model: proposal.model,
                      name: proposal.name,
                    }}
                    status={proposal.status}
                    onConfirm={() => handleConfirmSecretProposal(proposal.id)}
                    onReject={() => handleRejectSecretProposal(proposal.id)}
                    confirmText={t('common.confirm')}
                    rejectText={t('common.reject')}
                    loading={proposal.status !== 'pending'}
                    variant="warning"
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AIManagementTab;