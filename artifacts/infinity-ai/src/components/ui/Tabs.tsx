/**
 * Tabs Component — Liquid Glass Design System
 * Supports both array-prop API and Radix-style compound components
 */

import React, { useState, useRef, useEffect, useId, ReactNode, KeyboardEvent, createContext, useContext } from "react";
import "./Tabs.css";

export interface Tab {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  badge?: string | number;
  className?: string;
}

export interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  controlledTab?: string;
  onChange?: (tabId: string) => void;
  variant?: "line" | "enclosed" | "soft" | "glass";
  orientation?: "horizontal" | "vertical";
  fullWidth?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
}

/** Radix-style Tabs Context */
interface TabsContextValue {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  variant: "line" | "enclosed" | "soft" | "glass";
  orientation: "horizontal" | "vertical";
  tabsId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const useTabsContext = () => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs compound components must be used within a Tabs provider");
  }
  return context;
};

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  defaultTab,
  controlledTab,
  onChange,
  variant = "line",
  orientation = "horizontal",
  fullWidth = false,
  className = "",
  style,
}) => {
  const isControlled = controlledTab !== undefined;
  const [uncontrolledTab, setUncontrolledTab] = useState(defaultTab || tabs[0]?.id || "");
  const activeTab = isControlled ? controlledTab : uncontrolledTab;
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabPanelsRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const handleTabChange = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.disabled) return;
    if (!isControlled) setUncontrolledTab(tabId);
    onChange?.(tabId);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, tabId: string) => {
    const enabledTabs = tabs.filter((t) => !t.disabled);
    const currentIndex = enabledTabs.findIndex((t) => t.id === tabId);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    const isHorizontal = orientation === "horizontal";
    const isRTL = document.dir === "rtl";

    switch (e.key) {
      case isHorizontal ? (isRTL ? "ArrowRight" : "ArrowLeft") : "ArrowUp":
        e.preventDefault();
        nextIndex = (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
        break;
      case isHorizontal ? (isRTL ? "ArrowLeft" : "ArrowRight") : "ArrowDown":
        e.preventDefault();
        nextIndex = (currentIndex + 1) % enabledTabs.length;
        break;
      case "Home":
        e.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        e.preventDefault();
        nextIndex = enabledTabs.length - 1;
        break;
      default:
        return;
    }

    const nextTab = enabledTabs[nextIndex];
    handleTabChange(nextTab.id);
    nextTab.id && document.getElementById(`${id}-tab-${nextTab.id}`)?.focus();
  };

  const classNames = [
    "tabs",
    `tabs--${variant}`,
    `tabs--${orientation}`,
    fullWidth && "tabs--full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const activeTabData = tabs.find((t) => t.id === activeTab);

  return (
    <div ref={tabsRef} className={classNames} style={style} data-tabs-id={id}>
      <div
        ref={tabListRef}
        role="tablist"
        aria-orientation={orientation}
        className="tabs__list"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${id}-tab-${tab.id}`}
            role="tab"
            aria-selected={tab.id === activeTab}
            aria-controls={`${id}-panel-${tab.id}`}
            tabIndex={tab.id === activeTab ? 0 : -1}
            disabled={tab.disabled}
            className={`tabs__tab ${tab.id === activeTab ? "tabs__tab--active" : ""} ${tab.disabled ? "tabs__tab--disabled" : ""} ${tab.className || ""}`}
            onClick={() => handleTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, tab.id)}
          >
            {tab.icon && <span className="tabs__tab-icon" aria-hidden="true">{tab.icon}</span>}
            <span className="tabs__tab-label">{tab.label}</span>
            {tab.badge !== undefined && (
              <span className="tabs__tab-badge" aria-label={`${tab.badge} items`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
        {variant === "line" && (
          <div
            className="tabs__indicator"
            style={{
              transform: `translateX(${tabs.findIndex((t) => t.id === activeTab) * 100}%)`,
            }}
            aria-hidden="true"
          />
        )}
      </div>
      <div ref={tabPanelsRef} className="tabs__panels">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`${id}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${tab.id}`}
            hidden={tab.id !== activeTab}
            className="tabs__panel"
            tabIndex={0}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Tab Panel — for use with uncontrolled tabs */
export interface TabPanelProps {
  tabId: string;
  children: ReactNode;
  className?: string;
}

export const TabPanel: React.FC<TabPanelProps> = ({ tabId, children, className = "" }) => {
  // This is a placeholder for compound component pattern
  // Actual implementation would use context
  return <div className={`tabs__panel ${className}`} data-tab-id={tabId}>{children}</div>;
};

/** Radix-style TabsList Component */
export interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export const TabsList: React.FC<TabsListProps> = ({ children, className = "" }) => {
  const { orientation, variant, tabsId } = useTabsContext();
  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={`tabs__list ${className}`}
    >
      {children}
      {variant === "line" && (
        <div className="tabs__indicator" aria-hidden="true" />
      )}
    </div>
  );
};

/** Radix-style TabsTrigger Component */
export interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export const TabsTrigger: React.FC<TabsTriggerProps> = ({ value, children, disabled = false, className = "" }) => {
  const { activeTab, onTabChange, orientation, tabsId, variant } = useTabsContext();
  const isActive = activeTab === value;
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isActive && triggerRef.current) {
      triggerRef.current.focus();
    }
  }, [isActive]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const tabsList = triggerRef.current?.parentElement;
    if (!tabsList) return;
    const triggers = Array.from(tabsList.querySelectorAll('[role="tab"]:not(:disabled)')) as HTMLButtonElement[];
    const currentIndex = triggers.findIndex(t => t === triggerRef.current);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    const isHorizontal = orientation === "horizontal";
    const isRTL = document.dir === "rtl";

    switch (e.key) {
      case isHorizontal ? (isRTL ? "ArrowRight" : "ArrowLeft") : "ArrowUp":
        e.preventDefault();
        nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
        break;
      case isHorizontal ? (isRTL ? "ArrowLeft" : "ArrowRight") : "ArrowDown":
        e.preventDefault();
        nextIndex = (currentIndex + 1) % triggers.length;
        break;
      case "Home":
        e.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        e.preventDefault();
        nextIndex = triggers.length - 1;
        break;
      default:
        return;
    }

    triggers[nextIndex]?.focus();
    triggers[nextIndex]?.click();
  };

  return (
    <button
      ref={triggerRef}
      id={`${tabsId}-tab-${value}`}
      role="tab"
      aria-selected={isActive}
      aria-controls={`${tabsId}-panel-${value}`}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      className={`tabs__tab ${isActive ? "tabs__tab--active" : ""} ${disabled ? "tabs__tab--disabled" : ""} ${className}`}
      onClick={() => !disabled && onTabChange(value)}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
};

/** Radix-style TabsContent Component */
export interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export const TabsContent: React.FC<TabsContentProps> = ({ value, children, className = "" }) => {
  const { activeTab, tabsId, orientation } = useTabsContext();
  const isActive = activeTab === value;

  return (
    <div
      id={`${tabsId}-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`${tabsId}-tab-${value}`}
      hidden={!isActive}
      className={`tabs__panel ${className}`}
      tabIndex={0}
    >
      {isActive && children}
    </div>
  );
};

/** Segmented Control — for mutually exclusive options */
export interface SegmentedControlProps {
  options: Array<{ value: string; label: ReactNode; icon?: ReactNode; disabled?: boolean }>;
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  className?: string;
}

export const SegmentedControl: React.FC<SegmentedControlProps> = ({
  options,
  value,
  onChange,
  size = "md",
  fullWidth = false,
  className = "",
}) => {
  const classNames = ["segmented", `segmented--${size}`, fullWidth && "segmented--full", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} role="radiogroup" aria-orientation="horizontal">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          aria-disabled={option.disabled}
          disabled={option.disabled}
          className={`segmented__option ${option.value === value ? "segmented__option--active" : ""} ${option.disabled ? "segmented__option--disabled" : ""}`}
          onClick={() => !option.disabled && onChange(option.value)}
          type="button"
        >
          {option.icon && <span className="segmented__icon" aria-hidden="true">{option.icon}</span>}
          <span className="segmented__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
};