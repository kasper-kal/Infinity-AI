"use client";

/**
 * Phase 33: AI Automation System — Automation List
 *
 * Project-level automation list with status, enable/disable, run, edit, delete
 */

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter, Button, IconButton, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, Switch, Label, ScrollArea, Skeleton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import {
  Zap,
  Play,
  Pause,
  Edit,
  Trash2,
  Settings,
  Eye,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Filter,
  Plus,
  Search,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  GitBranch,
  History,
  Download,
  Upload,
} from "lucide-react";
import { AutomationBuilder } from "./AutomationBuilder";
import type { AutomationSpec, AutomationTriggerType, AutomationRunStatus } from "@workspace/api-server/src/lib/automation-parser";

interface Automation {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: {
    type: AutomationTriggerType;
    cronExpression?: string;
    webhookPath?: string;
    connectorId?: string;
    connectorEvent?: string;
  };
  conditions: any[];
  actions: any[];
  settings: any;
  version: number;
  createdBy?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  idempotencyKeyTemplate?: string;
}

interface AutomationRun {
  id: string;
  automationId: string;
  projectId: string;
  triggerType: string;
  triggerPayload?: any;
  idempotencyKey?: string;
  status: AutomationRunStatus;
  error?: string;
  output?: any;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  parentRunId?: string;
  createdAt: string;
}

interface AutomationStats {
  total: number;
  enabled: number;
  disabled: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDurationMs: number;
}

const TRIGGER_TYPE_LABELS: Record<AutomationTriggerType, string> = {
  cron: "Scheduled",
  webhook: "Webhook",
  manual: "Manual",
  api_call: "API Call",
  connector_event: "Connector Event",
};

const TRIGGER_TYPE_ICONS: Record<AutomationTriggerType, React.ReactNode> = {
  cron: <Clock className="w-4 h-4" />,
  webhook: <Zap className="w-4 h-4" />,
  manual: <Play className="w-4 h-4" />,
  api_call: <GitBranch className="w-4 h-4" />,
  connector_event: <Zap className="w-4 h-4" />,
};

const STATUS_COLORS: Record<AutomationRunStatus, string> = {
  pending: "bg-amber-500",
  running: "bg-blue-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-gray-500",
  partial: "bg-amber-500",
};

const STATUS_LABELS: Record<AutomationRunStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Success",
  failed: "Failed",
  cancelled: "Cancelled",
  partial: "Partial",
};

interface AutomationListProps {
  projectId: string;
  onAutomationCreated?: (automation: any) => void;
}

