import { beforeEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  fetch: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  accountUpdate: vi.fn(),
  account: {
    id: 'a',
    userId: 'u',
    provider: 'GMAIL',
    accessToken: 'encrypted',
    refreshToken: null,
    expiresAt: new Date('2099-01-01'),
    cursor: 'old',
    rescanStartedAt: null,
    syncRevision: 3,
  },
}));
vi.mock('@/lib/db', () => {
  const tx = {
    $queryRaw: async () => [{ observedAt: new Date() }],
    email: { upsert: fixture.upsert, deleteMany: fixture.deleteMany },
    emailAccount: { update: fixture.accountUpdate, updateMany: fixture.accountUpdate },
  };
  return {
    db: {
      emailAccount: {
        findMany: async () => [fixture.account],
        findUniqueOrThrow: async () => fixture.account,
        updateMany: async () => ({ count: 1 }),
        count: async () => 0,
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock('@/lib/crypto', () => ({ decrypt: () => 'token', encrypt: (value: string) => value }));
vi.mock('@/lib/providers', () => ({ fetchEmailPage: fixture.fetch, refreshAccessToken: vi.fn() }));
vi.mock('@/lib/classification', () => ({
  classifyEmails: async () => ({ classified: 0, errors: 0, remaining: 0 }),
}));
vi.mock('@/lib/notifications', () => ({ notifyUser: vi.fn() }));
import { syncUser } from '../src/lib/sync';
beforeEach(() => vi.clearAllMocks());
it('resets an expired cursor by updating existing mail and only sweeps unseen rows after the full rescan', async () => {
  fixture.fetch
    .mockResolvedValueOnce({
      reset: true,
      hasMore: true,
      cursor: 'page-2',
      messages: [
        {
          providerMessageId: 'p1',
          subject: 'Existing',
          sender: 'a@example.com',
          senderName: 'A',
          snippet: 'sample',
          body: null,
          receivedAt: new Date(),
          isRead: false,
          webUrl: 'https://mail.google.com',
        },
      ],
    })
    .mockResolvedValueOnce({ hasMore: false, cursor: 'new-history', messages: [] });
  await syncUser('u');
  const update = fixture.upsert.mock.calls[0][0];
  expect(update.where.accountId_providerMessageId).toEqual({
    accountId: 'a',
    providerMessageId: 'p1',
  });
  expect(update.update.handled).toBeUndefined();
  expect(update.create.lastSeenAt).toBe(update.update.lastSeenAt);
  expect(update.update.classifications).toBeUndefined();
  expect(fixture.deleteMany).toHaveBeenCalledTimes(1);
  expect(fixture.deleteMany.mock.calls[0][0].where.lastSeenAt.lt).toBeInstanceOf(Date);
  expect(fixture.accountUpdate.mock.calls[0][0].data.rescanStartedAt).toBeInstanceOf(Date);
  expect(fixture.accountUpdate.mock.calls[2][0].data.rescanStartedAt).toBeNull();
});

it('clears a sync request only if its account revision still matches', async () => {
  fixture.fetch.mockResolvedValueOnce({ hasMore: false, cursor: 'latest', messages: [] });
  await syncUser('u');
  const clear = fixture.accountUpdate.mock.calls.find(
    ([args]) => args.data.syncRequested === false,
  )![0];
  expect(clear.where.syncRevision).toBe(3);
  expect(clear.where.syncLeaseId).toBeTypeOf('string');
});
