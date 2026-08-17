/**
 * Canvas Component — Liquid Glass Design System
 * Infinite canvas / whiteboard area with zoom, pan, and grid
 */

import React, { useState, useCallback, useRef, useEffect, useMemo, ReactNode } from "react";
import "./Canvas.css";

export interface CanvasProps {
  /** Canvas children */
  children: ReactNode;
  /** Initial zoom level (1 = 100%) */
  initialZoom?: number;
  /** Min zoom */
  minZoom?: number;
  /** Max zoom */
  maxZoom?: number;
  /** Enable panning */
  pan?: boolean;
  /** Enable zoom */
  zoom?: boolean;
  /** Zoom on wheel */
  wheelZoom?: boolean;
  /** Show grid */
  grid?: boolean;
  /** Grid size */
  gridSize?: number;
  /** Grid color */
  gridColor?: string;
  /** Snap to grid */
  snapToGrid?: boolean;
  /** On viewport change */
  onViewportChange?: (viewport: CanvasViewport) => void;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  /** Theme */
  theme?: "light" | "dark" | "auto";
  /** Canvas ref */
  forwardedRef?: React.Ref<CanvasHandle>;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface CanvasHandle {
  /** Set viewport */
  setViewport: (viewport: Partial<CanvasViewport>) => void;
  /** Reset to default */
  reset: () => void;
  /** Fit content */
  fitContent: (padding?: number) => void;
  /** Get current viewport */
  getViewport: () => CanvasViewport;
  /** Screen to canvas coordinates */
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
  /** Canvas to screen coordinates */
  canvasToScreen: (canvasX: number, canvasY: number) => { x: number; y: number };
}

const DEFAULT_VIEWPORT: CanvasViewport = {
  x: 0,
  y: 0,
  zoom: 1,
  width: 0,
  height: 0,
};

export const Canvas = React.forwardRef<CanvasHandle, CanvasProps>(
  ({
    children,
    initialZoom = 1,
    minZoom = 0.1,
    maxZoom = 5,
    pan = true,
    zoom = true,
    wheelZoom = true,
    grid = true,
    gridSize = 20,
    gridColor,
    snapToGrid = false,
    onViewportChange,
    className = "",
    style,
    theme = "auto",
  }, forwardedRef) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewportState] = useState<CanvasViewport>({
      ...DEFAULT_VIEWPORT,
      zoom: initialZoom,
    });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const viewportRef = useRef(viewport);
    const animationFrameRef = useRef<number>();

    // Keep ref in sync
    viewportRef.current = viewport;

    // Update container size
    useEffect(() => {
      const updateSize = () => {
        if (containerRef.current) {
          const { width, height } = containerRef.current.getBoundingClientRect();
          setViewportState((v) => ({ ...v, width, height }));
        }
      };
      updateSize();
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }, []);

    // Notify viewport changes
    useEffect(() => {
      onViewportChange?.(viewport);
    }, [viewport, onViewportChange]);

