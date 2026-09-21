import 'server-only';
import webpush from 'web-push';
import { db } from './db';
import { isPushEndpoint } from './notification-utils';

export async function notifyUser(userId: string, deadline = Date.now() + 10000) {
  if (Date.now() >= deadline) return;
  const prefs = await db.notificationPref.findUnique({ where: { userId } });
  if (!prefs?.browserPush || Date.now() >= deadline) return;
  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  if (!subscriptions.length || Date.now() >= deadline) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  const matches = await db.emailClassification.findMany({
    where: {
      userId,
      matched: true,
      confidence: { gte: prefs.minConfidence },
      notifiedAt: null,
      tag: { priority: 'HIGH' },
      email: { handled: false, isRead: false },
    },
    include: { tag: true, email: true },
    take: 10,
  });
  for (const match of matches) {
    if (Date.now() >= deadline) return;
    if (match.tagVersion !== match.tag.version) continue;
    const claimedAt = new Date();
    const claim = await db.emailClassification.updateMany({
      where: { id: match.id, userId, notifiedAt: null },
      data: { notifiedAt: claimedAt },
    });
    if (!claim.count) continue;
    let delivered = false;
    try {
      for (const sub of subscriptions) {
        if (Date.now() >= deadline) break;
        if (!isPushEndpoint(sub.endpoint)) continue;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({
              title: `New ${match.tag.name} email`,
              body: `From ${match.email.senderName || match.email.sender}`,
              url: `/?email=${encodeURIComponent(match.emailId)}`,
              tag: match.id,
            }),
            { TTL: 3600, timeout: Math.max(1, Math.min(5000, deadline - Date.now())) },
          );
          delivered = true;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410)
            await db.pushSubscription.deleteMany({ where: { id: sub.id, userId } });
        }
      }
    } finally {
      // Only release our own unfulfilled claim, including cooperative deadline exits.
      if (!delivered)
        await db.emailClassification.updateMany({
          where: { id: match.id, userId, notifiedAt: claimedAt },
          data: { notifiedAt: null },
        });
    }
  }
}
