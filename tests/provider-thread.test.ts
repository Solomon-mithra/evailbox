import { afterEach, describe, expect, it, vi } from 'vitest';
import * as threadProvider from '../src/lib/providers/thread';
import { withProviderDeadline } from '../src/lib/providers/http';

const encoded = (value: string) => Buffer.from(value).toString('base64url');
const response = (value: unknown) => new Response(JSON.stringify(value));
const gmail = (id: string, date: number, content: string, labels = ['INBOX']) => ({
  id,
  threadId: 'thread/id',
  internalDate: String(date),
  labelIds: labels,
  snippet: `Preview ${id}`,
  payload: {
    mimeType: 'text/plain',
    headers: [{ name: 'From', value: '"A Person" <a@example.com>' }],
    body: { data: encoded(content) },
  },
});
const outlook = (id: string, day: number, extra = {}) => ({
  id,
  conversationId: "conversation'id",
  from: { emailAddress: { address: 'a@example.com', name: 'A Person' } },
  receivedDateTime: `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`,
  isDraft: false,
  bodyPreview: `Preview ${id}`,
  body: { contentType: 'html', content: `<p>Body ${id}</p>` },
  ...extra,
});
afterEach(() => vi.unstubAllGlobals());

describe('provider conversation bodies', () => {
  it('loads Gmail full threads including sent replies, sorts and deduplicates, excluding drafts and trash', async () => {
    const current = gmail('current', 2000, 'Received body');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(current))
      .mockResolvedValueOnce(
        response({
          messages: [
            gmail('reply', 3000, 'Sent reply', ['SENT']),
            current,
            gmail('first', 1000, 'Original message'),
            current,
            gmail('draft', 4000, 'Unsent', ['DRAFT']),
            gmail('trash', 4000, 'Deleted', ['TRASH']),
            gmail('spam', 4000, 'Spam', ['SPAM']),
          ],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(threadProvider.fetchMessageThread).toBeTypeOf('function');
    const result = await threadProvider.fetchMessageThread('GMAIL', 'token', 'current');
    expect(result.partial).toBe(false);
    expect(result.messages.map((m) => m.id)).toEqual(['first', 'current', 'reply']);
    expect(result.messages.map((m) => m.current)).toEqual([false, true, false]);
    expect(result.messages[2].content).toEqual({ format: 'text', content: 'Sent reply' });
    expect(result.messages[0]).toMatchObject({ sender: 'a@example.com', senderName: 'A Person' });
    expect(fetcher.mock.calls[0][0]).toContain('/messages/current?format=metadata');
    expect(fetcher.mock.calls[1][0]).toContain('/threads/thread%2Fid?format=full');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the rest of a Gmail conversation when one attachment body is unavailable', async () => {
    const broken = gmail('broken', 1000, '');
    broken.payload.body = { attachmentId: 'missing', size: 50 } as never;
    const current = gmail('current', 2000, 'Current body');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(current))
      .mockResolvedValueOnce(response({ messages: [broken, current] }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    const result = await threadProvider.fetchMessageThread('GMAIL', 'token', 'current');
    expect(result.partial).toBe(true);
    expect(result.messages[0]).toMatchObject({
      fallback: true,
      content: { format: 'text', content: 'Preview broken' },
    });
    expect(result.messages[1]).toMatchObject({
      fallback: false,
      content: { content: 'Current body' },
    });
  });

  it('caps large threads at 100 while preserving the selected message even when it is oldest', async () => {
    const messages = Array.from({ length: 105 }, (_, i) => gmail(`m${i}`, i + 1, `Body ${i}`));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(messages[0]))
        .mockResolvedValueOnce(response({ messages })),
    );
    const result = await threadProvider.fetchMessageThread('GMAIL', 'token', 'm0');
    expect(result.messages).toHaveLength(100);
    expect(result.partial).toBe(true);
    expect(result.messages[0]).toMatchObject({
      id: 'm0',
      current: true,
      content: { content: 'Body 0' },
    });
  });

  it('loads Outlook replies across mailbox folders and provider pages, omitting drafts', async () => {
    const next = new URL('https://graph.microsoft.com/v1.0/me/messages');
    next.searchParams.set('$filter', "conversationId eq 'conversation''id' and isDraft eq false");
    next.searchParams.set('$skip', '50');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(outlook('current/id', 2)))
      .mockResolvedValueOnce(
        response({
          value: [outlook('sent-reply', 3), outlook('draft', 4, { isDraft: true })],
          '@odata.nextLink': next.href,
        }),
      )
      .mockResolvedValueOnce(response({ value: [outlook('first', 1), outlook('sent-reply', 3)] }));
    vi.stubGlobal('fetch', fetcher);
    const result = await threadProvider.fetchMessageThread('OUTLOOK', 'token', 'current/id');
    expect(result.partial).toBe(false);
    expect(result.messages.map((m) => m.id)).toEqual(['first', 'current/id', 'sent-reply']);
    expect(result.messages[1].current).toBe(true);
    const list = new URL(fetcher.mock.calls[1][0]);
    expect(list.pathname).toBe('/v1.0/me/messages');
    expect(list.searchParams.get('$filter')).toBe(
      "conversationId eq 'conversation''id' and isDraft eq false",
    );
    expect(fetcher.mock.calls[0][0]).toContain('current%2Fid');
    for (const call of fetcher.mock.calls)
      expect(call[1].headers.Prefer).toContain('IdType="ImmutableId"');
  });

  it('keeps retrieved Outlook replies and the selected message when a later page fails', async () => {
    const next = new URL('https://graph.microsoft.com/v1.0/me/messages');
    next.searchParams.set('$filter', "conversationId eq 'conversation''id' and isDraft eq false");
    next.searchParams.set('$skip', '50');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(outlook('current', 2)))
      .mockResolvedValueOnce(
        response({ value: [outlook('sent-reply', 3)], '@odata.nextLink': next.href }),
      )
      .mockRejectedValueOnce(new TypeError('Network connection lost'));
    vi.stubGlobal('fetch', fetcher);
    const result = await threadProvider.fetchMessageThread('OUTLOOK', 'token', 'current');
    expect(result.partial).toBe(true);
    expect(result.messages.map((message) => message.id)).toEqual(['current', 'sent-reply']);
    expect(result.messages[0]).toMatchObject({ current: true, fallback: false });
    expect(result.messages[1].content.content).toContain('Body sent-reply');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('still reports unavailable when the first Outlook conversation page fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(outlook('current', 2)))
      .mockRejectedValueOnce(new TypeError('Network connection lost'));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      threadProvider.fetchMessageThread('OUTLOOK', 'token', 'current'),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('falls back for attachment bodies without more network requests after the shared deadline', async () => {
    const now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const current = gmail('current', 1000, 'Selected body');
    const attachments = Array.from({ length: 20 }, (_, index) => ({
      ...gmail(`attachment-${index}`, index + 2000, ''),
      payload: { mimeType: 'text/plain', body: { attachmentId: `body-${index}`, size: 50 } },
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(current))
      .mockImplementationOnce(async () => {
        clock.mockReturnValue(now + 2000);
        return response({ messages: [current, ...attachments] });
      });
    vi.stubGlobal('fetch', fetcher);
    try {
      const result = await withProviderDeadline(now + 1000, () =>
        threadProvider.fetchMessageThread('GMAIL', 'token', 'current'),
      );
      expect(result.partial).toBe(true);
      expect(result.messages[0]).toMatchObject({ current: true, fallback: false });
      expect(result.messages.slice(1).every((message) => message.fallback)).toBe(true);
      expect(result.messages).toHaveLength(21);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    'https://attacker.example/steal',
    'https://graph.microsoft.com.attacker.example/v1.0/me/messages',
    'https://token@graph.microsoft.com/v1.0/me/messages',
    'https://graph.microsoft.com/v1.0/users/other/messages',
    'https://graph.microsoft.com/v1.0/me/messages?$filter=all',
  ])('rejects unsafe Outlook next page %s before sending credentials', async (next) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(outlook('current', 2)))
      .mockResolvedValueOnce(response({ value: [], '@odata.nextLink': next }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      threadProvider.fetchMessageThread('OUTLOOK', 'secret', 'current'),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not claim a complete conversation when the provider thread fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(gmail('current', 1000, 'Body')))
        .mockResolvedValueOnce(new Response('', { status: 403 })),
    );
    await expect(threadProvider.fetchMessageThread('GMAIL', 'token', 'current')).rejects.toThrow();
  });

  it('bounds total body bytes and prioritizes the selected message within that budget', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      gmail(`m${i}`, i + 1, 'x'.repeat(1_000_000)),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(messages[9]))
        .mockResolvedValueOnce(response({ messages })),
    );
    const result = await threadProvider.fetchMessageThread('GMAIL', 'token', 'm9');
    expect(result.messages).toHaveLength(10);
    expect(result.partial).toBe(true);
    expect(result.messages.at(-1)).toMatchObject({ current: true, fallback: false });
    expect(
      result.messages.reduce((sum, m) => sum + Buffer.byteLength(m.content.content), 0),
    ).toBeLessThanOrEqual(8_100_000);
    expect(result.messages.some((m) => m.fallback)).toBe(true);
  });
});
