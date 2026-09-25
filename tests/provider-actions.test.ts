import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchReplyContext,
  prepareProviderReply,
  sendProviderReply,
  reconcileProviderReply,
  applyProviderAction,
  ProviderActionUnknown,
} from '../src/lib/providers/actions';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const gmail = {
  threadId: 'thread-original',
  payload: {
    headers: [
      { name: 'From', value: 'Sender <sender@example.com>' },
      { name: 'Reply-To', value: 'Support <support@example.com>' },
      { name: 'To', value: 'Me <me@example.com>, "Colleague, One" <one@example.com>' },
      { name: 'Cc', value: 'one@example.com, two@example.com, ME@example.com' },
      { name: 'Subject', value: 'Café update' },
      { name: 'Message-ID', value: '<original@example.com>' },
      { name: 'References', value: '<older@example.com>' },
    ],
  },
};
const context = {
  from: 'me@example.com',
  to: ['support@example.com', 'one@example.com'],
  cc: ['two@example.com'],
  subject: 'Re: Café update',
  threadId: 'thread-original',
  inReplyTo: '<original@example.com>',
  references: '<older@example.com> <original@example.com>',
};
afterEach(() => vi.unstubAllGlobals());
describe('provider reply fixtures (never contact a mailbox)', () => {
  it('derives Gmail reply-all recipients from Reply-To and removes self and duplicates', async () => {
    const fetch = vi.fn().mockResolvedValue(json(gmail));
    vi.stubGlobal('fetch', fetch);
    expect(
      await fetchReplyContext('GMAIL', 'token', 'original', 'me@example.com', 'reply-all'),
    ).toEqual(context);
    expect(fetch.mock.calls[0][0]).toContain('format=metadata');
  });
  it('reply excludes original To/Cc and rejects header injection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(gmail))
        .mockResolvedValueOnce(
          json({
            ...gmail,
            payload: {
              headers: [
                ...gmail.payload.headers,
                { name: 'Reply-To', value: 'bad@example.com\r\nBcc: evil@example.com' },
              ],
            },
          }),
        ),
    );
    const reply = await fetchReplyContext('GMAIL', 'token', 'original', 'me@example.com', 'reply');
    expect(reply.to).toEqual(['support@example.com']);
    expect(reply.cc).toEqual([]);
    // Duplicate address headers are unsafe rather than silently selecting attacker-controlled values.
    await expect(
      fetchReplyContext('GMAIL', 'token', 'original', 'me@example.com', 'reply'),
    ).rejects.toThrow();
  });
  it('builds a Gmail draft with original thread and RFC reply headers before sending', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: 'draft-1' }));
    vi.stubGlobal('fetch', fetch);
    expect(
      await prepareProviderReply(
        'GMAIL',
        'token',
        'original',
        'reply-all',
        context,
        'Thanks — noted.',
        '<stable@evailbox.local>',
        null,
      ),
    ).toBe('draft-1');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.message.threadId).toBe('thread-original');
    const mime = Buffer.from(body.message.raw, 'base64url').toString();
    expect(mime).toContain('From: me@example.com\r\n');
    expect(mime).toContain('In-Reply-To: <original@example.com>');
    expect(mime).toContain('References: <older@example.com> <original@example.com>');
    expect(mime).toContain('Message-ID: <stable@evailbox.local>');
    expect(mime).not.toContain('Bcc:');
    expect(fetch.mock.calls[0][0]).toContain('/drafts');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('never retries a send after a lost response or server failure', async () => {
    for (const response of [
      () => Promise.reject(new TypeError('connection lost')),
      () => Promise.resolve(json({}, 503)),
    ]) {
      const fetch = vi.fn(response);
      vi.stubGlobal('fetch', fetch);
      await expect(sendProviderReply('GMAIL', 'token', 'draft')).rejects.toBeInstanceOf(
        ProviderActionUnknown,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps explicit insufficient-scope errors distinguishable for reconnect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 403)));
    await expect(sendProviderReply('GMAIL', 'token', 'draft')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('uses Outlook original recipients, creates a reply draft, and updates only safe reply fields', async () => {
    const address = (address: string) => ({ emailAddress: { address } });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          subject: 'Review',
          from: address('sender@example.com'),
          replyTo: [address('reply@example.com')],
          toRecipients: [address('me@example.com'), address('other@example.com')],
          ccRecipients: [address('other@example.com')],
          internetMessageId: '<old@example.com>',
        }),
      )
      .mockResolvedValueOnce(json({ id: 'immutable-draft' }))
      .mockResolvedValueOnce(json({ id: 'immutable-draft' }));
    vi.stubGlobal('fetch', fetch);
    const reply = await fetchReplyContext(
      'OUTLOOK',
      'token',
      'original',
      'me@example.com',
      'reply-all',
    );
    expect(reply.to).toEqual(['reply@example.com', 'other@example.com']);
    expect(reply.cc).toEqual([]);
    expect(
      await prepareProviderReply(
        'OUTLOOK',
        'token',
        'original',
        'reply-all',
        reply,
        'My reply',
        '<stable@evailbox.local>',
        null,
      ),
    ).toBe('immutable-draft');
    expect(fetch.mock.calls[1][0]).toContain('/createReplyAll');
    expect(fetch.mock.calls[1][1].headers.Prefer).toContain('ImmutableId');
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({
      body: { contentType: 'Text', content: 'My reply' },
      toRecipients: [address('reply@example.com'), address('other@example.com')],
      bccRecipients: [],
    });
  });
  it('accepts empty Outlook send response and reconciles by stable draft id without resending', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(json({ id: 'draft', isDraft: false }));
    vi.stubGlobal('fetch', fetch);
    await expect(sendProviderReply('OUTLOOK', 'token', 'draft')).resolves.toBeNull();
    await expect(
      reconcileProviderReply('OUTLOOK', 'token', 'draft', '<stable@evailbox.local>'),
    ).resolves.toMatchObject({ status: 'accepted', providerMessageId: 'draft' });
    expect(fetch.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1);
  });
  it('Gmail reconciliation searches the saved RFC id only in sent messages', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ messages: [{ id: 'sent-1' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      reconcileProviderReply('GMAIL', 'token', 'draft', '<stable@evailbox.local>'),
    ).resolves.toMatchObject({ status: 'accepted', providerMessageId: 'sent-1' });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toContain(
      'rfc822msgid:stable@evailbox.local',
    );
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('labelIds')).toBe('SENT');
  });
  it('does not infer acceptance or retry when reconciliation cannot find a sent copy', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ messages: [] }));
    vi.stubGlobal('fetch', fetch);
    expect(await reconcileProviderReply('GMAIL', 'token', null, '<stable@evailbox.local>')).toEqual(
      { status: 'unknown' },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('Gmail archive removes INBOX and read action removes UNREAD', async () => {
    const fetch = vi.fn().mockImplementation(async () => json({}));
    vi.stubGlobal('fetch', fetch);
    await applyProviderAction('GMAIL', 'token', 'id', 'archive');
    await applyProviderAction('GMAIL', 'token', 'id', 'read');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ removeLabelIds: ['INBOX'] });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ removeLabelIds: ['UNREAD'] });
  });
  it('recovers an ambiguous Outlook archive by checking the immutable message folder', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'archive-id' }))
      .mockResolvedValueOnce(json({ parentFolderId: 'inbox-id' }))
      .mockRejectedValueOnce(new TypeError('lost'))
      .mockResolvedValueOnce(json({ parentFolderId: 'archive-id' }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      applyProviderAction('OUTLOOK', 'token', 'immutable-id', 'archive'),
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1);
  });
});

it('folds long UTF-8 MIME subjects into valid encoded words', async () => {
  const fetch = vi.fn().mockResolvedValue(json({ id: 'draft' }));
  vi.stubGlobal('fetch', fetch);
  await prepareProviderReply(
    'GMAIL',
    'token',
    'original',
    'reply',
    { ...context, subject: 'Re: ' + '🧪 Café '.repeat(180) },
    'Text',
    '<stable@evailbox.local>',
    null,
  );
  const raw = Buffer.from(
    JSON.parse(fetch.mock.calls[0][1].body).message.raw,
    'base64url',
  ).toString();
  const encodedWords = raw.match(/=\?UTF-8\?B\?.*?\?=/g)!;
  expect(encodedWords.every((word) => word.length <= 75)).toBe(true);
  expect(raw.split('\r\n').every((line) => Buffer.byteLength(line) <= 998)).toBe(true);
});
