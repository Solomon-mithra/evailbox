import { after } from 'next/server';
import { db } from '@/lib/db';
import { constantTimeEqual, decrypt } from '@/lib/crypto';
import { requestWork } from '@/lib/work-queue';
import { publishUserWork } from '@/lib/inngest/dispatch';
import {
  matchesOutlookResource,
  outlookNotifications,
  outlookValidationResponse,
  outlookWebhookUrl,
  readBoundedJson,
  WebhookInputError,
} from '@/lib/providers/webhooks';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) {
  const validation = outlookValidationResponse(request);
  if (validation) return validation;
  if (!outlookWebhookUrl()) return new Response(null, { status: 503 });
  let notifications;
  try {
    notifications = outlookNotifications.parse(await readBoundedJson(request)).value;
  } catch (error) {
    return new Response(null, { status: error instanceof WebhookInputError ? error.status : 400 });
  }
  try {
    const users = new Set<string>(),
      accounts = new Set<string>();
    for (const notification of notifications) {
      const subscriptions = await db.mailboxSubscription.findMany({
        where: {
          provider: 'OUTLOOK',
          providerSubscriptionId: notification.subscriptionId,
          status: { not: 'disconnected' },
        },
      });
      for (const subscription of subscriptions) {
        if (
          !subscription ||
          subscription.provider !== 'OUTLOOK' ||
          subscription.status === 'disconnected' ||
          !subscription.clientState
        )
          continue;
        let verified = false;
        try {
          verified = constantTimeEqual(decrypt(subscription.clientState), notification.clientState);
        } catch {
          /* Invalid stored state cannot authenticate a notification. */
        }
        if (!verified) continue;
        if (notification.resource && !matchesOutlookResource(notification.resource, subscription))
          continue;
        if (!notification.lifecycleEvent && (!notification.resource || !notification.changeType))
          continue;
        if (notification.lifecycleEvent) {
          await db.mailboxSubscription.updateMany({
            where: {
              accountId: subscription.accountId,
              providerSubscriptionId: notification.subscriptionId,
            },
            data: {
              renewalRequested: true,
              renewalRevision: { increment: 1 },
              retryAt: new Date(),
              ...(notification.lifecycleEvent === 'subscriptionRemoved'
                ? { expiresAt: new Date(0), status: 'pending' }
                : {}),
            },
          });
        }
        if (!accounts.has(subscription.accountId)) {
          await requestWork(subscription.userId, {
            sync: true,
            accountId: subscription.accountId,
            workspace: subscription.workspace,
          });
          accounts.add(subscription.accountId);
          users.add(subscription.userId);
        }
      }
    }
    if (users.size)
      after(async () => {
        await Promise.all([...users].map((userId) => publishUserWork(userId)));
      });
    return new Response(null, { status: 202 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
