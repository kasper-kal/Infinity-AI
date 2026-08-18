/**
 * SheetModal — Mobile-first bottom sheet modal
 * Slides up from bottom, supports multiple snap points (peek, half, full),
 * drag handle, swipe-to-dismiss, backdrop blur, safe-area handling.
 * Built on Radix Dialog primitives for accessibility.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { haptics } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";

export type SheetSnapPoint = 'peek' | 'half' | 'full';

export interface SheetModalProps {
  /** Open state */
  open: boolean;
  /** Called when sheet closes */
  onOpenChange: (open: boolean) => void;
  /** Sheet title */
  title?: string;
  /** Sheet description for accessibility */
  description?: string;
  /** Sheet content */
  children: React.ReactNode;
  /** Initial snap point (default: 'half') */
  defaultSnapPoint?: SheetSnapPoint;
  /** Available snap points (default: all three) */
  snapPoints?: SheetSnapPoint[];
  /** Show drag handle (default: true) */
  showHandle?: boolean;
  /** Enable swipe to dismiss (default: true) */
  swipeToDismiss?: boolean;
  /** Custom className for the sheet content */
  className?: string;
  /** Content className */
  contentClassName?: string;
  /** Prevent body scroll when open (default: true) */
  preventScroll?: boolean;
  /** Callback when snap point changes */
  onSnapPointChange?: (point: SheetSnapPoint) => void;
}

const SNAP_HEIGHTS: Record<SheetSnapPoint, string> = {
  peek: '120px',
  half: '50vh',
  full: 'calc(100vh - env(safe-area-inset-top, 0))',
};

const SNAP_PERCENTS: Record<SheetSnapPoint, number> = {
  peek: 0.15,
  half: 0.5,
  full: 0.9,
};

