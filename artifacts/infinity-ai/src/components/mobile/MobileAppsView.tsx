"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Textarea, Select, SelectOption } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Card } from "@/components/ui/card";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { MobileAppCard } from "./MobileAppCard";
import { MobileCreateModal } from "./MobileCreateModal";
import { MobileDesignTab } from "./MobileDesignTab";
import { MobilePreviewTab } from "./MobilePreviewTab";
import { MobileSubmitTab } from "./MobileSubmitTab";
import { MobileComponentsTab } from "./MobileComponentsTab";

interface MobileApp {
  id: string;
  name: string;
  appName: string;
  bundleIdentifier: string;
  packageName: string;
  platform: "ios" | "android" | "both";
  designKit: string;
  customFigmaUrl?: string;
  template: string;
  status: string;
  version: string;
  buildNumber: number;
  capabilities: Record<string, boolean>;
  nativeWindConfig: Record<string, unknown>;
  expoProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

interface MobilePreviewSession {
  id: string;
  status: string;
  metroPort: number;
  expoPort: number;
  qrCodeData?: string;
  qrCodeImage?: string;
  deviceConnections: number;
  logs: Array<{ timestamp: string; level: string; message: string }>;
  startedAt: string;
  endedAt?: string;
}

interface StoreSubmission {
  id: string;
  platform: string;
  stage: string;
  status: string;
  progress: number;
  buildProfile: string;
  credentials: Record<string, unknown>;
  easConfig: Record<string, unknown>;
  buildUrls: Record<string, string>;
  logs: Array<{ timestamp: string; stage: string; message: string; level: string }>;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface MobileAppsViewProps {
  projectId?: string | null;
  onProjectChange?: (projectId: string | null) => void;
}

export const MobileAppsView: React.FC<MobileAppsViewProps> = ({ projectId }) => {
  const { t } = useI18n();
  const [apps, setApps] = useState<MobileApp[]>([]);
  const [selectedApp, setSelectedApp] = useState<MobileApp | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "design" | "preview" | "submit" | "components">("overview");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSession, setPreviewSession] = useState<MobilePreviewSession | null>(null);
  const [submissions, setSubmissions] = useState<StoreSubmission[]>([]);
  const [designContext, setDesignContext] = useState<string>("");

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch("/api/infinity/mobile-apps");
      if (res.ok) {
        const data = await res.json();
        setApps(data);
      }
    } catch (err) {
      console.error("Failed to fetch mobile apps:", err);
    }
  }, []);

  const fetchDesignContext = useCallback(async () => {
    try {
      const res = await fetch("/api/infinity/design-kits/status");
      if (res.ok) {
        const data = await res.json();
        setDesignContext(JSON.stringify(data, null, 2));
      }
    } catch (err) {
      console.error("Failed to fetch design context:", err);
    }
  }, []);

  const handleCreateApp = useCallback(async (appData: Partial<MobileApp>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/infinity/mobile-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appData),
      });
      if (res.ok) {
        const data = await res.json();
        setApps((prev) => [data, ...prev]);
        setSelectedApp(data);
        setCreateModalOpen(false);
        setActiveTab("overview");
      } else {
        const err = await res.json();
        setError(err.error || "Failed to create app");
      }
    } catch (err) {
      setError("Failed to create app");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectApp = useCallback((app: MobileApp) => {
    setSelectedApp(app);
    setActiveTab("overview");
    // Fetch preview sessions and submissions
    fetch(`/api/infinity/mobile-apps/${app.id}/preview/sessions`)
      .then((r) => r.ok && r.json())
      .then((data) => {
        if (data.sessions?.length) setPreviewSession(data.sessions[0]);
      })
      .catch(() => {});
    fetch(`/api/infinity/mobile-apps/${app.id}/submissions`)
      .then((r) => r.ok && r.json())
      .then((data) => setSubmissions(data))
      .catch(() => {});
  }, []);

  const handleSyncKits = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/infinity/design-kits/sync", { method: "POST" });
      await fetchDesignContext();
    } catch (err) {
      setError("Failed to sync design kits");
    } finally {
      setLoading(false);
    }
  }, [fetchDesignContext]);

  const handleGenerateScaffold = useCallback(async () => {
    if (!selectedApp) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/infinity/mobile-apps/${selectedApp.id}/scaffold`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setApps((prev) => prev.map((a) => (a.id === selectedApp.id ? { ...a, status: "building" } : a)));
        setSelectedApp((prev) => (prev ? { ...prev, status: "building" } : null));
      }
    } catch (err) {
      setError("Failed to generate scaffold");
    } finally {
      setLoading(false);
    }
  }, [selectedApp]);

  const handleStartPreview = useCallback(async () => {
    if (!selectedApp) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/infinity/mobile-apps/${selectedApp.id}/preview/start`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setPreviewSession(data.session);
        setApps((prev) => prev.map((a) => (a.id === selectedApp.id ? { ...a, status: "previewing" } : a)));
        setSelectedApp((prev) => (prev ? { ...prev, status: "previewing" } : null));
      }
    } catch (err) {
      setError("Failed to start preview");
    } finally {
      setLoading(false);
    }
  }, [selectedApp]);

  const handleStopPreview = useCallback(async () => {
    if (!selectedApp || !previewSession) return;
    setLoading(true);
    try {
      await fetch(`/api/infinity/mobile-apps/${selectedApp.id}/preview/${previewSession.id}/stop`, { method: "POST" });
      setPreviewSession(null);
      setApps((prev) => prev.map((a) => (a.id === selectedApp.id ? { ...a, status: "scaffolded" } : a)));
      setSelectedApp((prev) => (prev ? { ...prev, status: "scaffolded" } : null));
    } catch (err) {
      setError("Failed to stop preview");
    } finally {
      setLoading(false);
    }
  }, [selectedApp, previewSession]);

  const handleCreateSubmission = useCallback(async (submissionData: Partial<StoreSubmission>) => {
    if (!selectedApp) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/infinity/mobile-apps/${selectedApp.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionData),
      });
      if (res.ok) {
        const data = await res.json();
        setSubmissions((prev) => [data.submission, ...prev]);
      }
    } catch (err) {
      setError("Failed to create submission");
    } finally {
      setLoading(false);
    }
  }, [selectedApp]);

  useEffect(() => {
    fetchApps();
    fetchDesignContext();
  }, [fetchApps, fetchDesignContext]);

  // Empty state
  if (!selectedApp) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{t("mobile.title")}</h1>
            <p className="text-muted-foreground">{t("mobile.overview")}</p>
          </div>
          <Button onClick={() => setCreateModalOpen(true)} variant="primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("mobile.createApp")}
          </Button>
        </div>

        {apps.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/50 mb-4">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <path d="M12 18h.01" />
            </svg>
            <h2 className="text-xl font-semibold mb-2">{t("mobile.noApps")}</h2>
            <p className="text-muted-foreground mb-6 max-w-md">{t("mobile.createFirst")}</p>
            <Button onClick={() => setCreateModalOpen(true)} variant="primary" size="lg">
              {t("mobile.createApp")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {apps.map((app) => (
              <MobileAppCard key={app.id} app={app} onClick={handleSelectApp} />
            ))}
          </div>
        )}

        <MobileCreateModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onCreate={handleCreateApp}
          loading={loading}
        />
      </div>
    );
  }

  // Selected app view
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => setSelectedApp(null)}
            aria-label={t("common.back")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </IconButton>
          <div>
            <h1 className="text-2xl font-bold">{selectedApp.appName}</h1>
            <p className="text-muted-foreground text-sm">{selectedApp.name} · {selectedApp.bundleIdentifier}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            selectedApp.status === "previewing" ? "bg-green-500/10 text-green-500" :
            selectedApp.status === "building" ? "bg-primary/10 text-primary" :
            selectedApp.status === "submitting" ? "bg-orange-500/10 text-orange-500" :
            selectedApp.status === "live" ? "bg-blue-500/10 text-blue-500" :
            "bg-muted text-muted-foreground"
          }`}>
            {t(`mobile.status.${selectedApp.status}` as TranslationKey) || selectedApp.status}
          </span>
          <Button variant="ghost" size="sm" onClick={handleSyncKits} disabled={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? "animate-spin" : ""}>
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {t("mobile.syncKits")}
          </Button>
          {selectedApp.status === "scaffolded" && (
            <Button variant="primary" size="sm" onClick={handleGenerateScaffold} disabled={loading}>
              {loading ? t("mobile.generating") : t("mobile.generateScaffold")}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: "overview", label: t("mobile.tabs.overview") },
          { id: "design", label: t("mobile.tabs.design") },
          { id: "preview", label: t("mobile.tabs.preview") },
          { id: "submit", label: t("mobile.tabs.submit") },
          { id: "components", label: t("mobile.tabs.components") },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      {/* Tab Content */}
      <div className="flex-1 min-h-0">
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Design Kit Status */}
            <Card className="p-4">
              <h3 className="font-semibold mb-3">{t("mobile.designTokens")}</h3>
              <pre className="bg-black/20 rounded p-4 text-xs overflow-auto max-h-64 font-mono">
                {designContext || t("mobile.loading")}
              </pre>
              <div className="flex items-center gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={handleSyncKits} disabled={loading}>
                  {loading ? t("mobile.syncing") : t("mobile.syncKits")}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {designContext ? `${t("mobile.lastSynced")}: ${new Date().toLocaleString()}` : ""}
                </span>
              </div>
            </Card>

            {/* App Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-4">
                <h3 className="font-semibold mb-3">{t("mobile.overview")}</h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("mobile.appName")}</dt>
                    <dd className="font-mono">{selectedApp.appName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("mobile.bundleIdentifier")}</dt>
                    <dd className="font-mono">{selectedApp.bundleIdentifier}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("mobile.packageName")}</dt>
                    <dd className="font-mono">{selectedApp.packageName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("mobile.platform")}</dt>
                    <dd>{t(`mobile.platform.${selectedApp.platform}` as TranslationKey) || selectedApp.platform}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("mobile.designKit")}</dt>
                    <dd>{t(`mobile.designKit.${selectedApp.designKit}` as TranslationKey) || selectedApp.designKit}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("mobile.template")}</dt>
                    <dd>{t(`mobile.template.${selectedApp.template}` as TranslationKey) || selectedApp.template}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("mobile.capabilities")}</dt>
                    <dd>
                      <span className="flex flex-wrap gap-1">
                        {Object.entries(selectedApp.capabilities).filter(([, v]) => v).map(([k]) => (
                          <span key={k} className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{k}</span>
                        ))}
                      </span>
                    </dd>
                  </div>
                </dl>
              </Card>

              <Card className="p-4">
                <h3 className="font-semibold mb-3">{t("mobile.storeSubmit")}</h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Version</dt>
                    <dd className="font-mono">v{selectedApp.version} ({selectedApp.buildNumber})</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Expo Project ID</dt>
                    <dd className="font-mono">{selectedApp.expoProjectId || "Not linked"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{new Date(selectedApp.createdAt).toLocaleDateString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd>{new Date(selectedApp.updatedAt).toLocaleDateString()}</dd>
                  </div>
                </dl>
              </Card>
            </div>

            {/* Recent Submissions */}
            {submissions.length > 0 && (
              <Card className="p-4">
                <h3 className="font-semibold mb-3">Recent Submissions</h3>
                <div className="space-y-2">
                  {submissions.slice(0, 5).map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <div className="font-medium">{sub.platform.toUpperCase()} · {sub.buildProfile}</div>
                        <div className="text-sm text-muted-foreground">{sub.stage} · {sub.progress}%</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        sub.status === "completed" ? "bg-green-500/10 text-green-500" :
                        sub.status === "failed" ? "bg-red-500/10 text-red-500" :
                        sub.status === "running" ? "bg-primary/10 text-primary" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {sub.status}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === "design" && selectedApp && (
          <MobileDesignTab app={selectedApp} onSyncKits={handleSyncKits} loading={loading} />
        )}

        {activeTab === "preview" && selectedApp && (
          <MobilePreviewTab
            app={selectedApp}
            session={previewSession}
            onStartPreview={handleStartPreview}
            onStopPreview={handleStopPreview}
            loading={loading}
          />
        )}

        {activeTab === "submit" && selectedApp && (
          <MobileSubmitTab
            app={selectedApp}
            submissions={submissions}
            onCreateSubmission={handleCreateSubmission}
            loading={loading}
          />
        )}

        {activeTab === "components" && selectedApp && (
          <MobileComponentsTab app={selectedApp} loading={loading} />
        )}
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg animate-slide-in">
          {error}
        </div>
      )}
    </div>
  );
};