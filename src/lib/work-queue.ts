import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { syncUser } from './sync';
import { ApiError } from './errors';
import type { WorkspaceId } from './workspace-selection';

/** Durable desired-work marker. A revision prevents a running worker from clearing newer requests. */
export async function requestWork(
  userId: string,
  options: { sync?: boolean; accountId?: string; workspace?: WorkspaceId } = {},
) {
  await db.$transaction(async (tx) => {
    if (options.sync)
      await tx.emailAccount.updateMany({
        where: {
          userId,
          ...(options.workspace ? { workspace: options.workspace } : {}),
          ...(options.accountId ? { id: options.accountId } : {}),
        },
        data: { syncRequested: true, syncRevision: { increment: 1 } },
      });
    await tx.user.update({
      where: { id: userId },
      data: {
        workRequested: true,
        workRevision: { increment: 1 },
        workNotBefore: new Date(),
        workFailures: 0,
      },
    });
  });
}
export async function requestDailySync() {
  await db.$transaction([
    db.emailAccount.updateMany({ data: { syncRequested: true, syncRevision: { increment: 1 } } }),
    db.user.updateMany({
      where: { accounts: { some: {} } },
      data: { workRequested: true, workRevision: { increment: 1 }, workNotBefore: new Date() },
    }),
  ]);
}
export async function withUserWorkLease<T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const leaseId = randomUUID();
  const claim = await db.user.updateMany({
    where: { id: userId, OR: [{ workLeaseUntil: null }, { workLeaseUntil: { lt: new Date() } }] },
    data: { workLeaseId: leaseId, workLeaseUntil: new Date(Date.now() + 120000) },
  });
  if (!claim.count)
    throw new ApiError(
      409,
      'WORK_IN_PROGRESS',
      'Your inbox is already processing. Progress is saved; it will continue automatically.',
    );
  try {
    return await operation();
  } finally {
    await db.user.updateMany({
      where: { id: userId, workLeaseId: leaseId },
      data: { workLeaseId: null, workLeaseUntil: null },
    });
  }
}
export async function processUserWork(userId: string, deadline = Date.now() + 45000) {
  return withUserWorkLease(userId, async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await db.user.update({ where: { id: userId }, data: { lastBackgroundSyncAt: new Date() } });
    try {
      const result = await syncUser(userId, undefined, deadline);
      const failures = result.errors ? user.workFailures + 1 : 0;
      await db.user.updateMany({
        where: { id: userId, workRevision: user.workRevision },
        data: {
          workRequested: result.pending || result.errors > 0,
          workFailures: failures,
          workNotBefore: new Date(
            Date.now() + (failures ? Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6)) : 0),
          ),
        },
      });
      return result;
    } catch (error) {
      await db.user.updateMany({
        where: { id: userId, workRevision: user.workRevision },
        data: {
          workRequested: true,
          workFailures: { increment: 1 },
          workNotBefore: new Date(Date.now() + 60000),
        },
      });
      throw error;
    }
  });
}
export async function processPendingWork(deadline = Date.now() + 45000) {
  const users = await db.user.findMany({
    where: {
      workRequested: true,
      workNotBefore: { lte: new Date() },
      OR: [{ workLeaseUntil: null }, { workLeaseUntil: { lt: new Date() } }],
    },
    orderBy: { lastBackgroundSyncAt: { sort: 'asc', nulls: 'first' } },
    take: 100,
    select: { id: true },
  });
  let processed = 0,
    errors = 0;
  for (const user of users) {
    if (Date.now() + 1000 >= deadline) break;
    try {
      await processUserWork(user.id, deadline);
      processed++;
    } catch {
      errors++;
    }
  }
  return {
    processed,
    errors,
    pendingUsers: await db.user.count({ where: { workRequested: true } }),
  };
}
