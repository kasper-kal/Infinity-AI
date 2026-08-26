"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface MobileDesignTabProps {
  app: {
    id: string;
    designKit: string;
    customFigmaUrl?: string;
  };
  onSyncKits: () => void;
  loading: boolean;
}

export const MobileDesignTab: React.FC<MobileDesignTabProps> = ({ app, onSyncKits, loading }) => {
  const { t } = useI18n();
  const [designContext, setDesignContext] = useState<string>("");
  const [customTokens, setCustomTokens] = useState<string>("");
  const [customUrl, setCustomUrl] = useState(app.customFigmaUrl || "");
  const [activeSubTab, setActiveSubTab] = useState<"kits" | "custom" | "context">("kits");
  const [syncStatus, setSyncStatus] = useState<{ ios?: string; android?: string }>({});

  const fetchDesignContext = async () => {
    try {
      const res = await fetch("/api/infinity/design-kits/status");
      if (res.ok) {
        const data = await res.json();
        setDesignContext(JSON.stringify(data, null, 2));
        if (data.ios?.versionLabel) setSyncStatus((p) => ({ ...p, ios: data.ios.versionLabel }));
        if (data.android?.versionLabel) setSyncStatus((p) => ({ ...p, android: data.android.versionLabel }));
      }
    } catch (err) {
      console.error("Failed to fetch design context:", err);
    }
  };

  const fetchCustomTokens = async () => {
    if (!customUrl.trim()) return;
    try {
      const res = await fetch("/api/infinity/mobile-apps/custom-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl: customUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setCustomTokens(data.mergedContext);
        }
      }
    } catch (err) {
      console.error("Failed to fetch custom tokens:", err);
    }
  };

  useEffect(() => {
    fetchDesignContext();
  }, []);

  return (
    <div className="space-y-6">
      {/* Kit Status */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{t("mobile.designTokens")}</h3>
          <Button variant="outline" size="sm" onClick={onSyncKits} disabled={loading}>
            {loading ? t("mobile.syncing") : t("mobile.syncKits")}
          </Button>
        </div>

        <Tabs
          tabs={[
            { id: "kits", label: t("mobile.tabs.design") },
            { id: "custom", label: "Custom Figma" },
            { id: "context", label: "Full Context" },
          ]}
          activeTab={activeSubTab}
          onChange={setActiveSubTab}
        />

        {activeSubTab === "kits" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* iOS 27 Kit */}
            <Card className="p-4 bg-primary/5 border-primary/20">
              <div className="flex items-center gap-2 mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                </svg>
                <span className="font-semibold text-primary">{t("mobile.designKit.ios27")}</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Official Apple iOS & iPadOS 27 Liquid Glass design kit. Auto-refreshed every 30s.
              </p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-mono">{syncStatus.ios || "Unknown"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-mono truncate max-w-[150px]">figma.com/community/file/1651309003795292092</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Uses OFFICIAL Liquid Glass components: glass-bar, glass-button, glass-card, glass-sheet, glass-navigation, glass-tab-bar, glass-toolbar, glass-menu, glass-modal, glass-widget, control-center, lock-screen, sf-symbol
                </p>
              </div>
            </Card>

            {/* Material 3 Kit */}
            <Card className="p-4 bg-green-500/5 border-green-500/20">
              <div className="flex items-center gap-2 mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500">
                  <path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                  <path d="M8 12h8" />
                  <path d="M12 8v8" />
                </svg>
                <span className="font-semibold text-green-500">{t("mobile.designKit.material3")}</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Official Material You 3 design kit. Auto-refreshed every 30s.
              </p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-mono">{syncStatus.android || "Unknown"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-mono truncate max-w-[150px]">figma.com/community/file/1035203688168086460</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Uses OFFICIAL Material 3 components: m3-button, m3-card, m3-navigation-bar, m3-top-app-bar, m3-bottom-sheet, m3-dialog, m3-fab, m3-list, m3-menu, m3-chip, m3-switch, m3-slider
                </p>
              </div>
            </Card>
          </div>
        )}

        {activeSubTab === "custom" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t("mobile.customFigmaUrl")}</label>
              <Input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder={t("mobile.customFigmaUrlPlaceholder")}
              />
            </div>
            <Button variant="primary" onClick={fetchCustomTokens} disabled={loading || !customUrl.trim()}>
              {loading ? t("mobile.syncing") : "Fetch Tokens"}
            </Button>
            {customTokens && (
              <Card className="p-4 max-h-96 overflow-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap">{customTokens}</pre>
              </Card>
            )}
          </div>
        )}

        {activeSubTab === "context" && (
          <Card className="p-4 max-h-96 overflow-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap">{designContext || t("mobile.loading")}</pre>
          </Card>
        )}
      </Card>

      {/* Current App Design Kit */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Current App Design Kit</h3>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          {app.designKit === "ios-27" ? (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              </svg>
              <span>{t("mobile.designKit.ios27")}</span>
            </>
          ) : app.designKit === "material-3" ? (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500">
                <path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                <path d="M8 12h8" />
                <path d="M12 8v8" />
              </svg>
              <span>{t("mobile.designKit.material3")}</span>
            </>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>{t("mobile.designKit.custom")}</span>
            </>
          )}
        </div>
        {app.customFigmaUrl && (
          <p className="text-sm text-muted-foreground mt-2 truncate">{app.customFigmaUrl}</p>
        )}
      </Card>
    </div>
  );
};