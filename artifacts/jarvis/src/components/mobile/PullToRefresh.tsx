/**
 * PullToRefresh — Mobile pull-to-refresh component
 * Implements the classic iOS/Android pull-to-refresh pattern with
 * animated spinner, elastic resistance, haptic feedback, and
 * accessibility support. Works with any scrollable container.
 */

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { haptics } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";

export interface PullToRefreshProps {
  /** Callback when refresh is triggered */
  onRefresh: () => Promise<void> | void;
  /** Children (scrollable content) */
  children: React.ReactNode;
  /** Whether refresh is currently in progress */
  refreshing?: boolean;
  /** Distance to pull before refresh triggers (default: 80px) */
  threshold?: number;
  /** Maximum pull distance (default: 120px) */
  maxPull?: number;
  /** Resistance factor (default: 0.5) - higher = more resistance */
  resistance?: number;
  /** Custom spinner component */
  spinner?: React.ReactNode;
  /** Loading text */
  loadingText?: string;
  /** Pull text */
  pullText?: string;
  /** Release text */
  releaseText?: string;
  /** Enable haptic feedback (default: true) */
  haptics?: boolean;
  /** Container className */
  className?: string;
  /** Content className */
  contentClassName?: string;
  /** Style prop for container */
  style?: React.CSSProperties;
}

export interface PullToRefreshRef {
  /** Manually trigger refresh */
  triggerRefresh: () => void;
  /** Reset to initial state */
  reset: () => void;
}

const DEFAULT_THRESHOLD = 80;
const DEFAULT_MAX_PULL = 120;
const DEFAULT_RESISTANCE = 0.5;

