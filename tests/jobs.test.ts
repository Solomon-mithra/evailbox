import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  request: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  send: vi.fn(),
  sync: vi.fn(),
  classify: vi.fn(),
  signal: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: m.find,
      updateMany: m.update,
      findMany: m.list,
    },
  },
}));
vi.mock('@/lib/work-queue', () => ({
  requestWork: m.request,
  withUserWorkLease: (_id: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@/lib/inngest/client', async (original) => ({
  ...(await original<typeof import('../src/lib/inngest/client')>()),
  inngest: { send: m.send },
}));
vi.mock('@/lib/sync', () => ({ syncMailboxes: m.sync }));
vi.mock('@/lib/classification', () => ({ classifyEmails: m.classify }));
vi.mock('@/lib/realtime', () => ({ signalInboxChange: m.signal }));
import { enqueueUserWork, recoverPendingWork } from '@/lib/inngest/dispatch';
import { fetchWorkBatch, classifyWorkBatch, finishWorkBatch } from '@/lib/inngest/work';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('INNGEST_EVENT_KEY', 'test-key');
  vi.stubEnv('INNGEST_SIGNING_KEY', 'test-signing-key');
  vi.stubEnv('INNGEST_DEV', '');
  m.find.mockResolvedValue({
    id: 'u',
    workRevision: 7,
    workRequested: true,
    workFailures: 0,
    workNotBefore: new Date(0),
  });
  m.update.mockResolvedValue({ count: 1 });
  m.send.mockResolvedValue({ ids: ['event'] });
  m.signal.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

it('durably requests work before publishing and never processes inline', async () => {
  const result = await enqueueUserWork('u', { sync: true, workspace: 'WORK' });
  expect(result).toEqual({ queued: true, pending: true, workerAvailable: true });
  expect(m.request.mock.invocationCallOrder[0]).toBeLessThan(m.send.mock.invocationCallOrder[0]);
  expect(m.sync).not.toHaveBeenCalled();
  expect(m.classify).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'work:u:7',
      name: 'evailbox/work.requested',
      data: { userId: 'u' },
    }),
  );
});
it('keeps durable work recoverable when dispatch is unavailable', async () => {
  m.send.mockRejectedValue(new Error('private upstream detail'));
  expect(await enqueueUserWork('u')).toMatchObject({ queued: true, workerAvailable: false });
  expect(m.request).toHaveBeenCalledOnce();
  expect(m.update).not.toHaveBeenCalled();
});
it('does not pretend a missing worker is connected', async () => {
  vi.stubEnv('INNGEST_EVENT_KEY', '');
  vi.stubEnv('INNGEST_DEV', '');
  expect(await enqueueUserWork('u')).toMatchObject({ workerAvailable: false });
  expect(m.send).not.toHaveBeenCalled();
});
it('fetch and inference are independently resumable', async () => {
  m.sync.mockResolvedValue({ synced: 25, errors: 0, pending: false });
  await fetchWorkBatch('u');
  expect(m.classify).not.toHaveBeenCalled();
  m.classify.mockResolvedValue({ classified: 25, errors: 0, remaining: 0 });
  await classifyWorkBatch('u');
  expect(m.sync).toHaveBeenCalledOnce();
  expect(m.classify).toHaveBeenCalledOnce();
});
it('completion cannot clear a newer work revision or shorten a cooldown', async () => {
  const future = new Date(Date.now() + 600_000);
  m.find.mockResolvedValue({
    id: 'u',
    workRevision: 8,
    workRequested: true,
    workFailures: 0,
    workNotBefore: future,
  });
  await finishWorkBatch(
    'u',
    7,
    { synced: 25, errors: 0, pending: false },
    { classified: 25, errors: 0, remaining: 0 },
  );
  const args = m.update.mock.calls[0][0];
  expect(args.where.workRevision).toBe(7);
  expect(args.data.workNotBefore.getTime()).toBeGreaterThanOrEqual(future.getTime());
});
it('failed processing remains requested with backoff', async () => {
  await finishWorkBatch(
    'u',
    7,
    { synced: 0, errors: 1, pending: true },
    { classified: 0, errors: 0, remaining: 0 },
  );
  const args = m.update.mock.calls[0][0];
  expect(args.data.workRequested).toBe(true);
  expect(args.data.workNotBefore.getTime()).toBeGreaterThan(Date.now() + 55_000);
});
it('recovery publishes references only and preserves flags on publication errors', async () => {
  m.list.mockResolvedValue([{ id: 'u', workRevision: 7 }]);
  m.send.mockRejectedValue(new Error('offline'));
  const result = await recoverPendingWork();
  expect(result).toMatchObject({ dispatched: 0, errors: 1 });
  expect(m.update).not.toHaveBeenCalled();
});

it('does not claim the worker is available with only an event key', async () => {
  vi.stubEnv('INNGEST_SIGNING_KEY', '');
  expect(await enqueueUserWork('u')).toMatchObject({ queued: true, workerAvailable: false });
  expect(m.request).toHaveBeenCalledOnce();
  expect(m.send).not.toHaveBeenCalled();
});
it('recovery can publish mailbox ingestion during an inference cooldown without changing that cooldown', async () => {
  m.list.mockResolvedValue([{ id: 'u', workRevision: 7 }]);
  await recoverPendingWork();
  const where = m.list.mock.calls[0][0].where;
  expect(where.workNotBefore).toBeUndefined();
  expect(where.AND).toEqual(
    expect.arrayContaining([
      {
        OR: [
          { workNotBefore: { lte: expect.any(Date) } },
          { accounts: { some: { syncRequested: true } } },
        ],
      },
    ]),
  );
  expect(m.send).toHaveBeenCalledWith([expect.objectContaining({ data: { userId: 'u' } })]);
  expect(m.update).not.toHaveBeenCalled();
});
