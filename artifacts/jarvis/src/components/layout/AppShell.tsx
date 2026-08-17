/**
 * AppShell Component — Liquid Glass Design System
 * Top-level application layout with header, sidebar, and content area
 */

import React, { useState, useCallback, useMemo, ReactNode } from "react";
import "./AppShell.css";

export interface AppShellProps {
  /** Application header content */
  header?: ReactNode;
  /** Sidebar content (left) */
  sidebar?: ReactNode;
  /** Right sidebar content */
  rightSidebar?: ReactNode;
  /** Main content area */
  children: ReactNode;
  /** Footer content */
  footer?: ReactNode;
  /** Sidebar open state (controlled) */
  sidebarOpen?: boolean;
  /** Default sidebar open state (uncontrolled) */
  defaultSidebarOpen?: boolean;
  /** Right sidebar open state (controlled) */
  rightSidebarOpen?: boolean;
  /** Default right sidebar open state (uncontrolled) */
  defaultRightSidebarOpen?: boolean;
  /** Sidebar width */
  sidebarWidth?: number | string;
  /** Right sidebar width */
  rightSidebarWidth?: number | string;
  /** Header height */
  headerHeight?: number | string;
  /** Footer height */
  footerHeight?: number | string;
  /** Enable sidebar overlay on mobile */
  overlay?: boolean;
  /** Collapse sidebar to icons only */
  collapsed?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** On sidebar toggle */
  onSidebarToggle?: (open: boolean) => void;
  /** On right sidebar toggle */
  onRightSidebarToggle?: (open: boolean) => void;
  /** On collapse toggle */
  onCollapseToggle?: (collapsed: boolean) => void;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  /** Theme */
  theme?: "light" | "dark" | "auto";
}

