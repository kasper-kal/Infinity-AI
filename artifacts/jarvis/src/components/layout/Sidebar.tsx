/**
 * Sidebar Component — Liquid Glass Design System
 * Reusable sidebar with navigation, sections, and collapsible support
 */

import React, { useState, useCallback, useMemo, ReactNode } from "react";
import "./Sidebar.css";
import { ConnectorMenu } from "./ConnectorMenu";
import "./ConnectorMenu.css";

export interface SidebarProps {
  /** Sidebar content */
  children: ReactNode;
  /** Sidebar width (open) */
  width?: number | string;
  /** Collapsed width */
  collapsedWidth?: number | string;
  /** Collapsed state */
  collapsed?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** On collapse toggle */
  onCollapseToggle?: (collapsed: boolean) => void;
  /** Position */
  position?: "left" | "right";
  /** Enable resize handle */
  resizable?: boolean;
  /** Min/max width for resize */
  minWidth?: number;
  maxWidth?: number;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  /** Theme */
  theme?: "light" | "dark" | "auto";
  /** Show backdrop on mobile */
  backdrop?: boolean;
  /** Mobile breakpoint */
  mobileBreakpoint?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  children,
  width = 280,
  collapsedWidth = 64,
  collapsed: controlledCollapsed,
  defaultCollapsed = false,
  onCollapseToggle,
  position = "left",
  resizable = false,
  minWidth = 200,
  maxWidth = 500,
  className = "",
  style,
  theme = "auto",
  backdrop = true,
  mobileBreakpoint = 768,
}) => {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const currentWidth = collapsed ? collapsedWidth : width;

  const setCollapsed = useCallback((isCollapsed: boolean) => {
    if (controlledCollapsed === undefined) {
      setUncontrolledCollapsed(isCollapsed);
    }
    onCollapseToggle?.(isCollapsed);
  }, [controlledCollapsed, onCollapseToggle]);

  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = parseFloat(getComputedStyle(e.currentTarget.parentElement!).width);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = position === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + diff));
      const parent = e.currentTarget.parentElement;
      if (parent) {
        parent.style.width = `${newWidth}px`;
        parent.style.setProperty("--sidebar-width", `${newWidth}px`);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [position, resizable, minWidth, maxWidth]);

  const classNames = useMemo(() => [
    "sidebar",
    `sidebar--${position}`,
    `sidebar--${theme}`,
    collapsed && "sidebar--collapsed",
    mobileOpen && "sidebar--mobile-open",
    resizable && "sidebar--resizable",
    isResizing && "sidebar--resizing",
    className,
  ].filter(Boolean).join(" "), [position, theme, collapsed, mobileOpen, resizable, isResizing, className]);

  const styles = useMemo(() => ({
    ...style,
    "--sidebar-width": `${currentWidth}px`,
    "--sidebar-collapsed-width": `${collapsedWidth}px`,
  }), [style, currentWidth, collapsedWidth]);

  return (
    <>
      {mobileOpen && backdrop && (
        <div
          className="sidebar__backdrop"
          onClick={() => {
            setMobileOpen(false);
            if (controlledCollapsed === undefined) setUncontrolledCollapsed(true);
            onCollapseToggle?.(true);
          }}
          aria-hidden="true"
        />
      )}
      <aside
        className={classNames}
        style={styles}
        role="complementary"
        aria-label={`${position} sidebar`}
        data-theme={theme}
      >
        <div className="sidebar__content">
          {children}
        </div>
        {resizable && !collapsed && (
          <button
            className={`sidebar__resize-handle sidebar__resize-handle--${position}`}
            onMouseDown={handleResizeStart}
            aria-label="Resize sidebar"
            type="button"
            tabIndex={-1}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="9" y1="3" x2="9" y2="21"/>
              <line x1="15" y1="3" x2="15" y2="21"/>
            </svg>
          </button>
        )}
        {collapsed && (
          <button
            className="sidebar__expand-btn"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {position === "left" ? (
                <path d="M9 18l6-6-6-6"/>
              ) : (
                <path d="M15 18l-6-6 6-6"/>
              )}
            </svg>
          </button>
        )}
      </aside>
    </>
  );
};

