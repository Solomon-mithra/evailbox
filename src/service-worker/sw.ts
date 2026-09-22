/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;
self.addEventListener('push', (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'evailbox', {
      body: data.body ?? 'A priority email needs you.',
      tag: data.tag ?? 'evailbox',
      icon: '/icon.svg',
      data: { url: data.url ?? '/inbox' },
    }),
  );
});
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const fallback = new URL('/inbox', self.location.origin);
  const candidate = new URL(
    String(event.notification.data?.url ?? fallback.href),
    self.location.origin,
  );
  const target = candidate.origin === self.location.origin ? candidate.href : fallback.href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients[0] as WindowClient | undefined;
      if (existing) {
        await existing.navigate(target);
        await existing.focus();
      } else await self.clients.openWindow(target);
    }),
  );
});
