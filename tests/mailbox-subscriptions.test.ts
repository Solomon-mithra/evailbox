import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  accounts: vi.fn(),
  account: vi.fn(),
  count: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  find: vi.fn(),
  credentials: vi.fn(),
  fetch: vi.fn(),
  peers: vi.fn(),
  subscriberCount: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    emailAccount: { findMany: fixture.accounts, findFirst: fixture.account, count: fixture.count },
    mailboxSubscription: {
      upsert: fixture.upsert,
      updateMany: fixture.update,
      findUnique: fixture.find,
      findMany: fixture.peers,
      count: fixture.subscriberCount,
    },
  },
}));
vi.mock('@/lib/providers/credentials', () => ({ withAccountCredentials: fixture.credentials }));
import {
  cleanupMailboxSubscription,
  renewMailboxSubscriptions,
  requestMailboxSubscriptionRenewal,
} from '../src/lib/mailbox-subscriptions';
import { decrypt, encrypt } from '../src/lib/crypto';
const account = {
  id: 'account1',
  userId: 'user1',
  workspace: 'WORK',
  provider: 'GMAIL',
  email: 'one@example.com',
};
let subscription: Record<string, unknown>;
const graphReply = () => ({
  id: 'graph-sub',
  resource: "/me/mailFolders('inbox')/messages",
  expirationDateTime: new Date(Date.now() + 6 * 86400000).toISOString(),
});
function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('ENCRYPTION_SECRET_KEY', 'a'.repeat(64));
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/p/topics/gmail');
  vi.stubEnv('GMAIL_PUBSUB_SUBSCRIPTION', 'projects/p/subscriptions/gmail');
  vi.stubEnv('GMAIL_PUBSUB_AUDIENCE', 'https://app.example/api/webhooks/gmail');
  vi.stubEnv('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL', 'push@p.iam.gserviceaccount.com');
  vi.stubEnv('OUTLOOK_WEBHOOK_URL', 'https://app.example/api/webhooks/outlook');
  vi.stubGlobal('fetch', fixture.fetch);
  subscription = {
    accountId: 'account1',
    userId: 'user1',
    workspace: 'WORK',
    provider: 'GMAIL',
    providerSubscriptionId: null,
    resource: null,
    providerMailboxId: null,
    clientState: null,
    expiresAt: null,
    watchHistoryId: null,
    status: 'pending',
    renewalRequested: true,
    renewalRevision: 3,
    renewalLeaseId: null,
    renewalLeaseUntil: null,
    retryAt: new Date(0),
  };
  fixture.accounts.mockResolvedValue([{ ...account, mailboxSubscription: null }]);
  fixture.account.mockResolvedValue(account);
  fixture.upsert.mockImplementation(async () => subscription);
  fixture.find.mockImplementation(async () => subscription);
  fixture.update.mockImplementation(async ({ data }) => {
    Object.assign(
      subscription,
      Object.fromEntries(
        Object.entries(data).filter(
          ([, v]) => typeof v !== 'object' || v === null || v instanceof Date,
        ),
      ),
    );
    return { count: 1 };
  });
  fixture.count.mockResolvedValue(0);
  fixture.peers.mockResolvedValue([]);
  fixture.subscriberCount.mockResolvedValue(0);
  fixture.credentials.mockImplementation(async (_u, _w, _a, op) =>
    op(account, 'provider-secret-token'),
  );
  fixture.fetch.mockResolvedValue(
    response({ historyId: '777', expiration: String(Date.now() + 7 * 86400000) }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('creates an INBOX-only Gmail watch under leases without advancing ingestion checkpoints', async () => {
  expect(await renewMailboxSubscriptions()).toMatchObject({
    renewed: 1,
    errors: 0,
    unconfigured: 0,
  });
  const [url, init] = fixture.fetch.mock.calls[0];
  expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/watch');
  expect(JSON.parse(init.body)).toEqual({
    topicName: 'projects/p/topics/gmail',
    labelIds: ['INBOX'],
    labelFilterBehavior: 'include',
  });
  expect(fixture.credentials.mock.calls[0].slice(0, 3)).toEqual(['user1', 'WORK', 'account1']);
  expect(fixture.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ watchHistoryId: '777', status: 'active' }),
    }),
  );
  expect(JSON.stringify(fixture.update.mock.calls)).not.toContain('"cursor"');
  expect(
    JSON.stringify(await renewMailboxSubscriptions({ deadline: Date.now() - 1 })),
  ).not.toContain('provider-secret-token');
});
it('does not contact providers when event delivery is not configured', async () => {
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', '');
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 0, unconfigured: 1 });
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.credentials).not.toHaveBeenCalled();
  expect(fixture.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'unconfigured', lastError: expect.any(String) }),
    }),
  );
});
it('honors a bounded batch and deadline, excluding leased accounts in the selection', async () => {
  await renewMailboxSubscriptions({ limit: 3 });
  expect(fixture.accounts.mock.calls[0][0]).toMatchObject({
    take: 3,
    where: { OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: expect.any(Date) } }] },
  });
  fixture.fetch.mockClear();
  await renewMailboxSubscriptions({ deadline: Date.now() - 1 });
  expect(fixture.fetch).not.toHaveBeenCalled();
});
it('does not create a duplicate provider subscription when its renewal lease is already taken', async () => {
  fixture.update.mockResolvedValueOnce({ count: 0 });
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 0, pending: true });
  expect(fixture.fetch).not.toHaveBeenCalled();
});
it('backs off failed renewals so a failing first batch cannot starve other accounts', async () => {
  fixture.fetch.mockRejectedValueOnce(new Error('network details with provider-secret-token'));
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 0, errors: 1 });
  const failure = fixture.update.mock.calls.find(([arg]) => arg.data.status === 'error')![0];
  expect(failure.data.retryAt.getTime()).toBeGreaterThan(Date.now());
  expect(failure.data.lastError).not.toContain('provider-secret-token');
  expect(fixture.accounts.mock.calls[0][0].where.AND).toEqual(
    expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]),
  );
});
it('uses a revision guard so a lifecycle wake during renewal remains pending', async () => {
  await renewMailboxSubscriptions();
  const clear = fixture.update.mock.calls.find(([arg]) => arg.data.renewalRequested === false)![0];
  expect(clear.where.renewalRevision).toBe(3);
});
function outlook() {
  Object.assign(subscription, { provider: 'OUTLOOK' });
  fixture.accounts.mockResolvedValue([
    { ...account, provider: 'OUTLOOK', mailboxSubscription: subscription },
  ]);
  fixture.credentials.mockImplementation(async (_u, _w, _a, op) =>
    op({ ...account, provider: 'OUTLOOK' }, 'provider-secret-token'),
  );
}
it('creates Graph inbox subscriptions with private encrypted state and HTTPS lifecycle callbacks', async () => {
  outlook();
  fixture.fetch
    .mockResolvedValueOnce(response({ id: 'mailbox-id' }))
    .mockResolvedValueOnce(response({ value: [] }))
    .mockResolvedValueOnce(response(graphReply(), 201));
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 1, errors: 0 });
  const [url, init] = fixture.fetch.mock.calls.at(-1)!;
  expect(url).toBe('https://graph.microsoft.com/v1.0/subscriptions');
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({
    changeType: 'created,updated,deleted',
    resource: "/me/mailFolders('inbox')/messages",
    notificationUrl: 'https://app.example/api/webhooks/outlook',
    lifecycleNotificationUrl: 'https://app.example/api/webhooks/outlook',
  });
  expect(body.clientState.length).toBeGreaterThanOrEqual(32);
  const stateWrite = fixture.update.mock.calls.find(([arg]) => arg.data.clientState)![0];
  expect(stateWrite.data.clientState).not.toBe(body.clientState);
  expect(decrypt(stateWrite.data.clientState)).toBe(body.clientState);
  expect(fixture.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        providerMailboxId: 'mailbox-id',
        providerSubscriptionId: 'graph-sub',
      }),
    }),
  );
});
it('renews and reauthorizes an existing Graph subscription with one PATCH', async () => {
  outlook();
  Object.assign(subscription, {
    providerSubscriptionId: 'old-sub',
    expiresAt: new Date(Date.now() + 3600000),
    clientState: encrypt('existing-state'),
    providerMailboxId: 'mailbox-id',
    resource: "/me/mailFolders('inbox')/messages",
  });
  fixture.fetch.mockResolvedValueOnce(response({ ...graphReply(), id: 'old-sub' }));
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 1 });
  expect(fixture.fetch).toHaveBeenCalledTimes(1);
  expect(fixture.fetch.mock.calls[0][0]).toBe(
    'https://graph.microsoft.com/v1.0/subscriptions/old-sub',
  );
  expect(fixture.fetch.mock.calls[0][1].method).toBe('PATCH');
});
it('recreates a missing Graph subscription after a 404 renewal response', async () => {
  outlook();
  Object.assign(subscription, {
    providerSubscriptionId: 'old-sub',
    expiresAt: new Date(Date.now() + 3600000),
    clientState: encrypt('existing-state'),
    providerMailboxId: 'mailbox-id',
    resource: "/me/mailFolders('inbox')/messages",
  });
  fixture.fetch
    .mockResolvedValueOnce(response({}, 404))
    .mockResolvedValueOnce(response({ value: [] }))
    .mockResolvedValueOnce(response(graphReply(), 201));
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 1 });
  expect(fixture.fetch.mock.calls.at(-1)![1].method).toBe('POST');
});
it('recovers a Graph create whose provider success was lost before database commit', async () => {
  outlook();
  Object.assign(subscription, {
    clientState: encrypt('persisted-state'),
    providerMailboxId: 'mailbox-id',
    resource: "/me/mailFolders('inbox')/messages",
  });
  fixture.fetch.mockResolvedValueOnce(
    response({
      value: [
        {
          ...graphReply(),
          clientState: 'persisted-state',
          notificationUrl: 'https://app.example/api/webhooks/outlook',
          lifecycleNotificationUrl: 'https://app.example/api/webhooks/outlook',
        },
      ],
    }),
  );
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 1 });
  expect(fixture.fetch).toHaveBeenCalledTimes(1);
  expect(fixture.fetch.mock.calls[0][1].method).toBe('GET');
});
it('does not stop a Gmail watch while another account shares the same mailbox', async () => {
  fixture.count.mockResolvedValue(1);
  expect(await cleanupMailboxSubscription('user1', 'account1')).toMatchObject({ skipped: true });
  expect(fixture.fetch).not.toHaveBeenCalled();
});
it('stops the final Gmail watch and accepts empty 204 responses', async () => {
  fixture.fetch.mockResolvedValueOnce(response(null, 204));
  expect(await cleanupMailboxSubscription('user1', 'account1')).toMatchObject({ cleaned: true });
  expect(fixture.fetch.mock.calls[0][0]).toBe(
    'https://gmail.googleapis.com/gmail/v1/users/me/stop',
  );
});
it('deletes Graph subscriptions on disconnect without exposing provider errors', async () => {
  fixture.account.mockResolvedValue({ ...account, provider: 'OUTLOOK' });
  Object.assign(subscription, { provider: 'OUTLOOK', providerSubscriptionId: 'old-sub' });
  fixture.fetch.mockRejectedValueOnce(new Error('provider-secret-token'));
  const result = await cleanupMailboxSubscription('user1', 'account1');
  expect(result).toMatchObject({ cleaned: false });
  expect(JSON.stringify(result)).not.toContain('provider-secret-token');
  expect(fixture.fetch.mock.calls[0][1].method).toBe('DELETE');
});
it('creates durable renewal requests scoped to the account owner and workspace', async () => {
  await requestMailboxSubscriptionRenewal('user1', 'account1', 'WORK');
  expect(fixture.accounts).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'user1', id: 'account1', workspace: 'WORK' } }),
  );
  expect(fixture.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { accountId: 'account1' },
      update: expect.objectContaining({
        renewalRequested: true,
        renewalRevision: { increment: 1 },
      }),
    }),
  );
});

