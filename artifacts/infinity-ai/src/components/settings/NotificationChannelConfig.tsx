/**
 * Notification Channel Configuration — Phase 38
 * Configure and manage notification delivery channels for Safety Watcher
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Input,
  Select,
  Switch,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Textarea,
  Alert,
  AlertTitle,
  AlertDescription,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Separator,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ScrollArea,
} from "@/components/ui";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

interface NotificationChannelConfigProps {
  projectId?: string;
}

interface NotificationChannel {
  id: string;
  projectId: string;
  type: "webpush" | "email" | "slack" | "discord" | "webhook" | "inapp";
  name: string;
  config: Record<string, any>;
  enabled: boolean;
  severityFilter: ("info" | "warning" | "critical" | "emergency")[];
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  createdAt: string;
  updatedAt: string;
}

const CHANNEL_TYPES = [
  { value: "webpush", label: "Web Push", icon: "🔔", description: "Browser push notifications" },
  { value: "email", label: "Email", icon: "📧", description: "Email notifications via SMTP" },
  { value: "slack", label: "Slack", icon: "💬", description: "Slack webhook integration" },
  { value: "discord", label: "Discord", icon: "🎮", description: "Discord webhook integration" },
  { value: "webhook", label: "Webhook", icon: "🔗", description: "Generic HTTP webhook" },
  { value: "inapp", label: "In-App", icon: "📱", description: "In-application notifications" },
];

const SEVERITY_OPTIONS = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
  { value: "emergency", label: "Emergency" },
];

const DEFAULT_SEVERITY_FILTER = ["warning", "critical", "emergency"];

const CHANNEL_CONFIG_FIELDS: Record<string, { key: string; label: string; type: "text" | "password" | "textarea" | "url"; placeholder?: string; required?: boolean }[]> = {
  webpush: [],
  email: [
    { key: "host", label: "SMTP Host", type: "text", placeholder: "smtp.example.com", required: true },
    { key: "port", label: "SMTP Port", type: "text", placeholder: "587", required: true },
    { key: "secure", label: "Use TLS", type: "text", placeholder: "true/false" },
    { key: "user", label: "Username", type: "text", placeholder: "user@example.com", required: true },
    { key: "pass", label: "Password", type: "password", placeholder: "••••••••", required: true },
    { key: "from", label: "From Address", type: "text", placeholder: "alerts@example.com", required: true },
    { key: "to", label: "Default Recipient", type: "text", placeholder: "recipient@example.com", required: true },
  ],
  slack: [
    { key: "webhookUrl", label: "Webhook URL", type: "url", placeholder: "https://hooks.slack.com/services/...", required: true },
  ],
  discord: [
    { key: "webhookUrl", label: "Webhook URL", type: "url", placeholder: "https://discord.com/api/webhooks/...", required: true },
  ],
  webhook: [
    { key: "url", label: "Webhook URL", type: "url", placeholder: "https://example.com/webhook", required: true },
    { key: "method", label: "HTTP Method", type: "text", placeholder: "POST" },
    { key: "headers", label: "Headers (JSON)", type: "textarea", placeholder: '{"Authorization": "Bearer ..."}' },
    { key: "template", label: "Body Template (JSON)", type: "textarea", placeholder: '{"text": "{{message}}"}' },
  ],
  inapp: [],
};

export const NotificationChannelConfig: React.FC<NotificationChannelConfigProps> = ({ projectId }) => {
  const { t } = useI18n();
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [formData, setFormData] = useState<Partial<NotificationChannel> & { config: Record<string, any> }>({
    type: "webpush",
    name: "",
    enabled: true,
    severityFilter: DEFAULT_SEVERITY_FILTER,
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    quietHoursTimezone: "UTC",
    config: {},
  });

  const fetchChannels = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/infinity/safety-watcher/channels?projectId=${projectId}`);
      const data = await res.json();
      if (data.ok) {
        setChannels(data.channels);
      } else {
        throw new Error(data.error || "Failed to fetch channels");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch channels");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchChannels();
    }
  }, [projectId, fetchChannels]);

  const handleTypeChange = (type: string) => {
    setFormData(prev => ({
      ...prev,
      type: type as any,
      config: CHANNEL_CONFIG_FIELDS[type]?.reduce((acc, field) => ({ ...acc, [field.key]: "" }), {}) || {},
    }));
  };

  const handleConfigChange = (key: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  };

  const openAddDialog = () => {
    setEditingChannel(null);
    setFormData({
      type: "webpush",
      name: "",
      enabled: true,
      severityFilter: DEFAULT_SEVERITY_FILTER,
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      quietHoursTimezone: "UTC",
      config: {},
    });
    setShowAddDialog(true);
  };

  const openEditDialog = (channel: NotificationChannel) => {
    setEditingChannel(channel);
    setFormData({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      enabled: channel.enabled,
      severityFilter: channel.severityFilter,
      quietHoursEnabled: channel.quietHoursEnabled,
      quietHoursStart: channel.quietHoursStart,
      quietHoursEnd: channel.quietHoursEnd,
      quietHoursTimezone: channel.quietHoursTimezone,
      config: { ...channel.config },
    });
    setShowAddDialog(true);
  };

  const closeDialog = () => {
    setShowAddDialog(false);
    setEditingChannel(null);
  };

  const saveChannel = async () => {
    if (!projectId) return;
    if (!formData.name || !formData.type) {
      setError("Name and type are required");
      haptics.error();
      return;
    }

    // Validate required config fields
    const requiredFields = CHANNEL_CONFIG_FIELDS[formData.type]?.filter(f => f.required) || [];
    for (const field of requiredFields) {
      if (!formData.config[field.key]) {
        setError(`${field.label} is required`);
        haptics.error();
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/infinity/safety-watcher/channels?projectId=${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: formData.id,
          type: formData.type,
          name: formData.name,
          config: formData.config,
          enabled: formData.enabled,
          severityFilter: formData.severityFilter,
          quietHoursEnabled: formData.quietHoursEnabled,
          quietHoursStart: formData.quietHoursStart,
          quietHoursEnd: formData.quietHoursEnd,
          quietHoursTimezone: formData.quietHoursTimezone,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save channel");

      await fetchChannels();
      closeDialog();
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save channel");
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const deleteChannel = async (channelId: string) => {
    if (!projectId) return;
    if (!window.confirm(t("settings.safetyWatcherDeleteChannelConfirm") || "Delete this channel?")) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/infinity/safety-watcher/channels/${channelId}?projectId=${projectId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to delete channel");

      await fetchChannels();
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete channel");
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const testChannel = async (channel: NotificationChannel) => {
    if (!projectId) return;
    setTestingChannelId(channel.id);
    try {
      const res = await fetch(`/api/infinity/safety-watcher/channels/${channel.id}/test?projectId=${projectId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok && data.result?.success) {
        haptics.success();
        alert(t("settings.safetyWatcherTestSuccess") || "Test notification sent successfully!");
      } else {
        haptics.error();
        alert(`${t("settings.safetyWatcherTestFailed") || "Test failed"}: ${data.result?.error || "Unknown error"}`);
      }
    } catch (e) {
      haptics.error();
      alert(`${t("settings.safetyWatcherTestFailed") || "Test failed"}: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setTestingChannelId(null);
    }
  };

  const toggleEnabled = async (channel: NotificationChannel) => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/infinity/safety-watcher/channels?projectId=${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: channel.id,
          type: channel.type,
          name: channel.name,
          config: channel.config,
          enabled: !channel.enabled,
          severityFilter: channel.severityFilter,
          quietHoursEnabled: channel.quietHoursEnabled,
          quietHoursStart: channel.quietHoursStart,
          quietHoursEnd: channel.quietHoursEnd,
          quietHoursTimezone: channel.quietHoursTimezone,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to update channel");

      setChannels(prev => prev.map(c => c.id === channel.id ? { ...c, enabled: !channel.enabled } : c));
      haptics.light();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update channel");
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const renderChannelCard = (channel: NotificationChannel) => {
    const channelType = CHANNEL_TYPES.find(ct => ct.value === channel.type);
    const isTesting = testingChannelId === channel.id;

    return (
      <Card key={channel.id} className={`border-border-primary/50 ${!channel.enabled ? "opacity-60" : ""}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-2xl">{channelType?.icon || "🔔"}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-medium truncate">{channel.name}</h4>
                  <Badge variant="outline">{channelType?.label || channel.type}</Badge>
                  <Badge variant="outline" className={channel.enabled ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-gray-500/10 text-gray-500 border-gray-500/20"}>
                    {channel.enabled ? t("common.enabled") : t("common.disabled")}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1 truncate">{channelType?.description || ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={channel.enabled}
                onChange={() => toggleEnabled(channel)}
                disabled={loading}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => testChannel(channel)} disabled={loading || isTesting}>
                    {isTesting ? (
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("settings.safetyWatcherTest")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => openEditDialog(channel)} disabled={loading}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.edit")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-500/10" onClick={() => deleteChannel(channel.id)} disabled={loading}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.delete")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Severity Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">{t("settings.safetyWatcherChannelSeverityFilter")}</label>
              <div className="flex flex-wrap gap-2">
                {SEVERITY_OPTIONS.map(sev => (
                  <Badge
                    key={sev.value}
                    variant={channel.severityFilter.includes(sev.value as any) ? "primary" : "outline"}
                    className={channel.severityFilter.includes(sev.value as any) ? "" : "border-border-primary/50"}
                  >
                    {sev.label}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Quiet Hours */}
            {channel.quietHoursEnabled && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>🌙 {t("settings.safetyWatcherQuietHours")}: {channel.quietHoursStart} – {channel.quietHoursEnd} ({channel.quietHoursTimezone})</span>
              </div>
            )}

            {/* Config Summary */}
            <div className="pt-2 border-t border-border-primary/50">
              <details className="group">
                <summary className="text-sm text-muted-foreground cursor-pointer flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-open:rotate-90">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                  Configuration
                </summary>
                <div className="mt-2 p-3 bg-bg-elevated/50 rounded text-xs font-mono text-muted-foreground max-h-40 overflow-auto">
                  {JSON.stringify(
                    Object.fromEntries(
                      Object.entries(channel.config).filter(([k]) => !["pass", "token", "secret", "key", "auth"].some(s => k.toLowerCase().includes(s)))
                    ),
                    null,
                    2
                  )}
                </div>
              </details>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderConfigForm = () => {
    const fields = CHANNEL_CONFIG_FIELDS[formData.type] || [];

    return (
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {/* Basic Info */}
        <div className="space-y-3">
          <Input
            label={t("settings.safetyWatcherChannelName")}
            value={formData.name || ""}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder={t("settings.safetyWatcherChannelNamePlaceholder") || "My Slack Channel"}
            required
          />
          <Select
            label={t("settings.safetyWatcherChannelType")}
            value={formData.type}
            onChange={e => handleTypeChange(e.target.value)}
            options={CHANNEL_TYPES.map(ct => ({ value: ct.value, label: ct.label }))}
          />

          <Separator />

          {/* Severity Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">{t("settings.safetyWatcherChannelSeverityFilter")}</label>
            <div className="flex flex-wrap gap-2">
              {SEVERITY_OPTIONS.map(sev => (
                <label
                  key={sev.value}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                    formData.severityFilter?.includes(sev.value as any)
                      ? "bg-accent/10 border-accent/30 text-accent-foreground"
                      : "border-border-primary/50 hover:bg-bg-elevated/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.severityFilter?.includes(sev.value as any) || false}
                    onChange={e => {
                      const newFilter = formData.severityFilter || [];
                      if (e.target.checked) {
                        setFormData(prev => ({ ...prev, severityFilter: [...newFilter, sev.value as any] }));
                      } else {
                        setFormData(prev => ({ ...prev, severityFilter: newFilter.filter(s => s !== sev.value) }));
                      }
                    }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{sev.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Quiet Hours */}
          <Separator />
          <label className="flex items-center justify-between">
            <span>{t("settings.safetyWatcherQuietHoursEnabled")}</span>
            <Switch
              checked={formData.quietHoursEnabled}
              onChange={e => setFormData(prev => ({ ...prev, quietHoursEnabled: e.target.checked }))}
            />
          </label>
          {formData.quietHoursEnabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                type="time"
                label={t("settings.safetyWatcherQuietHoursStart")}
                value={formData.quietHoursStart}
                onChange={e => setFormData(prev => ({ ...prev, quietHoursStart: e.target.value }))}
              />
              <Input
                type="time"
                label={t("settings.safetyWatcherQuietHoursEnd")}
                value={formData.quietHoursEnd}
                onChange={e => setFormData(prev => ({ ...prev, quietHoursEnd: e.target.value }))}
              />
              <Input
                label={t("settings.safetyWatcherQuietHoursTimezone")}
                value={formData.quietHoursTimezone}
                onChange={e => setFormData(prev => ({ ...prev, quietHoursTimezone: e.target.value }))}
              />
            </div>
          )}

          {/* Channel-specific config */}
          {fields.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                {fields.map(field => (
                  <div key={field.key} className="space-y-1">
                    <label className="block text-sm font-medium">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {field.type === "textarea" ? (
                      <Textarea
                        value={formData.config[field.key] || ""}
                        onChange={e => handleConfigChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        rows={3}
                        className="font-mono text-sm"
                      />
                    ) : (
                      <Input
                        type={field.type}
                        value={formData.config[field.key] || ""}
                        onChange={e => handleConfigChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className={field.type === "password" ? "font-mono" : ""}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {fields.length === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              <p>{t("settings.safetyWatcherNoConfigNeeded") || "No additional configuration needed for this channel type."}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherChannels")}</h3>
          <p className="text-sm text-muted-foreground">{t("settings.safetyWatcherChannelsDesc")}</p>
        </div>
        <Button onClick={openAddDialog} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("settings.safetyWatcherAddChannel")}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{t("common.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && channels.length === 0 ? (
        <div className="flex justify-center py-8 text-muted-foreground">{t("common.loading")}</div>
      ) : channels.length === 0 ? (
        <Card className="border-border-primary/50 text-center py-12">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-50">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <h4 className="font-medium mb-1">{t("settings.safetyWatcherNoChannels") || "No notification channels configured"}</h4>
          <p className="text-sm text-muted-foreground mb-4">{t("settings.safetyWatcherNoChannelsDesc") || "Add a channel to start receiving safety alerts"}</p>
          <Button onClick={openAddDialog}>{t("settings.safetyWatcherAddChannel")}</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {channels.map(renderChannelCard)}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showAddDialog} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{editingChannel ? t("settings.safetyWatcherEditChannel") : t("settings.safetyWatcherAddChannel")}</DialogTitle>
            <DialogDescription>
              {editingChannel
                ? t("settings.safetyWatcherEditChannelDesc") || "Update the notification channel configuration"
                : t("settings.safetyWatcherAddChannelDesc") || "Configure a new notification channel for safety alerts"}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea>
            {renderConfigForm()}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={loading}>
              {t("common.cancel")}
            </Button>
            <Button onClick={saveChannel} disabled={loading}>
              {loading ? t("common.saving") : (editingChannel ? t("common.save") : t("common.create"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Web Push VAPID Key Info */}
      <Card className="border-border-primary/50 mt-4">
        <CardHeader>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherPushSubscribe")}</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.safetyWatcherPushSubscribeDesc")}</p>
          <Button variant="outline" onClick={async () => {
            try {
              const res = await fetch(`/api/infinity/safety-watcher/vapid-public-key`);
              const data = await res.json();
              if (data.ok && data.publicKey) {
                navigator.clipboard.writeText(data.publicKey);
                haptics.success();
                alert(t("settings.safetyWatcherVapidCopied") || "VAPID public key copied to clipboard");
              }
            } catch (e) {
              haptics.error();
            }
          }}>
            {t("settings.safetyWatcherCopyVapidKey") || "Copy VAPID Public Key"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("settings.safetyWatcherVapidNote") || "This key is needed to register push subscriptions in the browser."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default NotificationChannelConfig;