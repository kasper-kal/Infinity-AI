"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/Input";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface MobilePreviewTabProps {
  app: {
    id: string;
    appName: string;
  };
  session: {
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
  } | null;
  onStartPreview: () => void;
  onStopPreview: () => void;
  loading: boolean;
}

export const MobilePreviewTab: React.FC<MobilePreviewTabProps> = ({
  app,
  session,
  onStartPreview,
  onStopPreview,
  loading,
}) => {
  const { t } = useI18n();
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: string; message: string }>>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [activeLogTab, setActiveLogTab] = useState<"all" | "info" | "warn" | "error">("all");

  useEffect(() => {
    if (session) {
      setLogs(session.logs || []);
    }
  }, [session]);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (autoScroll) scrollToBottom();
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) =>
    activeLogTab === "all" ? true : log.level === activeLogTab
  );

  const handleStartPreview = async () => {
    await onStartPreview();
  };

  const handleStopPreview = async () => {
    await onStopPreview();
  };

  if (!session) {
    return (
      <div className="space-y-6">
        <Card className="p-8 text-center">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-muted-foreground/50 mb-4">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <path d="M12 18h.01" />
            <path d="M9 10h6" />
            <path d="M9 14h6" />
          </svg>
          <h3 className="text-xl font-semibold mb-2">{t("mobile.preview")}</h3>
          <p className="text-muted-foreground mb-6 max-w-md">
            Start a live preview session to test your app on a physical device using Expo Go.
            The Metro bundler will start and generate a QR code for instant device preview.
          </p>
          <Button variant="primary" size="lg" onClick={handleStartPreview} disabled={loading}>
            {loading ? t("mobile.loading") : t("mobile.startPreview")}
          </Button>
        </Card>

        <Card className="p-4">
          <h4 className="font-semibold mb-3">{t("mobile.qrCode")}</h4>
          <div className="text-center text-muted-foreground py-8">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <rect x="5" y="5" width="4" height="4" />
              <rect x="15" y="5" width="4" height="4" />
              <rect x="5" y="15" width="4" height="4" />
            </svg>
            <p className="text-sm">{t("mobile.scanWithExpoGo")}</p>
            <p className="text-xs mt-1">QR code will appear here when preview starts</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              session.status === "running" ? "bg-green-500 animate-pulse" :
              session.status === "starting" ? "bg-yellow-500 animate-pulse" :
              "bg-red-500"
            }`} />
            <div>
              <p className="font-semibold">{t("mobile.previewRunning")}</p>
              <p className="text-sm text-muted-foreground">
                Metro: {session.metroPort} · Expo: {session.expoPort} ·{" "}
                {session.deviceConnections === 1
                  ? t("mobile.deviceConnected")
                  : `${session.deviceConnections} ${t("mobile.devicesConnected")}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleStopPreview} disabled={loading}>
              {t("mobile.stopPreview")}
            </Button>
          </div>
        </div>

        {/* QR Code */}
        {session.qrCodeImage && (
          <div className="mt-4 flex items-center justify-center gap-8 flex-wrap">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">{t("mobile.qrCode")}</p>
              <img
                src={`data:image/png;base64,${session.qrCodeImage}`}
                alt={t("mobile.qrCode")}
                className="rounded-lg border border-border shadow-lg"
                width="200"
                height="200"
              />
              <p className="text-xs text-muted-foreground mt-2">{t("mobile.scanWithExpoGo")}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">Expo URL</p>
              <code className="text-xs bg-black/20 px-3 py-1.5 rounded font-mono break-all block max-w-[200px]">
                {session.qrCodeData}
              </code>
            </div>
          </div>
        )}
      </Card>

      {/* Logs */}
      <Card className="p-4 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{t("mobile.previewLogs")}</h3>
          <div className="flex items-center gap-2">
            <Select
              value={activeLogTab}
              onChange={(e) => setActiveLogTab(e.target.value as typeof activeLogTab)}
              options={[
                { value: "all", label: "All" },
                { value: "info", label: "Info" },
                { value: "warn", label: "Warn" },
                { value: "error", label: "Error" },
              ]}
              className="w-[120px]"
            />
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded"
              />
              Auto-scroll
            </label>
            <Button variant="ghost" size="sm" onClick={() => setLogs([])}>
              Clear
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-black/20 rounded p-3 font-mono text-xs space-y-1">
          {filteredLogs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No logs yet</p>
          ) : (
            filteredLogs.map((log, i) => (
              <div
                key={`${log.timestamp}-${i}`}
                className={`flex gap-2 whitespace-pre-wrap ${
                  log.level === "error" ? "text-red-300" :
                  log.level === "warn" ? "text-yellow-300" :
                  log.level === "debug" ? "text-muted-foreground" :
                  "text-green-300"
                }`}
              >
                <span className="text-muted-foreground shrink-0 font-mono">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0">
                  {log.level.toUpperCase()}
                </span>
                <span className="break-all flex-1">{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </Card>
    </div>
  );
};

