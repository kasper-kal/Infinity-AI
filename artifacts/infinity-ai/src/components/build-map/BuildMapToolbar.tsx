/**
 * BuildMapToolbar Component
 * Toolbar for the visual build map with layout, filter, and action controls
 */

import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { Button, IconButton, ButtonGroup, Select, SelectOption } from "@/components/ui";
import {
  type BuildMapLayoutAlgorithm,
  type BuildMapNodeType,
  type BuildMapNodeStatus,
  type BuildMapAssignee,
} from "@/hooks/useBuildMap";

interface BuildMapToolbarProps {
  layout: BuildMapLayoutAlgorithm;
  onLayoutChange: (layout: BuildMapLayoutAlgorithm) => void;
  onAnalyze: () => void;
  onCenterView: () => void;
  onExport: () => void;
  onImport: () => void;
  onCreateNode: () => void;
  onCreateFeature: () => void;
  filters: {
    types: BuildMapNodeType[];
    statuses: BuildMapNodeStatus[];
    assignees: BuildMapAssignee[];
    search: string;
  };
  onFiltersChange: (filters: BuildMapToolbarProps["filters"]) => void;
  suggestionsCount: number;
  loading: boolean;
  connected: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  className?: string;
}

const LAYOUT_OPTIONS: { value: BuildMapLayoutAlgorithm; label: string; icon: React.ReactNode }[] = [
  { value: "hierarchical", label: "Hierarchical", icon: <HierarchicalIcon /> },
  { value: "force-directed", label: "Force Directed", icon: <ForceDirectedIcon /> },
  { value: "circular", label: "Circular", icon: <CircularIcon /> },
  { value: "manual", label: "Manual", icon: <ManualIcon /> },
];

const NODE_TYPES: BuildMapNodeType[] = ["feature", "component", "page", "api", "integration", "test", "doc", "database", "model", "config", "deployment"];
const NODE_STATUSES: BuildMapNodeStatus[] = ["planned", "in-progress", "review", "done", "blocked", "archived"];
const ASSIGNEES: BuildMapAssignee[] = ["human", "agent", "unassigned"];

// Icons
function HierarchicalIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H7M17 19H7"/></svg>; }
function ForceDirectedIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><line x1="12" y1="15" x2="4" y2="17"/><line x1="12" y1="15" x2="20" y2="17"/><line x1="12" y1="9" x2="4" y2="7"/><line x1="12" y1="9" x2="20" y2="7"/></svg>; }
function CircularIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>; }
function ManualIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5 5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>; }