/** Sidebar Section */
export interface SidebarSectionProps {
  /** Section title */
  title?: string;
  /** Section children */
  children: ReactNode;
  /** Collapsible */
  collapsible?: boolean;
  /** Default expanded */
  defaultExpanded?: boolean;
  /** On expand toggle */
  onToggle?: (expanded: boolean) => void;
  /** Class name */
  className?: string;
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  children,
  collapsible = false,
  defaultExpanded = true,
  onToggle,
  className = "",
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    onToggle?.(next);
  }, [expanded, onToggle]);

  const classNames = useMemo(() => [
    "sidebar-section",
    collapsible && "sidebar-section--collapsible",
    !expanded && "sidebar-section--collapsed",
    className,
  ].filter(Boolean).join(" "), [collapsible, expanded, className]);

  return (
    <section className={classNames}>
      {title && (
        <header className="sidebar-section__header" onClick={collapsible ? handleToggle : undefined}>
          <h2 className="sidebar-section__title">{title}</h2>
          {collapsible && (
            <span className={`sidebar-section__chevron ${expanded ? "sidebar-section__chevron--open" : ""}`} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </span>
          )}
        </header>
      )}
      <div className="sidebar-section__content" style={{ display: expanded ? "block" : "none" }}>
        {children}
      </div>
    </section>
  );
};

/** Sidebar Nav */
export interface SidebarNavProps {
  /** Nav items */
  items: SidebarNavItem[];
  /** Active item id */
  activeId?: string;
  /** On item click */
  onSelect?: (id: string, item: SidebarNavItem) => void;
  /** Class name */
  className?: string;
}

export interface SidebarNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  collapsedIcon?: ReactNode;
  badge?: string | number;
  disabled?: boolean;
  children?: SidebarNavItem[];
  href?: string;
  tooltip?: string;
  /** Custom render */
  render?: (item: SidebarNavItem, collapsed: boolean) => ReactNode;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  items,
  activeId,
  onSelect,
  className = "",
}) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const renderItem = useCallback((item: SidebarNavItem, depth = 0, collapsed = false) => {
    const isActive = item.id === activeId;
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);

    if (collapsed && !item.collapsedIcon && !item.icon) return null;

    const handleClick = () => {
      if (item.disabled) return;
      if (hasChildren) {
        setExpandedItems((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      } else {
        onSelect?.(item.id, item);
      }
    };

    const classNames = [
      "sidebar-nav__item",
      isActive && "sidebar-nav__item--active",
      item.disabled && "sidebar-nav__item--disabled",
      hasChildren && "sidebar-nav__item--has-children",
      hasChildren && !isExpanded && "sidebar-nav__item--collapsed",
      depth > 0 && `sidebar-nav__item--depth-${depth}`,
    ].filter(Boolean).join(" ");

    if (item.render) {
      return item.render(item, collapsed);
    }

    return (
      <div key={item.id} className={classNames} style={{ paddingLeft: `${12 + depth * 16}px` }}>
        <button
          className="sidebar-nav__button"
          onClick={handleClick}
          disabled={item.disabled}
          aria-current={isActive ? "page" : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-label={collapsed ? item.tooltip || item.label : undefined}
          type="button"
        >
          <span className="sidebar-nav__icon" aria-hidden="true">
            {collapsed ? item.collapsedIcon || item.icon : item.icon}
          </span>
          {!collapsed && (
            <span className="sidebar-nav__label">{item.label}</span>
          )}
          {!collapsed && item.badge && (
            <span className="sidebar-nav__badge">{item.badge}</span>
          )}
          {!collapsed && hasChildren && (
            <span className={`sidebar-nav__chevron ${isExpanded ? "sidebar-nav__chevron--open" : ""}`} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </span>
          )}
        </button>
        {!collapsed && hasChildren && isExpanded && (
          <div className="sidebar-nav__children" role="group" aria-label={`${item.label} children`}>
            {item.children!.map((child) => renderItem(child, depth + 1, collapsed))}
          </div>
        )}
      </div>
    );
  }, [activeId, onSelect, expandedItems]);

  return (
    <nav className={`sidebar-nav ${className}`} role="navigation" aria-label="Sidebar navigation">
      {items.map((item) => renderItem(item))}
    </nav>
  );
};

/** Sidebar Divider */
export const SidebarDivider: React.FC<{ className?: string; label?: string }> = ({
  className = "",
  label,
}) => (
  <div className={`sidebar-divider ${className}`} role="separator">
    {label && <span className="sidebar-divider__label">{label}</span>}
  </div>
);

/** Sidebar Footer */
export interface SidebarFooterProps {
  children: ReactNode;
  className?: string;
}

export const SidebarFooter: React.FC<SidebarFooterProps> = ({
  children,
  className = "",
}) => (
  <footer className={`sidebar-footer ${className}`}>
    {children}
  </footer>
);