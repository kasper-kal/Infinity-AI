/**
 * TouchTargets — Touch-friendly sizing utilities and components
 * Ensures minimum 44x44px (iOS) / 48x48dp (Android) touch targets
 * with visual feedback, hit area expansion, and accessibility.
 */

import React, { forwardRef, useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimum touch target sizes per platform guidelines
 */
export const TOUCH_TARGET_SIZES = {
  /** iOS Human Interface Guidelines minimum */
  iOS: 44,
  /** Material Design minimum */
  material: 48,
  /** WCAG AA minimum for pointer inputs */
  wcag: 44,
  /** Recommended comfortable size */
  comfortable: 56,
} as const;

export type TouchTargetSize = keyof typeof TOUCH_TARGET_SIZES;

/**
 * TouchTarget — Wrapper that expands hit area without affecting layout
 * Adds invisible padding around child for easier tapping
 */
export interface TouchTargetProps {
  /** Child element (must be single interactive element) */
  children: React.ReactElement;
  /** Minimum touch target size (default: 'material' = 48px) */
  size?: TouchTargetSize | number;
  /** Expand hit area only visually (default: false) */
  visualOnly?: boolean;
  /** Additional className */
  className?: string;
  /** Disable touch expansion */
  disabled?: boolean;
}

export const TouchTarget = forwardRef<HTMLDivElement, TouchTargetProps>(
  ({ children, size = 'material', visualOnly = false, className, disabled = false }, ref) => {
    const targetSize = useMemo(() => {
      if (typeof size === 'number') return size;
      return TOUCH_TARGET_SIZES[size];
    }, [size]);

    const child = React.Children.only(children);

    if (!React.isValidElement(child)) {
      return null;
    }

    const childProps = child.props as React.HTMLAttributes<HTMLElement> & { style?: React.CSSProperties };

    // Calculate padding needed to reach target size
    // We assume child has some intrinsic size or we expand equally
    const padding = Math.max(0, (targetSize - 24) / 2); // 24px assumed base

    const wrapperStyles: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: targetSize,
      minHeight: targetSize,
      ...(!visualOnly && {
        padding: padding > 0 ? `${padding}px` : undefined,
      }),
    };

    const expandedStyles: React.CSSProperties = {
      ...(childProps.style || {}),
      minWidth: targetSize,
      minHeight: targetSize,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    };

    return (
      <div
        ref={ref}
        className={cn("touch-manipulation", className)}
        style={wrapperStyles}
        role={childProps.role}
        aria-label={childProps['aria-label']}
        aria-disabled={disabled || childProps['aria-disabled']}
        tabIndex={disabled ? -1 : childProps.tabIndex}
        onClick={disabled ? undefined : childProps.onClick}
        onKeyDown={disabled ? undefined : childProps.onKeyDown}
      >
        {React.cloneElement(child, {
          style: visualOnly ? (childProps.style as React.CSSProperties | undefined) : expandedStyles,
          className: cn((childProps as any).className, !visualOnly && "relative z-10"),
        } as any)}
      </div>
    );
  }
);

TouchTarget.displayName = 'TouchTarget';

/**
 * TouchButton — Button with guaranteed touch target size
 */
export interface TouchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Touch target size (default: 'material') */
  touchSize?: TouchTargetSize | number;
  /** Show ripple effect on press */
  ripple?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Icon before text */
  startIcon?: React.ReactNode;
  /** Icon after text */
  endIcon?: React.ReactNode;
}

export const TouchButton = forwardRef<HTMLButtonElement, TouchButtonProps>(
  ({
    children,
    touchSize = 'material',
    ripple = true,
    loading = false,
    startIcon,
    endIcon,
    className,
    disabled,
    style,
    onClick,
    ...props
  }, ref) => {
    const targetSize = useMemo(() => {
      if (typeof touchSize === 'number') return touchSize;
      return TOUCH_TARGET_SIZES[touchSize];
    }, [touchSize]);

    const [rippleState, setRippleState] = React.useState<{ x: number; y: number } | null>(null);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || loading) return;
      if (ripple && !('touches' in e)) {
        const rect = e.currentTarget.getBoundingClientRect();
        setRippleState({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        setTimeout(() => setRippleState(null), 300);
      }
      onClick?.(e);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled || loading) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick(e as any);
      }
      props.onKeyDown?.(e);
    };

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-medium",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:pointer-events-none",
          "touch-manipulation select-none",
          className
        )}
        style={{
          minWidth: targetSize,
          minHeight: targetSize,
          padding: `0 ${Math.max(16, (targetSize - 24) / 2)}px`,
          ...style,
        }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-busy={loading}
        aria-disabled={disabled || loading}
        {...props}
      >
        {ripple && rippleState && (
          <span
            className="absolute inset-0 bg-current/10 rounded-[inherit] animate-ripple"
            style={{
              transformOrigin: `${rippleState.x}px ${rippleState.y}px`,
              animation: 'ripple 300ms ease-out forwards',
            }}
            aria-hidden="true"
          />
        )}
        {loading && (
          <svg
            className="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
        )}
        {!loading && startIcon && <span className="flex-shrink-0" aria-hidden="true">{startIcon}</span>}
        <span className={cn("truncate", loading && "opacity-0")}>{children}</span>
        {!loading && endIcon && <span className="flex-shrink-0" aria-hidden="true">{endIcon}</span>}
      </button>
    );
  }
);

TouchButton.displayName = 'TouchButton';

/**
 * TouchIconButton — Icon-only button with proper touch target
 */