export const AutomationList: React.FC<AutomationListProps> = ({ projectId, onAutomationCreated }) => {
  const { t } = useI18n();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [stats, setStats] = useState<AutomationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null);
  const [selectedAutomation, setSelectedAutomation] = useState<Automation | null>(null);
  const [showRunsDialog, setShowRunsDialog] = useState(false);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const fetchAutomations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.append("projectId", projectId);
      if (statusFilter !== "all") params.append("enabled", statusFilter);
      if (tagFilter.length > 0) params.append("tags", tagFilter.join(","));

      const response = await fetch(`/api/infinity/automations?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch automations");
      const data = await response.json();
      setAutomations(data);

      // Extract all unique tags
      const tags = new Set<string>();
      data.forEach((a: Automation) => a.tags?.forEach((t: string) => tags.add(t)));
      setAllTags(Array.from(tags).sort());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter, tagFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/infinity/automations/stats?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAutomations();
    fetchStats();
  }, [fetchAutomations, fetchStats]);

  const handleToggleEnabled = async (automation: Automation) => {
    try {
      const response = await fetch(`/api/infinity/automations/${automation.id}/${automation.enabled ? "disable" : "enable"}`, {
        method: "POST",
      });
      if (response.ok) {
        fetchAutomations();
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to toggle automation:", err);
    }
  };

  const handleRun = async (automation: Automation) => {
    setRunningAutomationId(automation.id);
    try {
      const response = await fetch(`/api/infinity/automations/${automation.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (data.runId) {
        fetchAutomations();
        fetchStats();
        // Optionally show runs dialog
        setSelectedAutomation(automation);
        setShowRunsDialog(true);
      }
    } catch (err) {
      console.error("Failed to run automation:", err);
    } finally {
      setRunningAutomationId(null);
    }
  };

  const handleDelete = async (automation: Automation) => {
    if (!confirm(t("automation.list.confirmDelete", { name: automation.name }))) return;
    try {
      const response = await fetch(`/api/infinity/automations/${automation.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchAutomations();
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to delete automation:", err);
    }
  };

  const handleViewRuns = async (automation: Automation) => {
    setSelectedAutomation(automation);
    setRunsLoading(true);
    try {
      const response = await fetch(`/api/infinity/automations/${automation.id}/runs?limit=20`);
      if (response.ok) {
        const data = await response.json();
        setRuns(data);
        setShowRunsDialog(true);
      }
    } catch (err) {
      console.error("Failed to fetch runs:", err);
    } finally {
      setRunsLoading(false);
    }
  };

  const filteredAutomations = automations.filter((a) => {
    const matchesSearch = a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = tagFilter.length === 0 || tagFilter.some(t => a.tags?.includes(t));
    return matchesSearch && matchesTag;
  });

  const renderTriggerBadge = (trigger: any) => (
    <Badge variant="outline" className="gap-1">
      {TRIGGER_TYPE_ICONS[trigger.type]}
      {TRIGGER_TYPE_LABELS[trigger.type]}
      {trigger.cronExpression && <span className="font-mono text-xs">{trigger.cronExpression}</span>}
      {trigger.webhookPath && <span className="font-mono text-xs">{trigger.webhookPath}</span>}
      {trigger.connectorId && trigger.connectorEvent && (
        <span className="font-mono text-xs">{trigger.connectorId}:{trigger.connectorEvent}</span>
      )}
    </Badge>
  );

  const renderStatusBadge = (status: AutomationRunStatus) => (
    <Badge variant="secondary" className="gap-1">
      <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
      {STATUS_LABELS[status]}
    </Badge>
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle>{t("automation.list.title")}</CardTitle>
          <Button variant="outline" size="sm" disabled>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            {t("common.loading")}
          </Button>
        </div>
        <div className="flex-1 space-y-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="p-4">
              <Skeleton className="h-6 w-1/4 mb-2" />
              <Skeleton className="h-4 w-1/2 mb-2" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-24" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header with stats and actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold">{t("automation.list.title")}</h2>
          {stats && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                {stats.enabled} {t("automation.list.enabled")}
              </span>
              <span className="flex items-center gap-1">
                <X className="w-4 h-4 text-red-500" />
                {stats.disabled} {t("automation.list.disabled")}
              </span>
              <span className="flex items-center gap-1">
                <GitBranch className="w-4 h-4" />
                {stats.totalRuns} {t("automation.list.runs")}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                {stats.successfulRuns} {t("automation.list.success")}
              </span>
              <span className="flex items-center gap-1">
                <AlertCircle className="w-4 h-4 text-red-500" />
                {stats.failedRuns} {t("automation.list.failed")}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t("automation.list.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter as any}>
            <SelectTrigger className="w-[160px] hidden sm:block">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder={t("automation.list.filterStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("automation.list.allStatus")}</SelectItem>
              <SelectItem value="enabled">{t("automation.list.enabled")}</SelectItem>
              <SelectItem value="disabled">{t("automation.list.disabled")}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tagFilter.join(",")} onValueChange={(v) => setTagFilter(v.split(",").filter(Boolean))} multiple>
            <SelectTrigger className="w-[160px] hidden sm:block">
              <GitBranch className="w-4 h-4 mr-2" />
              <SelectValue placeholder={t("automation.list.filterTags")} />
            </SelectTrigger>
            <SelectContent>
              {allTags.map(tag => (
                <SelectItem key={tag} value={tag}>{tag}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            {t("automation.list.createNew")}
          </Button>
        </div>
      </div>

      {/* Mobile search */}
      <div className="sm:hidden">
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("automation.list.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter as any}>
            <SelectTrigger className="flex-1">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder={t("automation.list.filterStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("automation.list.allStatus")}</SelectItem>
              <SelectItem value="enabled">{t("automation.list.enabled")}</SelectItem>
              <SelectItem value="disabled">{t("automation.list.disabled")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tagFilter.join(",")} onValueChange={(v) => setTagFilter(v.split(",").filter(Boolean))} multiple>
            <SelectTrigger className="flex-1">
              <GitBranch className="w-4 h-4 mr-2" />
              <SelectValue placeholder={t("automation.list.filterTags")} />
            </SelectTrigger>
            <SelectContent>
              {allTags.map(tag => (
                <SelectItem key={tag} value={tag}>{tag}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Automation List */}
      <div className="flex-1 min-h-0">
        {filteredAutomations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Zap className="w-12 h-12 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-1">{t("automation.list.emptyTitle")}</h3>
            <p className="text-sm mb-4">{t("automation.list.emptyDesc")}</p>
            <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              {t("automation.list.createFirst")}
            </Button>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-3 p-1">
              {filteredAutomations.map((automation) => (
                <Card key={automation.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold truncate">{automation.name}</h3>
                          <Badge variant={automation.enabled ? "default" : "secondary"}>
                            {automation.enabled ? t("automation.list.active") : t("automation.list.inactive")}
                          </Badge>
                          {automation.tags?.length && (
                            <div className="flex flex-wrap gap-1">
                              {automation.tags.slice(0, 3).map((tag: string) => (
                                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                              ))}
                              {automation.tags.length > 3 && (
                                <Badge variant="outline" className="text-xs">+{automation.tags.length - 3}</Badge>
                              )}
                            </div>
                          )}
                        </div>
                        {automation.description && (
                          <p className="text-sm text-muted-foreground mb-2 truncate">{automation.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          {renderTriggerBadge(automation.trigger)}
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {automation.actions.length} {t("automation.list.actions")}
                          </span>
                          {automation.conditions?.length && (
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              {automation.conditions.length} {t("automation.list.conditions")}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <History className="w-3 h-3" />
                            v{automation.version}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(automation.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{t("automation.list.actions")}</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => setEditingAutomation(automation)}>
                              <Edit className="w-4 h-4 mr-2" />
                              {t("automation.list.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleViewRuns(automation)}>
                              <History className="w-4 h-4 mr-2" />
                              {t("automation.list.viewRuns")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRun(automation)} disabled={runningAutomationId === automation.id || !automation.enabled}>
                              <Play className="w-4 h-4 mr-2" />
                              {runningAutomationId === automation.id ? t("automation.list.running") : t("automation.list.runNow")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleToggleEnabled(automation)}
                              className={automation.enabled ? "text-red-500" : "text-green-500"}
                            >
                              {automation.enabled ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                              {automation.enabled ? t("automation.list.disable") : t("automation.list.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(automation)} className="text-red-500">
                              <Trash2 className="w-4 h-4 mr-2" />
                              {t("automation.list.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Create/Edit Automation Dialog */}
      <Dialog open={showCreateDialog || !!editingAutomation} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) setEditingAutomation(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{editingAutomation ? t("automation.list.editAutomation") : t("automation.list.createAutomation")}</DialogTitle>
            <DialogDescription>{editingAutomation ? t("automation.list.editDesc") : t("automation.list.createDesc")}</DialogDescription>
          </DialogHeader>
          <AutomationBuilder
            projectId={projectId}
            initialPrompt={editingAutomation ? undefined : ""}
            onAutomationCreated={(automation) => {
              onAutomationCreated?.(automation);
              fetchAutomations();
              fetchStats();
              setShowCreateDialog(false);
              setEditingAutomation(null);
            }}
            onClose={() => { setShowCreateDialog(false); setEditingAutomation(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* Runs Dialog */}
      <Dialog open={showRunsDialog} onOpenChange={setShowRunsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t("automation.list.runHistory", { name: selectedAutomation?.name })}</DialogTitle>
            <DialogDescription>{t("automation.list.runHistoryDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {runsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="p-4">
                    <Skeleton className="h-6 w-1/4 mb-2" />
                    <div className="flex gap-2">
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-6 w-24" />
                    </div>
                  </Card>
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>{t("automation.list.noRuns")}</p>
              </div>
            ) : (
              runs.map((run) => (
                <Card key={run.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {renderStatusBadge(run.status)}
                      <div>
                        <div className="text-sm font-mono text-muted-foreground">{run.id.slice(0, 8)}...</div>
                        <div className="text-xs text-muted-foreground">{new Date(run.startedAt || run.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {run.durationMs && <span>{run.durationMs}ms</span>}
                      {run.retryCount > 0 && (
                        <Badge variant="outline" className="text-xs">
                          Retried {run.retryCount}x
                        </Badge>
                      )}
                    </div>
                  </div>
                  {run.error && (
                    <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-500 font-mono">
                      {run.error}
                    </div>
                  )}
                </Card>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRunsDialog(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AutomationList;