import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), batch: vi.fn(), finish: vi.fn(), renew: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: (config: unknown, handler: unknown) => ({ config, handler }),
  },
}));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: m.find } } }));
vi.mock('@/lib/inngest/work', () => ({ processInboxBatch: m.batch, finishWorkBatch: m.finish }));
vi.mock('@/lib/work-queue', () => ({ requestDailySync: vi.fn() }));
vi.mock('@/lib/inngest/dispatch', () => ({ recoverPendingWork: vi.fn() }));
vi.mock('@/lib/mailbox-subscriptions', () => ({ renewMailboxSubscriptions: m.renew }));
import { processInboxWork } from '@/lib/inngest/functions';
import { inboxConcurrency } from '@/lib/inngest/config';
const fn = processInboxWork as unknown as {
  config: { concurrency: unknown[] };
  handler: (context: unknown) => Promise<unknown>;
};
const userId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  m.find.mockResolvedValue({ workRequested: true, workRevision: 4 });
  m.renew.mockResolvedValue({ pending: false });
  m.batch.mockResolvedValue({
    sync: { synced: 20, pending: true, errors: 0 },
    classification: { classified: 20, remaining: 0, errors: 0 },
  });
  m.finish.mockResolvedValue({ pending: true, retryAt: null });
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['100', 100],
  ['500', 100],
  ['0', 1],
  ['bad', 5],
])('bounds worker concurrency %s to %i', (value, expected) => {
  vi.stubEnv('INBOX_WORK_CONCURRENCY', value);
  expect(inboxConcurrency()).toBe(expected);
});
it('serializes users, uses one content-processing step, and queues reference-only continuations', async () => {
  expect(fn.config.concurrency[0]).toEqual({ limit: 1, key: 'event.data.userId' });
  const persisted: unknown[] = [];
  const step = {
    run: vi.fn(async (_name, operation) => {
      const result = await operation();
      persisted.push(result);
      return result;
    }),
    sleepUntil: vi.fn(),
    sendEvent: vi.fn(),
  };
  await fn.handler({ event: { data: { userId } }, step, runId: 'run-1' });
  expect(m.batch).toHaveBeenCalledExactlyOnceWith(userId);
  expect(step.run.mock.calls.map(([name]) => name)).toEqual([
    'read-work',
    'renew-mailbox-subscriptions',
    'import-and-tag-page',
    'save-progress-and-signal',
  ]);
  expect(step.sendEvent).toHaveBeenCalledWith('continue-backlog', {
    id: 'continue:run-1',
    name: 'evailbox/work.requested',
    data: { userId },
  });
  expect(JSON.stringify(persisted)).not.toMatch(/body|snippet|subject/);
});
it.each([true, false])(
  'imports continue during cooldown when sync pending is %s',
  async (pending) => {
    m.batch.mockResolvedValue({
      sync: { synced: 20, pending, errors: 0 },
      classification: { classified: 0, remaining: 20, errors: 0, retryAfterSeconds: 120 },
    });
    m.finish.mockResolvedValue({
      pending: true,
      retryAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const step = {
      run: vi.fn(async (_name, operation) => operation()),
      sleepUntil: vi.fn(),
      sendEvent: vi.fn(),
    };
    await fn.handler({ event: { data: { userId } }, step, runId: 'run-2' });
    expect(step.sleepUntil).toHaveBeenCalledTimes(pending ? 0 : 1);
    expect(step.sendEvent).toHaveBeenCalledOnce();
  },
);
