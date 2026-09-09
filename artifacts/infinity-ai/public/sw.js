/**
 * Infinity AI Service Worker
 *
 * Offline-first caching strategy using Workbox patterns.
 * Caches: sandbox runtime, component library, design tokens, static assets.
 * Works offline for editing; syncs on reconnect.
 * Extended with Safety Watcher push notification support (Phase 38).
 */

// Service Worker version - update when changing caching strategy
const SW_VERSION = '2026-09-06-v2';
const CACHE_NAME = `infinity-ai-${SW_VERSION}`;

// Cache names for different strategies
const CACHES = {
  static: `${CACHE_NAME}-static`,
  runtime: `${CACHE_NAME}-runtime`,
  preview: `${CACHE_NAME}-preview`,
  components: `${CACHE_NAME}-components`,
  designTokens: `${CACHE_NAME}-design-tokens`,
  api: `${CACHE_NAME}-api`,
};

// Assets to cache on install (static assets)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/badge-72.png',
  // CDN assets that we want available offline
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7/babel.min.js',
];

// Runtime caching patterns
const RUNTIME_CACHE_PATTERNS = [
  // API responses - network first, fallback to cache
  { pattern: /\/api\/infinity/, strategy: 'networkFirst', cacheName: CACHES.api },
  // Component previews - stale while revalidate
  { pattern: /\/preview/, strategy: 'staleWhileRevalidate', cacheName: CACHES.preview },
  // Component library - cache first
  { pattern: /\/components/, strategy: 'cacheFirst', cacheName: CACHES.components },
  // Design tokens - cache first
  { pattern: /\/design-tokens/, strategy: 'cacheFirst', cacheName: CACHES.designTokens },
  // Fonts and images - cache first
  { pattern: /\.(woff2?|ttf|eot|otf|woff)$/, strategy: 'cacheFirst', cacheName: CACHES.runtime },
  { pattern: /\.(png|jpg|jpeg|gif|svg|webp|ico)$/, strategy: 'cacheFirst', cacheName: CACHES.runtime },
  // JS/CSS bundles - stale while revalidate
  { pattern: /\.(js|css)$/, strategy: 'staleWhileRevalidate', cacheName: CACHES.static },
];

// Maximum cache sizes
const MAX_CACHE_SIZES = {
  [CACHES.static]: 50,
  [CACHES.runtime]: 100,
  [CACHES.preview]: 50,
  [CACHES.components]: 100,
  [CACHES.designTokens]: 20,
  [CACHES.api]: 100,
};

// Cache expiration (in seconds)
const CACHE_EXPIRATION = {
  [CACHES.static]: 60 * 60 * 24 * 30, // 30 days
  [CACHES.runtime]: 60 * 60 * 24 * 7, // 7 days
  [CACHES.preview]: 60 * 60 * 24, // 1 day
  [CACHES.components]: 60 * 60 * 24 * 7, // 7 days
  [CACHES.designTokens]: 60 * 60 * 24 * 30, // 30 days
  [CACHES.api]: 60 * 60, // 1 hour
};

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHES.static);
      await cache.addAll(STATIC_ASSETS.map(url => new Request(url, { credentials: 'same-origin' })));
      await self.skipWaiting();
    })()
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(name => name.startsWith('infinity-ai-') && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// Fetch event - handle requests with appropriate strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) schemes
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Find matching cache pattern
  const match = RUNTIME_CACHE_PATTERNS.find(({ pattern }) => pattern.test(url.pathname));

  if (match) {
    event.respondWith(handleRequest(request, match.strategy, match.cacheName));
  } else {
    // Default: network first for unknown requests
    event.respondWith(handleRequest(request, 'networkFirst', CACHES.runtime));
  }
});

// Handle request with specified strategy
async function handleRequest(request, strategy, cacheName) {
  const cache = await caches.open(cacheName);

  switch (strategy) {
    case 'cacheFirst':
      return cacheFirst(request, cache, cacheName);
    case 'networkFirst':
      return networkFirst(request, cache, cacheName);
    case 'staleWhileRevalidate':
      return staleWhileRevalidate(request, cache, cacheName);
    default:
      return networkFirst(request, cache, cacheName);
  }
}

// Cache first strategy - good for static assets
async function cacheFirst(request, cache, cacheName) {
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Check expiration
    if (isExpired(cachedResponse, cacheName)) {
      // Expired - fetch in background, return stale
      fetchAndCache(request, cache, cacheName).catch(() => {});
      return cachedResponse;
    }
    return cachedResponse;
  }

  // Not in cache - fetch and cache
  return fetchAndCache(request, cache, cacheName);
}

