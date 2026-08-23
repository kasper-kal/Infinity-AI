/**
 * Panel Component — Liquid Glass Design System
 * Flexible container panels for layout composition
 */

import React, { useState, useCallback, useMemo, ReactNode } from "react";
import "./Panel.css";

export interface PanelProps {
  /** Panel content */
  children: ReactNode;
  /** Panel title */
  title?: string;
  /** Panel subtitle */
  subtitle?: string;
  /** Header action elements */
  headerActions?: ReactNode;
  /** Panel variant */
  variant?: "default" | "elevated" | "outlined" | "filled" | "glass";
  /** Panel size */
  size?: "sm" | "md" | "lg" | "full";
  /** Collapsible */
  collapsible?: boolean;
  /** Default expanded state */
  defaultExpanded?: boolean;
  /** Controlled expanded state */
  expanded?: boolean;
  /** On expand toggle */
  onExpandToggle?: (expanded: boolean) => void;
  /** Resizable */
  resizable?: boolean;
  /** Min/max height for resize */
  minHeight?: number;
  maxHeight?: number;
  /** Scrollable content */
  scrollable?: boolean;
  /** Padding */
  padding?: "none" | "sm" | "md" | "lg";
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  /** Theme */
  theme?: "light" | "dark" | "auto";
  /** Test id */
  testId?: string;
}

export const Panel: React.FC<PanelProps> = ({
  children,
  title,
  subtitle,
  headerActions,
  variant = "default",
  size = "md",
  collapsible = false,
  defaultExpanded = true,
  expanded: controlledExpanded,
  onExpandToggle,
  resizable = false,
  minHeight = 100,
  maxHeight = 800,
  scrollable = false,
  padding = "md",
  className = "",
  style,
  theme = "auto",
  testId,
}) => {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const expanded = controlledExpanded ?? uncontrolledExpanded;

  const setExpanded = useCallback((isExpanded: boolean) => {
    if (controlledExpanded === undefined) {
      setUncontrolledExpanded(isExpanded);
    }
    onExpandToggle?.(isExpanded);
  }, [controlledExpanded, onExpandToggle]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = panelRef.current?.getBoundingClientRect().height || 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientY - startY;
      const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + diff));
      if (panelRef.current) {
        panelRef.current.style.height = `${newHeight}px`;
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [resizable, minHeight, maxHeight]);

  const classNames = useMemo(() => [
    "panel",
    `panel--${variant}`,
    `panel--${size}`,
    collapsible && "panel--collapsible",
    !expanded && "panel--collapsed",
    scrollable && "panel--scrollable",
    resizable && "panel--resizable",
    isResizing && "panel--resizing",
    `panel--padding-${padding}`,
    className,
  ].filter(Boolean).join(" "), [variant, size, collapsible, expanded, scrollable, resizable, isResizing, padding, className]);

  const styles = useMemo(() => ({
    ...style,
    "--panel-min-height": `${minHeight}px`,
    "--panel-max-height": `${maxHeight}px`,
  }), [style, minHeight, maxHeight]);

  const hasHeader = title || subtitle || headerActions || collapsible;

  return (
    <div
      ref={panelRef}
      className={classNames}
      style={styles}
      data-theme={theme}
      data-testid={testId}
      role={title ? "region" : undefined}
      aria-label={title}
    >
      {hasHeader && (
        <header className="panel__header">
          <div className="panel__header-left">
            {collapsible && (
              <button
                className="panel__collapse-btn"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse panel" : "Expand panel"}
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {expanded ? (
                    <polyline points="6 9 12 15 18 9"/>
                  ) : (
                    <polyline points="18 15 12 9 6 15"/>
                  )}
                </svg>
              </button>
            )}
            {(title || subtitle) && (
              <div className="panel__title-group">
                {title && <h2 className="panel__title">{title}</h2>}
                {subtitle && <p className="panel__subtitle">{subtitle}</p>}
              </div>
            )}
          </div>
          {headerActions && <div className="panel__header-actions">{headerActions}</div>}
        </header>
      )}
      <div
        className="panel__content"
        style={{ display: expanded ? "block" : "none" }}
        role={collapsible ? "region" : undefined}
        aria-hidden={!expanded}
      >
        <div className="panel__inner">{children}</div>
      </div>
      {resizable && expanded && (
        <div
          className="panel__resize-handle"
          onMouseDown={handleResizeStart}
          aria-label="Resize panel"
          role="separator"
          tabIndex={0}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
          </svg>
        </div>
      )}
    </div>
  );
};

