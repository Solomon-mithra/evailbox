import 'server-only';
import { ProviderHttpError, withProviderDeadline } from './providers/http';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { decrypt, encrypt } from './crypto';
import { fetchEmailPage, refreshAccessToken } from './providers';
import { classifyEmails } from './classification';
import { emailContentHash } from './classification-version';
/** Resume provider pages independently of paid inference. */
export async function syncMailboxes(
  userId: string,
  accountId?: string,
  deadline = Date.now() + 45000,
) {
  const accounts = await db.emailAccount.findMany({
    where: { userId, syncRequested: true, ...(accountId ? { id: accountId } : {}) },
  });
  let synced = 0,
    errors = 0,
    pending = false;
  for (const snapshot of accounts) {
    let account = snapshot;
    if (Date.now() > deadline) {
      pending = true;
      break;
    }
    const leaseId = randomUUID();
    const lock = await db.emailAccount.updateMany({
      where: {
        id: account.id,
        userId,
        OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: new Date() } }],
      },
      data: { syncLeaseUntil: new Date(Date.now() + 120000), syncLeaseId: leaseId },
    });
    if (!lock.count) {
      pending = true;
      continue;
    }
    let stage = 'credentials';
    try {
      account = await db.emailAccount.findUniqueOrThrow({
        where: { id: account.id, userId, syncLeaseId: leaseId },
      });
      let token = decrypt(account.accessToken);
      if (account.expiresAt.getTime() < Date.now() + 120000) {
        if (!account.refreshToken) throw new Error('Reconnect account');
        const refreshed = await withProviderDeadline(deadline, () =>
          refreshAccessToken(account.provider, decrypt(account.refreshToken!)),
        );
        token = refreshed.accessToken;
        await db.emailAccount.update({
          where: { id: account.id, userId, syncLeaseId: leaseId },
          data: {
            accessToken: encrypt(token),
            expiresAt: new Date(refreshed.expiresAt),
            ...(refreshed.refreshToken ? { refreshToken: encrypt(refreshed.refreshToken) } : {}),
          },
        });
      }
      let cursor = account.cursor;
      let rescanStartedAt = account.rescanStartedAt;
      for (let page = 0; page < 4; page++) {
        if (Date.now() > deadline) {
          pending = true;
          break;
        }
        stage = 'fetch_page';
        const result = await withProviderDeadline(deadline, () =>
          fetchEmailPage(account.provider, token, cursor),
        );
        // Saving 25 messages over a remote database connection can exceed Prisma's
        // default five-second transaction. Budget the save explicitly, including
        // connection wait and cleanup, without advancing a cursor we cannot save.
        const saveBudget = deadline - Date.now() - 1000;
        if (saveBudget < 3000) {
          pending = true;
          break;
        }
        stage = 'save_page';
        await db.$transaction(
          async (tx) => {
            const [{ observedAt }] = await tx.$queryRaw<
              { observedAt: Date }[]
            >`SELECT clock_timestamp() AS "observedAt"`;
            if (result.reset) rescanStartedAt = observedAt;
            for (const message of result.messages) {
              const contentHash = emailContentHash(message);
              await tx.email.upsert({
                where: {
                  accountId_providerMessageId: {
                    accountId: account.id,
                    providerMessageId: message.providerMessageId,
                  },
                },
                create: {
                  userId,
                  workspace: account.workspace,
                  accountId: account.id,
                  ...message,
                  contentHash,
                  inInbox: true,
                  lastSeenAt: observedAt,
                },
                update: { ...message, contentHash, inInbox: true, lastSeenAt: observedAt },
              });
            }
            if (result.deletedIds?.length)
              await tx.email.deleteMany({
                where: {
                  userId,
                  accountId: account.id,
                  providerMessageId: { in: result.deletedIds },
                },
              });
            if (!result.hasMore && rescanStartedAt)
              await tx.email.deleteMany({
                where: { userId, accountId: account.id, lastSeenAt: { lt: rescanStartedAt } },
              });
            await tx.emailAccount.update({
              where: { id: account.id, userId, syncLeaseId: leaseId },
              data: {
                cursor: result.cursor,
                lastSync: new Date(),
                syncError: null,
                rescanStartedAt: result.hasMore ? rescanStartedAt : null,
              },
            });
            await tx.emailAccount.updateMany({
              where: {
                id: account.id,
                userId,
                syncLeaseId: leaseId,
                syncRevision: account.syncRevision,
              },
              data: { syncRequested: result.hasMore },
            });
          },
          { maxWait: 2000, timeout: Math.min(20000, saveBudget - 2000) },
        );
        synced += result.messages.length;
        cursor = result.cursor;
        if (!result.hasMore) break;
        pending = true;
      }
    } catch (error) {
      errors++;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      console.warn(
        JSON.stringify({
          event: 'mailbox_sync_failed',
          provider: account.provider,
          stage,
          status: error instanceof ProviderHttpError ? error.status : undefined,
          databaseCode: typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined,
        }),
      );
      await db.emailAccount.updateMany({
        where: { id: account.id, userId, syncLeaseId: leaseId },
        data: { syncError: 'Sync could not finish. Retry or reconnect this account.' },
      });
    } finally {
      await db.emailAccount.updateMany({
        where: { id: account.id, userId, syncLeaseId: leaseId },
        data: { syncLeaseUntil: null, syncLeaseId: null },
      });
    }
  }
  pending = (await db.emailAccount.count({ where: { userId, syncRequested: true } })) > 0;
  return { synced, errors, pending };
}

export async function syncUser(userId: string, accountId?: string, deadline = Date.now() + 45000) {
  const sync = await syncMailboxes(userId, accountId, deadline);
  const result = await classifyEmails(userId, { deadline });
  return {
    synced: sync.synced,
    classified: result.classified,
    errors: sync.errors + result.errors,
    pending: sync.pending || result.remaining > 0,
    ...(result.retryAfterSeconds
      ? ({ rateLimited: true, retryAfterSeconds: result.retryAfterSeconds } as const)
      : {}),
  };
}
