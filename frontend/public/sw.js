// Trading Desk service worker — only handles push notifications (no offline caching).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = { title: 'Trading Desk', body: '', path: '/', tag: undefined };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {
    if (event.data) msg.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      renotify: !!msg.tag,
      icon: '/pwa-icon/192',
      badge: '/pwa-icon/96',
      data: { path: msg.path },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || '/';
  const target = new URL(path, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === target.origin && 'focus' in w) {
          await w.focus();
          return w.navigate ? w.navigate(target.href) : undefined;
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
