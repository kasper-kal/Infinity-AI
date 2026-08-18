/**
 * Tooltip Component — Liquid Glass Design System
 */

import React, { useState, useRef, useEffect, useId, ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  offset?: number;
  delay?: number;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  position = "top",
  offset = 8,
  delay = 200,
  className = "",
}) => {
  const [open, setOpen] = useState(false);
  const [positionStyles, setPositionStyles] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const tooltipId = useId();

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = 0;
    let left = 0;

    switch (position) {
      case "top":
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        top = triggerRect.top - tooltipRect.height - offset;
        break;
      case "bottom":
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        top = triggerRect.bottom + offset;
        break;
      case "left":
        left = triggerRect.left - tooltipRect.width - offset;
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
      case "right":
        left = triggerRect.right + offset;
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
    }

    // Constrain to viewport
    const padding = 8;
    left = Math.max(padding, Math.min(left, viewportWidth - tooltipRect.width - padding));
    top = Math.max(padding, Math.min(top, viewportHeight - tooltipRect.height - padding));

    setPositionStyles({ top: `${top}px`, left: `${left}px` });
  };

  const show = () => {
    timeoutRef.current = setTimeout(() => {
      setOpen(true);
      requestAnimationFrame(updatePosition);
    }, delay);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") hide();
  };

  useEffect(() => {
    if (open) {
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }
  }, [open]);

  // Handle both single child element and array
  const child = React.Children.only(children) as React.ReactElement;
  const enhancedChild = React.cloneElement(child, {
    ref: triggerRef,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onKeyDown: handleKeyDown,
    "aria-describedby": open ? tooltipId : undefined,
  });

  const tooltipContent = open ? (
    <div
      ref={tooltipRef}
      id={tooltipId}
      className={`tooltip tooltip--${position} ${className}`}
      style={positionStyles}
      role="tooltip"
      aria-hidden="false"
    >
      <div className="tooltip__arrow" data-position={position} />
      <div className="tooltip__content">{content}</div>
    </div>
  ) : null;

  return (
    <>
      {enhancedChild}
      {tooltipContent && createPortal(tooltipContent, document.body)}
    </>
  );
};

/** Toast Component */
export interface ToastProps {
  message: string;
  type?: "info" | "success" | "warning" | "error";
  duration?: number;
  onClose?: () => void;
  action?: { label: string; onClick: () => void };
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = "info",
  duration = 5000,
  onClose,
  action,
}) => {
  const [visible, setVisible] = useState(true);
  const toastRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(() => onClose?.(), 200);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVisible(false);
        setTimeout(() => onClose?.(), 200);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!visible) return null;

  const classNames = ["toast", `toast--${type}`].join(" ");

  return (
    <div ref={toastRef} className={classNames} role="alert" aria-live="polite">
      <div className="toast__icon" aria-hidden="true">
        {type === "success" && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
        {type === "error" && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
        {type === "warning" && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
        {type === "info" && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
      </div>
      <div className="toast__message">{message}</div>
      {action && (
        <button className="toast__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <button className="toast__close" onClick={() => { setVisible(false); setTimeout(() => onClose?.(), 200); }} aria-label="Dismiss">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

/** Toast Container — manages multiple toasts */
export interface ToastContainerProps {
  toasts: Array<ToastProps & { id: string }>;
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
  gap?: number;
  maxToasts?: number;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  position = "top-right",
  gap = 12,
  maxToasts = 5,
}) => {
  const visibleToasts = toasts.slice(-maxToasts);

  const containerStyles: React.CSSProperties = {
    position: "fixed",
    zIndex: 600,
    display: "flex",
    flexDirection: "column",
    gap,
    pointerEvents: "none",
  };

  const positionStyles: Record<string, React.CSSProperties> = {
    "top-right": { top: 20, right: 20, alignItems: "flex-end" },
    "top-left": { top: 20, left: 20, alignItems: "flex-start" },
    "bottom-right": { bottom: 20, right: 20, alignItems: "flex-end" },
    "bottom-left": { bottom: 20, left: 20, alignItems: "flex-start" },
    "top-center": { top: 20, left: "50%", transform: "translateX(-50%)", alignItems: "center" },
    "bottom-center": { bottom: 20, left: "50%", transform: "translateX(-50%)", alignItems: "center" },
  };

  return (
    <div style={{ ...containerStyles, ...positionStyles[position] }} pointerEvents="auto">
      {visibleToasts.map((toast) => (
        <Toast key={toast.id} {...toast} />
      ))}
    </div>
  );
};
/** useToast hook — programmatic toast management */
export function useToast() {
  const [toasts, setToasts] = useState<Array<ToastProps & { id: string }>>([]);

  const toast = useCallback((message: string, type: ToastProps["type"] = "info", options?: Partial<ToastProps>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type, ...options }]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, toast, dismiss };
}