    // Pan handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      if (!pan || e.button !== 1 && e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".canvas__content > *")) return;
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y });
      (e.currentTarget as HTMLElement).style.cursor = "grabbing";
    }, [pan, viewport.x, viewport.y]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
      if (!isPanning) return;
      const newX = e.clientX - panStart.x;
      const newY = e.clientY - panStart.y;
      setViewportState((v) => ({ ...v, x: newX, y: newY }));
    }, [isPanning, panStart]);

    const handleMouseUp = useCallback(() => {
      setIsPanning(false);
      if (containerRef.current) {
        containerRef.current.style.cursor = "";
      }
    }, []);

    // Wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
      if (!wheelZoom || !zoom) return;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(minZoom, Math.min(maxZoom, viewport.zoom * zoomFactor));

      // Zoom towards mouse position
      const newX = mouseX - (mouseX - viewport.x) * (newZoom / viewport.zoom);
      const newY = mouseY - (mouseY - viewport.y) * (newZoom / viewport.zoom);

      setViewportState({ x: newX, y: newY, zoom: newZoom, width: viewport.width, height: viewport.height });
    }, [wheelZoom, zoom, minZoom, maxZoom, viewport]);

    // Touch handlers for mobile
    const [touchState, setTouchState] = useState<{
      touches: TouchList | null;
      initialDistance: number;
      initialZoom: number;
      initialCenter: { x: number; y: number };
    }>({ touches: null, initialDistance: 0, initialZoom: 1, initialCenter: { x: 0, y: 0 } });

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      if (e.touches.length === 1 && pan) {
        const touch = e.touches[0];
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setIsPanning(true);
        setPanStart({ x: touch.clientX - rect.left - viewport.x, y: touch.clientY - rect.top - viewport.y });
      } else if (e.touches.length === 2 && zoom) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
        setTouchState({
          touches: e.touches,
          initialDistance: distance,
          initialZoom: viewport.zoom,
          initialCenter: { x: centerX, y: centerY },
        });
      }
    }, [pan, zoom, viewport.x, viewport.y, viewport.zoom]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      e.preventDefault();
      if (isPanning && e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const newX = touch.clientX - rect.left - panStart.x;
        const newY = touch.clientY - rect.top - panStart.y;
        setViewportState((v) => ({ ...v, x: newX, y: newY }));
      } else if (touchState.touches && e.touches.length === 2 && zoom) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const scale = distance / touchState.initialDistance;
        const newZoom = Math.max(minZoom, Math.min(maxZoom, touchState.initialZoom * scale));
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
        const newX = centerX - (centerX - viewport.x) * (newZoom / viewport.zoom);
        const newY = centerY - (centerY - viewport.y) * (newZoom / viewport.zoom);
        setViewportState({ x: newX, y: newY, zoom: newZoom, width: viewport.width, height: viewport.height });
      }
    }, [isPanning, panStart, touchState, zoom, minZoom, maxZoom, viewport.x, viewport.y, viewport.zoom]);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
      if (e.touches.length === 0) {
        setIsPanning(false);
        setTouchState({ touches: null, initialDistance: 0, initialZoom: 1, initialCenter: { x: 0, y: 0 } });
      }
    }, []);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (!pan && !zoom) return;
      const step = 50 / viewport.zoom;
      const zoomStep = 0.1;
      let changed = false;

      switch (e.key) {
        case "ArrowLeft":
          if (pan) { setViewportState((v) => ({ ...v, x: v.x + step })); changed = true; }
          break;
        case "ArrowRight":
          if (pan) { setViewportState((v) => ({ ...v, x: v.x - step })); changed = true; }
          break;
        case "ArrowUp":
          if (pan) { setViewportState((v) => ({ ...v, y: v.y + step })); changed = true; }
          break;
        case "ArrowDown":
          if (pan) { setViewportState((v) => ({ ...v, y: v.y - step })); changed = true; }
          break;
        case "=":
        case "+":
          if (zoom) { setViewportState((v) => ({ ...v, zoom: Math.min(maxZoom, v.zoom + zoomStep) })); changed = true; }
          break;
        case "-":
          if (zoom) { setViewportState((v) => ({ ...v, zoom: Math.max(minZoom, v.zoom - zoomStep) })); changed = true; }
          break;
        case "0":
          if (zoom) { setViewportState((v) => ({ ...v, zoom: 1, x: 0, y: 0 })); changed = true; }
          break;
      }
      if (changed) e.preventDefault();
    }, [pan, zoom, viewport.zoom, minZoom, maxZoom]);

    // Public API
    const setViewport = useCallback((updates: Partial<CanvasViewport>) => {
      setViewportState((v) => ({ ...v, ...updates }));
    }, []);

    const reset = useCallback(() => {
      setViewportState({ ...DEFAULT_VIEWPORT, zoom: initialZoom, width: viewport.width, height: viewport.height });
    }, [initialZoom, viewport.width, viewport.height]);

    const fitContent = useCallback((padding = 50) => {
      if (!contentRef.current || !containerRef.current) return;
      const contentRect = contentRef.current.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const scaleX = (containerRect.width - padding * 2) / contentRect.width;
      const scaleY = (containerRect.height - padding * 2) / contentRect.height;
      const newZoom = Math.min(scaleX, scaleY, maxZoom);
      const newX = (containerRect.width - contentRect.width * newZoom) / 2 - contentRect.left * newZoom;
      const newY = (containerRect.height - contentRect.height * newZoom) / 2 - contentRect.top * newZoom;
      setViewportState({ x: newX, y: newY, zoom: newZoom, width: viewport.width, height: viewport.height });
    }, [maxZoom, viewport.width, viewport.height]);

    const screenToCanvas = useCallback((screenX: number, screenY: number) => {
      const v = viewportRef.current;
      return {
        x: (screenX - v.x) / v.zoom,
        y: (screenY - v.y) / v.zoom,
      };
    }, []);

    const canvasToScreen = useCallback((canvasX: number, canvasY: number) => {
      const v = viewportRef.current;
      return {
        x: canvasX * v.zoom + v.x,
        y: canvasY * v.zoom + v.y,
      };
    }, []);

    const handle = useMemo<CanvasHandle>(() => ({
      setViewport,
      reset,
      fitContent,
      getViewport: () => viewportRef.current,
      screenToCanvas,
      canvasToScreen,
    }), [setViewport, reset, fitContent, screenToCanvas, canvasToScreen]);

    // Expose ref
    useEffect(() => {
      if (forwardedRef) {
        if (typeof forwardedRef === "function") {
          forwardedRef(handle);
        } else {
          forwardedRef.current = handle;
        }
      }
    }, [forwardedRef, handle]);

    // Grid pattern
    const gridStyle = useMemo(() => {
      if (!grid) return {};
      const size = gridSize * viewport.zoom;
      if (size < 4) return {}; // Too small to render
      const color = gridColor || (theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.05)");
      return {
        backgroundImage: `
          linear-gradient(${color} 1px, transparent 1px),
          linear-gradient(90deg, ${color} 1px, transparent 1px)
        `,
        backgroundSize: `${size}px ${size}px`,
      };
    }, [grid, gridSize, gridColor, viewport.zoom, theme]);

    const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

    const classNames = useMemo(() => [
      "canvas",
      `canvas--${theme}`,
      pan && "canvas--pan-enabled",
      zoom && "canvas--zoom-enabled",
      isPanning && "canvas--panning",
      className,
    ].filter(Boolean).join(" "), [theme, pan, zoom, isPanning, className]);

    return (
      <div
        ref={containerRef}
        className={classNames}
        style={style}
        data-theme={theme}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="application"
        aria-label="Infinite canvas"
      >
        <div
          className="canvas__viewport"
          style={{
            transform,
            transformOrigin: "0 0",
            width: "100%",
            height: "100%",
            ...gridStyle,
          }}
        >
          <div
            ref={contentRef}
            className="canvas__content"
            style={{
              width: "100%",
              height: "100%",
              minWidth: "100%",
              minHeight: "100%",
            }}
          >
            {children}
          </div>
        </div>
        {/* Zoom indicator */}
        {zoom && (
          <div className="canvas__zoom-indicator" aria-live="polite" aria-atomic="true">
            {Math.round(viewport.zoom * 100)}%
          </div>
        )}
      </div>
    );
  }
);

