"use client";

/**
 * Phase 33: AI Automation System — Automation Flow Visualizer
 *
 * SVG-based visual flowchart for automation (trigger → conditions → actions)
 * No external dependencies - pure React + SVG
 */

import React, { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Minimize2, Maximize2, ZoomIn, ZoomOut, RotateCcw, Download } from "lucide-react";
import type { AutomationSpec, AutomationTrigger, AutomationAction, AutomationTriggerType, AutomationActionType } from "@workspace/api-server/src/lib/automation-parser";

interface AutomationFlowProps {
  spec: AutomationSpec;
  className?: string;
  interactive?: boolean;
}

const TRIGGER_TYPE_COLORS: Record<AutomationTriggerType, string> = {
  cron: "#8b5cf6",
  webhook: "#06b6d4",
  manual: "#6366f1",
  api_call: "#f59e0b",
  connector_event: "#ec4899",
};

const ACTION_TYPE_COLORS: Record<AutomationActionType, string> = {
  connector_action: "#10b981",
  notification: "#f97316",
  code_execution: "#6366f1",
  llm_call: "#8b5cf6",
  data_transform: "#06b6d4",
  http_request: "#f59e0b",
  delay: "#6b7280",
  conditional: "#ec4899",
  loop: "#84cc16",
  parallel: "#14b8a6",
};

const TRIGGER_TYPE_ICONS: Record<AutomationTriggerType, React.ReactNode> = {
  cron: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  webhook: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
  manual: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  api_call: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>,
  connector_event: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
};

