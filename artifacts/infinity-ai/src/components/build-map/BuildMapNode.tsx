/**
 * BuildMapNode Component
 * Renders a single node in the visual build map
 */

import React, { useMemo, useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  type BuildMapNode,
  type BuildMapNodeType,
  type BuildMapNodeStatus,
  type BuildMapAssignee,
} from "@/hooks/useBuildMap";

// Node type colors and icons
const NODE_TYPE_CONFIG: Record<BuildMapNodeType, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  feature: { color: "text-purple-400", bgColor: "bg-purple-500/20", icon: <FeatureIcon />, label: "Feature" },
  component: { color: "text-blue-400", bgColor: "bg-blue-500/20", icon: <ComponentIcon />, label: "Component" },
  page: { color: "text-cyan-400", bgColor: "bg-cyan-500/20", icon: <PageIcon />, label: "Page" },
  api: { color: "text-orange-400", bgColor: "bg-orange-500/20", icon: <ApiIcon />, label: "API" },
  integration: { color: "text-pink-400", bgColor: "bg-pink-500/20", icon: <IntegrationIcon />, label: "Integration" },
  test: { color: "text-green-400", bgColor: "bg-green-500/20", icon: <TestIcon />, label: "Test" },
  doc: { color: "text-yellow-400", bgColor: "bg-yellow-500/20", icon: <DocIcon />, label: "Doc" },
  database: { color: "text-red-400", bgColor: "bg-red-500/20", icon: <DatabaseIcon />, label: "Database" },
  model: { color: "text-indigo-400", bgColor: "bg-indigo-500/20", icon: <ModelIcon />, label: "Model" },
  config: { color: "text-gray-400", bgColor: "bg-gray-500/20", icon: <ConfigIcon />, label: "Config" },
  deployment: { color: "text-teal-400", bgColor: "bg-teal-500/20", icon: <DeploymentIcon />, label: "Deployment" },
};

// Status colors
const STATUS_CONFIG: Record<BuildMapNodeStatus, { color: string; bgColor: string; label: string }> = {
  planned: { color: "text-gray-400", bgColor: "bg-gray-500/20", label: "Planned" },
  "in-progress": { color: "text-brand-400", bgColor: "bg-brand-500/20", label: "In Progress" },
  review: { color: "text-yellow-400", bgColor: "bg-yellow-500/20", label: "Review" },
  done: { color: "text-green-400", bgColor: "bg-green-500/20", label: "Done" },
  blocked: { color: "text-red-400", bgColor: "bg-red-500/20", label: "Blocked" },
  archived: { color: "text-gray-500", bgColor: "bg-gray-500/10", label: "Archived" },
};

// Assignee colors
const ASSIGNEE_CONFIG: Record<BuildMapAssignee, { color: string; icon: React.ReactNode; label: string }> = {
  human: { color: "text-blue-400", icon: <HumanIcon />, label: "Human" },
  agent: { color: "text-purple-400", icon: <AgentIcon />, label: "Agent" },
  unassigned: { color: "text-gray-400", icon: <UnassignedIcon />, label: "Unassigned" },
};

// Icons
function FeatureIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>; }
function ComponentIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>; }
function PageIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>; }
function ApiIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IntegrationIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>; }
function TestIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/></svg>; }
function DocIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>; }
function DatabaseIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 3.3 3 7.5 3s7.5-1.3 7.5-3V5"/><path d="M3 12c0 1.7 3.3 3 7.5 3s7.5-1.3 7.5-3"/></svg>; }
function ModelIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>; }
function ConfigIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>; }
function DeploymentIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function HumanIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function AgentIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 17h8"/><path d="M12 13v4"/></svg>; }
function UnassignedIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 16l8-8"/></svg>; }

interface BuildMapNodeProps {
  node: BuildMapNode;
  selected: boolean;
  zoom: number;
  onSelect: (node: BuildMapNode) => void;
  onDrag: (nodeId: string, deltaX: number, deltaY: number) => void;
  onDragEnd: (nodeId: string, x: number, y: number) => void;
  onDoubleClick?: (node: BuildMapNode) => void;
  showDetails?: boolean;
}

