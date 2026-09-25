'use client';
import { useEffect } from 'react';
/** Remove our old push registration for returning users; leave unrelated workers alone. */
export function RetireNotificationWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        for (const registration of registrations) {
          const worker = registration.active ?? registration.waiting ?? registration.installing;
          if (!worker) continue;
          const url = new URL(worker.scriptURL);
          if (url.origin !== location.origin || url.pathname !== '/sw.js') continue;
          const subscription = await registration.pushManager?.getSubscription();
          if (subscription) await subscription.unsubscribe();
          await registration.unregister();
        }
      })
      .catch(() => undefined);
  }, []);
  return null;
}