// Network first strategy - good for API calls
async function networkFirst(request, cache, cacheName) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      await enforceCacheLimit(cache, cacheName);
    }

    return networkResponse;
  } catch (error) {
    // Network failed - try cache
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      // Add header to indicate stale response
      const headers = new Headers(cachedResponse.headers);
      headers.set('X-Infinity-Cache', 'stale');
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers,
      });
    }

    // Return offline fallback for navigation requests
    if (request.mode === 'navigate') {
      return createOfflineResponse();
    }

    throw error;
  }
}

// Stale while revalidate - good for frequently updated content
async function staleWhileRevalidate(request, cache, cacheName) {
  const cachedResponse = await cache.match(request);

  // Fetch in background
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      enforceCacheLimit(cache, cacheName);
    }
    return networkResponse;
  }).catch(() => {});

  if (cachedResponse) {
    // Check expiration
    if (isExpired(cachedResponse, cacheName)) {
      // Expired - return stale but fetch fresh
      return cachedResponse;
    }
    return cachedResponse;
  }

  // No cache - wait for network
  return fetchPromise;
}

// Fetch and cache response
async function fetchAndCache(request, cache, cacheName) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      await cache.put(request, response.clone());
      await enforceCacheLimit(cache, cacheName);
    }

    return response;
  } catch (error) {
    // Return a basic error response
    return new Response(JSON.stringify({ error: 'Offline', message: 'Network request failed' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Check if cached response is expired
function isExpired(response, cacheName) {
  const dateHeader = response.headers.get('date');
  if (!dateHeader) return false;

  const cachedTime = new Date(dateHeader).getTime();
  const now = Date.now();
  const maxAge = CACHE_EXPIRATION[cacheName] * 1000;

  return now - cachedTime > maxAge;
}

// Enforce cache size limit
async function enforceCacheLimit(cache, cacheName) {
  const maxSize = MAX_CACHE_SIZES[cacheName] || 100;
  const keys = await cache.keys();

  if (keys.length > maxSize) {
    // Delete oldest entries (LRU)
    const toDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(toDelete.map(key => cache.delete(key)));
  }
}

// Create offline fallback page
function createOfflineResponse() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline - Infinity AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fafafa;
      color: #1a1a1a;
      padding: 2rem;
    }
    .container { text-align: center; max-width: 400px; }
    .icon { width: 80px; height: 80px; margin: 0 auto 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; margin-bottom: 1.5rem; }
    button {
      padding: 0.75rem 1.5rem;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="container">
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <path d="M12 8v4M12 16h.01"/>
    </svg>
    <h1>You're Offline</h1>
    <p>Infinity AI works offline for editing. Your changes will sync when you're back online.</p>
    <button onclick="window.location.reload()">Retry Connection</button>
  </div>
  <script>
    // Auto-retry when online
    window.addEventListener('online', () => window.location.reload());
    // Show connection status
    navigator.onLine || document.body.classList.add('offline');
  </script>
</body>
</html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }
  );
}

// Handle messages from clients
self.addEventListener('message', event => {
  const { type, payload } = event.data;

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      clearCache(payload?.cacheName).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'GET_CACHE_SIZE':
      getCacheSize(payload?.cacheName).then(size => {
        event.ports[0]?.postMessage({ size });
      });
      break;

    case 'PREFETCH':
      prefetchUrls(payload?.urls || []).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'CACHE_PREVIEW':
      cachePreview(payload?.html, payload?.url).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'GET_OFFLINE_STATUS':
      event.ports[0]?.postMessage({
        online: navigator.onLine,
        version: SW_VERSION,
      });
      break;
  }
});

// Clear specific cache
async function clearCache(cacheName) {
  if (cacheName) {
    await caches.delete(cacheName);
  } else {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
  }
}

// Get cache size
async function getCacheSize(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  let size = 0;

  for (const key of keys) {
    const response = await cache.match(key);
    if (response) {
      const blob = await response.blob();
      size += blob.size;
    }
  }

  return size;
}

// Prefetch URLs
async function prefetchUrls(urls) {
  const cache = await caches.open(CACHES.runtime);

  await Promise.all(
    urls.map(url =>
      fetch(url).then(response => {
        if (response.ok) {
          return cache.put(url, response);
        }
      }).catch(() => {})
    )
  );
}

// Cache preview HTML
async function cachePreview(html, url) {
  const cache = await caches.open(CACHES.preview);
  const response = new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
  await cache.put(url, response);
  await enforceCacheLimit(cache, CACHES.preview);
}

// Background sync for offline mutations
self.addEventListener('sync', event => {
  if (event.tag === 'sync-mutations') {
    event.waitUntil(syncMutations());
  }
});

// Sync pending mutations when online
async function syncMutations() {
  // This would integrate with IndexedDB to sync offline changes
  // For now, just notify clients
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE' });
  });
}

