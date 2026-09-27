import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchEmailPage } from '../src/lib/providers';

const started = Date.parse('2026-09-26T12:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const receivedAt = (n: number) => new Date(started - n * 60_000).toISOString();
const gmail = (n: number) => ({
  id: `m${n}`,
  internalDate: String(started - n * 60_000),
  labelIds: ['INBOX'],
  payload: { mimeType: 'text/plain', body: { data: Buffer.from('fixture').toString('base64url') } },
});
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(started));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('Gmail stops historical pages at 100 across serialized cursors, then catches up new arrivals', async () => {
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/profile')) return json({ historyId: 'start' });
    if (url.pathname.endsWith('/messages')) {
      expect(url.searchParams.has('q')).toBe(false);
      const offset = Number(url.searchParams.get('pageToken') ?? 0);
      const count = Number(url.searchParams.get('maxResults'));
      return json({
        messages: Array.from({ length: count }, (_, i) => ({ id: `m${offset + i + 1}` })),
        nextPageToken: String(offset + count),
      });
    }
    if (url.pathname.endsWith('/history'))
      return json({
        historyId: 'end',
        history: [
          {
            messagesAdded: [{ message: { id: 'm0' } }],
            labelsAdded: [{ message: { id: 'm150' } }],
          },
        ],
      });
    return json(gmail(Number(url.pathname.split('/').at(-1)!.slice(1))));
  });
  vi.stubGlobal('fetch', fetch);
  let cursor: string | null = null;
  let imported = 0;
  for (let i = 0; i < 5; i++) {
    const page = await fetchEmailPage('GMAIL', 'token', cursor);
    imported += page.messages.length;
    cursor = page.cursor;
  }
  expect(imported).toBe(100);
  expect(JSON.parse(cursor!).phase).toBe('history');
  const changes = await fetchEmailPage('GMAIL', 'token', cursor);
  expect(changes.hasMore).toBe(false);
  expect(changes.createIds).toEqual(['m0']);
  expect(
    fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/messages')),
  ).toHaveLength(5);
});

it('Gmail bounds a short final page and retains the limit on retry', async () => {
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/messages')) {
      expect(url.searchParams.get('maxResults')).toBe('3');
      return json({ messages: [1, 2, 3, 4].map((n) => ({ id: `m${n}` })), nextPageToken: 'older' });
    }
    return json(gmail(Number(url.pathname.split('/').at(-1)!.slice(1))));
  });
  vi.stubGlobal('fetch', fetch);
  const cursor = JSON.stringify({
    v: 1,
    provider: 'GMAIL',
    phase: 'initial',
    historyId: 'start',
    remaining: 3,
    startedAt: new Date(started).toISOString(),
  });
  for (let i = 0; i < 2; i++) {
    const page = await fetchEmailPage('GMAIL', 'token', cursor);
    expect(page.messages).toHaveLength(3);
    expect(JSON.parse(page.cursor).phase).toBe('history');
  }
});

it('Outlook hydrates only the latest 100 existing messages and obtains a real delta checkpoint', async () => {
  const base = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta';
  const hydrated: string[] = [];
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/delta')) {
      if (url.searchParams.has('$deltatoken'))
        return json({
          value: [
            { id: 'm1', receivedDateTime: receivedAt(1) },
            { id: 'm130', receivedDateTime: receivedAt(130) },
            { id: 'new', receivedDateTime: new Date(started + 60_000).toISOString() },
          ],
          '@odata.deltaLink': `${base}?$deltatoken=newer`,
        });
      const offset = Number(url.searchParams.get('$skiptoken') ?? 0);
      if (!offset) {
        expect(url.searchParams.get('$orderby')).toBe('receivedDateTime desc');
        expect(url.searchParams.get('$select')).toBe('id,receivedDateTime');
      }
      return json({
        value: Array.from({ length: Math.min(20, 130 - offset) }, (_, i) => ({
          id: `m${offset + i + 1}`,
          receivedDateTime: receivedAt(offset + i + 1),
        })),
        ...(offset + 20 < 130
          ? { '@odata.nextLink': `${base}?$skiptoken=${offset + 20}` }
          : { '@odata.deltaLink': `${base}?$deltatoken=ready` }),
      });
    }
    const id = url.pathname.split('/').at(-1)!;
    hydrated.push(id);
    return json({
      id,
      receivedDateTime:
        id === 'new' ? new Date(started + 60_000).toISOString() : receivedAt(Number(id.slice(1))),
      body: { contentType: 'text', content: 'fixture' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  let cursor: string | null = null;
  let imported = 0;
  for (let i = 0; i < 7; i++) {
    const page = await fetchEmailPage('OUTLOOK', 'token', cursor);
    imported += page.messages.length;
    cursor = page.cursor;
    if (i === 6) expect(page.hasMore).toBe(false);
  }
  expect(imported).toBe(100);
  expect(hydrated).toHaveLength(100);
  expect(hydrated).not.toContain('m101');
  const changes = await fetchEmailPage('OUTLOOK', 'token', cursor);
  expect(changes.messages.map((m) => m.providerMessageId)).toEqual(['m1', 'new']);
  expect(changes.createIds).toEqual(['new']);
});

it('Gmail expired bounded history reconciles retained mail without backfilling older rows', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({}, 404))
    .mockResolvedValueOnce(json({ historyId: 'fresh' }))
    .mockResolvedValueOnce(json({ messages: [{ id: 'm1' }, { id: 'm0' }] }))
    .mockResolvedValueOnce(json(gmail(1)))
    .mockResolvedValueOnce(json(gmail(0)));
  vi.stubGlobal('fetch', fetch);
  const page = await fetchEmailPage(
    'GMAIL',
    'token',
    JSON.stringify({
      v: 1,
      provider: 'GMAIL',
      phase: 'history',
      historyId: 'expired',
      startedAt: new Date(started).toISOString(),
      oldestAt: receivedAt(100),
    }),
  );
  expect(page.reset).toBe(true);
  expect(page.createIds).toEqual(['m0']);
  expect(new URL(fetch.mock.calls[2][0]).searchParams.get('q')).toBe(
    `after:${Math.floor(Date.parse(receivedAt(100)) / 1000) - 1}`,
  );
  expect(JSON.parse(page.cursor)).toMatchObject({
    phase: 'history',
    startedAt: new Date(started).toISOString(),
  });
});

