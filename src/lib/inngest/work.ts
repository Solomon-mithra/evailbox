import 'server-only';
import { db } from '../db';
import { syncMailboxes } from '../sync';
import { classifyEmails } from '../classification';
import { withUserWorkLease } from '../work-queue';
import { signalInboxChange } from '../realtime';

export async function fetchWorkBatch(userId: string) {
  // Mailbox leases/checkpoints protect fetches; AI cooldown must not stop mail ingestion.
  const result = await syncMailboxes(userId, undefined, Date.now() + 40_000);
  try {
    await signalInboxChange(userId);
  } catch {
    console.warn(JSON.stringify({ event: 'inbox_signal_deferred' }));
  }
  return result;
}

export async function classifyWorkBatch(userId: string) {
  return withUserWorkLease(userId, () => classifyEmails(userId, { deadline: Date.now() + 40_000 }));
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
  // Signalling is best-effort and contains no email content. Reads are authoritative.
  try {
    await signalInboxChange(userId);
  } catch {
    console.warn(JSON.stringify({ event: 'inbox_signal_deferred' }));
  }
  const current = await db.user.findUnique({
    where: { id: userId },
    select: { workRequested: true, workNotBefore: true },
  });
  return {
    pending: current?.workRequested ?? false,
    retryAt: current?.workRequested ? current.workNotBefore.toISOString() : null,
  };
}
