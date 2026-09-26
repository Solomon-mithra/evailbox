import 'server-only';
import { z } from 'zod';
import { inngest } from './client';
import { db } from '../db';
import { requestDailySync } from '../work-queue';
import { isDemo } from '../env';
import { renewMailboxSubscriptions } from '../mailbox-subscriptions';
import { recoverPendingWork } from './dispatch';
import { processInboxBatch, finishWorkBatch } from './work';
import { inboxConcurrency } from './config';

export const processInboxWork = inngest.createFunction(
  {
    id: 'process-inbox-work',
    triggers: { event: 'evailbox/work.requested' },
    concurrency: [{ limit: 1, key: 'event.data.userId' }, { limit: inboxConcurrency() }],
    retries: 4,
  },
  async ({ event, step, runId }) => {
    if (isDemo()) return { skipped: true };
    const { userId } = z.object({ userId: z.uuid() }).parse(event.data);
    const state = await step.run('read-work', () =>
      db.user.findUnique({
        where: { id: userId },
        select: { workRequested: true, workRevision: true, workNotBefore: true },
      }),
    );
    if (!state?.workRequested) return { skipped: true };
    await step.run('renew-mailbox-subscriptions', () =>
      renewMailboxSubscriptions({ userId, deadline: Date.now() + 40000 }),
    );
    // Fetch, save metadata, signal readers and classify in ONE step. Bodies stay local.
    // During an AI cooldown imports still advance; classification returns deferred work.
    const { sync, classification } = await step.run('import-and-tag-page', () =>
      processInboxBatch(userId),
    );
    const next = await step.run('save-progress-and-signal', () =>
      finishWorkBatch(userId, state.workRevision, sync, classification),
    );
    if (next.pending) {
      if (
        (!sync.pending || sync.errors > 0) &&
        next.retryAt &&
        new Date(next.retryAt).getTime() > Date.now()
      )
        await step.sleepUntil('wait-before-continuation', new Date(next.retryAt));
      await step.sendEvent('continue-backlog', {
        id: `continue:${runId}`,
        name: 'evailbox/work.requested',
        data: { userId },
      });
    }
    return { synced: sync.synced, classified: classification.classified, pending: next.pending };
  },
);

export const recoverWork = inngest.createFunction(
  { id: 'recover-pending-inbox-work', triggers: { cron: '* * * * *' }, concurrency: 1 },
  async ({ step }) => step.run('publish-durable-backlog', () => recoverPendingWork()),
);

export const recoverMailboxChanges = inngest.createFunction(
  { id: 'recover-missed-mailbox-changes', triggers: { cron: '*/15 * * * *' }, concurrency: 1 },
  async ({ step }) => {
    if (isDemo()) return { skipped: true };
    await step.run('request-incremental-sync', () => requestDailySync());
    return step.run('dispatch-incremental-sync', () => recoverPendingWork());
  },
);

export const renewSubscriptions = inngest.createFunction(
  {
    id: 'renew-mailbox-subscriptions',
    triggers: [{ cron: '0 * * * *' }, { event: 'evailbox/subscriptions.renew' }],
    concurrency: 1,
    retries: 4,
  },
  async ({ step, runId }) => {
    if (isDemo()) return { skipped: true };
    const result = await step.run('renew-due-subscriptions', () =>
      renewMailboxSubscriptions({ deadline: Date.now() + 40000 }),
    );
    if (result.pending) {
      await step.sleep('yield-between-batches', '30s');
      await step.sendEvent('continue-renewals', {
        id: `renew:${runId}`,
        name: 'evailbox/subscriptions.renew',
        data: {},
      });
    }
    return result;
  },
);
export const functions = [processInboxWork, recoverWork, recoverMailboxChanges, renewSubscriptions];
