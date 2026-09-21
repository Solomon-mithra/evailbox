import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  exchangeCode,
  fetchEmailPage,
  getAuthorizationUrl,
  getMailboxIdentity,
  refreshAccessToken,
} from '../src/lib/providers';
const response = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const gmailMessage = {
  id: 'm1',
  internalDate: '1700000000000',
  labelIds: ['INBOX', 'UNREAD'],
  snippet: 'Hi',
  payload: {
    headers: [
      { name: 'Subject', value: 'Hello' },
      { name: 'From', value: '"Ada Lovelace" <ADA@example.com>' },
    ],
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<script>bad</script>').toString('base64url') },
          },
          { mimeType: 'text/plain', body: { data: Buffer.from('Hello ✓').toString('base64url') } },
        ],
      },
    ],
  },
};
let mockFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'google-id');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');
  vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', 'ms-id');
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'ms-secret');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('OAuth protocol', () => {
  it('uses read-only scopes and PKCE', () => {
    const options = {
      state: 'state',
      codeChallenge: 'challenge',
      redirectUri: 'https://app.example/callback',
    };
    const google = new URL(getAuthorizationUrl('GMAIL', options));
    expect(google.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('access_type')).toBe('offline');
    const microsoft = new URL(getAuthorizationUrl('OUTLOOK', options));
    expect(microsoft.searchParams.get('scope')).toBe('offline_access Mail.Read User.Read');
    expect(microsoft.searchParams.get('state')).toBe('state');
  });
  it('exchanges code with verifier, rotates refresh token and computes expiry', async () => {
    mockFetch.mockResolvedValueOnce(
      response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
    );
    const before = Date.now();
    const tokens = await exchangeCode('GMAIL', {
      code: 'code',
      codeVerifier: 'verifier',
      redirectUri: 'https://app.example/callback',
    });
    expect(tokens.accessToken).toBe('access');
    expect(tokens.refreshToken).toBe('refresh');
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600000);
    expect(new URLSearchParams(mockFetch.mock.calls[0][1].body).get('code_verifier')).toBe(
      'verifier',
    );
    mockFetch.mockResolvedValueOnce(
      response({ access_token: 'rotated', refresh_token: 'rotated-refresh', expires_in: 1200 }),
    );
    expect((await refreshAccessToken('OUTLOOK', 'old')).refreshToken).toBe('rotated-refresh');
  });
  it('retrieves verified provider identity', async () => {
    mockFetch.mockResolvedValueOnce(response({ emailAddress: 'ME@example.com' }));
    expect(await getMailboxIdentity('GMAIL', 'token')).toEqual({ email: 'me@example.com' });
    mockFetch.mockResolvedValueOnce(
      response({ mail: null, userPrincipalName: 'outlook@example.com' }),
    );
    expect(await getMailboxIdentity('OUTLOOK', 'token')).toEqual({ email: 'outlook@example.com' });
  });
});
describe('Gmail sync', () => {
  it('captures starting history before initial list, decodes nested plain MIME and catches up after listing', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ historyId: '100' }))
      .mockResolvedValueOnce(response({ messages: [{ id: 'm1' }], nextPageToken: 'page2' }))
      .mockResolvedValueOnce(response(gmailMessage));
    const first = await fetchEmailPage('GMAIL', 'token', null);
    expect(first.messages[0]).toMatchObject({
      sender: 'ada@example.com',
      senderName: 'Ada Lovelace',
      body: 'Hello ✓',
      isRead: false,
    });
    expect(first.hasMore).toBe(true);
    expect(String(mockFetch.mock.calls[1][0])).toContain('after%3A');
    mockFetch.mockResolvedValueOnce(response({ messages: [] }));
    const last = await fetchEmailPage('GMAIL', 'token', first.cursor);
    expect(last.hasMore).toBe(true);
    mockFetch.mockResolvedValueOnce(response({ historyId: '102' }));
    const caughtUp = await fetchEmailPage('GMAIL', 'token', last.cursor);
    expect(caughtUp.hasMore).toBe(false);
    expect(String(mockFetch.mock.calls.at(-1)?.[0])).toContain('startHistoryId=100');
  });
  it('retains history start across pages and handles deletion and inbox removal', async () => {
    const cursor = JSON.stringify({ v: 1, provider: 'GMAIL', phase: 'history', historyId: '100' });
    mockFetch
      .mockResolvedValueOnce(
        response({
          historyId: '105',
          nextPageToken: 'p2',
          history: [
            {
              messagesDeleted: [{ message: { id: 'deleted' } }],
              labelsRemoved: [{ message: { id: 'm1' }, labelIds: ['INBOX'] }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ ...gmailMessage, labelIds: ['SENT'] }));
    const page = await fetchEmailPage('GMAIL', 'token', cursor);
    expect(page.deletedIds).toEqual(expect.arrayContaining(['deleted', 'm1']));
    expect(JSON.parse(page.cursor).historyId).toBe('100');
    expect(page.hasMore).toBe(true);
  });
  it('resets expired history without swallowing other API failures', async () => {
    mockFetch
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ historyId: '200' }))
      .mockResolvedValueOnce(response({ messages: [] }));
    const result = await fetchEmailPage(
      'GMAIL',
      'token',
      JSON.stringify({ v: 1, provider: 'GMAIL', phase: 'history', historyId: '100' }),
    );
    expect(JSON.parse(result.cursor).historyId).toBe('200');
    mockFetch.mockResolvedValueOnce(response({ error: 'secret-provider-body' }, 401));
    await expect(fetchEmailPage('GMAIL', 'token', result.cursor)).rejects.toThrow('401');
  });
});
describe('Outlook sync security', () => {
  it.each([
    'https://evil.example/v1.0/me/messages/delta',
    'https://graph.microsoft.com.evil.example/v1.0/me/messages/delta',
    'http://graph.microsoft.com/v1.0/me/messages/delta',
    'https://user:pass@graph.microsoft.com/v1.0/me/messages/delta',
  ])('rejects untrusted cursor URL %s before sending credentials', async (url) => {
    await expect(
      fetchEmailPage('OUTLOOK', 'secret', JSON.stringify({ v: 1, provider: 'OUTLOOK', url })),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('preserves next/delta links, tombstones and plain bodies', async () => {
    const next =
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=abc';
    const delta =
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=xyz';
    mockFetch.mockResolvedValueOnce(
      response({
        value: [
          { id: 'old', '@removed': { reason: 'deleted' } },
          {
            id: 'new',
            receivedDateTime: '2026-09-21T10:00:00Z',
            subject: 'Hello',
            from: { emailAddress: { address: 'ADA@example.com', name: 'Ada' } },
            body: { contentType: 'html', content: '<img onerror=bad>' },
            bodyPreview: 'preview',
            isRead: false,
          },
        ],
        '@odata.nextLink': next,
      }),
    );
    const first = await fetchEmailPage('OUTLOOK', 'token', null);
    expect(first.deletedIds).toEqual(['old']);
    expect(first.messages[0].body).toBe(null);
    expect(first.hasMore).toBe(true);
    expect(mockFetch.mock.calls[0][1].redirect).toBe('error');
    mockFetch.mockResolvedValueOnce(response({ value: [], '@odata.deltaLink': delta }));
    const last = await fetchEmailPage('OUTLOOK', 'token', first.cursor);
    expect(mockFetch.mock.calls[1][0]).toBe(next);
    expect(JSON.parse(last.cursor).url).toBe(delta);
    expect(last.hasMore).toBe(false);
  });
  it('retries rate limiting at most twice and never leaks provider bodies', async () => {
    mockFetch.mockImplementation(async () =>
      response({ error: 'do-not-leak' }, 429, { 'retry-after': '0' }),
    );
    await expect(getMailboxIdentity('OUTLOOK', 'secret')).rejects.toThrow('429');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
it('rejects malicious Graph nextLink before persisting it', async () => {
  mockFetch.mockResolvedValueOnce(
    response({ value: [], '@odata.nextLink': 'https://evil.example/collect' }),
  );
  await expect(fetchEmailPage('OUTLOOK', 'secret', null)).rejects.toThrow(
    'Invalid Outlook sync cursor',
  );
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
it('signals an expired Graph delta reset for cache reconciliation', async () => {
  const delta =
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=old';
  mockFetch
    .mockResolvedValueOnce(response({}, 410))
    .mockResolvedValueOnce(
      response({ value: [], '@odata.deltaLink': delta.replace('=old', '=new') }),
    );
  expect(
    (
      await fetchEmailPage(
        'OUTLOOK',
        'token',
        JSON.stringify({ v: 1, provider: 'OUTLOOK', url: delta }),
      )
    ).reset,
  ).toBe(true);
});
it('does not retry 401 responses or expose sensitive provider error text', async () => {
  mockFetch.mockResolvedValueOnce(response({ error: 'access_token=topsecret' }, 401));
  let failure: unknown;
  try {
    await getMailboxIdentity('GMAIL', 'token');
  } catch (error) {
    failure = error;
  }
  expect(String(failure)).not.toContain('topsecret');
  expect(String(failure)).toContain('401');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
