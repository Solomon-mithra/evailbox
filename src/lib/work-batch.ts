import 'server-only';
import { db } from './db';
import { ApiError } from './errors';
import type { TransientBodies } from './transient-bodies';
import { WORK_BATCH_SIZE } from './providers/sync-policy';
import { syncMailboxes } from './sync';
import { classifyEmails } from './classification';
import { withUserWorkLease } from './work-queue';

export async function fetchWorkBatch(
  userId: string,
  bodies?: TransientBodies,
  deadline = Date.now() + 40_000,
) {
  // Mailbox leases/checkpoints protect fetches; AI cooldown must not stop mail ingestion.
  const result = await syncMailboxes(userId, undefined, deadline, { maxPages: 1, bodies });
  return result;
}

export async function classifyWorkBatch(
  userId: string,
  bodies?: TransientBodies,
  deadline = Date.now() + 40_000,
) {
  return withUserWorkLease(userId, () =>
    classifyEmails(userId, { deadline, limit: WORK_BATCH_SIZE, bodies }),
  );
}

/** A single durable step: only numeric progress may leave this function. */
export async function processInboxBatch(userId: string) {
  const bodies: TransientBodies = new Map();
  const deadline = Date.now() + 40_000;
  try {
    const sync = await fetchWorkBatch(userId, bodies, deadline);
    let classification;
    try {
      classification = await classifyWorkBatch(userId, bodies, deadline);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        !['WORK_COOLDOWN', 'WORK_IN_PROGRESS'].includes(error.code)
      )
        throw error;
      classification = {
        classified: 0,
        errors: 0,
        remaining: 1,
        // A stored cooldown already has an absolute retry time. Adding another
        // minute here lets early/duplicate events postpone inference indefinitely.
        ...(error.code === 'WORK_IN_PROGRESS' ? { retryAfterSeconds: 60 } : {}),
      };
    }
    return { sync, classification };
  } catch {
    // Provider/SDK/Prisma errors can embed private content. Never serialize them into a queue.
    throw new Error('Inbox batch could not complete');
  } finally {
    bodies.clear();
  }
}

export async function finishWorkBatch(
  userId: string,
  revision: number,
  sync: { synced: number; errors: number; pending: boolean },
  classification: {
    classified: number;
    errors: number;
    remaining: number;
    retryAfterSeconds?: number;
  },
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { pending: false, retryAt: null };
  const errors = sync.errors + classification.errors;
  const failures = errors ? user.workFailures + 1 : 0;
  const retryAt = new Date(
    Math.max(
      user.workNotBefore.getTime(),
      Date.now() +
        Math.max(
          (classification.retryAfterSeconds ?? 0) * 1000,
          failures ? Math.min(3_600_000, 60_000 * 2 ** Math.min(failures - 1, 6)) : 0,
        ),
    ),
  );
  await db.user.updateMany({
    where: { id: userId, workRevision: revision, workNotBefore: user.workNotBefore },
    data: {
      workRequested: sync.pending || classification.remaining > 0 || errors > 0,
      workFailures: failures,
      workNotBefore: retryAt,
      lastBackgroundSyncAt: new Date(),
    },
  });
  const current = await db.user.findUnique({
    where: { id: userId },
    select: { workRequested: true, workNotBefore: true },
  });
  return {
    pending: current?.workRequested ?? false,
    retryAt: current?.workRequested ? current.workNotBefore.toISOString() : null,
  };
}
