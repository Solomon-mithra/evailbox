import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
const fixture = vi.hoisted(() => ({
  gmailAccounts: vi.fn(),
  subscriptions: vi.fn(),
  update: vi.fn(),
  request: vi.fn(),
  publish: vi.fn(),
  after: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    mailboxSubscription: {
      findMany: (args: { where: { providerSubscriptionId?: string } }) =>
        args.where.providerSubscriptionId
          ? fixture.subscriptions(args)
          : fixture.gmailAccounts(args),
      findUnique: fixture.subscriptions,
      updateMany: fixture.update,
    },
  },
}));
vi.mock('@/lib/work-queue', () => ({ requestWork: fixture.request }));
vi.mock('@/lib/inngest/dispatch', () => ({ publishUserWork: fixture.publish }));
vi.mock('next/server', () => ({ after: fixture.after }));
vi.mock('@/lib/providers/webhooks', async (original) => ({
  ...(await original<typeof import('../src/lib/providers/webhooks')>()),
  verifyGmailPushToken: fixture.authenticate,
}));
import {
  gmailWebhookConfiguration,
  readBoundedJson,
  outlookValidationResponse,
  matchesOutlookResource,
} from '../src/lib/providers/webhooks';
import { POST as gmailPost } from '../src/app/api/webhooks/gmail/route';
import { POST as outlookPost } from '../src/app/api/webhooks/outlook/route';
import { encrypt } from '../src/lib/crypto';
const config = {
  topic: 'projects/p/topics/gmail',
  subscription: 'projects/p/subscriptions/gmail',
  audience: 'https://app.example/api/webhooks/gmail',
  serviceAccountEmail: 'push@p.iam.gserviceaccount.com',
};
const account = {
  accountId: 'account1',
  userId: 'user1',
  workspace: 'WORK',
  provider: 'GMAIL',
  account: { email: 'one@example.com' },
};
function gmailRequest(overrides = {}) {
  return new Request(config.audience, {
    method: 'POST',
    headers: { authorization: 'Bearer signed', 'content-type': 'application/json' },
    body: JSON.stringify({
      subscription: config.subscription,
      message: {
        data: Buffer.from(
          JSON.stringify({ emailAddress: 'one@example.com', historyId: '123' }),
        ).toString('base64url'),
        messageId: 'delivery1',
      },
      ...overrides,
    }),
  });
}
function outlookRequest(value: unknown) {
  return new Request('https://app.example/api/webhooks/outlook', {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}
const change = {
  subscriptionId: 'sub1',
  clientState: 'private-state',
  changeType: 'created',
  resource: 'Users/mailbox-id/Messages/message1',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('ENCRYPTION_SECRET_KEY', 'a'.repeat(64));
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', config.topic);
  vi.stubEnv('GMAIL_PUBSUB_SUBSCRIPTION', config.subscription);
  vi.stubEnv('GMAIL_PUBSUB_AUDIENCE', config.audience);
  vi.stubEnv('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL', config.serviceAccountEmail);
  vi.stubEnv('OUTLOOK_WEBHOOK_URL', 'https://app.example/api/webhooks/outlook');
  fixture.authenticate.mockResolvedValue(undefined);
  fixture.gmailAccounts.mockResolvedValue([account]);
  fixture.subscriptions.mockResolvedValue([
    {
      ...account,
      provider: 'OUTLOOK',
      status: 'active',
      providerSubscriptionId: 'sub1',
      clientState: encrypt('private-state'),
      resource: "/me/mailFolders('inbox')/messages",
      providerMailboxId: 'mailbox-id',
    },
  ]);
  fixture.request.mockResolvedValue(undefined);
  fixture.update.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

it('authenticates Gmail, durably marks only watched accounts, then publishes after response', async () => {
  const response = await gmailPost(gmailRequest());
  expect(response.status).toBe(204);
  expect(fixture.authenticate).toHaveBeenCalledWith('Bearer signed', config);
  expect(fixture.gmailAccounts).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        provider: 'GMAIL',
        resource: config.topic,
        watchHistoryId: { not: null },
        account: { email: 'one@example.com' },
      }),
    }),
  );
  expect(fixture.request).toHaveBeenCalledWith('user1', {
    sync: true,
    accountId: 'account1',
    workspace: 'WORK',
  });
  expect(fixture.publish).not.toHaveBeenCalled();
  await fixture.after.mock.calls[0][0]();
  expect(fixture.publish).toHaveBeenCalledWith('user1');
});
it('safely replays duplicate Gmail deliveries without moving an ingestion cursor', async () => {
  expect((await gmailPost(gmailRequest())).status).toBe(204);
  expect((await gmailPost(gmailRequest())).status).toBe(204);
  expect(fixture.request).toHaveBeenCalledTimes(2);
  expect(fixture.update).not.toHaveBeenCalled();
});
it('rejects Gmail JWT or subscription mismatch before mutating anything', async () => {
  fixture.authenticate.mockRejectedValueOnce(new Error('bad token'));
  expect((await gmailPost(gmailRequest())).status).toBe(401);
  expect(
    (await gmailPost(gmailRequest({ subscription: 'projects/other/subscriptions/wrong' }))).status,
  ).toBe(403);
  expect(fixture.request).not.toHaveBeenCalled();
});
it('validates Gmail payload and acknowledges unknown mailboxes without waking users', async () => {
  expect(
    (
      await gmailPost(
        gmailRequest({
          message: {
            data: Buffer.from('{"emailAddress":"bad","historyId":"123"}').toString('base64'),
          },
        }),
      )
    ).status,
  ).toBe(400);
  fixture.gmailAccounts.mockResolvedValue([]);
  expect((await gmailPost(gmailRequest())).status).toBe(204);
  expect(fixture.request).not.toHaveBeenCalled();
});
it('returns retryable failure when durable Gmail enqueue fails', async () => {
  fixture.request.mockRejectedValueOnce(new Error('database down'));
  expect((await gmailPost(gmailRequest())).status).toBe(503);
  expect(fixture.after).not.toHaveBeenCalled();
});
it('reports missing Gmail setup without accepting notifications', async () => {
  vi.stubEnv('GMAIL_PUBSUB_AUDIENCE', '');
  expect(gmailWebhookConfiguration()).toBeNull();
  expect((await gmailPost(gmailRequest())).status).toBe(503);
  expect(fixture.request).not.toHaveBeenCalled();
});
it('bounds actual streamed request bytes independently of Content-Length', async () => {
  const request = new Request('https://example.com', {
    method: 'POST',
    headers: { 'content-length': '1' },
    body: JSON.stringify({ data: 'a'.repeat(100) }),
  });
  await expect(readBoundedJson(request, 32)).rejects.toMatchObject({ status: 413 });
});
it('echoes the Graph validation token exactly once as bounded plain text', async () => {
  const response = await outlookPost(
    new Request('https://app.example/api/webhooks/outlook?validationToken=hello%20%2520%2B', {
      method: 'POST',
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  expect(await response.text()).toBe('hello %20+');
  expect(
    outlookValidationResponse(
      new Request('https://app.example/?validationToken=' + 'a'.repeat(5000)),
    )?.status,
  ).toBe(400);
  expect(fixture.subscriptions).not.toHaveBeenCalled();
});
it('validates Graph subscription identity, private state and mailbox resource', async () => {
  expect((await outlookPost(outlookRequest([change]))).status).toBe(202);
  expect(fixture.request).toHaveBeenCalledWith('user1', {
    sync: true,
    accountId: 'account1',
    workspace: 'WORK',
  });
  expect(fixture.publish).not.toHaveBeenCalled();
  await fixture.after.mock.calls[0][0]();
  expect(fixture.publish).toHaveBeenCalledWith('user1');
});
it('ignores forged Graph state, cross-mailbox resources and unknown subscriptions', async () => {
  await outlookPost(
    outlookRequest([
      { ...change, clientState: 'forged' },
      { ...change, resource: 'Users/other/Messages/message1' },
      { ...change, resource: "me/mailFolders('sentitems')/messages/message1" },
    ]),
  );
  fixture.subscriptions.mockResolvedValueOnce([]);
  await outlookPost(outlookRequest([change]));
  expect(fixture.request).not.toHaveBeenCalled();
  expect(fixture.update).not.toHaveBeenCalled();
});
it.each(['subscriptionRemoved', 'missed', 'reauthorizationRequired'])(
  'durably requests recovery and renewal for verified %s lifecycle notifications',
  async (lifecycleEvent) => {
    expect(
      (
        await outlookPost(
          outlookRequest([
            { subscriptionId: 'sub1', clientState: 'private-state', lifecycleEvent },
          ]),
        )
      ).status,
    ).toBe(202);
    expect(fixture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountId: 'account1', providerSubscriptionId: 'sub1' }),
        data: expect.objectContaining({
          renewalRequested: true,
          renewalRevision: { increment: 1 },
        }),
      }),
    );
    expect(fixture.request).toHaveBeenCalledTimes(1);
  },
);
it('returns retryable Graph failure when persistence fails', async () => {
  fixture.subscriptions.mockRejectedValueOnce(new Error('database down'));
  expect((await outlookPost(outlookRequest([change]))).status).toBe(503);
});
it('accepts only resource shapes belonging to a stored inbox subscription', () => {
  const sub = { resource: "/me/mailFolders('inbox')/messages", providerMailboxId: 'mailbox-id' };
  expect(matchesOutlookResource(change.resource, sub)).toBe(true);
  expect(matchesOutlookResource("/me/mailFolders('inbox')/messages/abc", sub)).toBe(true);
  expect(matchesOutlookResource('Users/mailbox-id/Messages/../abc', sub)).toBe(false);
  expect(matchesOutlookResource(change.resource, { ...sub, resource: '/me/messages' })).toBe(false);
});

