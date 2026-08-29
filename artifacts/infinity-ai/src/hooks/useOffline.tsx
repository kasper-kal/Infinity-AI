/**
 * useOffline Hook
 *
 * Manages offline state, service worker registration, and background sync.
 * Provides offline-first capabilities for the UI Builder.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';

export interface OfflineState {
  /** Whether the app is currently online */
  isOnline: boolean;
  /** Whether a service worker is registered and active */
  swRegistered: boolean;
  /** Whether there's an update available */
  updateAvailable: boolean;
  /** Pending mutations waiting to sync */
  pendingMutations: number;
  /** Last sync timestamp */
  lastSync: number | null;
  /** Cache storage usage in bytes */
  cacheSize: number;
}

export interface OfflineActions {
  /** Register the service worker */
  registerSW: () => Promise<ServiceWorkerRegistration | null>;
  /** Unregister the service worker */
  unregisterSW: () => Promise<boolean>;
  /** Check for service worker updates */
  checkForUpdate: () => Promise<void>;
  /** Apply service worker update */
  applyUpdate: () => Promise<void>;
  /** Clear all caches */
  clearCache: (cacheName?: string) => Promise<void>;
  /** Get cache size */
  getCacheSize: (cacheName?: string) => Promise<number>;
  /** Prefetch URLs for offline use */
  prefetch: (urls: string[]) => Promise<void>;
  /** Cache preview HTML */
  cachePreview: (html: string, url: string) => Promise<void>;
  /** Queue a mutation for background sync */
  queueMutation: (mutation: OfflineMutation) => Promise<void>;
  /** Force sync now */
  syncNow: () => Promise<void>;
  /** Dismiss update notification */
  dismissUpdate: () => void;
}

export interface OfflineMutation {
  id: string;
  type: 'create' | 'update' | 'delete';
  resource: string;
  data: any;
  timestamp: number;
  retries: number;
}

export interface UseOfflineOptions {
  /** Enable service worker registration */
  enableSW?: boolean;
  /** Service worker URL */
  swUrl?: string;
  /** Auto-register on mount */
  autoRegister?: boolean;
  /** Check for updates interval (ms) */
  updateCheckInterval?: number;
  /** Enable background sync */
  enableBackgroundSync?: boolean;
  /** Callback when online status changes */
  onOnlineChange?: (isOnline: boolean) => void;
  /** Callback when update is available */
  onUpdateAvailable?: () => void;
  /** Callback when sync completes */
  onSyncComplete?: () => void;
}

const DEFAULT_OPTIONS: Required<UseOfflineOptions> = {
  enableSW: true,
  swUrl: '/sw.js',
  autoRegister: true,
  updateCheckInterval: 60000, // 1 minute
  enableBackgroundSync: true,
  onOnlineChange: () => {},
  onUpdateAvailable: () => {},
  onSyncComplete: () => {},
};

const DB_NAME = 'infinity-offline';
const DB_VERSION = 1;
const MUTATIONS_STORE = 'mutations';

/**
 * Initialize IndexedDB for offline mutations
 */
function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        db.createObjectStore(MUTATIONS_STORE, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Get pending mutations count
 */
async function getPendingMutationsCount(): Promise<number> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MUTATIONS_STORE, 'readonly');
      const store = transaction.objectStore(MUTATIONS_STORE);
      const countRequest = store.count();
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
  } catch {
    return 0;
  }
}

/**
 * Queue a mutation for background sync
 */
async function queueMutation(mutation: OfflineMutation): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MUTATIONS_STORE, 'readwrite');
    const store = transaction.objectStore(MUTATIONS_STORE);
    const request = store.put(mutation);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending mutations
 */
async function getPendingMutations(): Promise<OfflineMutation[]> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MUTATIONS_STORE, 'readonly');
      const store = transaction.objectStore(MUTATIONS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

/**
 * Clear mutations after successful sync
 */
async function clearMutations(ids: string[]): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MUTATIONS_STORE, 'readwrite');
    const store = transaction.objectStore(MUTATIONS_STORE);
    let completed = 0;
    let hasError = false;

    ids.forEach(id => {
      const request = store.delete(id);
      request.onsuccess = () => {
        completed++;
        if (completed === ids.length && !hasError) resolve();
      };
      request.onerror = () => {
        if (!hasError) {
          hasError = true;
          reject(request.error);
        }
      };
    });
  });
}

/**
 * Communicate with service worker
 */
function sendSWMessage(type: string, payload?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!navigator.serviceWorker.controller) {
      reject(new Error('No service worker controller'));
      return;
    }

    const channel = new MessageChannel();
    channel.port1.onmessage = event => {
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data);
      }
    };

    navigator.serviceWorker.controller.postMessage(
      { type, payload },
      [channel.port2]
    );

    // Timeout after 5 seconds
    setTimeout(() => reject(new Error('Service worker message timeout')), 5000);
  });
}

