/**
 * SwipeGesture — Touch swipe detection hook & component
 * Detects swipe directions (left, right, up, down) with configurable
 * threshold, velocity, and exclusion zones. Works with React 18+.
 */

import React, { useRef, useCallback, useEffect, useState } from "react";
import { haptics } from "@/lib/haptics";

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface SwipeGestureOptions {
  /** Minimum distance in px to register as swipe (default: 50) */
  threshold?: number;
  /** Maximum time in ms for swipe (default: 300) */
  maxTime?: number;
  /** Minimum velocity in px/ms (default: 0.3) */
  minVelocity?: number;
  /** Exclude elements matching selector from triggering swipe */
  excludeSelectors?: string[];
  /** Prevent default touch behavior (default: false) */
  preventDefault?: boolean;
  /** Enable horizontal swipes (default: true) */
  horizontal?: boolean;
  /** Enable vertical swipes (default: true) */
  vertical?: boolean;
  /** Callback when swipe starts */
  onSwipeStart?: (direction: SwipeDirection, event: TouchEvent) => void;
  /** Callback during swipe movement */
  onSwipeMove?: (direction: SwipeDirection, delta: { x: number; y: number }, event: TouchEvent) => void;
  /** Callback when swipe ends (successful) */
  onSwipeEnd?: (direction: SwipeDirection, event: TouchEvent) => void;
  /** Callback when swipe cancelled (below threshold) */
  onSwipeCancel?: (direction: SwipeDirection, event: TouchEvent) => void;
}

export interface SwipeGestureState {
  isSwiping: boolean;
  direction: SwipeDirection | null;
  deltaX: number;
  deltaY: number;
  velocity: number;
  startTime: number;
  startX: number;
  startY: number;
}

const DEFAULT_OPTIONS: Required<SwipeGestureOptions> = {
  threshold: 50,
  maxTime: 300,
  minVelocity: 0.3,
  excludeSelectors: ['button', 'a', 'input', 'textarea', 'select', '[role="button"]', '[data-no-swipe]'],
  preventDefault: false,
  horizontal: true,
  vertical: true,
  onSwipeStart: undefined,
  onSwipeMove: undefined,
  onSwipeEnd: undefined,
  onSwipeCancel: undefined,
};

/**
 * Hook for swipe gesture detection
 */
export function useSwipeGesture(
  targetRef: React.RefObject<HTMLElement | null>,
  options: SwipeGestureOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const [state, setState] = useState<SwipeGestureState>({
    isSwiping: false,
    direction: null,
    deltaX: 0,
    deltaY: 0,
    velocity: 0,
    startTime: 0,
    startX: 0,
    startY: 0,
  });

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isExcludedRef = useRef(false);

  const isExcluded = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Element)) return false;
    return opts.excludeSelectors.some(selector => target.closest(selector));
  }, [opts.excludeSelectors]);

  const getDirection = useCallback((deltaX: number, deltaY: number): SwipeDirection | null => {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (!opts.horizontal && !opts.vertical) return null;
    if (!opts.horizontal && absY > absX) return deltaY > 0 ? 'down' : 'up';
    if (!opts.vertical && absX > absY) return deltaX > 0 ? 'right' : 'left';

    if (absX > absY) {
      return deltaX > 0 ? 'right' : 'left';
    } else {
      return deltaY > 0 ? 'down' : 'up';
    }
  }, [opts.horizontal, opts.vertical]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (isExcluded(e.target)) {
      isExcludedRef.current = true;
      return;
    }
    isExcludedRef.current = false;

    const touch = e.touches[0];
    const now = Date.now();

    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: now };

    setState({
      isSwiping: true,
      direction: null,
      deltaX: 0,
      deltaY: 0,
      velocity: 0,
      startTime: now,
      startX: touch.clientX,
      startY: touch.clientY,
    });

    if (opts.preventDefault) {
      e.preventDefault();
    }
  }, [isExcluded, opts.preventDefault]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (isExcludedRef.current || !touchStartRef.current) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    const direction = getDirection(deltaX, deltaY);

    setState(prev => ({
      ...prev,
      deltaX,
      deltaY,
      direction,
    }));

    if (direction && opts.onSwipeMove) {
      opts.onSwipeMove(direction, { x: deltaX, y: deltaY }, e);
    }

    if (opts.preventDefault) {
      e.preventDefault();
    }
  }, [getDirection, opts.onSwipeMove, opts.preventDefault]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (isExcludedRef.current || !touchStartRef.current) {
      touchStartRef.current = null;
      setState(prev => ({ ...prev, isSwiping: false }));
      return;
    }

    const touch = e.changedTouches[0];
    const now = Date.now();
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const timeDelta = now - touchStartRef.current.time;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const velocity = distance / timeDelta;

    const direction = getDirection(deltaX, deltaY);
    const isValidSwipe =
      distance >= opts.threshold &&
      timeDelta <= opts.maxTime &&
      velocity >= opts.minVelocity &&
      direction !== null;

    setState(prev => ({
      ...prev,
      isSwiping: false,
      velocity,
    }));

    if (isValidSwipe && direction) {
      haptics.light();
      opts.onSwipeEnd?.(direction, e);
    } else if (direction) {
      opts.onSwipeCancel?.(direction, e);
    }

    touchStartRef.current = null;
  }, [getDirection, opts.threshold, opts.maxTime, opts.minVelocity, opts.onSwipeEnd, opts.onSwipeCancel]);

  // Attach listeners
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: !opts.preventDefault });
    el.addEventListener('touchmove', handleTouchMove, { passive: !opts.preventDefault });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [targetRef, handleTouchStart, handleTouchMove, handleTouchEnd, opts.preventDefault]);

  return state;
}

/**
 * SwipeableArea — Component wrapper for swipe gestures
 * Wraps children and provides swipe detection props
 */
export interface SwipeableAreaProps {
  children: React.ReactNode;
  options?: SwipeGestureOptions;
  className?: string;
  /** Render prop for custom rendering based on swipe state */
  render?: (state: SwipeGestureState) => React.ReactNode;
}

export const SwipeableArea: React.FC<SwipeableAreaProps> = ({
  children,
  options = {},
  className,
  render,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const state = useSwipeGesture(ref, options);

  if (render) {
    return (
      <div ref={ref} className={className}>
        {render(state)}
      </div>
    );
  }

  return (
    <div ref={ref} className={className}>
      {typeof children === 'function' ? children(state) : children}
    </div>
  );
};

export default useSwipeGesture;