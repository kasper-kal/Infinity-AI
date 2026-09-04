/**
 * Phase 35: Live Task Display — Task Item
 *
 * Individual task row in the expanded Live Task Display.
 * Shows task type icon, title, progress bar, status, and time elapsed.
 */

import { useMemo } from "react";
import { Task, TaskType, TaskStatus } from "@/lib/task-registry";

interface LiveTaskDisplayItemProps {
  task: Task;
  onClick: () => void;
  onNavigate: (view: string, params?: Record<string, string>) => void;
  isSelected?: boolean;
}

const TASK_TYPE_ICONS: Record<TaskType, string> = {
  build: "🔨",
  research: "🔍",
  write: "📝",
  automation: "⚙️",
  "agent-loop": "🤖",
  deploy: "🚀",
  chat: "💬",
  migration: "🔄",
  sync: "☁️",
};

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  build: "Build",
  research: "Research",
  write: "Write",
  automation: "Automation",
  "agent-loop": "Agent",
  deploy: "Deploy",
  chat: "Chat",
  migration: "Migration",
  sync: "Sync",
};

const STATUS_COLORS: Record<TaskStatus, { bg: string; text: string; icon: string }> = {
  pending: { bg: "var(--color-warning-bg, #fff3cd)", text: "var(--color-warning-text, #856404)", icon: "⏳" },
  running: { bg: "var(--color-info-bg, #cce5ff)", text: "var(--color-info-text, #004085)", icon: "▶️" },
  complete: { bg: "var(--color-success-bg, #d4edda)", text: "var(--color-success-text, #155724)", icon: "✅" },
  error: { bg: "var(--color-error-bg, #f8d7da)", text: "var(--color-error-text, #721c24)", icon: "❌" },
  paused: { bg: "var(--color-muted-bg, #e2e3e5)", text: "var(--color-muted-text, #383d41)", icon: "⏸️" },
};

const PRIORITY_INDICATORS: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  normal: "🟡",
  low: "🟢",
};

function formatTimeElapsed(startedAt: string): string {
  const started = new Date(startedAt).getTime();
  const now = Date.now();
  const diff = now - started;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function getNavigationTarget(task: Task): { view: string; params?: Record<string, string> } | null {
  const { type, metadata } = task;

  switch (type) {
    case "build":
      if (metadata.projectId) return { view: "build", params: { projectId: metadata.projectId as string, tab: "buildMap" } };
      break;
    case "research":
      if (metadata.reportId) return { view: "research", params: { reportId: metadata.reportId as string } };
      break;
    case "write":
      if (metadata.bookId) return { view: "write", params: { bookId: metadata.bookId as string } };
      break;
    case "automation":
      if (metadata.automationId) return { view: "automation", params: { automationId: metadata.automationId as string } };
      break;
    case "agent-loop":
      if (metadata.agentId) return { view: "agent", params: { agentId: metadata.agentId as string } };
      break;
    case "deploy":
      if (metadata.projectId) return { view: "build", params: { projectId: metadata.projectId as string, tab: "deploy" } };
      break;
    case "chat":
      if (metadata.conversationId) return { view: "chat", params: { conversationId: metadata.conversationId as string } };
      break;
    case "migration":
    case "sync":
      return { view: "settings", params: { section: type } };
  }
  return null;
}

export function LiveTaskDisplayItem({ task, onClick, onNavigate, isSelected = false }: LiveTaskDisplayItemProps) {
  const typeIcon = useMemo(() => TASK_TYPE_ICONS[task.type] || "📋", [task.type]);
  const typeLabel = useMemo(() => TASK_TYPE_LABELS[task.type] || task.type, [task.type]);
  const statusStyle = useMemo(() => STATUS_COLORS[task.status] || STATUS_COLORS.pending, [task.status]);
  const priorityIndicator = useMemo(() => PRIORITY_INDICATORS[task.priority] || "⚪", [task.priority]);
  const timeElapsed = useMemo(() => formatTimeElapsed(task.startedAt), [task.startedAt]);
  const navTarget = useMemo(() => getNavigationTarget(task), [task]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
    if (navTarget) {
      onNavigate(navTarget.view, navTarget.params);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(e as unknown as React.MouseEvent);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderRadius: "12px",
        backgroundColor: isSelected ? "var(--color-accent-bg, #e8f0fe)" : "transparent",
        cursor: "pointer",
        transition: "background-color 0.15s ease",
        border: isSelected ? "2px solid var(--color-accent, #0066ff)" : "none",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "var(--color-hover-bg, #f5f5f5)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {/* Task type icon + priority */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
        <span style={{ fontSize: "18px" }} aria-hidden="true">{typeIcon}</span>
        <span style={{ fontSize: "12px" }} aria-label={`Priority: ${task.priority}`}>{priorityIndicator}</span>
      </div>

      {/* Task info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: "14px",
              color: "var(--color-text, #1a1a1a)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {task.title}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              padding: "2px 6px",
              borderRadius: "4px",
              backgroundColor: statusStyle.bg,
              color: statusStyle.text,
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span aria-hidden="true">{statusStyle.icon}</span>
            {task.status}
          </span>
        </div>

        <div
          style={{
            fontSize: "12px",
            color: "var(--color-text-muted, #666)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginBottom: "6px",
          }}
        >
          {task.description}
        </div>

        {/* Progress bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              flex: 1,
              height: "6px",
              backgroundColor: "var(--color-border, #e0e0e0)",
              borderRadius: "3px",
              overflow: "hidden",
            }}
            role="progressbar"
            aria-valuenow={task.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${task.title} progress`}
          >
            <div
              style={{
                width: `${task.progress}%`,
                height: "100%",
                backgroundColor: "var(--color-accent, #0066ff)",
                borderRadius: "3px",
                transition: "width 0.3s ease-out",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-text, #1a1a1a)",
              minWidth: "40px",
              textAlign: "right",
            }}
          >
            {task.progress}%
          </span>
        </div>

        {/* Time elapsed + type label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginTop: "6px",
            fontSize: "11px",
            color: "var(--color-text-muted, #888)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span aria-hidden="true">⏱️</span>
            {timeElapsed}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span aria-hidden="true">🏷️</span>
            {typeLabel}
          </span>
        </div>
      </div>

      {/* Chevron indicator */}
      <span
        style={{
          color: "var(--color-text-muted, #aaa)",
          fontSize: "16px",
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        ›
      </span>
    </div>
  );
}