it('Outlook expired bounded delta preserves retained old messages and admits only new mail', async () => {
  const delta =
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=fresh';
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({}, 410))
    .mockResolvedValueOnce(
      json({
        value: [
          { id: 'retained', receivedDateTime: receivedAt(100) },
          { id: 'older', receivedDateTime: receivedAt(101) },
          { id: 'new', receivedDateTime: receivedAt(0) },
        ],
        '@odata.deltaLink': delta,
      }),
    )
    .mockResolvedValueOnce(json({ id: 'retained', receivedDateTime: receivedAt(100) }))
    .mockResolvedValueOnce(json({ id: 'new', receivedDateTime: receivedAt(0) }));
  vi.stubGlobal('fetch', fetch);
  const page = await fetchEmailPage(
    'OUTLOOK',
    'token',
    JSON.stringify({
      v: 2,
      provider: 'OUTLOOK',
      phase: 'delta',
      remaining: 0,
      url: delta.replace('fresh', 'expired'),
      startedAt: new Date(started).toISOString(),
      oldestAt: receivedAt(100),
    }),
  );
  expect(page.reset).toBe(true);
  expect(page.messages.map((m) => m.providerMessageId)).toEqual(['retained', 'new']);
  expect(page.createIds).toEqual(['new']);
  expect(JSON.parse(page.cursor)).toMatchObject({ phase: 'delta', remaining: 0 });
});

it('Outlook rejects an untrusted v2 cursor before sending credentials', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    fetchEmailPage(
      'OUTLOOK',
      'secret',
      JSON.stringify({
        v: 2,
        provider: 'OUTLOOK',
        phase: 'delta',
        remaining: 0,
        url: 'https://evil.example/messages/delta',
        startedAt: new Date(started).toISOString(),
      }),
    ),
  ).rejects.toThrow('Invalid Outlook sync cursor');
  expect(fetch).not.toHaveBeenCalled();
});

it('Outlook does not lose new arrivals while finishing older delta references after the cap', async () => {
  const base = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta';
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [
            { id: 'older', receivedDateTime: receivedAt(120) },
            { id: 'new', receivedDateTime: receivedAt(-1) },
          ],
          '@odata.deltaLink': `${base}?$deltatoken=ready`,
        }),
      )
      .mockResolvedValueOnce(json({ id: 'new', receivedDateTime: receivedAt(-1) })),
  );
  const result = await fetchEmailPage(
    'OUTLOOK',
    'token',
    JSON.stringify({
      v: 2,
      provider: 'OUTLOOK',
      phase: 'initial',
      remaining: 0,
      url: `${base}?$skiptoken=tail`,
      startedAt: new Date(started).toISOString(),
      oldestAt: receivedAt(100),
    }),
  );
  expect(result.messages.map((m) => m.providerMessageId)).toEqual(['new']);
  expect(JSON.parse(result.cursor).remaining).toBe(0);
});

it('Outlook hydrates partial incremental updates before deciding whether they can create mail', async () => {
  const url =
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=current';
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        json({ value: [{ id: 'retained', isRead: true }], '@odata.deltaLink': url }),
      )
      .mockResolvedValueOnce(
        json({ id: 'retained', receivedDateTime: receivedAt(10), isRead: true }),
      ),
  );
  const result = await fetchEmailPage(
    'OUTLOOK',
    'token',
    JSON.stringify({
      v: 2,
      provider: 'OUTLOOK',
      phase: 'delta',
      remaining: 0,
      url,
      startedAt: new Date(started).toISOString(),
      oldestAt: receivedAt(100),
    }),
  );
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].isRead).toBe(true);
  expect(result.createIds).toEqual([]);
});