const PullToRefreshComponent = forwardRef<PullToRefreshRef, PullToRefreshProps>(
  (
    {
      onRefresh,
      children,
      refreshing = false,
      threshold = DEFAULT_THRESHOLD,
      maxPull = DEFAULT_MAX_PULL,
      resistance = DEFAULT_RESISTANCE,
      spinner,
      loadingText,
      pullText,
      releaseText,
      haptics: enableHaptics = true,
      className,
      contentClassName,
      style,
    },
    ref
  ) => {
    const { t } = useI18n();
    const [pullDistance, setPullDistance] = useState(0);
    const [isPulling, setIsPulling] = useState(false);
    const [willRefresh, setWillRefresh] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const startYRef = useRef(0);
    const isTouchingRef = useRef(false);
    const hasTriggeredHapticRef = useRef(false);

    const progress = Math.min(pullDistance / threshold, 1);
    const clampedProgress = Math.min(pullDistance / maxPull, 1);
    const shouldRefresh = pullDistance >= threshold;

    // Default texts
    const defaultPullText = pullText || t('mobile.pullToRefresh.pull') || 'Pull to refresh';
    const defaultReleaseText = releaseText || t('mobile.pullToRefresh.release') || 'Release to refresh';
    const defaultLoadingText = loadingText || t('mobile.pullToRefresh.loading') || 'Refreshing...';

    // Default spinner
    const defaultSpinner = (
      <svg
        className="w-6 h-6 animate-spin text-primary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          strokeLinecap="round"
          className="animate-spin"
        />
      </svg>
    );

    // Imperative methods
    useImperativeHandle(ref, () => ({
      triggerRefresh: () => {
        if (!isRefreshing) {
          startRefresh();
        }
      },
      reset: () => {
        setPullDistance(0);
        setIsPulling(false);
        setWillRefresh(false);
        setIsRefreshing(false);
      },
    }));

    const startRefresh = useCallback(async () => {
      setIsRefreshing(true);
      setPullDistance(threshold); // Hold at threshold during refresh
      if (enableHaptics) {
        haptics.medium();
      }

      try {
        await onRefresh();
      } finally {
        // Animate back
        setTimeout(() => {
          setIsRefreshing(false);
          setWillRefresh(false);
          animateTo(0);
        }, 300);
      }
    }, [onRefresh, threshold, enableHaptics]);

    const animateTo = useCallback((targetDistance: number, duration = 300) => {
      const start = pullDistance;
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (targetDistance - start) * eased;
        setPullDistance(current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          if (targetDistance === 0) {
            setIsPulling(false);
          }
        }
      };

      requestAnimationFrame(animate);
    }, [pullDistance]);

    // Touch handlers
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      if (isRefreshing) return;

      const scrollTop = containerRef.current?.scrollTop ?? 0;
      if (scrollTop > 0) return; // Only allow pull at top

      isTouchingRef.current = true;
      startYRef.current = e.touches[0].clientY;
      hasTriggeredHapticRef.current = false;
    }, [isRefreshing]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      if (!isTouchingRef.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - startYRef.current;

      if (deltaY <= 0) return; // Only pull down

      const scrollTop = containerRef.current?.scrollTop ?? 0;
      if (scrollTop > 0) {
        isTouchingRef.current = false;
        return;
      }

      e.preventDefault();

      // Apply resistance
      let distance = deltaY * resistance;

      // Cap at maxPull with extra resistance
      if (distance > maxPull) {
        distance = maxPull + (distance - maxPull) * 0.3;
      }

      setPullDistance(distance);
      setIsPulling(true);

      const willRefreshNow = distance >= threshold;
      if (willRefreshNow !== willRefresh) {
        setWillRefresh(willRefreshNow);
        if (willRefreshNow && enableHaptics && !hasTriggeredHapticRef.current) {
          haptics.light();
          hasTriggeredHapticRef.current = true;
        }
      }
    }, [isRefreshing, resistance, maxPull, threshold, willRefresh, enableHaptics]);

    const handleTouchEnd = useCallback(() => {
      if (!isTouchingRef.current || isRefreshing) return;

      isTouchingRef.current = false;

      if (willRefresh) {
        startRefresh();
      } else {
        animateTo(0);
      }
    }, [isRefreshing, willRefresh, startRefresh, animateTo]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        isTouchingRef.current = false;
      };
    }, []);

    // Sync refreshing prop
    useEffect(() => {
      setIsRefreshing(refreshing);
    }, [refreshing]);

    // Calculate transform for content
    const contentTransform = isRefreshing
      ? threshold
      : pullDistance;

    return (
      <div
        ref={containerRef}
        className={cn(
          "relative overflow-hidden touch-none",
          className
        )}
        style={style}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Pull indicator */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 flex items-center justify-center",
            "pointer-events-none z-10",
            "transition-transform duration-200 ease-out"
          )}
          style={{
            height: `${Math.max(contentTransform, 0)}px`,
            transform: `translateY(${Math.max(contentTransform - (isRefreshing ? threshold : 0), 0)}px)`,
          }}
          aria-hidden="true"
        >
          <div
            className={cn(
              "flex flex-col items-center gap-2 px-4 py-3",
              "transition-opacity duration-150",
              willRefresh && !isRefreshing ? "opacity-100" : "opacity-100"
            )}
            style={{
              opacity: isPulling ? 1 : 0,
              transform: `scale(${Math.max(0.5, progress)})`,
            }}
            role="status"
            aria-live="polite"
            aria-label={isRefreshing ? defaultLoadingText : willRefresh ? defaultReleaseText : defaultPullText}
          >
            {isRefreshing ? (
              <>
                {spinner || defaultSpinner}
                <span className="text-sm font-medium text-foreground">{defaultLoadingText}</span>
              </>
            ) : willRefresh ? (
              <>
                <svg
                  className="w-6 h-6 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-sm font-medium text-primary">{defaultReleaseText}</span>
              </>
            ) : (
              <>
                <svg
                  className="w-6 h-6 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ transform: `rotate(${progress * 180}deg)` }}
                  aria-hidden="true"
                >
                  <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-sm font-medium text-muted-foreground">{defaultPullText}</span>
              </>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={contentRef}
          className={cn(
            "relative z-20",
            "touch-auto",
            contentClassName
          )}
          style={{
            transform: `translateY(${contentTransform}px)`,
            transition: isRefreshing || !isPulling ? 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
          }}
        >
          {children}
        </div>

        {/* Accessibility: hidden live region for screen readers */}
        <div
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {isRefreshing ? defaultLoadingText : willRefresh ? defaultReleaseText : ''}
        </div>
      </div>
    );
  }
);

PullToRefreshComponent.displayName = 'PullToRefresh';

export const PullToRefresh = PullToRefreshComponent;
export default PullToRefresh;