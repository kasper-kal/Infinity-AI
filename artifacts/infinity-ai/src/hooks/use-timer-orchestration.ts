import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Server-backed timer orchestration.
 *
 * Timers now live on the API server (timers table + timer-scheduler), so they
 * survive a page reload and still fire via web-push when the tab is closed.
 * This hook is the frontend's bridge:
 *   - `activeTimers` is rehydrated from GET /api/infinity/timers on mount (and
 *     polled while timers are live so fired ones drop out).
 *   - The in-feed chat timer widget calls `createTimer` / `extendTimer` /
 *     `cancelTimer` (tracked via `serverIdRef`) instead of only living in
 *     React state.
 */

/** Row shape returned by GET /api/infinity/timers (includes wall-clock remainingMs). */
export interface ServerTimer {
  id: string;
  durationSeconds: number;
  fireAt: string | null;
  remainingSeconds: number | null;
  status: 'active' | 'paused' | 'done' | 'cancelled';
  label: string | null;
  conversationId: string | null;
  createdAt: string;
  remainingMs: number;
}

async function fetchTimers(): Promise<ServerTimer[]> {
  try {
    const res = await fetch('/api/infinity/timers');
    if (!res.ok) return [];
    return (await res.json()) as ServerTimer[];
  } catch {
    return [];
  }
}

export function useTimerOrchestration() {
  const [activeTimers, setActiveTimers] = useState<ServerTimer[]>([]);
  /** Server id of the timer the in-feed widget currently manages (for add/cancel). */
  const serverIdRef = useRef<string | null>(null);

  const refetch = useCallback(async () => {
    setActiveTimers(await fetchTimers());
  }, []);

  // Load timers on mount; poll while any are live so fired timers drop out.
  useEffect(() => {
    void refetch();
    const iv = setInterval(() => {
      void refetch();
    }, 10_000);
    return () => clearInterval(iv);
  }, [refetch]);

  const post = useCallback(
    async (url: string, body?: unknown): Promise<ServerTimer | null> => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) return null;
        const timer = (await res.json()) as ServerTimer;
        void refetch();
        return timer;
      } catch {
        return null;
      }
    },
    [refetch],
  );

  const createTimer = useCallback(
    async (opts: { durationSeconds: number; label?: string; conversationId?: string }) => {
      const t = await post('/api/infinity/timers', opts);
      if (t) serverIdRef.current = t.id;
      return t;
    },
    [post],
  );

  const extendTimer = useCallback(
    async (id: string, addSeconds: number) => {
      if (!id) return null;
      return post(`/api/infinity/timers/${id}/extend`, { addSeconds });
    },
    [post],
  );

  const cancelTimer = useCallback(
    async (id: string) => {
      if (!id) return null;
      serverIdRef.current = null;
      return post(`/api/infinity/timers/${id}/cancel`);
    },
    [post],
  );

  const pauseTimer = useCallback(async (id: string) => post(`/api/infinity/timers/${id}/pause`), [post]);
  const resumeTimer = useCallback(async (id: string) => post(`/api/infinity/timers/${id}/resume`), [post]);

  return {
    activeTimers,
    serverIdRef,
    createTimer,
    extendTimer,
    cancelTimer,
    pauseTimer,
    resumeTimer,
    refetch,
  };
}
