import 'server-only';
import { randomUUID } from 'node:crypto';
import type { EmailAccount } from '@prisma/client';
import { db } from '../db';
import { decrypt, encrypt } from '../crypto';
import { ApiError } from '../errors';
import { refreshAccessToken } from './index';
import { withProviderDeadline } from './http';
import type { WorkspaceId } from '../workspace-selection';
/** Cooperates with sync, replies and disconnect; deletion must not race an active send. */
export async function withAccountLock<T>(
  userId: string,
  workspace: WorkspaceId,
  accountId: string,
  operation: (account: EmailAccount) => Promise<T>,
  deadline = Date.now() + 45000,
): Promise<T> {
  const leaseId = randomUUID();
  const scope = { id: accountId, userId, workspace };
  const lease = await db.emailAccount.updateMany({
    where: { ...scope, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: new Date() } }] },
    data: {
      syncLeaseId: leaseId,
      syncLeaseUntil: new Date(Math.max(Date.now() + 120000, deadline + 15000)),
    },
  });
  if (!lease.count)
    throw new ApiError(
      409,
      'ACCOUNT_BUSY',
      'This account is processing a request. Try again shortly.',
    );
  try {
    const account = await db.emailAccount.findFirst({ where: { ...scope, syncLeaseId: leaseId } });
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    return await operation(account);
  } finally {
    await db.emailAccount.updateMany({
      where: { ...scope, syncLeaseId: leaseId },
      data: { syncLeaseId: null, syncLeaseUntil: null },
    });
  }
}
/** Refresh-token rotation is serialized across all provider operations. */
export async function withAccountCredentials<T>(
  userId: string,
  workspace: WorkspaceId,
  accountId: string,
  operation: (account: EmailAccount, token: string) => Promise<T>,
  deadline = Date.now() + 45000,
): Promise<T> {
  return withAccountLock(
    userId,
    workspace,
    accountId,
    (account) =>
      withProviderDeadline(deadline, async () => {
        let token = decrypt(account.accessToken);
        if (account.expiresAt.getTime() < Date.now() + 120000) {
          if (!account.refreshToken)
            throw new ApiError(409, 'RECONNECT_REQUIRED', 'Reconnect this account to continue.');
          const refreshed = await refreshAccessToken(
            account.provider,
            decrypt(account.refreshToken),
          );
          token = refreshed.accessToken;
          const saved = await db.emailAccount.updateMany({
            where: { id: accountId, userId, workspace, syncLeaseId: account.syncLeaseId },
            data: {
              accessToken: encrypt(token),
              expiresAt: new Date(refreshed.expiresAt),
              ...(refreshed.refreshToken ? { refreshToken: encrypt(refreshed.refreshToken) } : {}),
            },
          });
          if (!saved.count)
            throw new ApiError(409, 'ACCOUNT_BUSY', 'This account changed. Try again shortly.');
        }
        return operation(account, token);
      }),
    deadline,
  );
}
