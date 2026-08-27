/**
 * useConflictResolution Hook
 *
 * Handles conflict resolution when code editor and visual editor
 * make simultaneous changes to the same component.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface ConflictInfo {
  id: string;
  selector: string;
  codeChange: {
    type: 'prop' | 'structure' | 'text';
    previousValue: any;
    newValue: any;
    timestamp: number;
  };
  visualChange: {
    type: 'prop' | 'structure' | 'drag-drop';
    previousValue: any;
    newValue: any;
    timestamp: number;
  };
  status: 'pending' | 'resolved' | 'ignored';
  resolution?: 'code-wins' | 'visual-wins' | 'merge' | 'manual';
}

interface UseConflictResolutionOptions {
  /** Maximum time window to consider changes as simultaneous (ms) */
  conflictWindow?: number;
  /** Auto-resolve strategy */
  autoResolve?: 'code-wins' | 'visual-wins' | 'latest-wins' | 'manual';
  /** Callback when conflict detected */
  onConflict?: (conflict: ConflictInfo) => void;
  /** Callback when conflict resolved */
  onResolved?: (conflict: ConflictInfo, resolution: ConflictInfo['resolution']) => void;
}

interface UseConflictResolutionReturn {
  /** Register a code editor change */
  registerCodeChange: (selector: string, change: ConflictInfo['codeChange']) => void;
  /** Register a visual editor change */
  registerVisualChange: (selector: string, change: ConflictInfo['visualChange']) => void;
  /** Get pending conflicts */
  getConflicts: () => ConflictInfo[];
  /** Resolve a conflict */
  resolveConflict: (conflictId: string, resolution: ConflictInfo['resolution']) => void;
  /** Ignore a conflict */
  ignoreConflict: (conflictId: string) => void;
  /** Clear all conflicts */
  clearConflicts: () => void;
  /** Pending conflicts count */
  pendingCount: number;
}

export function useConflictResolution(
  options: UseConflictResolutionOptions = {}
): UseConflictResolutionReturn {
  const {
    conflictWindow = 500, // 500ms window
    autoResolve = 'manual',
    onConflict,
    onResolved,
  } = options;

  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const codeChangesRef = useRef<Map<string, ConflictInfo['codeChange']>>(new Map());
  const visualChangesRef = useRef<Map<string, ConflictInfo['visualChange']>>(new Map());
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Clean up old changes
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      codeChangesRef.current.forEach((change, selector) => {
        if (now - change.timestamp > conflictWindow * 2) {
          codeChangesRef.current.delete(selector);
        }
      });
      visualChangesRef.current.forEach((change, selector) => {
        if (now - change.timestamp > conflictWindow * 2) {
          visualChangesRef.current.delete(selector);
        }
      });
    }, conflictWindow);

    return () => clearInterval(interval);
  }, [conflictWindow]);

  const registerCodeChange = useCallback((
    selector: string,
    change: ConflictInfo['codeChange']
  ) => {
    const visualChange = visualChangesRef.current.get(selector);

    if (visualChange && Math.abs(change.timestamp - visualChange.timestamp) <= conflictWindow) {
      // Conflict detected!
      const conflict: ConflictInfo = {
        id: crypto.randomUUID(),
        selector,
        codeChange: change,
        visualChange,
        status: 'pending',
      };

      setConflicts(prev => [...prev, conflict]);
      onConflict?.(conflict);

      // Auto-resolve if configured
      if (autoResolve !== 'manual') {
        let resolution: ConflictInfo['resolution'];
        switch (autoResolve) {
          case 'code-wins':
            resolution = 'code-wins';
            break;
          case 'visual-wins':
            resolution = 'visual-wins';
            break;
          case 'latest-wins':
            resolution = change.timestamp > visualChange.timestamp ? 'code-wins' : 'visual-wins';
            break;
          default:
            resolution = 'manual';
        }

        if (resolution !== 'manual') {
          setConflicts(prev => prev.map(c =>
            c.id === conflict.id ? { ...c, status: 'resolved', resolution } : c
          ));
          onResolved?.(conflict, resolution);
        }
      }

      // Clean up
      visualChangesRef.current.delete(selector);
      codeChangesRef.current.delete(selector);
    } else {
      // No conflict, store for potential future conflict
      codeChangesRef.current.set(selector, change);

      // Set timer to clean up
      const existingTimer = timersRef.current.get(selector);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        codeChangesRef.current.delete(selector);
        timersRef.current.delete(selector);
      }, conflictWindow * 2);
      timersRef.current.set(selector, timer);
    }
  }, [conflictWindow, autoResolve, onConflict, onResolved]);

  const registerVisualChange = useCallback((
    selector: string,
    change: ConflictInfo['visualChange']
  ) => {
    const codeChange = codeChangesRef.current.get(selector);

    if (codeChange && Math.abs(change.timestamp - codeChange.timestamp) <= conflictWindow) {
      // Conflict detected!
      const conflict: ConflictInfo = {
        id: crypto.randomUUID(),
        selector,
        codeChange,
        visualChange: change,
        status: 'pending',
      };

      setConflicts(prev => [...prev, conflict]);
      onConflict?.(conflict);

      // Auto-resolve if configured
      if (autoResolve !== 'manual') {
        let resolution: ConflictInfo['resolution'];
        switch (autoResolve) {
          case 'code-wins':
            resolution = 'code-wins';
            break;
          case 'visual-wins':
            resolution = 'visual-wins';
            break;
          case 'latest-wins':
            resolution = change.timestamp > codeChange.timestamp ? 'visual-wins' : 'code-wins';
            break;
          default:
            resolution = 'manual';
        }

        if (resolution !== 'manual') {
          setConflicts(prev => prev.map(c =>
            c.id === conflict.id ? { ...c, status: 'resolved', resolution } : c
          ));
          onResolved?.(conflict, resolution);
        }
      }

      // Clean up
      codeChangesRef.current.delete(selector);
      visualChangesRef.current.delete(selector);
    } else {
      // No conflict, store for potential future conflict
      visualChangesRef.current.set(selector, change);

      // Set timer to clean up
      const existingTimer = timersRef.current.get(selector);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        visualChangesRef.current.delete(selector);
        timersRef.current.delete(selector);
      }, conflictWindow * 2);
      timersRef.current.set(selector, timer);
    }
  }, [conflictWindow, autoResolve, onConflict, onResolved]);

  const resolveConflict = useCallback((
    conflictId: string,
    resolution: ConflictInfo['resolution']
  ) => {
    setConflicts(prev => {
      const conflict = prev.find(c => c.id === conflictId);
      if (!conflict) return prev;

      onResolved?.(conflict, resolution);
      return prev.map(c =>
        c.id === conflictId ? { ...c, status: 'resolved', resolution } : c
      );
    });
  }, [onResolved]);

  const ignoreConflict = useCallback((conflictId: string) => {
    setConflicts(prev => prev.map(c =>
      c.id === conflictId ? { ...c, status: 'ignored' } : c
    ));
  }, []);

  const clearConflicts = useCallback(() => {
    setConflicts([]);
    codeChangesRef.current.clear();
    visualChangesRef.current.clear();
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const getConflicts = useCallback(() => conflicts.filter(c => c.status === 'pending'), [conflicts]);

  return {
    registerCodeChange,
    registerVisualChange,
    getConflicts,
    resolveConflict,
    ignoreConflict,
    clearConflicts,
    pendingCount: conflicts.filter(c => c.status === 'pending').length,
  };
}

export default useConflictResolution;