export interface TouchIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon to display */
  icon: React.ReactNode;
  /** Touch target size (default: 'material') */
  touchSize?: TouchTargetSize | number;
  /** Aria label (required for icon-only buttons) */
  ariaLabel: string;
  /** Show ripple */
  ripple?: boolean;
}

export const TouchIconButton = forwardRef<HTMLButtonElement, TouchIconButtonProps>(
  ({ icon, touchSize = 'material', ariaLabel, ripple = true, className, disabled, children, ...props }, ref) => {
    const targetSize = useMemo(() => {
      if (typeof touchSize === 'number') return touchSize;
      return TOUCH_TARGET_SIZES[touchSize];
    }, [touchSize]);

    const [rippleState, setRippleState] = React.useState<{ x: number; y: number } | null>(null);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (ripple && !('touches' in e)) {
        const rect = e.currentTarget.getBoundingClientRect();
        setRippleState({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        setTimeout(() => setRippleState(null), 300);
      }
      props.onClick?.(e);
    };

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:pointer-events-none",
          "touch-manipulation select-none",
          className
        )}
        style={{
          width: targetSize,
          height: targetSize,
          borderRadius: '50%',
          ...props.style,
        }}
        onClick={handleClick}
        aria-label={ariaLabel}
        aria-disabled={disabled}
        {...props}
      >
        {ripple && rippleState && (
          <span
            className="absolute inset-0 bg-current/10 rounded-full animate-ripple"
            style={{
              transformOrigin: `${rippleState.x}px ${rippleState.y}px`,
            }}
            aria-hidden="true"
          />
        )}
        <span className="relative z-10" aria-hidden="true">{icon}</span>
        {children}
      </button>
    );
  }
);

TouchIconButton.displayName = 'TouchIconButton';

/**
 * TouchListItem — List item with full-width touch target
 */
export interface TouchListItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left side content */
  startContent?: React.ReactNode;
  /** Main content */
  children: React.ReactNode;
  /** Right side content */
  endContent?: React.ReactNode;
  /** Touch target size (default: 'comfortable') */
  touchSize?: TouchTargetSize | number;
  /** Show divider */
  divider?: boolean;
  /** Pressed state */
  pressed?: boolean;
  /** Href for link behavior */
  href?: string;
}

export const TouchListItem = forwardRef<HTMLDivElement, TouchListItemProps>(
  ({
    startContent,
    children,
    endContent,
    touchSize = 'comfortable',
    divider = false,
    pressed = false,
    href,
    className,
    onClick,
    ...props
  }, ref) => {
    const targetSize = useMemo(() => {
      if (typeof touchSize === 'number') return touchSize;
      return TOUCH_TARGET_SIZES[touchSize];
    }, [touchSize]);

    const handleKeyDownDiv = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && !href) {
        e.preventDefault();
        (e.currentTarget as HTMLElement).click();
      }
    };

    const handleKeyDownAnchor = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && !href) {
        e.preventDefault();
        (e.currentTarget as HTMLElement).click();
      }
    };

    if (href) {
      // Extract and type anchor-specific props
      const {
        onClick: divOnClick,
        onKeyDown: divOnKeyDown,
        ...anchorProps
      } = props as React.AnchorHTMLAttributes<HTMLAnchorElement> & typeof props;

      const handleKeyDownAnchor = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
        if ((e.key === 'Enter' || e.key === ' ') && !href) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      };

      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={cn(
            "flex items-center gap-3 w-full",
            "transition-colors duration-100",
            "touch-manipulation",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            pressed && "bg-accent/10",
            divider && "border-b border-border-primary/60",
            className
          )}
          style={{
            minHeight: targetSize,
            padding: `0 16px`,
            ...props.style,
          }}
          onClick={divOnClick}
          onKeyDown={handleKeyDownAnchor}
          {...anchorProps}
        >
          {startContent && <div className="flex-shrink-0" aria-hidden="true">{startContent}</div>}
          <div className="flex-1 min-w-0">{children}</div>
          {endContent && <div className="flex-shrink-0" aria-hidden="true">{endContent}</div>}
        </a>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-3 w-full",
          "transition-colors duration-100",
          "touch-manipulation",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          pressed && "bg-accent/10",
          divider && "border-b border-border-primary/60",
          className
        )}
        style={{
          minHeight: targetSize,
          padding: `0 16px`,
          ...props.style,
        }}
        onClick={onClick}
        onKeyDown={handleKeyDownDiv}
        role="button"
        tabIndex={0}
        {...props}
      >
        {startContent && <div className="flex-shrink-0" aria-hidden="true">{startContent}</div>}
        <div className="flex-1 min-w-0">{children}</div>
        {endContent && <div className="flex-shrink-0" aria-hidden="true">{endContent}</div>}
      </div>
    );
  }
);

TouchListItem.displayName = 'TouchListItem';

/**
 * CSS for ripple animation (inject once)
 */
export const touchTargetStyles = `
@keyframes ripple {
  0% { transform: scale(0); opacity: 0.5; }
  100% { transform: scale(4); opacity: 0; }
}

.animate-ripple {
  animation: ripple 300ms ease-out forwards;
}

/* Touch action optimization */
.touch-manipulation {
  touch-action: manipulation;
}

.touch-auto {
  touch-action: auto;
}

.touch-none {
  touch-action: none;
}

/* Focus visible for touch targets */
.touch-target:focus-visible {
  outline: none;
  ring: 2px;
  ring-color: var(--ring);
  ring-offset: 2px;
  ring-offset-color: var(--background);
}

/* Active state for touch */
.touch-target:active {
  transform: scale(0.98);
}

.touch-target:active:not(:disabled) {
  transition: transform 50ms ease-out;
}
`;

export default TouchTarget;