"use client";

import React from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export interface MobileAppCardProps {
  app: {
    id: string;
    name: string;
    appName: string;
    bundleIdentifier: string;
    packageName: string;
    platform: "ios" | "android" | "both";
    designKit: string;
    template: string;
    status: string;
    version: string;
    buildNumber: number;
    createdAt: string;
    updatedAt: string;
  };
  onClick: (app: MobileAppCardProps["app"]) => void;
  onDelete?: (id: string) => void;
}

export const MobileAppCard: React.FC<MobileAppCardProps> = ({ app, onClick, onDelete }) => {
  const { t } = useI18n();

  const getPlatformIcon = () => {
    switch (app.platform) {
      case "ios":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          </svg>
        );
      case "android":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M8 12h8" />
            <path d="M12 8v8" />
          </svg>
        );
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <path d="M12 18h.01" />
          </svg>
        );
    }
  };

  const getStatusBadge = () => {
    const statusStyles: Record<string, string> = {
      scaffolded: "bg-muted text-muted-foreground",
      building: "bg-primary/10 text-primary",
      previewing: "bg-green-500/10 text-green-500",
      submitting: "bg-orange-500/10 text-orange-500",
      live: "bg-blue-500/10 text-blue-500",
    };
    const style = statusStyles[app.status] || statusStyles.scaffolded;
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${style}`}>
        {t(`mobile.status.${app.status}` as TranslationKey) || app.status}
      </span>
    );
  };

  const getDesignKitLabel = () => {
    switch (app.designKit) {
      case "ios-27":
        return t("mobile.designKit.ios27");
      case "material-3":
        return t("mobile.designKit.material3");
      default:
        return t("mobile.designKit.custom");
    }
  };

  return (
    <div
      className="liquid-glass rounded-2xl border border-border/40 p-4 transition hover:border-primary/30 hover:shadow-lg cursor-pointer group"
      onClick={() => onClick(app)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-lg truncate">{app.appName}</h3>
            {getPlatformIcon()}
          </div>
          <p className="text-sm text-muted-foreground truncate mb-1">{app.name}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              {app.bundleIdentifier || app.packageName}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
              v{app.version} ({app.buildNumber})
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {getStatusBadge()}
            <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
              {getDesignKitLabel()}
            </span>
            <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
              {t(`mobile.template.${app.template}` as TranslationKey) || app.template}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(app.id);
            }}
            aria-label={t("common.delete")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </IconButton>
        </div>
      </div>
    </div>
  );
};