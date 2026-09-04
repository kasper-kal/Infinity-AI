/**
 * Dialog Component — Liquid Glass Design System
 */

import React, { forwardRef, useEffect, useRef, ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Dialog.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  className?: string;
}

export const Dialog = forwardRef<HTMLDivElement, DialogProps>(
  (
    {
      open,
      onClose,
      title,
      description,
      children,
      size = "md",
      closeOnOverlayClick = true,
      closeOnEscape = true,
      showCloseButton = true,
      className = "",
    },
    ref
  ) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<HTMLElement | null>(null);

    // Focus management
    useEffect(() => {
      if (open) {
        previousActiveElement.current = document.activeElement as HTMLElement;
        document.body.style.overflow = "hidden";
        // Focus the dialog after a frame
        requestAnimationFrame(() => {
          dialogRef.current?.focus();
        });
      } else {
        document.body.style.overflow = "";
        previousActiveElement.current?.focus();
      }
      return () => {
        document.body.style.overflow = "";
      };
    }, [open]);

    // Escape key
    useEffect(() => {
      if (!open || !closeOnEscape) return;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, closeOnEscape, onClose]);

    // Trap focus
    useEffect(() => {
      if (!open) return;
      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", handleTab);
      return () => document.removeEventListener("keydown", handleTab);
    }, [open]);

    if (!open) return null;

    const classNames = ["dialog", `dialog--${size}`, className].filter(Boolean).join(" ");

    const content = (
      <div
        ref={ref}
        className={classNames}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "dialog-title" : undefined}
        aria-describedby={description ? "dialog-description" : undefined}
        tabIndex={-1}
        onClick={(e) => {
          if (e.target === e.currentTarget && closeOnOverlayClick) onClose();
        }}
      >
        <div className="dialog__overlay" aria-hidden="true" />
        <div className="dialog__container">
          <div className="dialog__content" ref={dialogRef}>
            {(showCloseButton || title) && (
              <div className="dialog__header">
                <div className="dialog__title-group">
                  {title && <h2 id="dialog-title" className="dialog__title">{title}</h2>}
                  {description && <p id="dialog-description" className="dialog__description">{description}</p>}
                </div>
                {showCloseButton && (
                  <button
                    className="dialog__close"
                    onClick={onClose}
                    aria-label="Close dialog"
                    type="button"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <div className="dialog__body">{children}</div>
          </div>
        </div>
      </div>
    );

    return createPortal(content, document.body);
  }
);

Dialog.displayName = "Dialog";

/** Alert Dialog — for confirmations */
export interface AlertDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
}

export const AlertDialog: React.FC<AlertDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "primary",
  loading = false,
}) => {
  return (
    <Dialog open={open} onClose={onClose} size="sm" showCloseButton={false}>
      <div className="alert-dialog">
        <h2 className="dialog__title">{title}</h2>
        {description && <p className="dialog__description">{description}</p>}
        <div className="alert-dialog__actions">
          <button className="btn btn--ghost btn--md" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button
            className={`btn btn--${variant} btn--md`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Loading..." : confirmText}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

/** Dialog sub-components for Radix-compatible API */
export interface DialogContentProps {
  children: ReactNode;
  className?: string;
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ children, className = "", ...props }, ref) => (
    <div ref={ref} className={`dialog__content ${className}`} {...props}>
      {children}
    </div>
  )
);
DialogContent.displayName = "DialogContent";

export interface DialogHeaderProps {
  children: ReactNode;
  className?: string;
}

export const DialogHeader: React.FC<DialogHeaderProps> = ({ children, className = "" }) => (
  <div className={`dialog__header ${className}`}>{children}</div>
);

export interface DialogTitleProps {
  children: ReactNode;
  className?: string;
}

export const DialogTitle: React.FC<DialogTitleProps> = ({ children, className = "" }) => (
  <h2 id="dialog-title" className={`dialog__title ${className}`}>
    {children}
  </h2>
);

export interface DialogDescriptionProps {
  children: ReactNode;
  className?: string;
}

export const DialogDescription: React.FC<DialogDescriptionProps> = ({ children, className = "" }) => (
  <p id="dialog-description" className={`dialog__description ${className}`}>
    {children}
  </p>
);

export interface DialogFooterProps {
  children: ReactNode;
  className?: string;
}

export const DialogFooter: React.FC<DialogFooterProps> = ({ children, className = "" }) => (
  <div className={`dialog__footer ${className}`}>{children}</div>
);

/** Drawer — slide-in panel from edge */
export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  position?: "left" | "right" | "top" | "bottom";
  size?: "sm" | "md" | "lg" | "full";
  title?: string;
  showCloseButton?: boolean;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  children,
  position = "right",
  size = "md",
  title,
  showCloseButton = true,
}) => {
  const classNames = ["drawer", `drawer--${position}`, `drawer--${size}`].filter(Boolean).join(" ");

  if (!open) return null;

  const content = (
    <div className={classNames} role="dialog" aria-modal="true" aria-labelledby={title ? "drawer-title" : undefined}>
      <div className="drawer__overlay" onClick={onClose} aria-hidden="true" />
      <div className="drawer__container">
        {(title || showCloseButton) && (
          <div className="drawer__header">
            {title && <h2 id="drawer-title" className="drawer__title">{title}</h2>}
            {showCloseButton && (
              <button className="drawer__close" onClick={onClose} aria-label="Close drawer" type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="drawer__body">{children}</div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};