/** Panel Group - for stacking multiple panels */
export interface PanelGroupProps {
  /** Panel group children */
  children: ReactNode;
  /** Layout direction */
  direction?: "vertical" | "horizontal";
  /** Gap between panels */
  gap?: number | string;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const PanelGroup: React.FC<PanelGroupProps> = ({
  children,
  direction = "vertical",
  gap = "var(--space-4)",
  className = "",
  style,
}) => {
  const classNames = useMemo(() => [
    "panel-group",
    `panel-group--${direction}`,
    className,
  ].filter(Boolean).join(" "), [direction, className]);

  const styles = useMemo(() => ({
    ...style,
    "--panel-group-gap": typeof gap === "number" ? `${gap}px` : gap,
  }), [style, gap]);

  return (
    <div className={classNames} style={styles} role="group">
      {children}
    </div>
  );
};

/** Panel Stack - panels that can be toggled like tabs but stacked */
export interface PanelStackProps {
  /** Panels */
  panels: Array<{
    id: string;
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    content: ReactNode;
    disabled?: boolean;
  }>;
  /** Active panel id */
  activeId?: string;
  /** Default active panel */
  defaultActiveId?: string;
  /** On panel change */
  onChange?: (id: string) => void;
  /** Variant */
  variant?: "default" | "elevated" | "outlined";
  /** Class name */
  className?: string;
}

export const PanelStack: React.FC<PanelStackProps> = ({
  panels,
  activeId: controlledActiveId,
  defaultActiveId,
  onChange,
  variant = "default",
  className = "",
}) => {
  const [uncontrolledActiveId, setUncontrolledActiveId] = useState(defaultActiveId || panels[0]?.id || "");
  const activeId = controlledActiveId ?? uncontrolledActiveId;

  const handleSelect = useCallback((id: string) => {
    const panel = panels.find((p) => p.id === id);
    if (panel?.disabled) return;
    if (controlledActiveId === undefined) {
      setUncontrolledActiveId(id);
    }
    onChange?.(id);
  }, [controlledActiveId, onChange, panels]);

  return (
    <div className={`panel-stack panel-stack--${variant} ${className}`} role="tablist">
      <div className="panel-stack__tabs">
        {panels.map((panel) => (
          <button
            key={panel.id}
            className={`panel-stack__tab ${panel.id === activeId ? "panel-stack__tab--active" : ""} ${panel.disabled ? "panel-stack__tab--disabled" : ""}`}
            onClick={() => handleSelect(panel.id)}
            disabled={panel.disabled}
            role="tab"
            aria-selected={panel.id === activeId}
            aria-controls={`panel-stack-${panel.id}`}
            id={`panel-stack-tab-${panel.id}`}
            type="button"
          >
            {panel.icon && <span className="panel-stack__tab-icon" aria-hidden="true">{panel.icon}</span>}
            <div className="panel-stack__tab-text">
              <span className="panel-stack__tab-title">{panel.title}</span>
              {panel.subtitle && <span className="panel-stack__tab-subtitle">{panel.subtitle}</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="panel-stack__panels">
        {panels.map((panel) => (
          <div
            key={panel.id}
            id={`panel-stack-${panel.id}`}
            role="tabpanel"
            aria-labelledby={`panel-stack-tab-${panel.id}`}
            hidden={panel.id !== activeId}
            className="panel-stack__panel"
          >
            {panel.id === activeId && panel.content}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Split Panel - two resizable panels side by side or stacked */
export interface SplitPanelProps {
  /** Primary panel content */
  primary: ReactNode;
  /** Secondary panel content */
  secondary: ReactNode;
  /** Split direction */
  direction?: "horizontal" | "vertical";
  /** Primary panel initial size (0-1) */
  primarySize?: number;
  /** Min size for each panel (0-1) */
  minSize?: number;
  /** Max size for each panel (0-1) */
  maxSize?: number;
  /** On size change */
  onSizeChange?: (primarySize: number) => void;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const SplitPanel: React.FC<SplitPanelProps> = ({
  primary,
  secondary,
  direction = "horizontal",
  primarySize = 0.5,
  minSize = 0.1,
  maxSize = 0.9,
  onSizeChange,
  className = "",
  style,
}) => {
  const [size, setSize] = useState(primarySize);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startPos = direction === "horizontal" ? e.clientX : e.clientY;
    const startSize = size;
    const container = containerRef.current;
    if (!container) return;
    const containerSize = direction === "horizontal" ? container.offsetWidth : container.offsetHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPos = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
      const diff = (currentPos - startPos) / containerSize;
      const newSize = Math.max(minSize, Math.min(maxSize, startSize + diff));
      setSize(newSize);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      setIsDragging(false);
      onSizeChange?.(size);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [direction, size, minSize, maxSize, onSizeChange]);

  const primaryStyle = direction === "horizontal"
    ? { width: `${size * 100}%` }
    : { height: `${size * 100}%` };

  const secondaryStyle = direction === "horizontal"
    ? { width: `${(1 - size) * 100}%` }
    : { height: `${(1 - size) * 100}%` };

  return (
    <div
      ref={containerRef}
      className={`split-panel split-panel--${direction} ${isDragging ? "split-panel--dragging" : ""} ${className}`}
      style={style}
      role="group"
      aria-label="Split panel"
    >
      <div className="split-panel__primary" style={primaryStyle}>
        {primary}
      </div>
      <div
        className="split-panel__divider"
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation={direction}
        aria-valuemin={Math.round(minSize * 100)}
        aria-valuemax={Math.round(maxSize * 100)}
        aria-valuenow={Math.round(size * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = 0.05;
          let newSize = size;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") newSize += step;
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") newSize -= step;
          newSize = Math.max(minSize, Math.min(maxSize, newSize));
          if (newSize !== size) {
            setSize(newSize);
            onSizeChange?.(newSize);
          }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {direction === "horizontal" ? (
            <>
              <line x1="12" y1="3" x2="12" y2="21"/>
              <line x1="12" y1="3" x2="12" y2="21"/>
            </>
          ) : (
            <>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
            </>
          )}
        </svg>
      </div>
      <div className="split-panel__secondary" style={secondaryStyle}>
        {secondary}
      </div>
    </div>
  );
};