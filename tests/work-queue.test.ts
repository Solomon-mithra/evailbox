import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  updateMany: vi.fn(),
  update: vi.fn(),
  find: vi.fn(),
  sync: vi.fn(),
  accountUpdate: vi.fn(),
  users: vi.fn(),
  count: vi.fn(),
}));
vi.mock('@/lib/db', () => {
  const db = {
    user: {
      updateMany: fixture.updateMany,
      update: fixture.update,
      findUniqueOrThrow: fixture.find,
      findMany: fixture.users,
      count: fixture.count,
    },
    emailAccount: { updateMany: fixture.accountUpdate },
    $transaction: async (operation: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) =>
      typeof operation === 'function' ? operation(db) : Promise.all(operation),
  };
  return { db };
});
vi.mock('@/lib/sync', () => ({ syncUser: fixture.sync }));
import {
  withUserWorkLease,
  processUserWork,
  requestWork,
  requestDailySync,
  processPendingWork,
} from '../src/lib/work-queue';
beforeEach(() => {
  vi.resetAllMocks();
  fixture.updateMany.mockResolvedValue({ count: 1 });
  fixture.find.mockResolvedValue({ workRevision: 7, workFailures: 0, workNotBefore: new Date(0) });
  fixture.sync.mockResolvedValue({ synced: 25, classified: 10, errors: 0, pending: false });
});
it('prevents manual work from bypassing a stored retry cooldown', async () => {
  fixture.updateMany.mockResolvedValueOnce({ count: 0 });
  fixture.find.mockResolvedValueOnce({ workNotBefore: new Date(Date.now() + 120000) });
  const run = vi.fn();
  await expect(withUserWorkLease('u', run)).rejects.toMatchObject({
    status: 429,
    code: 'WORK_COOLDOWN',
  });
  expect(run).not.toHaveBeenCalled();
  expect(fixture.updateMany.mock.calls[0][0].where.workNotBefore.lte).toBeInstanceOf(Date);
});

it('new manual and daily work requests preserve a stored cooldown', async () => {
  await requestWork('u');
  expect(fixture.update.mock.calls[0][0].data).not.toHaveProperty('workNotBefore');
  await requestDailySync();
  expect(fixture.updateMany.mock.calls[0][0].data).not.toHaveProperty('workNotBefore');
});

it('honors a provider retry delay longer than the normal worker backoff', async () => {
  fixture.sync.mockResolvedValue({
    synced: 0,
    classified: 0,
    errors: 1,
    pending: true,
    rateLimited: true,
    retryAfterSeconds: 300,
  });
  const start = Date.now();
  await processUserWork('u');
  const update = fixture.updateMany.mock.calls.find(([args]) => args.where.workRevision === 7)![0];
  expect(update.data.workNotBefore.getTime()).toBeGreaterThanOrEqual(start + 300000);
});
it('prevents overlapping workers from evaluating the same user', async () => {
  fixture.updateMany.mockResolvedValueOnce({ count: 0 });
  const run = vi.fn();
  await expect(withUserWorkLease('u', run)).rejects.toMatchObject({ code: 'WORK_IN_PROGRESS' });
  expect(run).not.toHaveBeenCalled();
});
it('clears completion only for the revision actually processed', async () => {
  await processUserWork('u');
  expect(
    fixture.updateMany.mock.calls.some(
      ([args]) => args.where.workRevision === 7 && args.data.workRequested === false,
    ),
  ).toBe(true);
});
it('keeps failed work durable and schedules backoff', async () => {
  fixture.sync.mockResolvedValue({ synced: 0, classified: 0, errors: 1, pending: true });
  await processUserWork('u');
  const update = fixture.updateMany.mock.calls.find(([args]) => args.where.workRevision === 7)![0];
  expect(update.data.workRequested).toBe(true);
  expect(update.data.workNotBefore.getTime()).toBeGreaterThan(Date.now() + 55000);
});
it('always releases its own lease even if work throws', async () => {
  fixture.sync.mockRejectedValueOnce(new Error('database offline'));
  await expect(processUserWork('u')).rejects.toThrow('database offline');
  const last = fixture.updateMany.mock.calls.at(-1)![0];
  expect(last.where.workLeaseId).toBeTypeOf('string');
  expect(last.data).toEqual({ workLeaseId: null, workLeaseUntil: null });
});

it('ends the scheduled pass after a shared-model rate limit instead of trying the next user', async () => {
  fixture.users.mockResolvedValue([{ id: 'u' }, { id: 'other' }]);
  fixture.count.mockResolvedValue(2);
  fixture.sync.mockResolvedValueOnce({
    synced: 0,
    classified: 0,
    errors: 1,
    pending: true,
    rateLimited: true,
    retryAfterSeconds: 60,
  });
  expect(await processPendingWork()).toMatchObject({ processed: 1, pendingUsers: 2 });
  expect(fixture.sync).toHaveBeenCalledTimes(1);
});