export const AppShell: React.FC<AppShellProps> = ({
  header,
  sidebar,
  rightSidebar,
  children,
  footer,
  sidebarOpen: controlledSidebarOpen,
  defaultSidebarOpen = true,
  rightSidebarOpen: controlledRightSidebarOpen,
  defaultRightSidebarOpen = false,
  sidebarWidth = 280,
  rightSidebarWidth = 280,
  headerHeight = 56,
  footerHeight = 0,
  overlay = true,
  collapsed: controlledCollapsed,
  defaultCollapsed = false,
  onSidebarToggle,
  onRightSidebarToggle,
  onCollapseToggle,
  className = "",
  style,
  theme = "auto",
}) => {
  const [uncontrolledSidebarOpen, setUncontrolledSidebarOpen] = useState(defaultSidebarOpen);
  const [uncontrolledRightSidebarOpen, setUncontrolledRightSidebarOpen] = useState(defaultRightSidebarOpen);
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileRightSidebarOpen, setMobileRightSidebarOpen] = useState(false);

  const sidebarOpen = controlledSidebarOpen ?? uncontrolledSidebarOpen;
  const rightSidebarOpen = controlledRightSidebarOpen ?? uncontrolledRightSidebarOpen;
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;

  const setSidebarOpen = useCallback((open: boolean) => {
    if (controlledSidebarOpen === undefined) {
      setUncontrolledSidebarOpen(open);
    }
    onSidebarToggle?.(open);
    if (window.innerWidth < 768) setMobileMenuOpen(open);
  }, [controlledSidebarOpen, onSidebarToggle]);

  const setRightSidebarOpen = useCallback((open: boolean) => {
    if (controlledRightSidebarOpen === undefined) {
      setUncontrolledRightSidebarOpen(open);
    }
    onRightSidebarToggle?.(open);
    if (window.innerWidth < 768) setMobileRightSidebarOpen(open);
  }, [controlledRightSidebarOpen, onRightSidebarToggle]);

  const setCollapsed = useCallback((isCollapsed: boolean) => {
    if (controlledCollapsed === undefined) {
      setUncontrolledCollapsed(isCollapsed);
    }
    onCollapseToggle?.(isCollapsed);
  }, [controlledCollapsed, onCollapseToggle]);

  const toggleSidebar = useCallback(() => setSidebarOpen(!sidebarOpen), [sidebarOpen, setSidebarOpen]);
  const toggleRightSidebar = useCallback(() => setRightSidebarOpen(!rightSidebarOpen), [rightSidebarOpen, setRightSidebarOpen]);
  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  const classNames = useMemo(() => [
    "app-shell",
    `app-shell--${theme}`,
    sidebarOpen && "app-shell--sidebar-open",
    rightSidebarOpen && "app-shell--right-sidebar-open",
    collapsed && "app-shell--collapsed",
    mobileMenuOpen && "app-shell--mobile-menu-open",
    mobileRightSidebarOpen && "app-shell--mobile-right-sidebar-open",
    header && "app-shell--has-header",
    footer && "app-shell--has-footer",
    overlay && "app-shell--overlay",
    className,
  ].filter(Boolean).join(" "), [
    theme, sidebarOpen, rightSidebarOpen, collapsed,
    mobileMenuOpen, mobileRightSidebarOpen, header, footer, overlay, className
  ]);

  const styles = useMemo(() => ({
    ...style,
    "--app-shell-sidebar-width": `${sidebarWidth}px`,
    "--app-shell-right-sidebar-width": `${rightSidebarWidth}px`,
    "--app-shell-header-height": `${headerHeight}px`,
    "--app-shell-footer-height": `${footerHeight}px`,
    "--app-shell-collapsed-width": "64px",
  }), [style, sidebarWidth, rightSidebarWidth, headerHeight, footerHeight]);

  return (
    <div className={classNames} style={styles} data-theme={theme}>
      {/* Mobile overlay backdrop */}
      {(mobileMenuOpen || mobileRightSidebarOpen) && overlay && (
        <div
          className="app-shell__backdrop"
          onClick={() => {
            setMobileMenuOpen(false);
            setMobileRightSidebarOpen(false);
            if (controlledSidebarOpen === undefined) setUncontrolledSidebarOpen(false);
            if (controlledRightSidebarOpen === undefined) setUncontrolledRightSidebarOpen(false);
            onSidebarToggle?.(false);
            onRightSidebarToggle?.(false);
          }}
          aria-hidden="true"
        />
      )}

      {/* Header */}
      {header && (
        <header className="app-shell__header" role="banner">
          <div className="app-shell__header-left">
            <button
              className="app-shell__menu-btn"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              aria-expanded={sidebarOpen}
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div className="app-shell__header-content">{header}</div>
          </div>
          <div className="app-shell__header-right">
            {rightSidebar && (
              <button
                className="app-shell__menu-btn"
                onClick={toggleRightSidebar}
                aria-label={rightSidebarOpen ? "Close right sidebar" : "Open right sidebar"}
                aria-expanded={rightSidebarOpen}
                type="button"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M9 3v18M15 3v18"/>
                </svg>
              </button>
            )}
            {collapsed !== undefined && (
              <button
                className="app-shell__collapse-btn"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
                type="button"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {collapsed ? (
                    <path d="M15 18l-6-6 6-6"/>
                  ) : (
                    <path d="M9 18l6-6-6-6"/>
                  )}
                </svg>
              </button>
            )}
          </div>
        </header>
      )}

      <div className="app-shell__body">
        {/* Left Sidebar */}
        {sidebar && (
          <aside
            className="app-shell__sidebar"
            role="complementary"
            aria-label="Sidebar"
            style={{ width: collapsed ? "var(--app-shell-collapsed-width)" : "var(--app-shell-sidebar-width)" }}
          >
            <div className="app-shell__sidebar-content">
              {collapsed ? (
                <nav className="app-shell__collapsed-nav" aria-label="Collapsed navigation">
                  {React.Children.map(sidebar, (child) => {
                    if (React.isValidElement(child) && child.props["data-collapsed-icon"]) {
                      return React.cloneElement(child, { className: "app-shell__collapsed-item" });
                    }
                    return null;
                  })}
                </nav>
              ) : (
                <div className="app-shell__sidebar-inner">{sidebar}</div>
              )}
            </div>
            {!collapsed && (
              <button
                className="app-shell__resize-handle"
                onMouseDown={(e) => startResize(e, "sidebar")}
                aria-label="Resize sidebar"
                type="button"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="9" y1="3" x2="9" y2="21"/>
                  <line x1="15" y1="3" x2="15" y2="21"/>
                </svg>
              </button>
            )}
          </aside>
        )}

        {/* Main Content */}
        <main className="app-shell__main" role="main" tabIndex={-1}>
          {children}
        </main>

        {/* Right Sidebar */}
        {rightSidebar && (
          <aside
            className="app-shell__right-sidebar"
            role="complementary"
            aria-label="Right sidebar"
            style={{ width: "var(--app-shell-right-sidebar-width)" }}
          >
            <button
              className="app-shell__resize-handle app-shell__resize-handle--right"
              onMouseDown={(e) => startResize(e, "rightSidebar")}
              aria-label="Resize right sidebar"
              type="button"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="9" y1="3" x2="9" y2="21"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </button>
            <div className="app-shell__right-sidebar-content">
              <div className="app-shell__right-sidebar-inner">{rightSidebar}</div>
            </div>
          </aside>
        )}
      </div>

      {/* Footer */}
      {footer && (
        <footer className="app-shell__footer" role="contentinfo">
          {footer}
        </footer>
      )}
    </div>
  );
};

