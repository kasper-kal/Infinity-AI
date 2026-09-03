/**
 * Phase 35: Live Task Display — Main Component
 *
 * Persistent live dashboard showing ALL concurrent Infinity activities.
 * A pill-shaped floating UI element (top-center by default, draggable)
 * inspired by the Dynamic Island concept that shows every active task.
 * Collapsed state: compact pill with task count + primary task progress ring.
 * Expanded state: vertical list of all tasks with progress bars, status icons.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTaskRegistry, useActiveTasks, usePrimaryTask, useTaskCounts } from "@/lib/task-registry";
import { Task, TaskStatus } from "@/lib/task-registry";
import { ProgressRing } from "./ProgressRing";
import { LiveTaskDisplayItem } from "./LiveTaskDisplayItem";

interface LiveTaskDisplayProps {
  /** Initial position */
  initialPosition?: "top-center" | "top-left" | "top-right" | "floating";
  /** Whether to auto-expand on critical tasks */
  autoExpandOnCritical?: boolean;
  /** Custom base URL for API calls */
  baseUrl?: string;
  /** Callback when task is clicked for navigation */
  onNavigate?: (view: string, params?: Record<string, string>) => void;
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  running: 0,
  pending: 1,
  error: 2,
  paused: 3,
  complete: 4,
};

