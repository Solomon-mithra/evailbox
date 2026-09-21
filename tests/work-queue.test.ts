import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  updateMany: vi.fn(),
  update: vi.fn(),
  find: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    user: {
      updateMany: fixture.updateMany,
      update: fixture.update,
      findUniqueOrThrow: fixture.find,
    },
  },
}));
vi.mock('@/lib/sync', () => ({ syncUser: fixture.sync }));
import { withUserWorkLease, processUserWork } from '../src/lib/work-queue';
beforeEach(() => {
  vi.resetAllMocks();
  fixture.updateMany.mockResolvedValue({ count: 1 });
  fixture.find.mockResolvedValue({ workRevision: 7, workFailures: 0 });
  fixture.sync.mockResolvedValue({ synced: 25, classified: 10, errors: 0, pending: false });
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