export const BuildMapNode: React.FC<BuildMapNodeProps> = ({
  node,
  selected,
  zoom,
  onSelect,
  onDrag,
  onDragEnd,
  onDoubleClick,
  showDetails = false,
}) => {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const nodeRef = useRef<HTMLDivElement>(null);

  const typeConfig = NODE_TYPE_CONFIG[node.type];
  const statusConfig = STATUS_CONFIG[node.status];
  const assigneeConfig = ASSIGNEE_CONFIG[node.assignee];

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    onSelect(node);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const deltaX = (e.clientX - dragStart.x) / zoom;
    const deltaY = (e.clientY - dragStart.y) / zoom;
    onDrag(node.id, deltaX, deltaY);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    if (dragging && nodeRef.current) {
      const x = parseFloat(nodeRef.current.style.left) || node.position?.x || 0;
      const y = parseFloat(nodeRef.current.style.top) || node.position?.y || 0;
      onDragEnd(node.id, x, y);
    }
    setDragging(false);
  };

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove as EventListener);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove as EventListener);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, dragStart, zoom, node.id, onDrag, onDragEnd]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.(node);
  };

  const position = node.position || { x: 0, y: 0 };
  const scale = Math.max(0.5, Math.min(2, zoom));
  const width = Math.max(180, Math.min(280, 220 * scale));
  const fontSize = Math.max(10, Math.min(14, 12 * scale));

  return (
    <div
      ref={nodeRef}
      className={cn(
        "absolute transition-all duration-150 cursor-grab select-none",
        "hover:z-20",
        selected && "z-30 ring-2 ring-brand-500",
        dragging && "cursor-grabbing opacity-90",
        node.status === "archived" && "opacity-50"
      )}
      style={{
        left: position.x,
        top: position.y,
        width,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onClick={(e) => { e.stopPropagation(); onSelect(node); }}
    >
      {/* Node Card */}
      <div
        className={cn(
          "rounded-xl border border-border-primary/50 glass-strong",
          "shadow-lg",
          selected && "ring-2 ring-brand-500/50 shadow-xl",
          typeConfig.bgColor
        )}
        style={{ minWidth: "100%" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 p-3 border-b border-border-primary/30">
          <span className={cn("flex-shrink-0", typeConfig.color)}>
            {typeConfig.icon}
          </span>
          <span className="text-xs font-medium truncate" title={typeConfig.label}>
            {t(`buildMap.nodeTypes.${node.type}`)}
          </span>
          <div className="flex-1" />
          {/* Priority badge */}
          <span className={cn(
            "text-xs font-mono px-1.5 py-0.5 rounded",
            node.priority >= 8 ? "bg-red-500/20 text-red-400" :
            node.priority >= 5 ? "bg-yellow-500/20 text-yellow-400" :
            "bg-green-500/20 text-green-400"
          )}>
            P{node.priority}
          </span>
        </div>

        {/* Title */}
        <div className="p-3">
          <h4 className="font-semibold text-foreground truncate" style={{ fontSize }} title={node.title}>
            {node.title}
          </h4>

          {/* Description */}
          {node.description && showDetails && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2" style={{ fontSize }}>
              {node.description}
            </p>
          )}

          {/* Tags */}
          {node.tags.length > 0 && showDetails && (
            <div className="flex flex-wrap gap-1 mt-2" style={{ fontSize }}>
              {node.tags.slice(0, 4).map(tag => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
              {node.tags.length > 4 && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                  +{node.tags.length - 4}
                </span>
              )}
            </div>
          )}

          {/* Files count */}
          {node.files.length > 0 && showDetails && (
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground" style={{ fontSize }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>{node.files.length} file{node.files.length !== 1 ? "s" : ""}</span>
            </div>
          )}

          {/* Status & Assignee */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-primary/30" style={{ fontSize }}>
            <span
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                statusConfig.bgColor,
                statusConfig.color
              )}
            >
              {t(`buildMap.nodeStatuses.${node.status}`)}
            </span>
            <span
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
                `bg-${assigneeConfig.color.replace("text-", "").replace("-400", "-500/20")}`,
                assigneeConfig.color
              )}
            >
              {assigneeConfig.icon}
              <span>{assigneeConfig.label}</span>
            </span>
          </div>

          {/* Estimate */}
          {node.estimate && showDetails && (
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground" style={{ fontSize }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>{t("buildMap.estimate")}: {node.estimate}h</span>
              {node.actualTime && (
                <>
                  <span>/</span>
                  <span className={node.actualTime > node.estimate ? "text-red-400" : "text-green-400"}>
                    {node.actualTime}h
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Dependencies indicator */}
        {(node.dependencies.length > 0 || node.dependents.length > 0) && showDetails && (
          <div className="px-3 pb-3 flex items-center justify-between text-xs text-muted-foreground border-t border-border-primary/30" style={{ fontSize }}>
            {node.dependencies.length > 0 && (
              <span className="flex items-center gap-1" title={t("buildMap.dependsOn")}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                {node.dependencies.length}
              </span>
            )}
            {node.dependents.length > 0 && (
              <span className="flex items-center gap-1" title={t("buildMap.dependents")}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 11V5a2 2 0 0 1 2-2h6"/>
                  <polyline points="9 21 3 21 3 15"/>
                  <line x1="14" y1="10" x2="3" y2="21"/>
                </svg>
                {node.dependents.length}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Selection ring */}
      {selected && (
        <div
          className="absolute -inset-1.5 rounded-xl border-2 border-brand-500/50 animate-pulse"
          style={{ pointerEvents: "none" }}
        />
      )}
    </div>
  );
};

export default BuildMapNode;