import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Check, Info, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import '@/lib/build-ui-theme.css';

export type ToastVariant = 'error' | 'success' | 'info' | 'warning' | 'loading';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'destructive';
  }>;
  duration?: number; // ms, 0 = persistent
  dismissible?: boolean;
}

interface ToastState extends Toast {
  entered: boolean;
  exiting: boolean;
}

const ICON_MAP: Record<ToastVariant, typeof AlertTriangle> = {
  error: AlertTriangle,
  success: Check,
  info: Info,
  warning: AlertTriangle,
  loading: Loader2,
};

const VARIANT_STYLES: Record<ToastVariant, { border: string; bg: string; iconColor: string }> = {
  error: { border: 'border-[var(--build-accent-error)]/40', bg: 'bg-[var(--build-accent-error)]/10', iconColor: 'text-[var(--build-accent-error)]' },
  success: { border: 'border-[var(--build-accent-success)]/40', bg: 'bg-[var(--build-accent-success)]/10', iconColor: 'text-[var(--build-accent-success)]' },
  info: { border: 'border-[var(--build-accent-read)]/40', bg: 'bg-[var(--build-accent-read)]/10', iconColor: 'text-[var(--build-accent-read)]' },
  warning: { border: 'border-[var(--build-accent-warning)]/40', bg: 'bg-[var(--build-accent-warning)]/10', iconColor: 'text-[var(--build-accent-warning)]' },
  loading: { border: 'border-[var(--build-accent-read)]/40', bg: 'bg-[var(--build-accent-read)]/10', iconColor: 'text-[var(--build-accent-read)]' },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: (id: string) => void;
}) {
  const { t } = useI18n();
  const styles = VARIANT_STYLES[toast.variant];
  const Icon = ICON_MAP[toast.variant];

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-xl ${styles.border} ${styles.bg} ${styles.iconColor}`}
      style={{ minWidth: '280px', maxWidth: '420px' }}
      role="alert"
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex-shrink-0 mt-0.5" style={{ width: 20, height: 20 }}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-foreground">{toast.title}</p>
        {toast.message && (
          <p className="mt-1 text-[12px] text-muted-foreground/90">{toast.message}</p>
        )}
        {toast.actions && toast.actions.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            {toast.actions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  action.onClick();
                  if (!action.variant || action.variant !== 'secondary') onDismiss(toast.id);
                }}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
                  action.variant === 'destructive'
                    ? 'border border-[var(--build-accent-error)]/40 text-[var(--build-accent-error)] hover:bg-[var(--build-accent-error)]/10'
                    : action.variant === 'secondary'
                      ? 'border border-border text-muted-foreground hover:bg-secondary'
                      : 'bg-primary text-white hover:bg-primary/90'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {toast.dismissible !== false && (
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 p-1 text-muted-foreground/60 hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

interface ToasterProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function Toaster({ toasts, onDismiss }: ToasterProps) {
  const [state, setState] = useState<ToastState[]>([]);

  useEffect(() => {
    setState(prev => {
      const currentIds = new Set(prev.map(t => t.id));
      const incomingIds = new Set(toasts.map(t => t.id));

      // Remove toasts that are no longer in the incoming list
      const toRemove = prev.filter(t => !incomingIds.has(t.id));
      if (toRemove.length > 0) {
        const next = prev.filter(t => incomingIds.has(t.id));
        // Trigger exit animations
        toRemove.forEach(t => {
          const idx = prev.indexOf(t);
          setState(current => current.map((c, i) => (i === idx ? { ...c, exiting: true } : c)));
        });
        // Actually remove after animation
        setTimeout(() => setState(next), 200);
        return prev;
      }

      // Add new toasts
      const newToasts = toasts
        .filter(t => !currentIds.has(t.id))
        .map(t => ({ ...t, entered: true, exiting: false }));
      if (newToasts.length > 0) {
        return [...prev, ...newToasts];
      }
      return prev;
    });
  }, [toasts]);

  // Auto-dismiss timers
  useEffect(() => {
    const timers = state.map(toast => {
      if (toast.duration !== 0 && toast.duration !== undefined && !toast.exiting) {
        return setTimeout(() => {
          setState(current => current.map(t => (t.id === toast.id ? { ...t, exiting: true } : t)));
          setTimeout(() => onDismiss(toast.id), 200);
        }, toast.duration ?? 5000);
      }
      return null;
    }).filter(Boolean) as NodeJS.Timeout[];

    return () => timers.forEach(t => clearTimeout(t));
  }, [state, onDismiss]);

  return (
    <AnimatePresence mode="popLayout">
      {state.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </AnimatePresence>
  );
}

// Global toast manager
const listeners = new Set<(toasts: Toast[]) => void>();
let toastQueue: Toast[] = [];

const notify = () => listeners.forEach(fn => fn(toastQueue));

export function useBuildToasts() {
  const [toasts, setToasts] = useState<Toast[]>(toastQueue);

  useEffect(() => {
    const update = (newToasts: Toast[]) => {
      toastQueue = newToasts;
      setToasts([...newToasts]);
    };
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    toastQueue = toastQueue.filter(t => t.id !== id);
    notify();
  }, []);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newToast: Toast = {
      id,
      duration: 5000,
      dismissible: true,
      ...toast,
    };
    toastQueue = [...toastQueue, newToast];
    notify();
    return id;
  }, []);

  const error = useCallback((title: string, message?: string, actions?: Toast['actions']) =>
    showToast({ variant: 'error', title, message, actions }), [showToast]);

  const success = useCallback((title: string, message?: string) =>
    showToast({ variant: 'success', title, message, duration: 3000 }), [showToast]);

  const info = useCallback((title: string, message?: string) =>
    showToast({ variant: 'info', title, message }), [showToast]);

  const warning = useCallback((title: string, message?: string, actions?: Toast['actions']) =>
    showToast({ variant: 'warning', title, message, actions }), [showToast]);

  const loading = useCallback((title: string, message?: string) =>
    showToast({ variant: 'loading', title, message, duration: 0, dismissible: false }), [showToast]);

  return { toasts, dismiss, showToast, error, success, info, warning, loading };
}

/**
 * Portal-mounted toaster — renders at document.body top-right.
 * Use <BuildToaster /> once at the root of Build Studio.
 */
export function BuildToaster() {
  const { toasts, dismiss } = useBuildToasts();

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[70] flex flex-col items-end gap-2 pointer-events-none" style={{ maxWidth: '440px' }}>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>,
    document.body
  );
}