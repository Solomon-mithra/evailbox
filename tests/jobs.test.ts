import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  request: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  sync: vi.fn(),
  classify: vi.fn(),
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
vi.mock('@/lib/sync', () => ({ syncMailboxes: m.sync }));
vi.mock('@/lib/classification', () => ({ classifyEmails: m.classify }));
import {
  fetchWorkBatch,
  classifyWorkBatch,
  finishWorkBatch,
  processInboxBatch,
} from '@/lib/work-batch';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  m.find.mockResolvedValue({
    id: 'u',
    workRevision: 7,
    workRequested: true,
    workFailures: 0,
    workNotBefore: new Date(0),
  });
  m.update.mockResolvedValue({ count: 1 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
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
it('shares transient bodies inside one bounded turn', async () => {
  let bodies: Map<string, unknown>;
  m.sync.mockImplementation(async (_user, _account, _deadline, options) => {
    expect(options.maxPages).toBe(1);
    bodies = options.bodies;
    bodies.set('mail', { body: 'PRIVATE', contentHash: 'hash' });
    return { synced: 20, errors: 0, pending: true };
  });
  m.classify.mockImplementation(async (_user, options) => {
    expect(options.bodies).toBe(bodies);
    expect(options.limit).toBe(20);
    return { classified: 20, errors: 0, remaining: 0 };
  });
  const result = await processInboxBatch('u');
  expect(result.sync.synced).toBe(20);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(bodies!.size).toBe(0);
});

it('continues importing while inference is cooling down', async () => {
  const { ApiError } = await import('@/lib/errors');
  m.sync.mockResolvedValue({ synced: 20, errors: 0, pending: true });
  m.classify.mockRejectedValue(new ApiError(429, 'WORK_COOLDOWN', 'paused'));
  const result = await processInboxBatch('u');
  expect(result.sync.synced).toBe(20);
  expect(result.classification).toMatchObject({
    classified: 0,
    remaining: 1,
  });
});

it('does not slide an existing cooldown forward when queued workers arrive early', async () => {
  vi.useFakeTimers();
  const start = Date.parse('2026-09-27T00:00:00Z');
  const originalRetry = new Date(start + 60_000);
  m.find.mockResolvedValue({
    id: 'u',
    workRevision: 7,
    workRequested: true,
    workFailures: 0,
    workNotBefore: originalRetry,
  });
  const { ApiError } = await import('@/lib/errors');
  m.sync.mockResolvedValue({ synced: 0, errors: 0, pending: false });
  m.classify.mockRejectedValue(new ApiError(429, 'WORK_COOLDOWN', 'paused'));
  for (const elapsed of [20_000, 40_000, 59_000]) {
    vi.setSystemTime(start + elapsed);
    const { sync, classification } = await processInboxBatch('u');
    await finishWorkBatch('u', 7, sync, classification);
    expect(m.update.mock.calls.at(-1)![0].data.workNotBefore).toEqual(originalRetry);
  }
});

it('still backs off while another worker holds the processing lease', async () => {
  const { ApiError } = await import('@/lib/errors');
  m.sync.mockResolvedValue({ synced: 0, errors: 0, pending: false });
  m.classify.mockRejectedValue(new ApiError(409, 'WORK_IN_PROGRESS', 'busy'));
  expect((await processInboxBatch('u')).classification.retryAfterSeconds).toBe(60);
});

it('discards transient bodies and sanitizes errors when classification crashes after import', async () => {
  let bodies: Map<string, unknown>;
  m.sync.mockImplementation(async (_user, _account, _deadline, options) => {
    bodies = options.bodies;
    bodies.set('mail', { body: 'PRIVATE BODY', contentHash: 'hash' });
    return { synced: 20, errors: 0, pending: false };
  });
  m.classify.mockRejectedValue(new Error('PRIVATE BODY in upstream response'));
  await expect(processInboxBatch('u')).rejects.toThrow('Inbox batch could not complete');
  expect(bodies!.size).toBe(0);
});