const ACTION_TYPE_ICONS: Record<AutomationActionType, React.ReactNode> = {
  connector_action: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  notification: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  code_execution: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  llm_call: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>,
  data_transform: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  http_request: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>,
  delay: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  conditional: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
  loop: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  parallel: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>,
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const NODE_RADIUS = 8;
const H_SPACING = 240;
const V_SPACING = 100;

export const AutomationFlow: React.FC<AutomationFlowProps> = ({
  spec,
  className = "",
  interactive = true,
}) => {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showAll, setShowAll] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const nodes = useMemo(() => {
    const result: Array<{
      id: string;
      type: "trigger" | "condition" | "action";
      label: string;
      subtitle?: string;
      color: string;
      icon: React.ReactNode;
      x: number;
      y: number;
      data: any;
      children?: string[];
    }> = [];

    // Trigger node
    const trigger = spec.trigger;
    result.push({
      id: "trigger",
      type: "trigger",
      label: TRIGGER_TYPE_LABELS[trigger.type],
      subtitle: getTriggerSubtitle(trigger),
      color: TRIGGER_TYPE_COLORS[trigger.type],
      icon: TRIGGER_TYPE_ICONS[trigger.type],
      x: 0,
      y: 0,
      data: trigger,
    });

    let yOffset = V_SPACING;

    // Conditions
    if (spec.conditions && spec.conditions.length > 0) {
      spec.conditions.forEach((cond, i) => {
        result.push({
          id: `condition-${cond.id || i}`,
          type: "condition",
          label: cond.field,
          subtitle: `${cond.operator} ${cond.value !== undefined ? JSON.stringify(cond.value) : cond.customExpression || ""}`,
          color: "#f59e0b",
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
          x: 0,
          y: yOffset,
          data: cond,
        });
        yOffset += V_SPACING;
      });
    }

    // Actions (main flow)
    spec.actions.forEach((action, i) => {
      const actionNodes = flattenActions(action, `action-${i}`, 0);
      actionNodes.forEach((an, idx) => {
        result.push({
          ...an,
          x: 0,
          y: yOffset,
        });
        yOffset += V_SPACING;
      });
    });

    // Center horizontally
    result.forEach(node => {
      node.x = -NODE_WIDTH / 2;
    });

    return result;
  }, [spec]);

  const edges = useMemo(() => {
    const result: Array<{ from: string; to: string; type: "main" | "branch" }> = [];
    let prevId = "trigger";

    // Trigger -> first condition or action
    if (spec.conditions && spec.conditions.length > 0) {
      result.push({ from: "trigger", to: `condition-${spec.conditions[0].id || 0}`, type: "main" });
      spec.conditions.forEach((cond, i) => {
        const currId = `condition-${cond.id || i}`;
        if (i < spec.conditions.length - 1) {
          result.push({ from: currId, to: `condition-${spec.conditions[i + 1].id || i + 1}`, type: "main" });
        } else if (spec.actions.length > 0) {
          result.push({ from: currId, to: "action-0", type: "main" });
        }
        prevId = currId;
      });
    } else if (spec.actions.length > 0) {
      result.push({ from: "trigger", to: "action-0", type: "main" });
    }

    // Actions chain
    spec.actions.forEach((action, i) => {
      const currId = `action-${i}`;
      if (i < spec.actions.length - 1) {
        result.push({ from: currId, to: `action-${i + 1}`, type: "main" });
      }

      // Branches
      if (action.thenActions?.length) {
        action.thenActions.forEach((ba, bi) => {
          const branchId = `${currId}-then-${bi}`;
          result.push({ from: currId, to: branchId, type: "branch" });
        });
      }
      if (action.elseActions?.length) {
        action.elseActions.forEach((ba, bi) => {
          const branchId = `${currId}-else-${bi}`;
          result.push({ from: currId, to: branchId, type: "branch" });
        });
      }
      if (action.loopActions?.length) {
        action.loopActions.forEach((la, li) => {
          const loopId = `${currId}-loop-${li}`;
          result.push({ from: currId, to: loopId, type: "branch" });
        });
      }
      if (action.parallelActions?.length) {
        action.parallelActions.forEach((pa, pi) => {
          const parId = `${currId}-parallel-${pi}`;
          result.push({ from: currId, to: parId, type: "branch" });
        });
      }
    });

    return result;
  }, [spec]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const newZoom = Math.min(Math.max(zoom - e.deltaY * 0.001, 0.3), 2);
      setZoom(newZoom);
    } else {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const downloadSVG = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgRef.current);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `automation-flow-${spec.settings.name}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getViewBox = () => {
    const heights = nodes.map(n => n.y + NODE_HEIGHT);
    const maxHeight = Math.max(...heights, 400);
    return `0 -${maxHeight / 2} ${NODE_WIDTH} ${maxHeight}`;
  };

  return (
    <div className={`relative ${className}`} onWheel={handleWheel}>
      {/* Toolbar */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-bg-elevated/90 backdrop-blur rounded-lg border border-border-primary p-1">
        <Button variant="ghost" size="icon" onClick={() => setZoom(Math.min(zoom + 0.2, 2))} title={t("automation.flow.zoomIn")}>
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setZoom(Math.max(zoom - 0.2, 0.3))} title={t("automation.flow.zoomOut")}>
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={resetView} title={t("automation.flow.resetView")}>
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={downloadSVG} title={t("automation.flow.download")}>
          <Download className="w-4 h-4" />
        </Button>
        <span className="px-2 text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
      </div>

      {/* SVG Flowchart */}
      <div
        className="relative overflow-auto"
        style={{
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          transformOrigin: "top center",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={getViewBox()}
          preserveAspectRatio="xMidYMin meet"
          className="w-full h-full min-h-[400px]"
          style={{ minHeight: "400px" }}
        >
          <defs>
            {/* Arrow marker */}
            <marker id="arrowhead-main" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
            </marker>
            <marker id="arrowhead-branch" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
            </marker>
            {/* Gradient for trigger */}
            <linearGradient id="trigger-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={nodes.find(n => n.id === "trigger")?.color || "#8b5cf6"} stopOpacity="0.2" />
              <stop offset="100%" stopColor={nodes.find(n => n.id === "trigger")?.color || "#8b5cf6"} stopOpacity="0.05" />
            </linearGradient>
            {/* Drop shadow */}
            <filter id="drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.1" />
            </filter>
          </defs>

          {/* Edges */}
          <g strokeWidth="2" fill="none">
            {edges.map((edge, i) => {
              const fromNode = nodes.find(n => n.id === edge.from);
              const toNode = nodes.find(n => n.id === edge.to);
              if (!fromNode || !toNode) return null;

              const fromX = fromNode.x + NODE_WIDTH;
              const fromY = fromNode.y + NODE_HEIGHT / 2;
              const toX = toNode.x;
              const toY = toNode.y + NODE_HEIGHT / 2;

              const midX = (fromX + toX) / 2;

              return (
                <path
                  key={i}
                  d={`M${fromX} ${fromY} C${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
                  stroke={edge.type === "main" ? "#64748b" : "#94a3b8"}
                  strokeDasharray={edge.type === "branch" ? "5,5" : "none"}
                  markerEnd={`url(#arrowhead-${edge.type})`}
                  style={{ filter: "url(#drop-shadow)" }}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((node) => (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                {/* Node background */}
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={NODE_RADIUS}
                  fill={node.type === "trigger" ? "url(#trigger-gradient)" : "white"}
                  stroke={node.color}
                  strokeWidth={node.type === "trigger" ? 2 : 1.5}
                  filter="url(#drop-shadow)"
                />

                {/* Color indicator bar */}
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={NODE_HEIGHT}
                  rx={NODE_RADIUS}
                  fill={node.color}
                />

                {/* Icon */}
                <g transform="translate(16, 15)">
                  <span style={{ color: node.color }}>{node.icon}</span>
                </g>

                {/* Label */}
                <text
                  x={50}
                  y={25}
                  fontSize="13"
                  fontWeight="600"
                  fill="#1e293b"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {node.label}
                </text>

                {/* Subtitle */}
                {node.subtitle && (
                  <text
                    x={50}
                    y={44}
                    fontSize="11"
                    fill="#64748b"
                    fontFamily="system-ui, -apple-system, sans-serif"
                  >
                    {node.subtitle.length > 35 ? node.subtitle.slice(0, 35) + "..." : node.subtitle}
                  </text>
                )}

                {/* Type badge */}
                <text
                  x={NODE_WIDTH - 12}
                  y={18}
                  fontSize="9"
                  fontWeight="600"
                  fill={node.color}
                  textAnchor="end"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  textTransform="uppercase"
                >
                  {node.type === "trigger" ? "TRIGGER" : node.type.toUpperCase()}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 bg-bg-elevated/90 backdrop-blur rounded-lg border border-border-primary p-3 text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ background: TRIGGER_TYPE_COLORS.cron }} />
            <span className="text-muted-foreground">Trigger</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ background: "#f59e0b" }} />
            <span className="text-muted-foreground">Condition</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ background: ACTION_TYPE_COLORS.connector_action }} />
            <span className="text-muted-foreground">Action</span>
          </div>
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" className="w-3 h-3">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <span className="text-muted-foreground">Main Flow</span>
          </div>
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5,5" className="w-3 h-3">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <span className="text-muted-foreground">Branch</span>
          </div>
        </div>
      </div>
    </div>
  );
};