export function LiveTaskDisplay({
  initialPosition = "top-center",
  autoExpandOnCritical = true,
  baseUrl = "",
  onNavigate,
}: LiveTaskDisplayProps) {
  const {
    activeTasks,
    primaryTask,
    taskCounts,
    isInitialized,
  } = useTaskRegistry();

  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>();
  const criticalTaskDetectedRef = useRef(false);

  // Sort active tasks by status priority
  const sortedTasks = useMemo(() => {
    return [...activeTasks].sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      // Then by priority (critical first)
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      // Then by start time
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    });
  }, [activeTasks]);

  // Check for critical tasks that should auto-expand
  useEffect(() => {
    if (!autoExpandOnCritical || isExpanded) return;

    const hasCriticalTask = activeTasks.some(
      (task) =>
        (task.status === "error" || task.priority === "critical") &&
        !criticalTaskDetectedRef.current
    );

    if (hasCriticalTask && !criticalTaskDetectedRef.current) {
      criticalTaskDetectedRef.current = true;
      setIsExpanded(true);

      // Reset detection after a delay
      setTimeout(() => {
        criticalTaskDetectedRef.current = false;
      }, 10000);
    }
  }, [activeTasks, autoExpandOnCritical, isExpanded]);

  // Initialize position
  useEffect(() => {
    const savedPosition = localStorage.getItem("liveTaskDisplayPosition");
    if (savedPosition) {
      try {
        setPosition(JSON.parse(savedPosition));
      } catch {
        // Ignore parse errors
      }
    } else {
      // Default to top-center
      setPosition({ x: window.innerWidth / 2 - 100, y: 16 });
    }
  }, []);

  // Save position on change
  useEffect(() => {
    if (position) {
      localStorage.setItem("liveTaskDisplayPosition", JSON.stringify(position));
    }
  }, [position]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if focused or expanded
      if (!isExpanded && document.activeElement !== pillRef.current) return;

      switch (e.key) {
        case "Enter":
        case " ":
          if (!isExpanded) {
            e.preventDefault();
            setIsExpanded(true);
          }
          break;
        case "Escape":
          if (isExpanded) {
            e.preventDefault();
            setIsExpanded(false);
            pillRef.current?.focus();
          }
          break;
        case "ArrowDown":
          if (isExpanded) {
            e.preventDefault();
            const taskIds = sortedTasks.map((t) => t.id);
            const currentIndex = selectedTaskId ? taskIds.indexOf(selectedTaskId) : -1;
            const nextIndex = Math.min(currentIndex + 1, taskIds.length - 1);
            if (nextIndex >= 0) setSelectedTaskId(taskIds[nextIndex]);
          }
          break;
        case "ArrowUp":
          if (isExpanded) {
            e.preventDefault();
            const taskIds = sortedTasks.map((t) => t.id);
            const currentIndex = selectedTaskId ? taskIds.indexOf(selectedTaskId) : taskIds.length;
            const nextIndex = Math.max(currentIndex - 1, 0);
            if (nextIndex < taskIds.length) setSelectedTaskId(taskIds[nextIndex]);
          }
          break;
        case "Tab":
          if (isExpanded && !e.shiftKey && selectedTaskId === sortedTasks[sortedTasks.length - 1]?.id) {
            // Allow tab to exit
          } else if (isExpanded && e.shiftKey && selectedTaskId === sortedTasks[0]?.id) {
            // Allow shift+tab to exit
          } else if (isExpanded) {
            e.preventDefault();
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, sortedTasks, selectedTaskId]);

  // Drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!position) return;
    e.preventDefault();
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragOffset) return;
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    // Constrain to viewport
    const constrainedX = Math.max(0, Math.min(newX, window.innerWidth - 200));
    const constrainedY = Math.max(0, Math.min(newY, window.innerHeight - 100));
    setPosition({ x: constrainedX, y: constrainedY });
  }, [dragOffset]);

  const handleMouseUp = useCallback(() => {
    setDragOffset(null);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Click outside to collapse
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isExpanded && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded]);

  // Focus management
  useEffect(() => {
    if (isExpanded && expandedRef.current) {
      expandedRef.current.focus();
    }
  }, [isExpanded]);

  if (!isInitialized) {
    return null; // Don't render until initialized
  }

  const totalActive = taskCounts.running + taskCounts.pending;
  const hasActiveTasks = totalActive > 0;

  // Only show if there are active tasks or we're expanded
  if (!hasActiveTasks && !isExpanded) {
    return null;
  }

  const handleTaskClick = useCallback(
    (task: Task) => {
      setSelectedTaskId(task.id);
      if (onNavigate) {
        // Navigation handled by LiveTaskDisplayItem
      }
    },
    [onNavigate]
  );

  // Collapsed pill
  const pillContent = (
    <div
      ref={pillRef}
      tabIndex={0}
      role="button"
      aria-label={isExpanded ? "Collapse task display" : `Expand task display, ${totalActive} active tasks`}
      aria-expanded={isExpanded}
      aria-haspopup="listbox"
      onClick={() => setIsExpanded(!isExpanded)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsExpanded(!isExpanded);
        }
      }}
      onMouseDown={handleMouseDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 16px",
        backgroundColor: "var(--color-surface, #fff)",
        borderRadius: "9999px",
        boxShadow: "var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.15))",
        border: "1px solid var(--color-border, #e0e0e0)",
        cursor: isExpanded ? "default" : "grab",
        userSelect: "none",
        transition: "box-shadow 0.2s ease, transform 0.2s ease",
        zIndex: 1000,
      }}
      onMouseEnter={(e) => {
        if (!isExpanded) e.currentTarget.style.boxShadow = "var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.2))";
      }}
      onMouseLeave={(e) => {
        if (!isExpanded) e.currentTarget.style.boxShadow = "var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.15))";
      }}
    >
      {/* Progress ring for primary task */}
      {primaryTask && (
        <ProgressRing
          progress={primaryTask.progress}
          size={28}
          strokeWidth={3}
          ariaLabel={`${primaryTask.title} progress: ${Math.round(primaryTask.progress)}%`}
        />
      )}

      {/* Task count */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--color-text, #1a1a1a)",
            lineHeight: 1,
          }}
        >
          {totalActive} {totalActive === 1 ? "active task" : "active tasks"}
        </span>
        {primaryTask && (
          <span
            style={{
              fontSize: "10px",
              color: "var(--color-text-muted, #888)",
              lineHeight: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "200px",
            }}
          >
            {primaryTask.title}
          </span>
        )}
      </div>

      {/* Expand/collapse indicator */}
      <span
        style={{
          color: "var(--color-text-muted, #aaa)",
          fontSize: "14px",
          transition: "transform 0.2s ease",
          transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
        }}
        aria-hidden="true"
      >
        ‹
      </span>
    </div>
  );

  // Expanded panel
  const expandedContent = isExpanded ? (
    <div
      ref={expandedRef}
      tabIndex={-1}
      role="listbox"
      aria-label="Active tasks"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: "8px",
        backgroundColor: "var(--color-surface, #fff)",
        borderRadius: "16px",
        boxShadow: "var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.2))",
        border: "1px solid var(--color-border, #e0e0e0)",
        overflow: "hidden",
        maxHeight: "400px",
        overflowY: "auto",
        zIndex: 1001,
        animation: "slideDown 0.2s ease-out",
      }}
    >
      <style jsx>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border, #e0e0e0)",
          backgroundColor: "var(--color-surface-hover, #fafafa)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-text, #1a1a1a)" }}>
          Live Tasks
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: "9999px",
              backgroundColor: "var(--color-success-bg, #d4edda)",
              color: "var(--color-success-text, #155724)",
            }}
          >
            {taskCounts.running} running
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: "9999px",
              backgroundColor: "var(--color-warning-bg, #fff3cd)",
              color: "var(--color-warning-text, #856404)",
            }}
          >
            {taskCounts.pending} pending
          </span>
          {taskCounts.error > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 500,
                padding: "2px 8px",
                borderRadius: "9999px",
                backgroundColor: "var(--color-error-bg, #f8d7da)",
                color: "var(--color-error-text, #721c24)",
              }}
            >
              {taskCounts.error} error
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
            }}
            aria-label="Collapse"
            style={{
              padding: "6px",
              borderRadius: "8px",
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted, #888)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Task list */}
      {sortedTasks.length === 0 ? (
        <div
          style={{
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--color-text-muted, #888)",
          }}
        >
          <span style={{ fontSize: "32px", display: "block", marginBottom: "8px" }}>🎉</span>
          <p>No active tasks</p>
        </div>
      ) : (
        <div role="list" style={{ padding: "8px" }}>
          {sortedTasks.map((task) => (
            <LiveTaskDisplayItem
              key={task.id}
              task={task}
              onClick={() => handleTaskClick(task)}
              onNavigate={onNavigate || (() => {})}
              isSelected={selectedTaskId === task.id}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--color-border, #e0e0e0)",
          backgroundColor: "var(--color-surface-hover, #fafafa)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "12px",
          color: "var(--color-text-muted, #888)",
        }}
      >
        <span>Updates in real-time via SSE</span>
        <span>Click task to navigate</span>
      </div>
    </div>
  ) : null;

  // Position styles
  const containerStyle = useMemo(() => {
    if (!position) return { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)" };

    return {
      position: "fixed",
      left: position.x,
      top: position.y,
      transform: "none",
      zIndex: 9999,
    };
  }, [position]);

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {pillContent}
      {expandedContent}
    </div>
  );
}

// Named export for the provider
export { LiveTaskDisplay as default };