// Simple resize handler (in production, use a more robust solution)
function startResize(e: React.MouseEvent, type: "sidebar" | "rightSidebar") {
  e.preventDefault();
  const startX = e.clientX;
  const element = e.currentTarget.parentElement;
  if (!element) return;

  const startWidth = element.getBoundingClientRect().width;

  const handleMouseMove = (moveEvent: MouseEvent) => {
    const diff = type === "sidebar" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
    const newWidth = Math.max(200, Math.min(600, startWidth + diff));
    element.style.width = `${newWidth}px`;
    element.style.setProperty(type === "sidebar" ? "--app-shell-sidebar-width" : "--app-shell-right-sidebar-width", `${newWidth}px`);
  };

  const handleMouseUp = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
}

/** AppShell Header - for use within AppShell header prop */
export interface AppShellHeaderProps {
  /** Title */
  title?: ReactNode;
  /** Subtitle */
  subtitle?: ReactNode;
  /** Action buttons */
  actions?: ReactNode;
  /** Avatar */
  avatar?: ReactNode;
  /** Class name */
  className?: string;
}

export const AppShellHeader: React.FC<AppShellHeaderProps> = ({
  title,
  subtitle,
  actions,
  avatar,
  className = "",
}) => (
  <div className={`app-shell-header ${className}`}>
    {title && (
      <div className="app-shell-header__title-group">
        <h1 className="app-shell-header__title">{title}</h1>
        {subtitle && <p className="app-shell-header__subtitle">{subtitle}</p>}
      </div>
    )}
    <div className="app-shell-header__actions">
      {actions}
      {avatar && <div className="app-shell-header__avatar">{avatar}</div>}
    </div>
  </div>
);

/** AppShell Sidebar Section */
export interface AppShellSidebarSectionProps {
  /** Section title */
  title?: string;
  /** Section children */
  children: ReactNode;
  /** Class name */
  className?: string;
}

export const AppShellSidebarSection: React.FC<AppShellSidebarSectionProps> = ({
  title,
  children,
  className = "",
}) => (
  <section className={`app-shell-sidebar-section ${className}`}>
    {title && <h2 className="app-shell-sidebar-section__title">{title}</h2>}
    <div className="app-shell-sidebar-section__content">{children}</div>
  </section>
);

/** AppShell Sidebar Nav Item - with collapsed icon support */
export interface AppShellSidebarNavItemProps {
  /** Navigation label */
  label: string;
  /** Icon */
  icon?: ReactNode;
  /** Collapsed icon (shown when sidebar is collapsed) */
  collapsedIcon?: ReactNode;
  /** Active state */
  active?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** On click */
  onClick?: () => void;
  /** Href for anchor */
  href?: string;
  /** Tooltip for collapsed state */
  tooltip?: string;
  /** Class name */
  className?: string;
}

export const AppShellSidebarNavItem: React.FC<AppShellSidebarNavItemProps> = ({
  label,
  icon,
  collapsedIcon,
  active = false,
  disabled = false,
  onClick,
  href,
  tooltip,
  className = "",
}) => {
  const Component = href ? "a" : "button";
  const classNames = [
    "app-shell-sidebar-nav-item",
    active && "app-shell-sidebar-nav-item--active",
    disabled && "app-shell-sidebar-nav-item--disabled",
    className,
  ].filter(Boolean).join(" ");

  return (
    <Component
      className={classNames}
      href={href}
      onClick={onClick}
      disabled={disabled && !href}
      type={href ? undefined : "button"}
      aria-current={active ? "page" : undefined}
      aria-label={collapsedIcon ? tooltip || label : undefined}
      data-collapsed-icon={!!collapsedIcon}
    >
      <span className="app-shell-sidebar-nav-item__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="app-shell-sidebar-nav-item__label">{label}</span>
      {collapsedIcon && (
        <span className="app-shell-sidebar-nav-item__collapsed-icon" aria-hidden="true">
          {collapsedIcon}
        </span>
      )}
    </Component>
  );
};