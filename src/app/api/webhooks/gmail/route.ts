import { after } from 'next/server';
import { db } from '@/lib/db';
import { requestWork } from '@/lib/work-queue';
import { publishUserWork } from '@/lib/inngest/dispatch';
import {
  gmailWebhookConfiguration,
  parseGmailNotification,
  readBoundedJson,
  verifyGmailPushToken,
  WebhookInputError,
} from '@/lib/providers/webhooks';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) {
  const configuration = gmailWebhookConfiguration();
  if (!configuration) return new Response(null, { status: 503 });
  try {
    await verifyGmailPushToken(request.headers.get('authorization'), configuration);
  } catch {
    return new Response(null, { status: 401 });
  }
  let notification;
  try {
    notification = parseGmailNotification(await readBoundedJson(request));
  } catch (error) {
    return new Response(null, { status: error instanceof WebhookInputError ? error.status : 400 });
  }
  if (notification.subscription !== configuration.subscription)
    return new Response(null, { status: 403 });
  try {
    const accounts = await db.mailboxSubscription.findMany({
      where: {
        provider: 'GMAIL',
        resource: configuration.topic,
        watchHistoryId: { not: null },
        status: { not: 'disconnected' },
        account: { email: notification.emailAddress },
      },
      select: { accountId: true, userId: true, workspace: true },
    });
    const users = new Set<string>();
    for (const account of accounts) {
      // Delivery order/historyId is a hint, never an ingestion checkpoint.
      await requestWork(account.userId, {
        sync: true,
        accountId: account.accountId,
        workspace: account.workspace,
      });
      users.add(account.userId);
    }
    if (users.size)
      after(async () => {
        await Promise.all([...users].map((userId) => publishUserWork(userId)));
      });
    return new Response(null, { status: 204 });
  } catch {
    // No success acknowledgment unless the durable marker was saved.
    return new Response(null, { status: 503 });
  }
}
