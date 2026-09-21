"use strict";
(() => {
  // src/service-worker/sw.ts
  self.addEventListener("push", (event) => {
    let data = {};
    try {
      data = event.data?.json() ?? {};
    } catch {
      return;
    }
    event.waitUntil(
      self.registration.showNotification(data.title ?? "JevInbox", {
        body: data.body ?? "A priority email needs you.",
        tag: data.tag ?? "jevinbox",
        icon: "/icon.svg",
        data: { url: data.url ?? "/" }
      })
    );
  });
  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const candidate = new URL(String(event.notification.data?.url ?? "/"), self.location.origin);
    const target = candidate.origin === self.location.origin ? candidate.href : self.location.origin;
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
        const existing = clients[0];
        if (existing) {
          await existing.navigate(target);
          await existing.focus();
        } else await self.clients.openWindow(target);
      })
    );
  });
})();
