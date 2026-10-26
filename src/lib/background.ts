import 'server-only';
import { db } from './db';
import { isDemo } from './env';
import { requestDailySync } from './work-queue';

/** Replaces the hosted queue: one in-process loop, safe because a self-hosted instance has one server. */
const TICK_MS = 30_000;
const SYNC_INTERVAL_MS = 2 * 60_000;
type State = { running: boolean; again: boolean; lastSync: number; timer?: NodeJS.Timeout };
const g = globalThis as unknown as { evailboxWorker?: State };
const state = (g.evailboxWorker ??= { running: false, again: false, lastSync: 0 });

export async function startBackgroundWork() {
  if (isDemo() || state.timer) return;
  // WAL lets inbox reads proceed while the worker writes; the mode persists in the file.
  // Awaited before any other query: switching modes needs the database to itself.
  await db.$queryRawUnsafe('PRAGMA journal_mode=WAL').catch(() => {
    console.warn(JSON.stringify({ event: 'sqlite_wal_unavailable' }));
  });
  if (state.timer) return;
  state.timer = setInterval(kickWork, TICK_MS);
  state.timer.unref?.();
  kickWork();
}

/** Called after user actions that request work; coalesces with a run already in progress. */
export function kickWork() {
  if (isDemo()) return;
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  void (async () => {
    try {
      do {
        state.again = false;
        await runOnce();
      } while (state.again);
    } catch {
      // Prisma/provider errors can embed private mail; log only the event.
      console.warn(JSON.stringify({ event: 'background_work_failed' }));
    } finally {
      state.running = false;
    }
  })();
}

async function runOnce() {
  if (Date.now() - state.lastSync >= SYNC_INTERVAL_MS) {
    state.lastSync = Date.now();
    await requestDailySync();
  }
  const { processInboxBatch, finishWorkBatch } = await import('./work-batch');
  const now = new Date();
  const users = await db.user.findMany({
    where: {
      workRequested: true,
      // Ingestion continues during an AI cooldown; classification defers itself.
      OR: [{ workNotBefore: { lte: now } }, { accounts: { some: { syncRequested: true } } }],
      AND: [{ OR: [{ workLeaseUntil: null }, { workLeaseUntil: { lt: now } }] }],
    },
    select: { id: true, workRevision: true },
  });
  for (const user of users) {
    // ponytail: bounded turns per tick; the next tick or kick continues a large backlog.
    for (let turn = 0; turn < 10; turn++) {
      const revision =
        turn === 0
          ? user.workRevision
          : (await db.user.findUnique({ where: { id: user.id }, select: { workRevision: true } }))
              ?.workRevision;
      if (revision === undefined) break;
      let batch;
      try {
        batch = await processInboxBatch(user.id);
      } catch {
        console.warn(JSON.stringify({ event: 'inbox_batch_failed' }));
        const failures = (
          await db.user.update({
            where: { id: user.id },
            data: { workFailures: { increment: 1 } },
            select: { workFailures: true },
          })
        ).workFailures;
        const retryAt = new Date(
          Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(failures - 1, 6)),
        );
        await db.user.updateMany({
          where: { id: user.id, workNotBefore: { lt: retryAt } },
          data: { workNotBefore: retryAt },
        });
        break;
      }
      const next = await finishWorkBatch(user.id, revision, batch.sync, batch.classification);
      if (!next.pending) break;
      // Keep importing while pages remain; otherwise wait for the stored retry time.
      if (!batch.sync.pending && next.retryAt && new Date(next.retryAt).getTime() > Date.now())
        break;
    }
  }
}