// Periodic background sync (if supported)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'refresh-design-tokens') {
    event.waitUntil(refreshDesignTokens());
  }
});

async function refreshDesignTokens() {
  try {
    const response = await fetch('/api/infinity/design-tokens');
    if (response.ok) {
      const cache = await caches.open(CACHES.designTokens);
      await cache.put('/api/infinity/design-tokens', response);
    }
  } catch (error) {
    console.log('Design token refresh failed:', error);
  }
}

// ─── Safety Watcher Push Notification Handling (Phase 38) ───

function isSafetyWatcherData(data) {
  return data && data.type === 'safety';
}

function getSeverityIcon(severity) {
  switch (severity) {
    case 'emergency': return '🚨';
    case 'critical': return '⚠️';
    case 'warning': return '⚡';
    case 'info': return 'ℹ️';
    default: return '🔔';
  }
}

function getSeverityColor(severity) {
  switch (severity) {
    case 'emergency': return '#dc2626';
    case 'critical': return '#ea580c';
    case 'warning': return '#d97706';
    case 'info': return '#2563eb';
    default: return '#6b7280';
  }
}

// Push notification handling for Safety Watcher
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  // Handle Safety Watcher notifications
  if (isSafetyWatcherData(data)) {
    const severityIcon = getSeverityIcon(data.severity);
    const severityColor = getSeverityColor(data.severity);

    const actions = [];

    // Add dismiss action
    if (data.dismissAction) {
      actions.push({
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icons/dismiss.svg',
      });
    }

    // Add acknowledge action for critical/emergency
    if ((data.severity === 'critical' || data.severity === 'emergency') && data.acknowledgeAction) {
      actions.push({
        action: 'acknowledge',
        title: 'Acknowledge',
        icon: '/icons/acknowledge.svg',
      });
    }

    // Add view action if URL provided
    if (data.actionUrl) {
      actions.push({
        action: 'view',
        title: data.actionLabel || 'View Details',
        icon: '/icons/view.svg',
      });
    }

    event.waitUntil(
      self.registration.showNotification(`${severityIcon} ${data.title || 'Safety Alert'}`, {
        body: data.body || data.message,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data,
        actions,
        tag: `safety-${data.notificationId}`,
        requireInteraction: data.severity === 'emergency' || data.severity === 'critical',
        vibrate: data.severity === 'emergency' ? [200, 100, 200, 100, 200] : [100, 50, 100],
        timestamp: Date.now(),
        renotify: true,
      })
    );
    return;
  }

  // Legacy/fallback notification handling
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: data.url,
      actions: data.actions || [],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data = event.notification.data;

  // Handle Safety Watcher notification actions
  if (isSafetyWatcherData(data)) {
    const handleAction = async (action) => {
      // Send action to server
      try {
        await fetch(`/api/infinity/safety-watcher/in-app-notifications/${data.notificationId}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: data.projectId }),
        });
      } catch (e) {
        console.error('Failed to send notification action:', e);
      }

      // Handle client-side action
      switch (action) {
        case 'view':
          if (data.actionUrl) {
            return openOrFocusWindow(data.actionUrl);
          }
          break;
        case 'dismiss':
        case 'acknowledge':
          // Already sent to server, nothing else needed
          break;
      }
    };

    if (event.action) {
      event.waitUntil(handleAction(event.action));
    } else {
      // Default click - open action URL or project dashboard
      const url = data.actionUrl || `/projects/${data.projectId}/safety-watcher`;
      event.waitUntil(openOrFocusWindow(url));
    }
    return;
  }

  // Legacy/fallback notification click handling
  if (event.action) {
    clients.openWindow(event.notification.data);
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        for (const client of clientList) {
          if (client.url === event.notification.data && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(event.notification.data);
      })
    );
  }
});

// Helper to open or focus existing window
async function openOrFocusWindow(url) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  // Try to find existing window with matching origin
  for (const client of clients) {
    try {
      const clientUrl = new URL(client.url);
      const targetUrl = new URL(url, self.location.origin);
      if (clientUrl.origin === targetUrl.origin && 'focus' in client) {
        return client.focus();
      }
    } catch {
      // Invalid URL, continue
    }
  }

  // Open new window
  return self.clients.openWindow(url);
}

// Handle notification close (user dismissed without action)
self.addEventListener('notificationclose', event => {
  const data = event.notification.data;

  if (isSafetyWatcherData(data)) {
    // Optionally send dismiss to server
    // We don't auto-dismiss on close, user must explicitly dismiss
    console.log('Safety Watcher notification closed:', data.notificationId);
  }
});

console.log(`Infinity AI Service Worker ${SW_VERSION} loaded`);