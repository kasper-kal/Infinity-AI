/**
 * Safety Watcher Tab — Phase 38
 * Main tab for configuring and monitoring the Local AI Safety Watcher
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Input,
  Textarea,
  Select,
  Switch,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Separator,
} from "@/components/ui";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import { NotificationHistory } from "./NotificationHistory";
import { NotificationChannelConfig } from "./NotificationChannelConfig";

interface SafetyWatcherTabProps {
  projectId?: string;
}

interface SafetyRule {
  id: string;
  ruleId: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: "info" | "warning" | "critical" | "emergency";
  action: "notify" | "pause_agent" | "rollback" | "request_human" | "throttle";
  config: Record<string, any>;
  cooldownMs: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface SafetyWatcherConfig {
  enabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  batchEnabled: boolean;
  batchMaxSize: number;
  batchMaxWaitMs: number;
  batchGroupBy: "rule" | "severity" | "source";
  localModelEnabled: boolean;
  localModelProvider: "ollama" | "transformers" | "auto";
  localModelName: string;
  fallbackApiEnabled: boolean;
  fallbackApiProvider: string;
  notificationRetentionDays: number;
}

interface SafetyWatcherStatus {
  running: boolean;
  lastCheck: string | null;
  rulesEnabled: number;
  rulesTotal: number;
  channelsConfigured: number;
  notificationsToday: number;
  localModelStatus: "connected" | "disconnected" | "unavailable";
}

const DEFAULT_CONFIG: SafetyWatcherConfig = {
  enabled: true,
  quietHoursEnabled: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  quietHoursTimezone: "UTC",
  batchEnabled: true,
  batchMaxSize: 10,
  batchMaxWaitMs: 300000,
  batchGroupBy: "rule",
  localModelEnabled: true,
  localModelProvider: "ollama",
  localModelName: "llama3.2:1b",
  fallbackApiEnabled: true,
  fallbackApiProvider: "groq",
  notificationRetentionDays: 30,
};

const DEFAULT_RULES: SafetyRule[] = [
  {
    id: "runaway_loop",
    ruleId: "runaway_loop",
    name: "Runaway Loop",
    description: "Detects agents stuck in infinite loops or excessive iterations",
    enabled: true,
    severity: "critical",
    action: "pause_agent",
    config: { maxIterations: 50, timeWindowMs: 300000 },
    cooldownMs: 300000,
    tags: ["agent", "loop"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "token_burn",
    ruleId: "token_burn",
    name: "Token Burn",
    description: "Alerts when token consumption exceeds thresholds",
    enabled: true,
    severity: "warning",
    action: "notify",
    config: { maxTokensPerMinute: 100000, maxTokensPerHour: 1000000 },
    cooldownMs: 300000,
    tags: ["cost", "tokens"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "security_violation",
    ruleId: "security_violation",
    name: "Security Violation",
    description: "Detects potential security issues (secrets, unauthorized access, injection)",
    enabled: true,
    severity: "emergency",
    action: "request_human",
    config: { scanSecrets: true, scanInjection: true },
    cooldownMs: 60000,
    tags: ["security", "secrets"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "deployment_failure",
    ruleId: "deployment_failure",
    name: "Deployment Failure",
    description: "Monitors deployment pipelines for failures and anomalies",
    enabled: true,
    severity: "critical",
    action: "notify",
    config: { maxFailureRate: 0.1, alertOnRollback: true },
    cooldownMs: 300000,
    tags: ["deployment", "ci-cd"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "error_pattern",
    ruleId: "error_pattern",
    name: "Error Pattern",
    description: "Detects recurring error patterns across builds and agents",
    enabled: true,
    severity: "warning",
    action: "notify",
    config: { minOccurrences: 3, timeWindowMs: 600000 },
    cooldownMs: 300000,
    tags: ["errors", "patterns"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "policy_violation",
    ruleId: "policy_violation",
    name: "Policy Violation",
    description: "Checks for policy violations (license, compliance, coding standards)",
    enabled: true,
    severity: "warning",
    action: "notify",
    config: { checkLicenses: true, checkCompliance: true },
    cooldownMs: 300000,
    tags: ["policy", "compliance"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "resource_exhaustion",
    ruleId: "resource_exhaustion",
    name: "Resource Exhaustion",
    description: "Monitors CPU, memory, disk, and network for exhaustion",
    enabled: true,
    severity: "critical",
    action: "throttle",
    config: { cpuThreshold: 90, memoryThreshold: 90, diskThreshold: 85 },
    cooldownMs: 300000,
    tags: ["resources", "infrastructure"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "stalled_task",
    ruleId: "stalled_task",
    name: "Stalled Task",
    description: "Detects tasks that have not made progress within expected time",
    enabled: true,
    severity: "warning",
    action: "notify",
    config: { maxStallMinutes: 30, checkIntervalMs: 60000 },
    cooldownMs: 300000,
    tags: ["tasks", "progress"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  critical: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  emergency: "bg-red-500/10 text-red-500 border-red-500/20",
};

const ACTION_LABELS: Record<string, string> = {
  notify: "Notify",
  pause_agent: "Pause Agent",
  rollback: "Rollback",
  request_human: "Request Human",
  throttle: "Throttle",
};

export const SafetyWatcherTab: React.FC<SafetyWatcherTabProps> = ({ projectId }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"overview" | "rules" | "channels" | "history" | "settings">("overview");
  const [config, setConfig] = useState<SafetyWatcherConfig>(DEFAULT_CONFIG);
  const [rules, setRules] = useState<SafetyRule[]>(DEFAULT_RULES);
  const [status, setStatus] = useState<SafetyWatcherStatus>({
    running: false,
    lastCheck: null,
    rulesEnabled: 0,
    rulesTotal: 8,
    channelsConfigured: 0,
    notificationsToday: 0,
    localModelStatus: "unavailable",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SafetyRule>>({});

  // Fetch data on mount
  useEffect(() => {
    if (projectId) {
      fetchConfig();
      fetchRules();
      fetchStatus();
    }
  }, [projectId]);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`/api/infinity/safety-watcher/config?projectId=${projectId}`);
      const data = await res.json();
      if (data.ok && data.config) {
        setConfig(data.config);
      }
    } catch (e) {
      console.error("Failed to fetch config:", e);
    }
  };

  const fetchRules = async () => {
    try {
      const res = await fetch(`/api/infinity/safety-watcher/rules?projectId=${projectId}`);
      const data = await res.json();
      if (data.ok && data.rules?.length > 0) {
        setRules(data.rules);
      }
    } catch (e) {
      console.error("Failed to fetch rules:", e);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/infinity/safety-watcher/status?projectId=${projectId}`);
      const data = await res.json();
      if (data.ok && data.status) {
        setStatus(data.status);
      }
    } catch (e) {
      console.error("Failed to fetch status:", e);
    }
  };

  const handleConfigChange = useCallback((key: keyof SafetyWatcherConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    haptics.light();
  }, []);

  const saveConfig = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/infinity/safety-watcher/config?projectId=${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save");
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save configuration");
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const toggleWatcher = async (start: boolean) => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/infinity/safety-watcher/${start ? "start" : "stop"}?projectId=${projectId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to toggle");
      setStatus(prev => ({ ...prev, running: start }));
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle watcher");
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const handleRuleToggle = async (ruleId: string, enabled: boolean) => {
    if (!projectId) return;
    try {
      const rule = rules.find(r => r.ruleId === ruleId);
      if (!rule) return;

      const res = await fetch(`/api/infinity/safety-watcher/rules?projectId=${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rule, enabled }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to update rule");

      setRules(prev => prev.map(r => r.ruleId === ruleId ? { ...r, enabled } : r));
      haptics.light();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
      haptics.error();
    }
  };

  const startEditRule = (rule: SafetyRule) => {
    setEditingRuleId(rule.ruleId);
    setEditForm({
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      action: rule.action,
      config: rule.config,
      cooldownMs: rule.cooldownMs,
      tags: rule.tags,
    });
  };

  const saveRule = async () => {
    if (!projectId || !editingRuleId) return;
    setLoading(true);
    try {
      const rule = rules.find(r => r.ruleId === editingRuleId);
      if (!rule) return;

      const res = await fetch(`/api/infinity/safety-watcher/rules?projectId=${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleId: editingRuleId,
          ...rule,
          ...editForm,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save rule");

      setRules(prev => prev.map(r => r.ruleId === editingRuleId ? { ...r, ...editForm, updatedAt: new Date().toISOString() } : r));
      setEditingRuleId(null);
      setEditForm({});
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save rule");
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const cancelEditRule = () => {
    setEditingRuleId(null);
    setEditForm({});
  };

  const renderRuleRow = (rule: SafetyRule, isEditing: boolean) => {
    if (isEditing) {
      return (
        <div key={rule.ruleId} className="space-y-3 p-4 bg-bg-elevated/50 rounded-lg border border-accent/20">
          <div className="flex items-center gap-3">
            <h4 className="font-medium">{rule.name}</h4>
            <Button variant="primary" size="sm" onClick={saveRule}>{t("common.confirm")}</Button>
            <Button variant="ghost" size="sm" onClick={cancelEditRule}>{t("common.cancel")}</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={t("settings.safetyWatcherRuleName") as TranslationKey}
              value={editForm.name || ""}
              onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
            />
            <Select
              label={t("settings.safetyWatcherSeverity") as TranslationKey}
              value={editForm.severity || "warning"}
              onChange={e => setEditForm(prev => ({ ...prev, severity: e.target.value as any }))}
              options={[
                { value: "info", label: t("settings.safetyWatcherSeverityInfo") },
                { value: "warning", label: t("settings.safetyWatcherSeverityWarning") },
                { value: "critical", label: t("settings.safetyWatcherSeverityCritical") },
                { value: "emergency", label: t("settings.safetyWatcherSeverityEmergency") },
              ]}
            />
            <Select
              label={t("settings.safetyWatcherAction") as TranslationKey}
              value={editForm.action || "notify"}
              onChange={e => setEditForm(prev => ({ ...prev, action: e.target.value as any }))}
              options={[
                { value: "notify", label: t("settings.safetyWatcherActionNotify") },
                { value: "pause_agent", label: t("settings.safetyWatcherActionPause") },
                { value: "rollback", label: t("settings.safetyWatcherActionRollback") },
                { value: "request_human", label: t("settings.safetyWatcherActionRequestHuman") },
                { value: "throttle", label: t("settings.safetyWatcherActionThrottle") },
              ]}
            />
            <Input
              type="number"
              label={t("settings.safetyWatcherRuleCooldown") as TranslationKey}
              value={editForm.cooldownMs || 300000}
              onChange={e => setEditForm(prev => ({ ...prev, cooldownMs: parseInt(e.target.value) }))}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">{t("settings.safetyWatcherRuleConfig") as TranslationKey}</label>
            <Textarea
              value={JSON.stringify(editForm.config, null, 2)}
              onChange={e => {
                try {
                  setEditForm(prev => ({ ...prev, config: JSON.parse(e.target.value) }));
                } catch {
                  // Ignore invalid JSON
                }
              }}
              rows={4}
              className="font-mono text-sm"
            />
          </div>
        </div>
      );
    }

    return (
      <div key={rule.ruleId} className="p-4 rounded-lg border border-border-primary/50 bg-bg-elevated/30">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h4 className="font-medium truncate">{rule.name}</h4>
              <Badge className={SEVERITY_COLORS[rule.severity]}>{t(`settings.safetyWatcherSeverity${rule.severity.charAt(0).toUpperCase() + rule.severity.slice(1)}` as TranslationKey)}</Badge>
              <Badge variant="outline">{ACTION_LABELS[rule.action]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
              <span>Cooldown: {Math.round(rule.cooldownMs / 1000)}s</span>
              <span>Tags: {rule.tags.join(", ")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={rule.enabled}
              onChange={e => handleRuleToggle(rule.ruleId, e.target.checked)}
              disabled={loading}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => startEditRule(rule)} disabled={loading}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.edit")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  };

  // Overview tab content
  const renderOverview = () => (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="border-border-primary/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{t("settings.safetyWatcherStatus")}</h3>
              <p className="text-sm text-muted-foreground">{t("settings.safetyWatcherDesc")}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${status.running ? "bg-green-500" : "bg-gray-400"}`} />
              <span className="text-sm font-medium">{status.running ? t("settings.safetyWatcherStatusRunning") : t("settings.safetyWatcherStatusStopped")}</span>
              <Button
                variant={status.running ? "secondary" : "primary"}
                size="sm"
                onClick={() => toggleWatcher(!status.running)}
                disabled={loading}
              >
                {status.running ? t("common.stop") : t("common.start")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
              <div className="text-2xl font-bold">{status.rulesEnabled}/{status.rulesTotal}</div>
              <div className="text-sm text-muted-foreground">{t("settings.safetyWatcherRules")}</div>
            </div>
            <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
              <div className="text-2xl font-bold">{status.channelsConfigured}</div>
              <div className="text-sm text-muted-foreground">{t("settings.safetyWatcherChannels")}</div>
            </div>
            <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
              <div className="text-2xl font-bold">{status.notificationsToday}</div>
              <div className="text-sm text-muted-foreground">{t("settings.safetyWatcherNotificationsToday") || "Notifications Today"}</div>
            </div>
            <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  status.localModelStatus === "connected" ? "bg-green-500" :
                  status.localModelStatus === "disconnected" ? "bg-yellow-500" : "bg-gray-400"
                }`} />
                <span className="text-sm capitalize">{status.localModelStatus}</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">{t("settings.safetyWatcherLocalModel")}</div>
            </div>
          </div>
          {status.lastCheck && (
            <p className="text-sm text-muted-foreground mt-4">
              {t("settings.safetyWatcherLastCheck") || "Last check"}: {new Date(status.lastCheck).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="border-border-primary/50">
        <CardHeader>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherQuickActions") || "Quick Actions"}</h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setActiveTab("rules")}>
              {t("settings.safetyWatcherRules")}
            </Button>
            <Button variant="outline" onClick={() => setActiveTab("channels")}>
              {t("settings.safetyWatcherChannels")}
            </Button>
            <Button variant="outline" onClick={() => setActiveTab("history")}>
              {t("settings.safetyWatcherHistory")}
            </Button>
            <Button variant="outline" onClick={() => setActiveTab("settings")}>
              {t("settings.safetyWatcherLocalModel")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Alert if not running */}
      {!status.running && (
        <Alert variant="warning">
          <AlertTitle>{t("settings.safetyWatcherNotRunning") || "Safety Watcher is not running"}</AlertTitle>
          <AlertDescription>
            {t("settings.safetyWatcherNotRunningDesc") || "Enable the Safety Watcher to start monitoring for safety issues across all Infinity activity."}
          </AlertDescription>
        </Alert>
      )}

      {/* Local model status alert */}
      {config.localModelEnabled && status.localModelStatus !== "connected" && (
        <Alert variant="warning">
          <AlertTitle>{t("settings.safetyWatcherLocalModelDisconnected") || "Local model not connected"}</AlertTitle>
          <AlertDescription>
            {t("settings.safetyWatcherLocalModelDisconnectedDesc") || "Configure Ollama or enable fallback API for advanced pattern detection."}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );

  // Rules tab content
  const renderRules = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("settings.safetyWatcherRules")}</h3>
        <p className="text-sm text-muted-foreground">{t("settings.safetyWatcherRulesDesc")}</p>
      </div>
      <div className="space-y-3">
        {rules.map(rule => renderRuleRow(rule, editingRuleId === rule.ruleId))}
      </div>
    </div>
  );

  // Settings tab content
  const renderSettings = () => (
    <div className="space-y-6">
      {/* General Settings */}
      <Card className="border-border-primary/50">
        <CardHeader>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherGeneral") || "General Settings"}</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50">
            <span>{t("settings.safetyWatcherEnabled")}</span>
            <Switch
              checked={config.enabled}
              onChange={e => handleConfigChange("enabled", e.target.checked)}
            />
          </label>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherQuietHoursStart")}</label>
              <Input
                type="time"
                value={config.quietHoursStart}
                onChange={e => handleConfigChange("quietHoursStart", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherQuietHoursEnd")}</label>
              <Input
                type="time"
                value={config.quietHoursEnd}
                onChange={e => handleConfigChange("quietHoursEnd", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherQuietHoursTimezone")}</label>
              <Input
                value={config.quietHoursTimezone}
                onChange={e => handleConfigChange("quietHoursTimezone", e.target.value)}
              />
            </div>
            <label className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50 md:col-span-2">
              <span>{t("settings.safetyWatcherQuietHoursEnabled")}</span>
              <Switch
                checked={config.quietHoursEnabled}
                onChange={e => handleConfigChange("quietHoursEnabled", e.target.checked)}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Batching Settings */}
      <Card className="border-border-primary/50">
        <CardHeader>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherBatching")}</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50">
            <span>{t("settings.safetyWatcherBatchingEnabled") || "Enable Batching"}</span>
            <Switch
              checked={config.batchEnabled}
              onChange={e => handleConfigChange("batchEnabled", e.target.checked)}
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherBatchSize")}</label>
              <Input
                type="number"
                value={config.batchMaxSize}
                onChange={e => handleConfigChange("batchMaxSize", parseInt(e.target.value))}
                min={1}
                max={100}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherBatchWait")}</label>
              <Input
                type="number"
                value={config.batchMaxWaitMs}
                onChange={e => handleConfigChange("batchMaxWaitMs", parseInt(e.target.value))}
                min={1000}
                step={1000}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherBatchGroupBy") || "Group By"}</label>
              <Select
                value={config.batchGroupBy}
                onChange={e => handleConfigChange("batchGroupBy", e.target.value as any)}
                options={[
                  { value: "rule", label: "Rule" },
                  { value: "severity", label: "Severity" },
                  { value: "source", label: "Source" },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Local Model Settings */}
      <Card className="border-border-primary/50">
        <CardHeader>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherLocalModel")}</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50">
            <span>{t("settings.safetyWatcherLocalModelEnabled") || "Enable Local Model"}</span>
            <Switch
              checked={config.localModelEnabled}
              onChange={e => handleConfigChange("localModelEnabled", e.target.checked)}
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherLocalModelProvider")}</label>
              <Select
                value={config.localModelProvider}
                onChange={e => handleConfigChange("localModelProvider", e.target.value as any)}
                options={[
                  { value: "ollama", label: "Ollama" },
                  { value: "transformers", label: "Transformers.js (WASM)" },
                  { value: "auto", label: "Auto" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("settings.safetyWatcherLocalModelName")}</label>
              <Input
                value={config.localModelName}
                onChange={e => handleConfigChange("localModelName", e.target.value)}
                placeholder="llama3.2:1b"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fallback API Settings */}
      <Card className="border-border-primary/50">
        <CardHeader>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherFallbackApi")}</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50">
            <span>{t("settings.safetyWatcherFallbackApiEnabled") || "Enable Fallback API"}</span>
            <Switch
              checked={config.fallbackApiEnabled}
              onChange={e => handleConfigChange("fallbackApiEnabled", e.target.checked)}
            />
          </label>
          <div className="space-y-2">
            <label className="block text-sm font-medium">{t("settings.safetyWatcherFallbackApiProvider")}</label>
            <Select
              value={config.fallbackApiProvider}
              onChange={e => handleConfigChange("fallbackApiProvider", e.target.value)}
              options={[
                { value: "groq", label: "Groq (Free tier)" },
                { value: "together", label: "Together AI (Free tier)" },
                { value: "huggingface", label: "Hugging Face (Free tier)" },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Retention Settings */}
      <Card className="border-border-primary/50">
        <CardHeader>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherCleanup")}</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">{t("settings.safetyWatcherRetentionDays")}</label>
            <Input
              type="number"
              value={config.notificationRetentionDays}
              onChange={e => handleConfigChange("notificationRetentionDays", parseInt(e.target.value))}
              min={1}
              max={365}
            />
          </div>
          <Button variant="outline" onClick={async () => {
            if (!projectId) return;
            setLoading(true);
            try {
              const res = await fetch(`/api/infinity/safety-watcher/cleanup?projectId=${projectId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ days: config.notificationRetentionDays }),
              });
              const data = await res.json();
              if (!data.ok) throw new Error(data.error || "Failed to cleanup");
              haptics.success();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to cleanup");
              haptics.error();
            } finally {
              setLoading(false);
            }
          }} disabled={loading}>
            {t("settings.safetyWatcherCleanup")}
          </Button>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button onClick={saveConfig} disabled={loading} className="w-full md:w-auto">
        {loading ? t("common.saving") : t("common.save")}
      </Button>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">{t("settings.safetyWatcherOverview") || "Overview"}</TabsTrigger>
          <TabsTrigger value="rules">{t("settings.safetyWatcherRules")}</TabsTrigger>
          <TabsTrigger value="channels">{t("settings.safetyWatcherChannels")}</TabsTrigger>
          <TabsTrigger value="history">{t("settings.safetyWatcherHistory")}</TabsTrigger>
          <TabsTrigger value="settings">{t("settings.safetyWatcherSettings") || "Settings"}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {renderOverview()}
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          {renderRules()}
        </TabsContent>

        <TabsContent value="channels" className="mt-4">
          <NotificationChannelConfig projectId={projectId} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <NotificationHistory projectId={projectId} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          {renderSettings()}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SafetyWatcherTab;