describe('Google JWT signature verification', () => {
  it('requires Google issuer, exact audience, verified service-account email, valid expiry and signature', async () => {
    const { verifyGmailPushToken } = await vi.importActual<
      typeof import('../src/lib/providers/webhooks')
    >('../src/lib/providers/webhooks');
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
    const signed = async (claims = {}) =>
      new SignJWT({ email: config.serviceAccountEmail, email_verified: true, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer('https://accounts.google.com')
        .setSubject('service')
        .setAudience(config.audience)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
    await expect(
      verifyGmailPushToken('Bearer ' + (await signed()), config, keys),
    ).resolves.toBeUndefined();
    for (const claims of [{ email: 'other@p.iam.gserviceaccount.com' }, { email_verified: false }])
      await expect(
        verifyGmailPushToken('Bearer ' + (await signed(claims)), config, keys),
      ).rejects.toThrow();
    await expect(
      verifyGmailPushToken(
        'Bearer ' + (await signed()),
        { ...config, audience: 'https://other.example' },
        keys,
      ),
    ).rejects.toThrow();
    const invalid = await new SignJWT({ email: config.serviceAccountEmail, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('https://attacker.example')
      .setSubject('service')
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    await expect(verifyGmailPushToken('Bearer ' + invalid, config, keys)).rejects.toThrow();
  });
});

it('fans a shared Outlook subscription out to each authenticated known account', async () => {
  const first = (await fixture.subscriptions())[0];
  fixture.subscriptions.mockResolvedValue([
    first,
    { ...first, accountId: 'account2', userId: 'user2', workspace: 'PERSONAL' },
  ]);
  expect((await outlookPost(outlookRequest([change]))).status).toBe(202);
  expect(fixture.request).toHaveBeenCalledWith('user1', {
    sync: true,
    accountId: 'account1',
    workspace: 'WORK',
  });
  expect(fixture.request).toHaveBeenCalledWith('user2', {
    sync: true,
    accountId: 'account2',
    workspace: 'PERSONAL',
  });
});
