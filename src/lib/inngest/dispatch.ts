import 'server-only';
import { db } from '../db';
import { requestWork } from '../work-queue';
import type { WorkspaceId } from '../workspace-selection';
import { backgroundConfigured, inngest } from './client';

export function canPublishWork() {
  // Publishing is useful only if this environment can also serve signed worker requests.
  return backgroundConfigured();
}

/** The durable database marker is the outbox; failed event delivery is repaired by recovery. */
export async function publishUserWork(userId: string) {
  if (!canPublishWork()) return false;
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { workRevision: true, workRequested: true },
    });
    if (!user?.workRequested) return true;
    await inngest.send({
      id: `work:${userId}:${user.workRevision}`,
      name: 'evailbox/work.requested',
      data: { userId },
    });
    return true;
  } catch {
    console.warn(JSON.stringify({ event: 'work_dispatch_deferred' }));
    return false;
  }
}

export async function enqueueUserWork(
  userId: string,
  options: { sync?: boolean; accountId?: string; workspace?: WorkspaceId } = {},
) {
  await requestWork(userId, options);
  const workerAvailable = await publishUserWork(userId);
  return { queued: true, pending: true, workerAvailable };
}

export async function recoverPendingWork(deadline = Date.now() + 40_000) {
  if (!canPublishWork()) return { dispatched: 0, errors: 0, configured: false };
  let cursor: string | undefined,
    dispatched = 0,
    errors = 0;
  while (Date.now() < deadline) {
    const users = await db.user.findMany({
      where: {
        workRequested: true,
        // Ingestion must continue even while paid inference observes a cooldown.
        // The worker fetches first, then durably sleeps before classification.
        AND: [
          {
            OR: [
              { workNotBefore: { lte: new Date() } },
              { accounts: { some: { syncRequested: true } } },
            ],
          },
        ],
        OR: [{ workLeaseUntil: null }, { workLeaseUntil: { lt: new Date() } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, workRevision: true },
    });
    if (!users.length) break;
    try {
      // Stable within a minute, but recover an exhausted/failed run in the next minute.
      await inngest.send(
        users.map((user) => ({
          id: `recovery:${user.id}:${user.workRevision}:${Math.floor(Date.now() / 60_000)}`,
          name: 'evailbox/work.requested',
          data: { userId: user.id },
        })),
      );
      dispatched += users.length;
    } catch {
      errors++;
      break;
    }
    cursor = users.at(-1)!.id;
    if (users.length < 100) break;
  }
  return { dispatched, errors, configured: true };
}