function flattenActions(action: AutomationAction, prefix: string, depth: number): Array<{
  id: string;
  type: "action";
  label: string;
  subtitle?: string;
  color: string;
  icon: React.ReactNode;
  x: number;
  y: number;
  data: any;
}> {
  const result: Array<{
    id: string;
    type: "action";
    label: string;
    subtitle?: string;
    color: string;
    icon: React.ReactNode;
    x: number;
    y: number;
    data: any;
  }> = [];

  result.push({
    id: prefix,
    type: "action",
    label: action.name,
    subtitle: getActionSubtitle(action),
    color: ACTION_TYPE_COLORS[action.type],
    icon: ACTION_TYPE_ICONS[action.type],
    x: 0,
    y: 0,
    data: action,
  });

  // Then branch
  if (action.thenActions?.length) {
    action.thenActions.forEach((ba, i) => {
      result.push({
        id: `${prefix}-then-${i}`,
        type: "action",
        label: `↳ ${ba.name}`,
        subtitle: `then: ${getActionSubtitle(ba)}`,
        color: ACTION_TYPE_COLORS[ba.type],
        icon: ACTION_TYPE_ICONS[ba.type],
        x: 0,
        y: 0,
        data: { ...ba, branch: "then" },
      });
    });
  }

  // Else branch
  if (action.elseActions?.length) {
    action.elseActions.forEach((ba, i) => {
      result.push({
        id: `${prefix}-else-${i}`,
        type: "action",
        label: `↳ ${ba.name}`,
        subtitle: `else: ${getActionSubtitle(ba)}`,
        color: ACTION_TYPE_COLORS[ba.type],
        icon: ACTION_TYPE_ICONS[ba.type],
        x: 0,
        y: 0,
        data: { ...ba, branch: "else" },
      });
    });
  }

  // Loop actions
  if (action.loopActions?.length) {
    action.loopActions.forEach((la, i) => {
      result.push({
        id: `${prefix}-loop-${i}`,
        type: "action",
        label: `↻ ${la.name}`,
        subtitle: `loop: ${getActionSubtitle(la)}`,
        color: ACTION_TYPE_COLORS[la.type],
        icon: ACTION_TYPE_ICONS[la.type],
        x: 0,
        y: 0,
        data: { ...la, branch: "loop" },
      });
    });
  }

  // Parallel actions
  if (action.parallelActions?.length) {
    action.parallelActions.forEach((pa, i) => {
      result.push({
        id: `${prefix}-parallel-${i}`,
        type: "action",
        label: `⟳ ${pa.name}`,
        subtitle: `parallel: ${getActionSubtitle(pa)}`,
        color: ACTION_TYPE_COLORS[pa.type],
        icon: ACTION_TYPE_ICONS[pa.type],
        x: 0,
        y: 0,
        data: { ...pa, branch: "parallel" },
      });
    });
  }

  return result;
}

