/**
 * Notification History — Phase 38
 * View and manage safety notification history
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  Select,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Separator,
  ScrollArea,
} from "@/components/ui";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

interface NotificationHistoryProps {
  projectId?: string;
}

interface SafetyNotification {
  id: string;
  projectId: string;
  ruleId: string | null;
  severity: "info" | "warning" | "critical" | "emergency";
  title: string;
  message: string;
  details: Record<string, any>;
  source: string;
  timestamp: string;
  channel: "webpush" | "email" | "slack" | "discord" | "webhook" | "inapp";
  status: "pending" | "delivered" | "failed" | "queued";
  error: string | null;
  externalId: string | null;
  deliveredAt: string | null;
  deduplicationKey: string | null;
  queuedForQuietHours: boolean;
  createdAt: string;
}

interface InAppNotification {
  id: string;
  projectId: string;
  notificationId: string;
  severity: "info" | "warning" | "critical" | "emergency";
  title: string;
  message: string;
  details: Record<string, any>;
  source: string;
  actionUrl: string | null;
  actionLabel: string | null;
  timestamp: string;
  read: boolean;
  dismissed: boolean;
  createdAt: string;
}

interface NotificationStats {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  bySource: Record<string, number>;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  critical: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  emergency: "bg-red-500/10 text-red-500 border-red-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  delivered: "bg-green-500/10 text-green-500 border-green-500/20",
  failed: "bg-red-500/10 text-red-500 border-red-500/20",
  queued: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  webpush: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  email: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>,
  slack: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 17h6"/></svg>,
  discord: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19.5 13.5c0 3.5-3.5 6.5-7.5 6.5S4.5 17 4.5 13.5c0-2.8 1.8-5.2 4.5-6.1"/><path d="M14 9.5c0 1.5-1.5 3-3.5 3S7 11 7 9.5s1.5-3 3.5-3S14 8 14 9.5z"/></svg>,
  webhook: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13.5 18H9a6 6 0 0 0-6-5v-1a6 6 0 0 1 6-5h14"/><path d="M10.5 6a4.5 4.5 0 1 1 4.5 4.5H15"/></svg>,
  inapp: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
};

export const NotificationHistory: React.FC<NotificationHistoryProps> = ({ projectId }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"all" | "inapp">("all");
  const [notifications, setNotifications] = useState<SafetyNotification[]>([]);
  const [inAppNotifications, setInAppNotifications] = useState<InAppNotification[]>([]);
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ limit: 50, offset: 0, total: 0 });
  const [inAppPagination, setInAppPagination] = useState({ limit: 50, offset: 0, total: 0 });
  const [filters, setFilters] = useState({
    severity: "",
    status: "",
    channel: "",
    source: "",
    since: "",
    unreadOnly: false,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        projectId,
        limit: String(pagination.limit),
        offset: String(pagination.offset),
      });
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.status) params.set("status", filters.status);
      if (filters.since) params.set("since", filters.since);

      const res = await fetch(`/api/infinity/safety-watcher/notifications?${params}`);
      const data = await res.json();
      if (data.ok) {
        setNotifications(data.notifications);
        if (data.pagination) setPagination(prev => ({ ...prev, total: data.pagination.total }));
      } else {
        throw new Error(data.error || "Failed to fetch notifications");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch notifications");
    } finally {
      setLoading(false);
    }
  }, [projectId, pagination.limit, pagination.offset, filters.severity, filters.status, filters.since]);

  const fetchInAppNotifications = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        projectId,
        limit: String(inAppPagination.limit),
        offset: String(inAppPagination.offset),
        unreadOnly: String(filters.unreadOnly),
      });
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.since) params.set("since", filters.since);

      const res = await fetch(`/api/infinity/safety-watcher/in-app?${params}`);
      const data = await res.json();
      if (data.ok) {
        setInAppNotifications(data.notifications);
        if (data.stats) {
          setInAppPagination(prev => ({ ...prev, total: data.stats.unread + data.stats.read }));
        }
      } else {
        throw new Error(data.error || "Failed to fetch in-app notifications");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch in-app notifications");
    } finally {
      setLoading(false);
    }
  }, [projectId, inAppPagination.limit, inAppPagination.offset, filters.severity, filters.since, filters.unreadOnly]);

  const fetchStats = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/infinity/safety-watcher/notifications/stats?projectId=${projectId}&since=${filters.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}`);
      const data = await res.json();
      if (data.ok) setStats(data.stats);
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    }
  }, [projectId, filters.since]);

  useEffect(() => {
    if (projectId) {
      fetchNotifications();
      fetchInAppNotifications();
      fetchStats();
    }
  }, [projectId, fetchNotifications, fetchInAppNotifications, fetchStats]);

  const handleMarkRead = async (notificationId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/infinity/safety-watcher/in-app/${notificationId}/read?projectId=${projectId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setInAppNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, read: true } : n));
        haptics.light();
      }
    } catch (e) {
      haptics.error();
    }
  };

  const handleMarkAllRead = async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/infinity/safety-watcher/in-app/read-all?projectId=${projectId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setInAppNotifications(prev => prev.map(n => ({ ...n, read: true })));
        haptics.success();
      }
    } catch (e) {
      haptics.error();
    }
  };

  const handleDismiss = async (notificationId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/infinity/safety-watcher/in-app/${notificationId}/dismiss?projectId=${projectId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setInAppNotifications(prev => prev.filter(n => n.id !== notificationId));
        haptics.light();
      }
    } catch (e) {
      haptics.error();
    }
  };

  const handlePageChange = (newOffset: number) => {
    if (activeTab === "all") {
      setPagination(prev => ({ ...prev, offset: newOffset }));
    } else {
      setInAppPagination(prev => ({ ...prev, offset: newOffset }));
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("time.justNow");
    if (diffMins < 60) return t("time.mAgo").replace("{n}", String(diffMins));
    if (diffHours < 24) return t("time.hAgo").replace("{n}", String(diffHours));
    if (diffDays < 7) return t("time.dAgo").replace("{n}", String(diffDays));
    return date.toLocaleDateString();
  };

  const renderNotificationRow = (notification: SafetyNotification) => {
    const isExpanded = expandedId === notification.id;
    return (
      <div key={notification.id} className="border border-border-primary/50 rounded-lg overflow-hidden bg-bg-elevated/30">
        <div
          className="p-4 flex items-start gap-4 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
          onClick={() => setExpandedId(isExpanded ? null : notification.id)}
        >
          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEVERITY_COLORS[notification.severity].split(" ")[0].replace("bg-", "bg-").replace("/10", "")}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-medium truncate">{notification.title}</h4>
              <Badge className={SEVERITY_COLORS[notification.severity]}>
                {t(`settings.safetyWatcherSeverity${notification.severity.charAt(0).toUpperCase() + notification.severity.slice(1)}` as TranslationKey)}
              </Badge>
              <Badge variant="outline" className={STATUS_COLORS[notification.status]}>
                {notification.status}
              </Badge>
              <span className="text-xs text-muted-foreground">{CHANNEL_ICONS[notification.channel]}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">{notification.message}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <span>{t("settings.safetyWatcherSource")}: {notification.source}</span>
              <span>{formatTime(notification.timestamp)}</span>
              {notification.queuedForQuietHours && (
                <span className="text-yellow-500">🌙 Queued for quiet hours</span>
              )}
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        {isExpanded && (
          <div className="p-4 border-t border-border-primary/50 bg-bg-elevated/20 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><span className="font-medium">{t("settings.safetyWatcherSeverity")}:</span> {notification.severity}</div>
              <div><span className="font-medium">{t("settings.safetyWatcherChannel")}:</span> {notification.channel}</div>
              <div><span className="font-medium">{t("settings.safetyWatcherStatus")}:</span> {notification.status}</div>
              <div><span className="font-medium">{t("settings.safetyWatcherSource")}:</span> {notification.source}</div>
              <div><span className="font-medium">{t("settings.safetyWatcherTimestamp")}:</span> {new Date(notification.timestamp).toLocaleString()}</div>
              {notification.deliveredAt && (
                <div><span className="font-medium">Delivered:</span> {new Date(notification.deliveredAt).toLocaleString()}</div>
              )}
              {notification.error && (
                <div className="md:col-span-2"><span className="font-medium text-red-500">Error:</span> {notification.error}</div>
              )}
              {notification.details && Object.keys(notification.details).length > 0 && (
                <div className="md:col-span-2">
                  <span className="font-medium">Details:</span>
                  <pre className="mt-1 text-xs bg-bg-elevated/50 p-2 rounded overflow-auto max-h-40 font-mono">
                    {JSON.stringify(notification.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderInAppNotificationRow = (notification: InAppNotification) => {
    const isExpanded = expandedId === notification.id;
    return (
      <div key={notification.id} className={`border rounded-lg overflow-hidden ${notification.read ? "opacity-70" : "bg-accent/5"}`}>
        <div
          className="p-4 flex items-start gap-4 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
          onClick={() => setExpandedId(isExpanded ? null : notification.id)}
        >
          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEVERITY_COLORS[notification.severity].split(" ")[0].replace("bg-", "bg-").replace("/10", "")}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-medium truncate">{notification.title}</h4>
              <Badge className={SEVERITY_COLORS[notification.severity]}>
                {t(`settings.safetyWatcherSeverity${notification.severity.charAt(0).toUpperCase() + notification.severity.slice(1)}` as TranslationKey)}
              </Badge>
              {!notification.read && (
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                  {t("settings.safetyWatcherUnread")}
                </Badge>
              )}
              {notification.dismissed && (
                <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/20">
                  Dismissed
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">{notification.message}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <span>{t("settings.safetyWatcherSource")}: {notification.source}</span>
              <span>{formatTime(notification.timestamp)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!notification.read && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); handleMarkRead(notification.id); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16a4 4 0 0 1-4-4"/><path d="M12 8h.01"/></svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("settings.safetyWatcherMarkRead")}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); handleDismiss(notification.id); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("settings.safetyWatcherDismiss")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {isExpanded && (
          <div className="p-4 border-t border-border-primary/50 bg-bg-elevated/20 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><span className="font-medium">{t("settings.safetyWatcherSeverity")}:</span> {notification.severity}</div>
              <div><span className="font-medium">Status:</span> {notification.read ? t("settings.safetyWatcherRead") : t("settings.safetyWatcherUnread")}</div>
              <div><span className="font-medium">{t("settings.safetyWatcherSource")}:</span> {notification.source}</div>
              <div><span className="font-medium">{t("settings.safetyWatcherTimestamp")}:</span> {new Date(notification.timestamp).toLocaleString()}</div>
              {notification.actionUrl && (
                <div className="md:col-span-2">
                  <span className="font-medium">Action:</span>
                  <Button variant="link" size="sm" className="p-0 h-auto" onClick={e => { e.stopPropagation(); window.open(notification.actionUrl!, "_blank"); }}>
                    {notification.actionLabel || notification.actionUrl}
                  </Button>
                </div>
              )}
              {notification.details && Object.keys(notification.details).length > 0 && (
                <div className="md:col-span-2">
                  <span className="font-medium">Details:</span>
                  <pre className="mt-1 text-xs bg-bg-elevated/50 p-2 rounded overflow-auto max-h-40 font-mono">
                    {JSON.stringify(notification.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderFilters = () => (
    <div className="flex flex-wrap gap-3 mb-4 p-3 bg-bg-elevated/50 rounded-lg border border-border-primary/50">
      <Select
        value={filters.severity}
        onChange={e => { setFilters(prev => ({ ...prev, severity: e.target.value })); setPagination(prev => ({ ...prev, offset: 0 })); }}
        options={[
          { value: "", label: t("common.all") },
          { value: "info", label: t("settings.safetyWatcherSeverityInfo") },
          { value: "warning", label: t("settings.safetyWatcherSeverityWarning") },
          { value: "critical", label: t("settings.safetyWatcherSeverityCritical") },
          { value: "emergency", label: t("settings.safetyWatcherSeverityEmergency") },
        ]}
        placeholder={t("settings.safetyWatcherSeverity")}
        className="w-36"
      />
      {activeTab === "all" && (
        <Select
          value={filters.status}
          onChange={e => { setFilters(prev => ({ ...prev, status: e.target.value })); setPagination(prev => ({ ...prev, offset: 0 })); }}
          options={[
            { value: "", label: t("common.all") },
            { value: "pending", label: "Pending" },
            { value: "delivered", label: "Delivered" },
            { value: "failed", label: "Failed" },
            { value: "queued", label: "Queued" },
          ]}
          placeholder={t("settings.safetyWatcherStatus")}
          className="w-36"
        />
      )}
      <Input
        type="date"
        value={filters.since ? filters.since.split("T")[0] : ""}
        onChange={e => {
          const val = e.target.value;
          setFilters(prev => ({ ...prev, since: val ? new Date(val).toISOString() : "" }));
          setPagination(prev => ({ ...prev, offset: 0 }));
        }}
        className="w-40"
      />
      {activeTab === "inapp" && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.unreadOnly}
            onChange={e => { setFilters(prev => ({ ...prev, unreadOnly: e.target.checked })); setInAppPagination(prev => ({ ...prev, offset: 0 })); }}
            className="w-4 h-4"
          />
          <span className="text-sm">{t("settings.safetyWatcherUnreadOnly") || "Unread only"}</span>
        </label>
      )}
      <Button variant="outline" onClick={() => {
        setFilters({ severity: "", status: "", channel: "", source: "", since: "", unreadOnly: false });
        setPagination(prev => ({ ...prev, offset: 0 }));
        setInAppPagination(prev => ({ ...prev, offset: 0 }));
      }}>
        {t("common.clear")}
      </Button>
    </div>
  );

  const renderPagination = (currentPagination: typeof pagination, onPageChange: (offset: number) => void) => {
    const totalPages = Math.ceil(currentPagination.total / currentPagination.limit);
    const currentPage = Math.floor(currentPagination.offset / currentPagination.limit) + 1;

    if (totalPages <= 1) return null;

    return (
      <div className="flex items-center justify-center gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(0, currentPagination.offset - currentPagination.limit))}
          disabled={currentPage === 1}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages} ({currentPagination.total} total)
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min((totalPages - 1) * currentPagination.limit, currentPagination.offset + currentPagination.limit))}
          disabled={currentPage === totalPages}
        >
          Next
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t("settings.safetyWatcherHistory")}</h3>
          <p className="text-sm text-muted-foreground">{t("settings.safetyWatcherHistoryDesc")}</p>
        </div>
        {activeTab === "inapp" && (
          <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={loading}>
            {t("settings.safetyWatcherMarkAllRead")}
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          {error}
        </div>
      )}

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Card className="border-border-primary/50 p-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </Card>
          <Card className="border-border-primary/50 p-3">
            <div className="text-2xl font-bold text-red-500">{stats.bySeverity.emergency || 0}</div>
            <div className="text-xs text-muted-foreground">Emergency</div>
          </Card>
          <Card className="border-border-primary/50 p-3">
            <div className="text-2xl font-bold text-orange-500">{stats.bySeverity.critical || 0}</div>
            <div className="text-xs text-muted-foreground">Critical</div>
          </Card>
          <Card className="border-border-primary/50 p-3">
            <div className="text-2xl font-bold text-yellow-500">{stats.bySeverity.warning || 0}</div>
            <div className="text-xs text-muted-foreground">Warning</div>
          </Card>
          <Card className="border-border-primary/50 p-3">
            <div className="text-2xl font-bold text-blue-500">{stats.bySeverity.info || 0}</div>
            <div className="text-xs text-muted-foreground">Info</div>
          </Card>
        </div>
      )}

      {/* Tab Navigation for All vs In-App */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="all">
            {t("settings.safetyWatcherAllNotifications") || "All Notifications"}
            <span className="ml-2 px-2 py-0.5 text-xs bg-bg-elevated/50 rounded">{pagination.total}</span>
          </TabsTrigger>
          <TabsTrigger value="inapp">
            {t("settings.safetyWatcherInApp") || "In-App"}
            <span className="ml-2 px-2 py-0.5 text-xs bg-bg-elevated/50 rounded">
              {inAppNotifications.filter(n => !n.read).length} unread
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {renderFilters()}
          <ScrollArea className="max-h-[600px]">
            <div className="space-y-3">
              {loading ? (
                <div className="flex justify-center py-8 text-muted-foreground">{t("common.loading")}</div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-50">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <p>{t("settings.safetyWatcherNoNotifications")}</p>
                </div>
              ) : (
                notifications.map(renderNotificationRow)
              )}
            </div>
          </ScrollArea>
          {renderPagination(pagination, handlePageChange)}
        </TabsContent>

        <TabsContent value="inapp" className="mt-4">
          {renderFilters()}
          <ScrollArea className="max-h-[600px]">
            <div className="space-y-3">
              {loading ? (
                <div className="flex justify-center py-8 text-muted-foreground">{t("common.loading")}</div>
              ) : inAppNotifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-50">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <p>{t("settings.safetyWatcherNoNotifications")}</p>
                </div>
              ) : (
                inAppNotifications.map(renderInAppNotificationRow)
              )}
            </div>
          </ScrollArea>
          {renderPagination(inAppPagination, handlePageChange)}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default NotificationHistory;