export function useOffline(options: UseOfflineOptions = {}): [OfflineState, OfflineActions] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { toast } = useToast();

  const [state, setState] = useState<OfflineState>({
    isOnline: navigator.onLine,
    swRegistered: false,
    updateAvailable: false,
    pendingMutations: 0,
    lastSync: null,
    cacheSize: 0,
  });

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const updateCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onlineHandlerRef = useRef<(() => void) | null>(null);
  const offlineHandlerRef = useRef<(() => void) | null>(null);

  // Update online status
  const updateOnlineStatus = useCallback((isOnline: boolean) => {
    setState(prev => {
      if (prev.isOnline === isOnline) return prev;
      return { ...prev, isOnline };
    });
    opts.onOnlineChange(isOnline);

    if (isOnline) {
      toast({ title: 'Back online', description: 'Syncing changes...', variant: 'success' });
      // Trigger sync when coming back online
      syncNow();
    } else {
      toast({ title: 'You\'re offline', description: 'Changes will sync when online', variant: 'default' });
    }
  }, [toast, opts]);

  // Check for service worker updates
  const checkForUpdate = useCallback(async () => {
    if (!registrationRef.current) return;

    try {
      await registrationRef.current.update();
    } catch (error) {
      console.log('SW update check failed:', error);
    }
  }, []);

  // Apply service worker update
  const applyUpdate = useCallback(async () => {
    if (!registrationRef.current?.waiting) return;

    // Tell SW to skip waiting
    registrationRef.current.waiting.postMessage({ type: 'SKIP_WAITING' });

    // Reload page to activate new SW
    window.location.reload();
  }, []);

  // Register service worker
  const registerSW = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !opts.enableSW) {
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register(opts.swUrl, {
        scope: '/',
      });

      registrationRef.current = registration;

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setState(prev => ({ ...prev, updateAvailable: true }));
            opts.onUpdateAvailable();
            toast({
              title: 'Update available',
              description: 'A new version of Infinity AI is ready.',
              action: { label: 'Refresh', onClick: applyUpdate },
              duration: 0,
            });
          }
        });
      });

      // Handle controller change (new SW activated)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (registrationRef.current?.active?.state === 'activated') {
          setState(prev => ({ ...prev, updateAvailable: false }));
        }
      });

      // Listen for messages from SW
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'SYNC_COMPLETE') {
          setState(prev => ({ ...prev, lastSync: Date.now() }));
          opts.onSyncComplete();
          toast({ title: 'Synced', description: 'Offline changes synced successfully', variant: 'success' });
        }
      });

      setState(prev => ({ ...prev, swRegistered: true }));
      console.log('Service Worker registered:', registration.scope);

      // Initial update check
      await checkForUpdate();

      // Set up periodic update checks
      if (opts.updateCheckInterval > 0) {
        updateCheckIntervalRef.current = setInterval(checkForUpdate, opts.updateCheckInterval);
      }

      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      toast({ title: 'Offline support unavailable', description: String(error), variant: 'destructive' });
      return null;
    }
  }, [opts, checkForUpdate, applyUpdate, toast]);

  // Unregister service worker
  const unregisterSW = useCallback(async () => {
    if (!registrationRef.current) return false;

    try {
      const result = await registrationRef.current.unregister();
      registrationRef.current = null;
      setState(prev => ({ ...prev, swRegistered: false, updateAvailable: false }));
      return result;
    } catch (error) {
      console.error('SW unregister failed:', error);
      return false;
    }
  }, []);

  // Clear cache
  const clearCache = useCallback(async (cacheName?: string) => {
    try {
      await sendSWMessage('CLEAR_CACHE', { cacheName });
      toast({ title: 'Cache cleared', variant: 'success' });
    } catch (error) {
      toast({ title: 'Failed to clear cache', description: String(error), variant: 'destructive' });
    }
  }, [toast]);

  // Get cache size
  const getCacheSize = useCallback(async (cacheName?: string) => {
    try {
      const { size } = await sendSWMessage('GET_CACHE_SIZE', { cacheName });
      setState(prev => ({ ...prev, cacheSize: size }));
      return size;
    } catch (error) {
      console.error('Get cache size failed:', error);
      return 0;
    }
  }, []);

  // Prefetch URLs
  const prefetch = useCallback(async (urls: string[]) => {
    try {
      await sendSWMessage('PREFETCH', { urls });
      toast({ title: 'Prefetched', description: `${urls.length} resources cached for offline`, variant: 'success' });
    } catch (error) {
      toast({ title: 'Prefetch failed', description: String(error), variant: 'destructive' });
    }
  }, [toast]);

  // Cache preview
  const cachePreview = useCallback(async (html: string, url: string) => {
    try {
      await sendSWMessage('CACHE_PREVIEW', { html, url });
    } catch (error) {
      console.error('Cache preview failed:', error);
    }
  }, []);

  // Queue mutation for background sync
  const queueMutationAction = useCallback(async (mutation: OfflineMutation) => {
    await queueMutation(mutation);
    const count = await getPendingMutationsCount();
    setState(prev => ({ ...prev, pendingMutations: count }));

    // Register background sync if supported
    if (opts.enableBackgroundSync && 'sync' in registrationRef.current!) {
      try {
        await (registrationRef.current as any).sync.register('sync-mutations');
      } catch (error) {
        console.log('Background sync registration failed:', error);
      }
    }
  }, [opts.enableBackgroundSync]);

  // Force sync now
  const syncNow = useCallback(async () => {
    if (!navigator.onLine) {
      toast({ title: 'Cannot sync', description: 'You are currently offline', variant: 'destructive' });
      return;
    }

    try {
      const mutations = await getPendingMutations();
      if (mutations.length === 0) {
        toast({ title: 'Nothing to sync', variant: 'default' });
        return;
      }

      // Process mutations
      const successfulIds: string[] = [];

      for (const mutation of mutations) {
        try {
          // This would integrate with your API layer
          // For now, we just simulate success
          await new Promise(resolve => setTimeout(resolve, 100));
          successfulIds.push(mutation.id);
        } catch (error) {
          console.error('Mutation sync failed:', error);
          // Increment retry count
          await queueMutation({ ...mutation, retries: mutation.retries + 1 });
        }
      }

      if (successfulIds.length > 0) {
        await clearMutations(successfulIds);
        const count = await getPendingMutationsCount();
        setState(prev => ({ ...prev, pendingMutations: count, lastSync: Date.now() }));
      }

      if (successfulIds.length === mutations.length) {
        toast({ title: 'Sync complete', description: `${successfulIds.length} changes synced`, variant: 'success' });
      } else if (successfulIds.length > 0) {
        toast({ title: 'Partial sync', description: `${successfulIds.length}/${mutations.length} changes synced`, variant: 'default' });
      } else {
        toast({ title: 'Sync failed', description: 'No changes could be synced', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Sync error', description: String(error), variant: 'destructive' });
    }
  }, [toast]);

  // Dismiss update notification
  const dismissUpdate = useCallback(() => {
    setState(prev => ({ ...prev, updateAvailable: false }));
  }, []);

  // Initialize on mount
  useEffect(() => {
    // Set up online/offline listeners
    onlineHandlerRef.current = () => updateOnlineStatus(true);
    offlineHandlerRef.current = () => updateOnlineStatus(false);

    window.addEventListener('online', onlineHandlerRef.current);
    window.addEventListener('offline', offlineHandlerRef.current);

    // Check initial pending mutations
    getPendingMutationsCount().then(count => {
      setState(prev => ({ ...prev, pendingMutations: count }));
    });

    // Auto-register SW
    if (opts.autoRegister) {
      registerSW();
    }

    // Get initial cache size
    getCacheSize().then(size => {
      setState(prev => ({ ...prev, cacheSize: size }));
    });

    return () => {
      if (onlineHandlerRef.current) {
        window.removeEventListener('online', onlineHandlerRef.current);
      }
      if (offlineHandlerRef.current) {
        window.removeEventListener('offline', offlineHandlerRef.current);
      }
      if (updateCheckIntervalRef.current) {
        clearInterval(updateCheckIntervalRef.current);
      }
    };
  }, [opts.autoRegister, registerSW, updateOnlineStatus, getCacheSize]);

  // Expose actions
  const actions: OfflineActions = {
    registerSW,
    unregisterSW,
    checkForUpdate,
    applyUpdate,
    clearCache,
    getCacheSize,
    prefetch,
    cachePreview,
    queueMutation: queueMutationAction,
    syncNow,
    dismissUpdate,
  };

  return [state, actions];
}

/**
 * Hook for components that need to work offline
 */
export function useOfflineMutation() {
  const [, { queueMutation, syncNow, pendingMutations }] = useOffline();

  const mutateOffline = useCallback(async (
    type: OfflineMutation['type'],
    resource: string,
    data: any
  ) => {
    const mutation: OfflineMutation = {
      id: `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      resource,
      data,
      timestamp: Date.now(),
      retries: 0,
    };

    await queueMutation(mutation);
    return mutation.id;
  }, [queueMutation]);

  return {
    mutateOffline,
    syncNow,
    pendingMutations,
  };
}

/**
 * Hook for checking offline capability
 */
export function useOfflineCapability() {
  const [state] = useOffline();

  return {
    canWorkOffline: state.swRegistered && state.isOnline !== false,
    isOnline: state.isOnline,
    hasUpdate: state.updateAvailable,
    pendingChanges: state.pendingMutations,
  };
}

/**
 * Component wrapper for offline indicator
 */
export function OfflineIndicator() {
  const [state] = useOffline();

  if (state.isOnline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
      <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-500/50 text-amber-800 dark:text-amber-300 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <span className="text-sm font-medium">Working offline</span>
        <span className="text-xs opacity-75">Changes sync when online</span>
      </div>
    </div>
  );
}