import { afterEach, beforeEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  fetch: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  retainDraft: vi.fn(),
  accountUpdate: vi.fn(),
  classify: vi.fn(),
  saveDurationMs: 0,
  transactionOptions: vi.fn(),
  pendingAccounts: vi.fn(),
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
    email: {
      upsert: fixture.upsert,
      deleteMany: fixture.deleteMany,
      updateMany: fixture.retainDraft,
    },
    emailAccount: { update: fixture.accountUpdate, updateMany: fixture.accountUpdate },
  };
  return {
    db: {
      emailAccount: {
        findMany: async () => [fixture.account],
        findUniqueOrThrow: async () => fixture.account,
        updateMany: async () => ({ count: 1 }),
        count: fixture.pendingAccounts,
      },
      $transaction: async (
        fn: (t: typeof tx) => Promise<unknown>,
        options?: { timeout?: number; maxWait?: number },
      ) => {
        fixture.transactionOptions(options);
        if (fixture.saveDurationMs > (options?.timeout ?? 5000))
          throw Object.assign(new Error('Transaction already closed'), { code: 'P2028' });
        return fn(tx);
      },
    },
  };
});
vi.mock('@/lib/crypto', () => ({ decrypt: () => 'token', encrypt: (value: string) => value }));
vi.mock('@/lib/providers', () => ({ fetchEmailPage: fixture.fetch, refreshAccessToken: vi.fn() }));
vi.mock('@/lib/classification', () => ({
  classifyEmails: fixture.classify,
}));
import { syncMailboxes, syncUser } from '../src/lib/sync';
beforeEach(() => {
  vi.clearAllMocks();
  fixture.saveDurationMs = 0;
  fixture.pendingAccounts.mockResolvedValue(0);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fixture.classify.mockResolvedValue({ classified: 0, errors: 0, remaining: 0 });
});
afterEach(() => vi.restoreAllMocks());
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

it('passes a classification cooldown back to the worker scheduler', async () => {
  fixture.fetch.mockResolvedValueOnce({ hasMore: false, cursor: 'latest', messages: [] });
  fixture.classify.mockResolvedValueOnce({
    classified: 4,
    errors: 1,
    remaining: 20,
    rateLimited: true,
    retryAfterSeconds: 300,
  });
  expect(await syncUser('u')).toMatchObject({
    classified: 4,
    errors: 1,
    pending: true,
    rateLimited: true,
    retryAfterSeconds: 300,
  });
});

it('saves a provider page that takes longer than Prisma’s default five-second transaction', async () => {
  fixture.saveDurationMs = 6000;
  fixture.fetch.mockResolvedValueOnce({
    hasMore: false,
    cursor: 'after-page',
    messages: [
      {
        providerMessageId: 'm1',
        subject: 'Fixture',
        sender: 'test@example.com',
        senderName: '',
        snippet: '',
        body: null,
        receivedAt: new Date(),
        isRead: true,
        webUrl: 'https://mail.google.com',
      },
    ],
  });
  expect(await syncUser('u')).toMatchObject({ synced: 1, errors: 0 });
  expect(fixture.accountUpdate.mock.calls.some(([args]) => args.data.cursor === 'after-page')).toBe(
    true,
  );
});

it('leaves the cursor pending when fetching a page consumes the remaining save budget', async () => {
  fixture.pendingAccounts.mockResolvedValue(1);
  const start = Date.now();
  const now = vi.spyOn(Date, 'now').mockReturnValue(start);
  fixture.fetch.mockImplementationOnce(async () => {
    now.mockReturnValue(start + 44500);
    return { hasMore: true, cursor: 'must-not-advance', messages: [] };
  });
  expect(await syncUser('u', undefined, start + 45000)).toMatchObject({ pending: true });
  expect(fixture.transactionOptions).not.toHaveBeenCalled();
  expect(fixture.accountUpdate).not.toHaveBeenCalled();
});

it('keeps connection wait plus transaction timeout within the shared worker deadline', async () => {
  const start = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(start);
  fixture.fetch.mockResolvedValueOnce({ hasMore: false, cursor: 'next', messages: [] });
  await syncUser('u', undefined, start + 10000);
  const options = fixture.transactionOptions.mock.calls[0][0];
  expect(options).toBeDefined();
  expect(options.timeout + options.maxWait).toBeLessThanOrEqual(9000);
});

it('can resume mailbox imports without invoking AI classification', async () => {
  fixture.fetch.mockResolvedValueOnce({ hasMore: false, cursor: 'next', messages: [] });
  expect(await syncMailboxes('u')).toMatchObject({ synced: 0, errors: 0, pending: false });
  expect(fixture.classify).not.toHaveBeenCalled();
});

it('hashes the actual bounded classification input when importing messages', async () => {
  const message = {
    providerMessageId: 'p1',
    subject: 'Hello',
    sender: 'a@example.com',
    senderName: 'A',
    snippet: 'Short',
    body: 'content',
    receivedAt: new Date(),
    isRead: false,
    webUrl: 'https://mail.google.com',
  };
  fixture.fetch.mockResolvedValueOnce({ hasMore: false, cursor: 'next', messages: [message] });
  await syncMailboxes('u');
  const { emailContentHash } = await import('../src/lib/classification-version');
  const row = fixture.upsert.mock.calls[0][0];
  expect(row.create.contentHash).toBe(emailContentHash(message));
  expect(row.update.contentHash).toBe(row.create.contentHash);
  expect(row.update.inInbox).toBe(true);
});
it('retains disappeared messages with reply drafts but removes other message rows', async () => {
  fixture.fetch.mockResolvedValueOnce({
    hasMore: false,
    cursor: 'next',
    messages: [],
    deletedIds: ['gone'],
  });
  await syncMailboxes('u');
  expect(fixture.retainDraft).toHaveBeenCalledWith({
    where: {
      userId: 'u',
      accountId: 'a',
      providerMessageId: { in: ['gone'] },
      replyDraft: { isNot: null },
    },
    data: { inInbox: false },
  });
  expect(fixture.deleteMany).toHaveBeenCalledWith({
    where: {
      userId: 'u',
      accountId: 'a',
      providerMessageId: { in: ['gone'] },
      replyDraft: { is: null },
    },
  });
});
it('stores the content hash of the full message but never persists its body', async () => {
  const message = {
    providerMessageId: 'p2',
    subject: 'Offer',
    sender: 'hr@example.com',
    senderName: 'HR',
    snippet: 'Preview',
    body: 'PRIVATE FULL BODY',
    receivedAt: new Date(),
    isRead: false,
    webUrl: 'https://mail.google.com',
  };
  fixture.fetch.mockResolvedValueOnce({ hasMore: false, cursor: 'next', messages: [message] });
  await syncMailboxes('u');
  const { emailContentHash } = await import('../src/lib/classification-version');
  const row = fixture.upsert.mock.calls[0][0];
  expect(row.create.contentHash).toBe(emailContentHash(message));
  expect(row.create).not.toHaveProperty('body');
  expect(row.update).not.toHaveProperty('body');
  expect(JSON.stringify(row)).not.toContain('PRIVATE FULL BODY');
});
