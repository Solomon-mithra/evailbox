import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { EmailAccount, MailboxSubscription, Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { constantTimeEqual, decrypt, encrypt } from './crypto';
import { ApiError } from './errors';
import type { WorkspaceId } from './workspace-selection';
import { withAccountCredentials } from './providers/credentials';
import { authHeaders, ProviderHttpError } from './providers/http';
import {
  gmailWebhookConfiguration,
  isOutlookInboxResource,
  OUTLOOK_INBOX_RESOURCE,
  outlookWebhookUrl,
} from './providers/webhooks';

const DAY = 86400000;
const graphBase = 'https://graph.microsoft.com/v1.0';
const graphSubscription = z.object({
  id: z.string().min(1).max(200),
  expirationDateTime: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  resource: z.string().optional(),
});
/** Mutating provider requests get one attempt: a lost response may have succeeded. */
async function providerRequest(
  url: string,
  token: string,
  method: string,
  deadline: number,
  body?: unknown,
): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Provider deadline exceeded');
  const response = await fetch(url, {
    method,
    headers: { ...authHeaders(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1, Math.min(12000, remaining))),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderHttpError(response.status);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function due(now: Date): Prisma.MailboxSubscriptionWhereInput {
  return {
    status: { not: 'disconnected' },
    retryAt: { lte: now },
    AND: [
      { OR: [{ renewalLeaseUntil: null }, { renewalLeaseUntil: { lt: now } }] },
      {
        OR: [
          { renewalRequested: true },
          { expiresAt: null },
          { expiresAt: { lte: new Date(now.getTime() + DAY) } },
          { provider: 'GMAIL', updatedAt: { lte: new Date(now.getTime() - DAY) } },
        ],
      },
    ],
  };
}
/** Called after OAuth; worker dispatch is owned by the caller's durable work flow. */
export async function requestMailboxSubscriptionRenewal(
  userId: string,
  accountId?: string,
  workspace?: WorkspaceId,
) {
  const accounts = await db.emailAccount.findMany({
    where: { userId, ...(accountId ? { id: accountId } : {}), ...(workspace ? { workspace } : {}) },
    select: { id: true, userId: true, workspace: true, provider: true },
  });
  for (const account of accounts) {
    await db.mailboxSubscription.upsert({
      where: { accountId: account.id },
      create: {
        accountId: account.id,
        userId,
        workspace: account.workspace,
        provider: account.provider,
      },
      update: {
        renewalRequested: true,
        renewalRevision: { increment: 1 },
        status: 'pending',
        retryAt: new Date(),
      },
    });
  }
}
/** Bounded and fair: active leases are excluded; failures move retryAt into the future. */
export async function renewMailboxSubscriptions(
  options: { userId?: string; accountId?: string; limit?: number; deadline?: number } = {},
) {
  const deadline = Math.min(options.deadline ?? Date.now() + 45000, Date.now() + 50000);
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)));
  let renewed = 0,
    errors = 0,
    unconfigured = 0,
    pending = false;
  if (Date.now() >= deadline) return { renewed, errors, unconfigured, pending: true };
  const now = new Date();
  const accounts = await db.emailAccount.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.accountId ? { id: options.accountId } : {}),
      OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }],
      AND: [
        { OR: [{ mailboxSubscription: { is: null } }, { mailboxSubscription: { is: due(now) } }] },
      ],
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, userId: true, provider: true, workspace: true },
  });
  pending = accounts.length === limit;
  for (const account of accounts) {
    if (Date.now() >= deadline) {
      pending = true;
      break;
    }
    await db.mailboxSubscription.upsert({
      where: { accountId: account.id },
      create: {
        accountId: account.id,
        userId: account.userId,
        workspace: account.workspace,
        provider: account.provider,
      },
      update: {},
    });
    const leaseId = randomUUID();
    const claim = await db.mailboxSubscription.updateMany({
      where: { accountId: account.id, ...due(new Date()) },
      data: { renewalLeaseId: leaseId, renewalLeaseUntil: new Date(Date.now() + 120000) },
    });
    if (!claim.count) {
      pending = true;
      continue;
    }
    const owned = {
      accountId: account.id,
      renewalLeaseId: leaseId,
      status: { not: 'disconnected' },
    };
    try {
      const subscription = await db.mailboxSubscription.findUnique({
        where: { accountId: account.id },
      });
      if (
        !subscription ||
        subscription.renewalLeaseId !== leaseId ||
        subscription.status === 'disconnected'
      ) {
        pending = true;
        continue;
      }
      const gmail = account.provider === 'GMAIL' ? gmailWebhookConfiguration() : null;
      const outlookUrl = account.provider === 'OUTLOOK' ? outlookWebhookUrl() : null;
      if (account.provider === 'GMAIL' ? !gmail : !outlookUrl) {
        unconfigured++;
        await db.mailboxSubscription.updateMany({
          where: owned,
          data: {
            status: 'unconfigured',
            lastError: 'Mailbox events are not configured for this provider.',
            retryAt: new Date(Date.now() + 3600000),
          },
        });
        continue;
      }
      const result = await withAccountCredentials(
        account.userId,
        account.workspace,
        account.id,
        async (freshAccount, token) => {
          if (account.provider === 'GMAIL') {
            const watch = z
              .object({
                historyId: z.string().regex(/^\d{1,40}$/),
                expiration: z.string().regex(/^\d+$/),
              })
              .parse(
                await providerRequest(
                  'https://gmail.googleapis.com/gmail/v1/users/me/watch',
                  token,
                  'POST',
                  deadline,
                  { topicName: gmail!.topic, labelIds: ['INBOX'], labelFilterBehavior: 'include' },
                ),
              );
            const expiresAt = new Date(Number(watch.expiration));
            if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
              throw new Error('Invalid watch expiry');
            return { resource: gmail!.topic, watchHistoryId: watch.historyId, expiresAt };
          }
          return renewOutlook(
            subscription,
            outlookUrl!,
            token,
            leaseId,
            deadline,
            freshAccount.email,
          );
        },
        deadline,
      );
      const saved = await db.mailboxSubscription.updateMany({
        where: owned,
        data: {
          ...result,
          status: 'active',
          lastError: null,
          retryAt: account.provider === 'GMAIL' ? new Date(Date.now() + DAY) : new Date(0),
        },
      });
      if (!saved.count) {
        pending = true;
        continue;
      }
      // Keep a concurrent lifecycle request, even if this provider call succeeded.
      await db.mailboxSubscription.updateMany({
        where: { ...owned, renewalRevision: subscription.renewalRevision },
        data: { renewalRequested: false },
      });
      renewed++;
    } catch (error) {
      const busy = error instanceof ApiError && error.status === 409;
      if (busy) pending = true;
      else errors++;
      await db.mailboxSubscription.updateMany({
        where: owned,
        data: {
          status: busy ? 'pending' : 'error',
          lastError: busy
            ? 'Mailbox is busy; renewal will retry shortly.'
            : 'Mailbox event renewal failed. Check provider setup or reconnect this account.',
          retryAt: new Date(Date.now() + (busy ? 60000 : 15 * 60000)),
        },
      });
    } finally {
      await db.mailboxSubscription.updateMany({
        where: { accountId: account.id, renewalLeaseId: leaseId },
        data: { renewalLeaseId: null, renewalLeaseUntil: null },
      });
    }
  }
  return { renewed, errors, unconfigured, pending };
}
async function renewOutlook(
  subscription: MailboxSubscription,
  callback: string,
  token: string,
  leaseId: string,
  deadline: number,
  mailboxEmail: string,
) {
  let providerMailboxId = subscription.providerMailboxId;
  if (!providerMailboxId) {
    providerMailboxId = z
      .object({ id: z.string().min(1).max(200) })
      .parse(await providerRequest(`${graphBase}/me?$select=id`, token, 'GET', deadline)).id;
  }
  const peers = () =>
    db.mailboxSubscription.findMany({
      where: {
        accountId: { not: subscription.accountId },
        provider: 'OUTLOOK',
        providerMailboxId,
        resource: OUTLOOK_INBOX_RESOURCE,
        status: { not: 'disconnected' },
        clientState: { not: null },
        // Both identifiers came from this application's authenticated OAuth/Graph
        // identity, never a webhook. Do not share across a matching display email alone.
        account: { email: mailboxEmail },
      },
      orderBy: { accountId: 'asc' },
      select: { accountId: true, clientState: true, providerSubscriptionId: true, expiresAt: true },
      take: 100,
    });
  const siblings = await peers();
  const sibling =
    siblings.find(
      (row) =>
        row.clientState &&
        row.providerSubscriptionId &&
        row.expiresAt &&
        row.expiresAt.getTime() > Date.now(),
    ) ?? siblings.find((row) => row.clientState);
  let clientState = subscription.clientState
    ? decrypt(subscription.clientState)
    : sibling?.clientState
      ? decrypt(sibling.clientState)
      : randomBytes(32).toString('base64url');
  let existingId = subscription.providerSubscriptionId;
  let existingExpiry = subscription.expiresAt;
  if (
    !existingId &&
    sibling?.providerSubscriptionId &&
    sibling.expiresAt &&
    sibling.expiresAt.getTime() > Date.now()
  ) {
    existingId = sibling.providerSubscriptionId;
    existingExpiry = sibling.expiresAt;
    clientState = decrypt(sibling.clientState!);
  }
  // Save before creation, so concurrent callers and ambiguous-response recovery
  // can prove the provider's returned state belongs to this exact mailbox.
  if (
    !subscription.clientState ||
    !subscription.providerMailboxId ||
    existingId !== subscription.providerSubscriptionId
  ) {
    const saved = await db.mailboxSubscription.updateMany({
      where: {
        accountId: subscription.accountId,
        renewalLeaseId: leaseId,
        status: { not: 'disconnected' },
      },
      data: {
        clientState: encrypt(clientState),
        providerMailboxId,
        resource: OUTLOOK_INBOX_RESOURCE,
      },
    });
    if (!saved.count) throw new Error('Subscription was disconnected');
  }
  const expirationDateTime = new Date(Date.now() + 6 * DAY).toISOString();
  let result: z.infer<typeof graphSubscription> | undefined;
  if (existingId && existingExpiry && existingExpiry.getTime() > Date.now()) {
    try {
      result = graphSubscription.parse(
        await providerRequest(
          `${graphBase}/subscriptions/${encodeURIComponent(existingId)}`,
          token,
          'PATCH',
          deadline,
          { expirationDateTime },
        ),
      );
      if (result.id !== existingId) throw new Error('Subscription identity mismatch');
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || ![404, 410].includes(error.status)) throw error;
    }
  }
  const allowedStates = (rows: typeof siblings) => [
    clientState,
    ...rows.flatMap((row) => (row.clientState ? [decrypt(row.clientState)] : [])),
  ];
  if (!result) {
    let recovered = await findRecoverableSubscription(
      token,
      allowedStates(siblings),
      callback,
      deadline,
    );
    if (recovered) {
      result = recovered;
      clientState = recovered.clientState!;
    } else {
      try {
        result = graphSubscription.parse(
          await providerRequest(`${graphBase}/subscriptions`, token, 'POST', deadline, {
            changeType: 'created,updated,deleted',
            notificationUrl: callback,
            lifecycleNotificationUrl: callback,
            resource: OUTLOOK_INBOX_RESOURCE,
            expirationDateTime,
            clientState,
          }),
        );
      } catch (error) {
        if (!(error instanceof ProviderHttpError) || error.status !== 409) throw error;
        // Graph forbids duplicate resource/changeType subscriptions. Another
        // workspace may have won the create race; re-read its durable private state.
        recovered = await findRecoverableSubscription(
          token,
          allowedStates(await peers()),
          callback,
          deadline,
        );
        if (!recovered) throw error;
        result = recovered;
        clientState = recovered.clientState!;
      }
    }
  }
  if (Date.parse(result.expirationDateTime) <= Date.now())
    throw new Error('Subscription is expired');
  if (result.resource && !isOutlookInboxResource(result.resource))
    throw new Error('Subscription resource mismatch');
  return {
    providerSubscriptionId: result.id,
    providerMailboxId,
    clientState: encrypt(clientState),
    resource: OUTLOOK_INBOX_RESOURCE,
    expiresAt: new Date(result.expirationDateTime),
  };
}
async function findRecoverableSubscription(
  token: string,
  allowedStates: string[],
  callback: string,
  deadline: number,
) {
  let url: string | undefined = `${graphBase}/subscriptions`;
  for (let page = 0; url && page < 4; page++) {
    const list = z
      .object({
        value: z
          .array(
            graphSubscription.extend({
              clientState: z.string().nullish(),
              notificationUrl: z.string(),
              lifecycleNotificationUrl: z.string().nullish(),
            }),
          )
          .max(1000),
        '@odata.nextLink': z.string().optional(),
      })
      .parse(await providerRequest(url, token, 'GET', deadline));
    const existing = list.value.find(
      (item) =>
        item.clientState &&
        allowedStates.some((state) => constantTimeEqual(item.clientState!, state)) &&
        item.notificationUrl === callback &&
        item.lifecycleNotificationUrl === callback &&
        isOutlookInboxResource(item.resource) &&
        Date.parse(item.expirationDateTime) > Date.now(),
    );
    if (existing) return existing;
    url = list['@odata.nextLink'];
    if (url) {
      const next = new URL(url);
      if (
        next.origin !== 'https://graph.microsoft.com' ||
        next.pathname !== '/v1.0/subscriptions' ||
        next.username ||
        next.password ||
        next.hash
      )
        throw new Error('Invalid subscription pagination');
    }
  }
  if (url) throw new Error('Subscription recovery page limit exceeded');
  return undefined;
}
/** Run before account deletion. Cleanup is best effort; local FK deletion revokes routing. */
export async function cleanupMailboxSubscription(
  userId: string,
  accountId: string,
  deadline = Date.now() + 10000,
  heldCredentials?: { account: EmailAccount; token: string },
) {
  try {
    if (
      heldCredentials &&
      (heldCredentials.account.id !== accountId || heldCredentials.account.userId !== userId)
    )
      throw new Error('Invalid held account ownership');
    const account =
      heldCredentials?.account ??
      (await db.emailAccount.findFirst({ where: { id: accountId, userId } }));
    if (!account) return { cleaned: false, skipped: true };
    const subscription = await db.mailboxSubscription.findUnique({ where: { accountId } });
    await db.mailboxSubscription.updateMany({
      where: { accountId, userId },
      data: { status: 'disconnected', renewalRequested: false },
    });
    if (account.provider === 'GMAIL') {
      // Gmail watch belongs to the provider identity, not our workspace account.
      const shared = await db.emailAccount.count({
        where: { id: { not: accountId }, provider: 'GMAIL', email: account.email },
      });
      if (shared) return { cleaned: false, skipped: true };
    } else {
      if (!subscription?.providerSubscriptionId) return { cleaned: false, skipped: true };
      const shared = await db.mailboxSubscription.count({
        where: {
          accountId: { not: accountId },
          provider: 'OUTLOOK',
          providerSubscriptionId: subscription.providerSubscriptionId,
          status: { not: 'disconnected' },
        },
      });
      if (shared) return { cleaned: false, skipped: true };
    }
    const cleanup = async (token: string) => {
      try {
        await providerRequest(
          account.provider === 'GMAIL'
            ? 'https://gmail.googleapis.com/gmail/v1/users/me/stop'
            : `${graphBase}/subscriptions/${encodeURIComponent(subscription!.providerSubscriptionId!)}`,
          token,
          account.provider === 'GMAIL' ? 'POST' : 'DELETE',
          deadline,
        );
      } catch (error) {
        if (!(error instanceof ProviderHttpError) || ![404, 410].includes(error.status))
          throw error;
      }
    };
    // Disconnect callers can retain this lease through subsequent database deletion,
    // preventing a send from starting in a cleanup-release/delete gap.
    if (heldCredentials) await cleanup(heldCredentials.token);
    else
      await withAccountCredentials(
        userId,
        account.workspace,
        accountId,
        (_freshAccount, token) => cleanup(token),
        deadline,
      );
    return { cleaned: true, skipped: false };
  } catch {
    return {
      cleaned: false,
      skipped: false,
      error: 'Provider cleanup could not finish. The subscription will expire.',
    };
  }
}
