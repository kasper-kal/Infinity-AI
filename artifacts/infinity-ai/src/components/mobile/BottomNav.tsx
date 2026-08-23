/**
 * BottomNav — Mobile-first bottom navigation bar
 * Provides 4-5 primary destinations with icons + labels, active indicator,
 * safe-area inset handling, and haptic feedback on press.
 */

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { haptics } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";

export interface BottomNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
  disabled?: boolean;
}

export interface BottomNavProps {
  items: BottomNavItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  /** Show labels under icons (default: true) */
  showLabels?: boolean;
  /** Max 5 items recommended for touch targets */
  maxItems?: number;
}

const ITEM_STYLES = "flex flex-col items-center justify-center gap-1 min-w-0 flex-1";
const ICON_WRAPPER = "relative flex items-center justify-center";
const LABEL_STYLES = "text-xs font-medium leading-none truncate";
const BADGE_STYLES = "absolute -top-1 -right-1 min-w-[16px] h-5 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold flex items-center justify-center";

export const BottomNav: React.FC<BottomNavProps> = ({
  items,
  activeId,
  onChange,
  className,
  showLabels = true,
  maxItems = 5,
}) => {
  const { t } = useI18n();
  const safeItems = useMemo(() => items.slice(0, maxItems), [items, maxItems]);

  const handlePress = (item: BottomNavItem) => {
    if (item.disabled) return;
    haptics.light();
    onChange(item.id);
  };

  return (
    <nav
      role="navigation"
      aria-label={t('mobile.bottomNav.label') || 'Main navigation'}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50",
        "glass-strong border-t border-border-primary/60",
        "safe-area-inset-bottom",
        "flex items-center",
        className
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      <div className={cn("flex w-full", safeItems.length <= 3 ? "justify-around" : "justify-between")}>
        {safeItems.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeId === item.id}
            aria-disabled={item.disabled}
            aria-label={item.label}
            onClick={() => handlePress(item)}
            disabled={item.disabled}
            className={cn(
              ITEM_STYLES,
              "px-3 py-2.5",
              "transition-colors duration-150",
              "touch-manipulation",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              activeId === item.id
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
              item.disabled && "opacity-40 pointer-events-none"
            )}
          >
            <div className={ICON_WRAPPER}>
              {React.isValidElement(item.icon)
                ? React.cloneElement(item.icon as React.ReactElement<{ className?: string }>, {
                    className: cn(
                      "w-6 h-6",
                      activeId === item.id ? "text-primary" : "text-muted-foreground",
                      "transition-colors duration-150"
                    ),
                  })
                : item.icon}
              {item.badge != null && (
                <span className={BADGE_STYLES} aria-label={`${item.badge} notifications`}>
                  {typeof item.badge === 'number' && item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </div>
            {showLabels && (
              <span
                className={cn(
                  LABEL_STYLES,
                  activeId === item.id
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                {item.label}
              </span>
            )}
            {/* Active indicator */}
            {activeId === item.id && (
              <div
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full"
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;