/**
 * useNotifications Hook — Phase 38
 * Real-time in-app notification management with WebSocket/SSE integration
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export interface InAppNotification {
  id: string;
  projectId: string;
  type: "safety" | "info" | "warning" | "success" | "error";
  title: string;
  message: string;
  severity: "info" | "warning" | "critical" | "emergency";
  ruleId?: string;
  eventId?: string;
  data?: Record<string, any>;
  read: boolean;
  dismissed: boolean;
  createdAt: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface NotificationState {
  notifications: InAppNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  connected: boolean;
}

export interface UseNotificationsOptions {
  projectId?: string;
  autoConnect?: boolean;
  pollInterval?: number;
  maxNotifications?: number;
}

export interface UseNotificationsReturn extends NotificationState {
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismiss: (notificationId: string) => Promise<void>;
  dismissAll: () => Promise<void>;
  refresh: () => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  onNotification: (callback: (notification: InAppNotification) => void) => () => void;
}

/**
 * Hook for managing real-time in-app notifications
 */
export function useNotifications(
  options: UseNotificationsOptions = {}
): UseNotificationsReturn {
  const {
    projectId,
    autoConnect = true,
    pollInterval = 30000,
    maxNotifications = 100,
  } = options;

  const { t } = useI18n();
  const [state, setState] = useState<NotificationState>({
    notifications: [],
    unreadCount: 0,
    loading: false,
    error: null,
    connected: false,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callbacksRef = useRef<Set<(notification: InAppNotification) => void>>(new Set());
  const initializedRef = useRef(false);

  // Fetch notifications from API
  const fetchNotifications = useCallback(async () => {
    if (!projectId) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const params = new URLSearchParams();
      params.set("projectId", projectId);
      params.set("limit", maxNotifications.toString());

      const res = await fetch(`/api/infinity/safety-watcher/in-app-notifications?${params}`);
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to fetch notifications");
      }

      const notifications = data.notifications || [];
      const unreadCount = notifications.filter((n: InAppNotification) => !n.read && !n.dismissed).length;

      setState(prev => ({
        ...prev,
        notifications,
        unreadCount,
        loading: false,
        error: null,
      }));
    } catch (e) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch notifications",
      }));
    }
  }, [projectId, maxNotifications]);

  // Mark notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/infinity/safety-watcher/in-app-notifications/${notificationId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to mark as read");
      }

      setState(prev => {
        const updated = prev.notifications.map(n =>
          n.id === notificationId ? { ...n, read: true } : n
        );
        const unreadCount = updated.filter(n => !n.read && !n.dismissed).length;
        return { ...prev, notifications: updated, unreadCount };
      });

      haptics.light();
    } catch (e) {
      console.error("Failed to mark notification as read:", e);
      haptics.error();
    }
  }, [projectId]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/infinity/safety-watcher/in-app-notifications/read-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to mark all as read");
      }

      setState(prev => ({
        ...prev,
        notifications: prev.notifications.map(n => ({ ...n, read: true })),
        unreadCount: 0,
      }));

      haptics.success();
    } catch (e) {
      console.error("Failed to mark all notifications as read:", e);
      haptics.error();
    }
  }, [projectId]);

  // Dismiss a notification
  const dismiss = useCallback(async (notificationId: string) => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/infinity/safety-watcher/in-app-notifications/${notificationId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to dismiss notification");
      }

      setState(prev => {
        const updated = prev.notifications.map(n =>
          n.id === notificationId ? { ...n, dismissed: true } : n
        );
        const unreadCount = updated.filter(n => !n.read && !n.dismissed).length;
        return { ...prev, notifications: updated, unreadCount };
      });

      haptics.light();
    } catch (e) {
      console.error("Failed to dismiss notification:", e);
      haptics.error();
    }
  }, [projectId]);

  // Dismiss all notifications
  const dismissAll = useCallback(async () => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/infinity/safety-watcher/in-app-notifications/dismiss-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to dismiss all notifications");
      }

      setState(prev => ({
        ...prev,
        notifications: prev.notifications.map(n => ({ ...n, dismissed: true })),
        unreadCount: 0,
      }));

      haptics.success();
    } catch (e) {
      console.error("Failed to dismiss all notifications:", e);
      haptics.error();
    }
  }, [projectId]);

  // Connect to SSE stream for real-time updates
  const connect = useCallback(() => {
    if (!projectId || eventSourceRef.current) return;

    try {
      const eventSource = new EventSource(`/api/infinity/safety-watcher/events?projectId=${projectId}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setState(prev => ({ ...prev, connected: true, error: null }));
      };

      eventSource.onmessage = (event) => {
        try {
          const notification = JSON.parse(event.data) as InAppNotification;

          // Add to notifications list
          setState(prev => {
            const exists = prev.notifications.some(n => n.id === notification.id);
            if (exists) return prev;

            const updated = [notification, ...prev.notifications].slice(0, maxNotifications);
            const unreadCount = updated.filter(n => !n.read && !n.dismissed).length;
            return { ...prev, notifications: updated, unreadCount };
          });

          // Notify callbacks
          callbacksRef.current.forEach(callback => {
            try {
              callback(notification);
            } catch (e) {
              console.error("Notification callback error:", e);
            }
          });

          // Show browser notification if permitted
          if (Notification.permission === "granted" && !document.hasFocus()) {
            new Notification(notification.title, {
              body: notification.message,
              icon: "/favicon.ico",
              tag: notification.id,
            });
          }

          // Haptic feedback based on severity
          switch (notification.severity) {
            case "emergency":
              haptics.heavy();
              break;
            case "critical":
              haptics.medium();
              break;
            default:
              haptics.light();
          }
        } catch (e) {
          console.error("Failed to parse notification:", e);
        }
      };

      eventSource.onerror = () => {
        setState(prev => ({ ...prev, connected: false }));
        // Reconnect after 5 seconds
        setTimeout(() => {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            connect();
          }
        }, 5000);
      };
    } catch (e) {
      console.error("Failed to connect to notification stream:", e);
      setState(prev => ({ ...prev, connected: false, error: "Connection failed" }));
    }
  }, [projectId, maxNotifications]);

  // Disconnect from SSE stream
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setState(prev => ({ ...prev, connected: false }));
    }
  }, []);

  // Subscribe to new notifications
  const onNotification = useCallback((callback: (notification: InAppNotification) => void) => {
    callbacksRef.current.add(callback);
    return () => {
      callbacksRef.current.delete(callback);
    };
  }, []);

  // Polling fallback
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;

    pollTimerRef.current = setInterval(() => {
      fetchNotifications();
    }, pollInterval);
  }, [fetchNotifications, pollInterval]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Initialize
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      fetchNotifications();

      if (autoConnect) {
        connect();
        startPolling();
      }
    }

    return () => {
      disconnect();
      stopPolling();
      initializedRef.current = false;
    };
  }, []); // Run once on mount

  // Reconnect when projectId changes
  useEffect(() => {
    if (projectId) {
      fetchNotifications();
      if (autoConnect) {
        disconnect();
        connect();
      }
    }
  }, [projectId, fetchNotifications, autoConnect, connect, disconnect]);

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  return {
    ...state,
    markAsRead,
    markAllAsRead,
    dismiss,
    dismissAll,
    refresh: fetchNotifications,
    connect,
    disconnect,
    onNotification,
  };
}

/**
 * Hook for getting unread notification count (lightweight, for badges)
 */
export function useUnreadCount(projectId?: string): number {
  const { unreadCount } = useNotifications({ projectId, autoConnect: false, pollInterval: 60000 });
  return unreadCount;
}

/**
 * Hook for creating a notification bell component with count
 */
export function useNotificationBell(projectId?: string) {
  const { notifications, unreadCount, markAsRead, dismiss, markAllAsRead, dismissAll, refresh, connected } =
    useNotifications({ projectId });

  const hasUnread = unreadCount > 0;

  return {
    notifications,
    unreadCount,
    hasUnread,
    connected,
    markAsRead,
    dismiss,
    markAllAsRead,
    dismissAll,
    refresh,
  };
}

export default useNotifications;