/* Jarvis service worker — shows Web Push notifications even when the tab is closed. */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Jarvis', body: '', url: '/' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        data = { ...data, ...parsed };
      }
    }
  } catch {
    // Non-JSON payload — fall back to defaults.
    const fallback = event.data ? event.data.text() : '';
    if (fallback) data.body = fallback;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'jarvis-push',
      renotify: true,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && client.url !== url) {
            client.navigate(url).catch(() => {});
          }
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