function getTriggerSubtitle(trigger: AutomationTrigger): string {
  switch (trigger.type) {
    case "cron":
      return trigger.cronExpression || "";
    case "webhook":
      return trigger.webhookPath || "";
    case "connector_event":
      return `${trigger.connectorId} → ${trigger.connectorEvent}`;
    case "api_call":
      return trigger.apiPath || "";
    case "manual":
      return "Manual trigger";
    default:
      return "";
  }
}

function getActionSubtitle(action: AutomationAction): string {
  switch (action.type) {
    case "connector_action":
      return `${action.connectorId} → ${action.connectorAction}`;
    case "notification":
      return `${action.notificationChannel} → ${action.notificationRecipients?.join(", ")}`;
    case "code_execution":
      return action.code?.slice(0, 40) + (action.code && action.code.length > 40 ? "..." : "") || "";
    case "llm_call":
      return action.llmPrompt?.slice(0, 40) + (action.llmPrompt && action.llmPrompt.length > 40 ? "..." : "") || "";
    case "data_transform":
      return action.transformType || "";
    case "http_request":
      return `${action.httpMethod} ${action.httpUrl?.slice(0, 30)}`;
    case "delay":
      return `${action.delayMs}ms`;
    case "conditional":
      return `if/else`;
    case "loop":
      return `${action.loopType} ${action.loopCount || action.loopCollection || ""}`;
    case "parallel":
      return `${action.parallelActions?.length} parallel`;
    default:
      return "";
  }
}

const TRIGGER_TYPE_LABELS: Record<AutomationTriggerType, string> = {
  cron: "Scheduled (Cron)",
  webhook: "Webhook",
  manual: "Manual",
  api_call: "API Call",
  connector_event: "Connector Event",
};

export default AutomationFlow;