export const BuildMapToolbar: React.FC<BuildMapToolbarProps> = ({
  layout,
  onLayoutChange,
  onAnalyze,
  onCenterView,
  onExport,
  onImport,
  onCreateNode,
  onCreateFeature,
  filters,
  onFiltersChange,
  suggestionsCount,
  loading,
  connected,
  zoom,
  onZoomChange,
  className,
}) => {
  const { t } = useI18n();
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);

  const handleTypeToggle = useCallback((type: BuildMapNodeType) => {
    onFiltersChange({
      ...filters,
      types: filters.types.includes(type)
        ? filters.types.filter(t => t !== type)
        : [...filters.types, type],
    });
  }, [filters, onFiltersChange]);

  const handleStatusToggle = useCallback((status: BuildMapNodeStatus) => {
    onFiltersChange({
      ...filters,
      statuses: filters.statuses.includes(status)
        ? filters.statuses.filter(s => s !== status)
        : [...filters.statuses, status],
    });
  }, [filters, onFiltersChange]);

  const handleAssigneeToggle = useCallback((assignee: BuildMapAssignee) => {
    onFiltersChange({
      ...filters,
      assignees: filters.assignees.includes(assignee)
        ? filters.assignees.filter(a => a !== assignee)
        : [...filters.assignees, assignee],
    });
  }, [filters, onFiltersChange]);

  const handleSearchChange = useCallback((search: string) => {
    onFiltersChange({ ...filters, search });
  }, [filters, onFiltersChange]);

  const handleZoomIn = useCallback(() => onZoomChange(Math.min(2, zoom + 0.2)), [zoom, onZoomChange]);
  const handleZoomOut = useCallback(() => onZoomChange(Math.max(0.25, zoom - 0.2)), [zoom, onZoomChange]);
  const handleZoomReset = useCallback(() => onZoomChange(1), [onZoomChange]);

  const activeFiltersCount = filters.types.length + filters.statuses.length + filters.assignees.length + (filters.search ? 1 : 0);

  return (
    <div className={cn("flex flex-col gap-3 p-3 glass-strong rounded-xl border border-border-primary/50", className)}>
      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("w-2 h-2 rounded-full", connected ? "bg-green-400" : "bg-red-400")} />
        <span>{connected ? t("buildMap.connected") : t("buildMap.disconnected")}</span>
        {loading && <span className="text-brand-400 animate-pulse">{t("buildMap.loading")}</span>}
      </div>

      {/* Main actions */}
      <div className="flex flex-wrap gap-2">
        <ButtonGroup variant="outline" size="sm" className="flex-wrap">
          <IconButton
            onClick={onCenterView}
            aria-label={t("buildMap.centerView")}
            variant="outline"
            size="sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </IconButton>
          <IconButton
            onClick={handleZoomOut}
            aria-label={t("buildMap.zoomOut")}
            variant="outline"
            size="sm"
            disabled={zoom <= 0.25}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </IconButton>
          <span className="flex items-center px-2 text-sm font-mono text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            onClick={handleZoomIn}
            aria-label={t("buildMap.zoomIn")}
            variant="outline"
            size="sm"
            disabled={zoom >= 2}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="11" y1="8" x2="11" y2="14"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </IconButton>
          <IconButton
            onClick={handleZoomReset}
            aria-label={t("buildMap.zoomReset")}
            variant="outline"
            size="sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
            </svg>
          </IconButton>
        </ButtonGroup>

        <ButtonGroup variant="outline" size="sm">
          <IconButton
            onClick={onAnalyze}
            aria-label={t("buildMap.analyze")}
            variant="outline"
            size="sm"
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            {suggestionsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {suggestionsCount > 9 ? "9+" : suggestionsCount}
              </span>
            )}
          </IconButton>
        </ButtonGroup>
      </div>

      {/* Layout selector */}
      <div className="relative">
        <Button
          onClick={() => setLayoutMenuOpen(!layoutMenuOpen)}
          variant="outline"
          size="sm"
          className="w-full justify-between"
          aria-label={t("buildMap.layout")}
          aria-expanded={layoutMenuOpen}
        >
          <span className="flex items-center gap-2">
            {LAYOUT_OPTIONS.find(o => o.value === layout)?.icon}
            <span>{t(`buildMap.layouts.${layout}`)}</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </Button>

        {layoutMenuOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 glass-strong border border-border-primary rounded-lg shadow-lg overflow-hidden z-10">
            {LAYOUT_OPTIONS.map(option => (
              <button
                key={option.value}
                onClick={() => {
                  onLayoutChange(option.value);
                  setLayoutMenuOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                  layout === option.value ? "bg-brand-500/20 text-brand-400" : "hover:bg-muted"
                )}
              >
                <span className="text-muted-foreground">{option.icon}</span>
                <span>{t(`buildMap.layouts.${option.value}`)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create actions */}
      <div className="flex gap-2">
        <Button
          onClick={onCreateNode}
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={loading}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {t("buildMap.addNode")}
        </Button>
        <Button
          onClick={onCreateFeature}
          variant="secondary"
          size="sm"
          className="flex-1"
          disabled={loading}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          {t("buildMap.addFeature")}
        </Button>
      </div>

      {/* Filter panel toggle */}
      <Button
        onClick={() => setFilterPanelOpen(!filterPanelOpen)}
        variant="outline"
        size="sm"
        className="w-full justify-between"
        aria-label={t("buildMap.filters")}
        aria-expanded={filterPanelOpen}
      >
        <span className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          <span>{t("buildMap.filters")}</span>
        </span>
        {activeFiltersCount > 0 && (
          <span className="w-4 h-4 bg-brand-500 text-white text-xs rounded-full flex items-center justify-center">
            {activeFiltersCount}
          </span>
        )}
      </Button>

      {/* Filter panel */}
      {filterPanelOpen && (
        <div className="space-y-4 pt-2 border-t border-border-primary">
          {/* Search */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("buildMap.search")}
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("buildMap.searchPlaceholder")}
              className="w-full px-3 py-2 text-sm bg-bg-elevated border border-border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Type filters */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("buildMap.filterTypes")}
            </label>
            <div className="flex flex-wrap gap-1">
              {NODE_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => handleTypeToggle(type)}
                  className={cn(
                    "px-2 py-1 text-xs rounded-full border transition-colors",
                    filters.types.includes(type)
                      ? "bg-brand-500/20 border-brand-500 text-brand-400"
                      : "bg-muted border-border-primary text-muted-foreground hover:bg-muted-foreground/20"
                  )}
                >
                  {t(`buildMap.nodeTypes.${type}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Status filters */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("buildMap.filterStatuses")}
            </label>
            <div className="flex flex-wrap gap-1">
              {NODE_STATUSES.map(status => (
                <button
                  key={status}
                  onClick={() => handleStatusToggle(status)}
                  className={cn(
                    "px-2 py-1 text-xs rounded-full border transition-colors",
                    filters.statuses.includes(status)
                      ? "bg-green-500/20 border-green-500 text-green-400"
                      : "bg-muted border-border-primary text-muted-foreground hover:bg-muted-foreground/20"
                  )}
                >
                  {t(`buildMap.nodeStatuses.${status}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Assignee filters */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("buildMap.filterAssignees")}
            </label>
            <div className="flex flex-wrap gap-1">
              {ASSIGNEES.map(assignee => (
                <button
                  key={assignee}
                  onClick={() => handleAssigneeToggle(assignee)}
                  className={cn(
                    "px-2 py-1 text-xs rounded-full border transition-colors",
                    filters.assignees.includes(assignee)
                      ? "bg-purple-500/20 border-purple-500 text-purple-400"
                      : "bg-muted border-border-primary text-muted-foreground hover:bg-muted-foreground/20"
                  )}
                >
                  {t(`buildMap.assignees.${assignee}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Clear filters */}
          {activeFiltersCount > 0 && (
            <Button
              onClick={() => onFiltersChange({ types: [], statuses: [], assignees: [], search: "" })}
              variant="ghost"
              size="sm"
              className="w-full"
            >
              {t("buildMap.clearFilters")}
            </Button>
          )}
        </div>
      )}

      {/* Import/Export */}
      <div className="flex gap-2 pt-2 border-t border-border-primary">
        <Button onClick={onExport} variant="outline" size="sm" className="flex-1" disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          {t("buildMap.export")}
        </Button>
        <Button onClick={onImport} variant="outline" size="sm" className="flex-1" disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {t("buildMap.import")}
        </Button>
      </div>
    </div>
  );
};

export default BuildMapToolbar;