Canvas.displayName = "Canvas";

/** Canvas Layer - for organizing content in layers */
export interface CanvasLayerProps {
  /** Layer children */
  children: ReactNode;
  /** Layer name */
  name?: string;
  /** Layer visible */
  visible?: boolean;
  /** Layer opacity */
  opacity?: number;
  /** Layer z-index */
  zIndex?: number;
  /** Pointer events */
  pointerEvents?: "auto" | "none" | "visiblePainted" | "visibleFill" | "visibleStroke" | "visible" | "painted" | "fill" | "stroke" | "all" | "inherit";
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const CanvasLayer: React.FC<CanvasLayerProps> = ({
  children,
  name,
  visible = true,
  opacity = 1,
  zIndex = 0,
  pointerEvents = "auto",
  className = "",
  style,
}) => {
  if (!visible) return null;

  return (
    <div
      className={`canvas-layer ${className}`}
      style={{
        ...style,
        opacity,
        zIndex,
        pointerEvents,
        position: "absolute",
        inset: 0,
      }}
      data-layer-name={name}
      role="group"
      aria-label={name}
    >
      {children}
    </div>
  );
};

/** Canvas Grid - customizable grid overlay */
export interface CanvasGridProps {
  /** Grid size */
  size?: number;
  /** Major grid every N cells */
  majorEvery?: number;
  /** Grid color */
  color?: string;
  /** Major grid color */
  majorColor?: string;
  /** Line width */
  lineWidth?: number;
  /** Major line width */
  majorLineWidth?: number;
  /** Style */
  style?: React.CSSProperties;
}

export const CanvasGrid: React.FC<CanvasGridProps> = ({
  size = 20,
  majorEvery = 5,
  color,
  majorColor,
  lineWidth = 0.5,
  majorLineWidth = 1,
  style,
}) => {
  // This would render as an SVG overlay in production
  // For now, using CSS background on the viewport
  return null;
};

/** Canvas Ruler - shows measurements along edges */
export interface CanvasRulerProps {
  /** Axis */
  axis?: "x" | "y" | "both";
  /** Unit */
  unit?: "px" | "cm" | "in";
  /** DPI */
  dpi?: number;
  /** Color */
  color?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const CanvasRuler: React.FC<CanvasRulerProps> = ({
  axis = "both",
  unit = "px",
  dpi = 96,
  color,
  style,
}) => {
  // Ruler implementation would go here
  return null;
};