export const SheetModal: React.FC<SheetModalProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  defaultSnapPoint = 'half',
  snapPoints = ['peek', 'half', 'full'],
  showHandle = true,
  swipeToDismiss = true,
  className,
  contentClassName,
  preventScroll = true,
  onSnapPointChange,
}) => {
  const { t } = useI18n();
  const [snapPoint, setSnapPoint] = useState<SheetSnapPoint>(defaultSnapPoint);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [currentHeight, setCurrentHeight] = useState<number>(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const previousSnapPoint = useRef<SheetSnapPoint>(defaultSnapPoint);

  // Calculate initial height from snap point
  useEffect(() => {
    if (open) {
      const height = getSnapHeight(snapPoint);
      setCurrentHeight(height);
    }
  }, [open, snapPoint]);

  // Notify parent of snap point changes
  useEffect(() => {
    if (open && snapPoint !== previousSnapPoint.current) {
      onSnapPointChange?.(snapPoint);
      previousSnapPoint.current = snapPoint;
    }
  }, [snapPoint, open, onSnapPointChange]);

  const getSnapHeight = (point: SheetSnapPoint): number => {
    const vh = window.innerHeight;
    return Math.round(vh * SNAP_PERCENTS[point]);
  };

  const getClosestSnapPoint = (height: number): SheetSnapPoint => {
    const vh = window.innerHeight;
    const percent = height / vh;

    let closest: SheetSnapPoint = snapPoints[0];
    let minDiff = Infinity;

    for (const point of snapPoints) {
      const diff = Math.abs(percent - SNAP_PERCENTS[point]);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }
    return closest;
  };

  const handleDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!swipeToDismiss) return;

    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragStartY(clientY);
    setIsDragging(true);
    haptics.light();
  }, [swipeToDismiss]);

  const handleDragMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;

    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = dragStartY - clientY; // negative = dragging down
    const newHeight = Math.max(0, currentHeight + deltaY);
    setCurrentHeight(newHeight);
  }, [isDragging, dragStartY, currentHeight]);

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    // Determine action based on drag distance and velocity
    const draggedDown = currentHeight < getSnapHeight(snapPoint);
    const threshold = window.innerHeight * 0.3; // 30% of viewport

    if (draggedDown && (getSnapHeight(snapPoint) - currentHeight) > threshold) {
      // Dismiss
      onOpenChange(false);
      haptics.medium();
    } else {
      // Snap to closest point
      const newPoint = getClosestSnapPoint(currentHeight);
      setSnapPoint(newPoint);
      haptics.light();
    }
  }, [isDragging, currentHeight, snapPoint, onOpenChange]);

  // Attach global listeners during drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('touchmove', handleDragMove as any, { passive: false });
      window.addEventListener('mousemove', handleDragMove as any);
      window.addEventListener('touchend', handleDragEnd);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('touchmove', handleDragMove as any);
        window.removeEventListener('mousemove', handleDragMove as any);
        window.removeEventListener('touchend', handleDragEnd);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Prevent body scroll
  useEffect(() => {
    if (open && preventScroll) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open, preventScroll]);

  // Handle ESC key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onOpenChange(false);
    }
  }, [onOpenChange]);

  // Snap point heights for pointer
  const snapHeights = useMemo(() =>
    snapPoints.map(p => getSnapHeight(p)),
  [snapPoints]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "touch-manipulation"
          )}
          onClick={() => onOpenChange(false)}
        />

        {/* Sheet Content */}
        <DialogPrimitive.Content
          ref={contentRef}
          className={cn(
            "fixed bottom-0 left-0 right-0 z-50",
            "glass-strong border-t border-border-primary/60 rounded-t-2xl",
            "shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            "touch-manipulation",
            className
          )}
          style={{
            height: `${currentHeight}px`,
            maxHeight: `calc(100vh - env(safe-area-inset-top, 0))`,
            minHeight: getSnapHeight(snapPoints[0]),
          } as React.CSSProperties}
          onKeyDown={handleKeyDown}
        >
          {/* Drag Handle */}
          {showHandle && (
            <div
              ref={handleRef}
              className={cn(
                "flex items-center justify-center px-4 py-3",
                "touch-manipulation select-none",
                isDragging ? "active" : ""
              )}
              onTouchStart={handleDragStart}
              onMouseDown={handleDragStart}
              role="button"
              tabIndex={0}
              aria-label={t('mobile.sheet.dragHandle') || 'Drag to resize'}
              aria-expanded={open}
            >
              <div
                className={cn(
                  "w-10 h-1 rounded-full bg-muted-foreground/30",
                  "transition-colors duration-150",
                  isDragging && "bg-primary"
                )}
                aria-hidden="true"
              />
            </div>
          )}

          {/* Header */}
          {(title || description) && (
            <div className="px-4 pb-2">
              {title && (
                <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
                  {title}
                </DialogPrimitive.Title>
              )}
              {description && (
                <DialogPrimitive.Description className="text-sm text-muted-foreground mt-1">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
          )}

          {/* Content */}
          <div
            className={cn(
              "overflow-y-auto overscroll-contain",
              "max-h-[calc(100%-env(safe-area-inset-bottom,0))]",
              "pb-4 px-4",
              contentClassName
            )}
            style={{
              maxHeight: `calc(${currentHeight}px - ${showHandle ? '60px' : '20px'} - env(safe-area-inset-bottom, 0))`,
            }}
          >
            {children}
          </div>

          {/* Snap point indicators (subtle) */}
          {snapPoints.length > 1 && !isDragging && (
            <div
              className="absolute right-4 top-4 flex flex-col gap-1.5 opacity-50 transition-opacity"
              aria-hidden="true"
            >
              {snapPoints.map((point) => (
                <div
                  key={point}
                  className={cn(
                    "w-2 h-2 rounded-full transition-all duration-200",
                    snapPoint === point
                      ? "bg-primary w-3"
                      : "bg-muted-foreground/30"
                  )}
                />
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default SheetModal;