it('accepts Graph canonical inbox resources with an omitted leading slash', async () => {
  outlook();
  fixture.fetch
    .mockResolvedValueOnce(response({ id: 'mailbox-id' }))
    .mockResolvedValueOnce(response({ value: [] }))
    .mockResolvedValueOnce(
      response({ ...graphReply(), resource: "me/mailFolders('Inbox')/messages" }, 201),
    );
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 1, errors: 0 });
});

it('shares Graph id and private state only between verified copies of the same mailbox', async () => {
  outlook();
  Object.assign(subscription, { providerMailboxId: 'mailbox-id' });
  fixture.peers.mockResolvedValue([
    {
      accountId: 'sibling-account',
      providerSubscriptionId: 'shared-id',
      clientState: encrypt('shared-secret'),
      expiresAt: new Date(Date.now() + 3600000),
    },
  ]);
  fixture.fetch.mockResolvedValueOnce(response({ ...graphReply(), id: 'shared-id' }));
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 1 });
  expect(fixture.peers).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        provider: 'OUTLOOK',
        providerMailboxId: 'mailbox-id',
        account: { email: 'one@example.com' },
      }),
    }),
  );
  expect(fixture.fetch.mock.calls[0][0]).toBe(
    'https://graph.microsoft.com/v1.0/subscriptions/shared-id',
  );
  const saved = fixture.update.mock.calls.find(
    ([arg]) => arg.data.providerSubscriptionId === 'shared-id',
  )![0];
  expect(decrypt(saved.data.clientState)).toBe('shared-secret');
});
it('adopts a concurrent Graph create after 409 only through a persisted same-mailbox secret', async () => {
  outlook();
  Object.assign(subscription, { providerMailboxId: 'mailbox-id' });
  fixture.peers
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ accountId: 'other', clientState: encrypt('racing-state') }]);
  fixture.fetch
    .mockResolvedValueOnce(response({ value: [] }))
    .mockResolvedValueOnce(response({}, 409))
    .mockResolvedValueOnce(
      response({
        value: [
          {
            ...graphReply(),
            clientState: 'racing-state',
            notificationUrl: 'https://app.example/api/webhooks/outlook',
            lifecycleNotificationUrl: 'https://app.example/api/webhooks/outlook',
          },
        ],
      }),
    );
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 1, errors: 0 });
  expect(fixture.fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  const saved = fixture.update.mock.calls.find(
    ([arg]) => arg.data.providerSubscriptionId === 'graph-sub',
  )![0];
  expect(decrypt(saved.data.clientState)).toBe('racing-state');
});
it('does not adopt another mailbox subscription merely because its callback and inbox resource match', async () => {
  outlook();
  Object.assign(subscription, { providerMailboxId: 'mailbox-id' });
  fixture.fetch
    .mockResolvedValueOnce(response({ value: [] }))
    .mockResolvedValueOnce(response({}, 409))
    .mockResolvedValueOnce(
      response({
        value: [
          {
            ...graphReply(),
            clientState: 'unknown-secret',
            notificationUrl: 'https://app.example/api/webhooks/outlook',
            lifecycleNotificationUrl: 'https://app.example/api/webhooks/outlook',
          },
        ],
      }),
    );
  expect(await renewMailboxSubscriptions()).toMatchObject({ renewed: 0, errors: 1 });
});
it('disconnects one shared Graph account without deleting the remaining subscriber', async () => {
  fixture.account.mockResolvedValue({ ...account, provider: 'OUTLOOK' });
  Object.assign(subscription, { provider: 'OUTLOOK', providerSubscriptionId: 'shared-id' });
  fixture.subscriberCount.mockResolvedValue(1);
  expect(await cleanupMailboxSubscription('user1', 'account1')).toMatchObject({
    cleaned: false,
    skipped: true,
  });
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.subscriberCount).toHaveBeenCalledWith({
    where: {
      accountId: { not: 'account1' },
      provider: 'OUTLOOK',
      providerSubscriptionId: 'shared-id',
      status: { not: 'disconnected' },
    },
  });
});

it('reuses an already held account credential lease during disconnect cleanup', async () => {
  fixture.fetch.mockResolvedValueOnce(response(null, 204));
  const held = {
    account: account as import('@prisma/client').EmailAccount,
    token: 'held-private-token',
  };
  expect(
    await cleanupMailboxSubscription('user1', 'account1', Date.now() + 5000, held),
  ).toMatchObject({ cleaned: true });
  expect(fixture.credentials).not.toHaveBeenCalled();
  expect(fixture.account).not.toHaveBeenCalled();
  expect(fixture.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer held-private-token');
});
it.each([{ id: 'other-account' }, { userId: 'other-user' }])(
  'rejects mismatched held credential ownership before database mutation: %j',
  async (mismatch) => {
    const held = {
      account: { ...account, ...mismatch } as import('@prisma/client').EmailAccount,
      token: 'held-private-token',
    };
    const result = await cleanupMailboxSubscription('user1', 'account1', Date.now() + 5000, held);
    expect(result.cleaned).toBe(false);
    expect(fixture.fetch).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.credentials).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('held-private-token');
  },
);
