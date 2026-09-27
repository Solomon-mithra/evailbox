import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver, dehydrate } from '@tanstack/react-query';
import {
  createEmailIntent,
  emailContentQuery,
  emailThreadQuery,
  emailThreadNeedsRefresh,
  preloadEmail,
  preloadReplyDraft,
  replyDraftQuery,
} from '@/lib/email-preload';
import { cacheBuster, sanitizeCache } from '@/lib/query-cache';

const scope = { userId: 'alice', workspace: 'PERSONAL' as const };
let client: QueryClient;
const html = '<!doctype html><p>Full message</p>';
const replyDraft = {
  draft: null,
  account: { id: 'account', email: 'alice@example.com', provider: 'GMAIL' },
  context: null,
  notice: null,
};
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/content?')
        ? new Response(html, { headers: { 'Content-Type': 'text/html' } })
        : Response.json({ data: { id: 'mail', classifications: [] } }),
    ),
  );
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('waits a full second, cancels quick passes and starts immediately on click', async () => {
  const load = vi.fn();
  const intent = createEmailIntent(load);
  intent.start();
  await vi.advanceTimersByTimeAsync(999);
  expect(load).not.toHaveBeenCalled();
  intent.cancel();
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).not.toHaveBeenCalled();
  intent.start();
  intent.start(); // A focus event during hover must not reset the timer.
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(1);
  intent.start();
  intent.open();
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(2);
});

it('shares the in-flight body fetch between hover and click, including images', async () => {
  const preload = preloadEmail(client, scope, 'mail');
  const opened = client.fetchQuery(emailContentQuery(scope, 'mail'));
  await preload;
  expect((await opened).html).toBe(html);
  await preloadEmail(client, scope, 'mail');
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/content?')),
  ).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith(
    '/api/emails/mail/content?images=1&workspace=PERSONAL',
    expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }),
  );
});

it('isolates users, workspaces and image preferences; never persists bodies', async () => {
  await preloadEmail(client, scope, 'mail');
  expect(
    client.getQueryData(emailContentQuery({ ...scope, userId: 'bob' }, 'mail').queryKey),
  ).toBeUndefined();
  expect(
    client.getQueryData(emailContentQuery({ ...scope, workspace: 'WORK' }, 'mail').queryKey),
  ).toBeUndefined();
  expect(client.getQueryData(emailContentQuery(scope, 'mail', false).queryKey)).toBeUndefined();
  const saved = sanitizeCache(
    { timestamp: Date.now(), buster: cacheBuster(scope), clientState: dehydrate(client) },
    scope,
  );
  expect(saved?.clientState.queries).toEqual([]);
});

it('bounds speculative content to three messages and expires it after two minutes', async () => {
  for (const id of ['a', 'b', 'c', 'd']) {
    await preloadEmail(client, scope, id);
    await vi.advanceTimersByTimeAsync(1);
  }
  const bodies = () =>
    client
      .getQueryCache()
      .findAll()
      .filter((q) => q.queryKey[3] === 'content');
  expect(bodies()).toHaveLength(3);
  expect(client.getQueryData(emailContentQuery(scope, 'a').queryKey)).toBeUndefined();
  await vi.advanceTimersByTimeAsync(120_001);
  expect(bodies()).toHaveLength(0);
});

it('retries failed preloads on open and does not treat a preview fallback as fresh', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('Offline', { status: 503 }));
  await client.prefetchQuery(emailContentQuery(scope, 'mail'));
  expect((await client.fetchQuery(emailContentQuery(scope, 'mail'))).html).toBe(html);
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response('Preview', {
      headers: { 'Content-Type': 'text/html', 'X-Email-Content-Fallback': '1' },
    }),
  );
  await client.prefetchQuery(emailContentQuery(scope, 'other'));
  expect((await client.fetchQuery(emailContentQuery(scope, 'other'))).html).toBe(html);
});

it('does not reload an open message when background tagging refreshes the inbox', async () => {
  const options = emailContentQuery(scope, 'mail');
  await client.fetchQuery(options);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.invalidateQueries({ queryKey: ['private', scope.userId, scope.workspace] });
    await client.fetchQuery(options);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});

it('keeps conversations private and stable until an explicit refresh', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ data: { messages: [], partial: false } }));
  const options = emailThreadQuery(scope, 'mail');
  await client.fetchQuery(options);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.invalidateQueries({ queryKey: ['private', scope.userId, scope.workspace] });
    expect(fetch).toHaveBeenCalledTimes(1);
    await observer.refetch();
    expect(fetch).toHaveBeenCalledTimes(2);
    const saved = sanitizeCache(
      { timestamp: Date.now(), buster: cacheBuster(scope), clientState: dehydrate(client) },
      scope,
    );
    expect(saved?.clientState.queries).toEqual([]);
    expect(
      client.getQueryData(emailThreadQuery({ ...scope, workspace: 'WORK' }, 'mail').queryKey),
    ).toBeUndefined();
    expect(
      client.getQueryData(emailThreadQuery({ ...scope, userId: 'bob' }, 'mail').queryKey),
    ).toBeUndefined();
    expect(client.getQueryData(emailThreadQuery(scope, 'mail', false).queryKey)).toBeUndefined();
  } finally {
    unsubscribe();
  }
});

it('reuses complete conversations for thirty seconds while retrying missing or partial threads', () => {
  const updatedAt = Date.now();
  const complete = { messages: [], partial: false };
  expect(emailThreadNeedsRefresh(undefined, 0)).toBe(true);
  expect(emailThreadNeedsRefresh({ ...complete, partial: true }, updatedAt)).toBe(true);
  expect(emailThreadNeedsRefresh(complete, updatedAt, updatedAt + 29_999)).toBe(false);
  expect(emailThreadNeedsRefresh(complete, updatedAt, updatedAt + 30_000)).toBe(true);
});

it('shares a pending local draft preload with the composer and refreshes after fifteen seconds', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch)
    .mockImplementation(async () => Response.json({ data: replyDraft }))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const preload = preloadReplyDraft(client, scope, 'mail');
  const opened = client.fetchQuery(replyDraftQuery(scope, 'mail'));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    '/api/emails/mail/draft?context=0&workspace=PERSONAL',
    expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) }),
  );
  finish(Response.json({ data: replyDraft }));
  await preload;
  expect(await opened).toEqual(replyDraft);
  await preloadReplyDraft(client, scope, 'mail');
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15_001);
  await client.fetchQuery(replyDraftQuery(scope, 'mail'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps at most three speculative local drafts in private memory for two minutes', async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({ data: replyDraft }));
  for (const id of ['a', 'b', 'c', 'd']) {
    await preloadReplyDraft(client, scope, id);
    await vi.advanceTimersByTimeAsync(1);
  }
  const drafts = () =>
    client
      .getQueryCache()
      .findAll()
      .filter((query) => query.queryKey[3] === 'reply-draft');
  expect(drafts()).toHaveLength(3);
  expect(client.getQueryData(replyDraftQuery(scope, 'a').queryKey)).toBeUndefined();
  expect(
    client.getQueryData(replyDraftQuery({ ...scope, userId: 'bob' }, 'd').queryKey),
  ).toBeUndefined();
  expect(
    client.getQueryData(replyDraftQuery({ ...scope, workspace: 'WORK' }, 'd').queryKey),
  ).toBeUndefined();
  const saved = sanitizeCache(
    { timestamp: Date.now(), buster: cacheBuster(scope), clientState: dehydrate(client) },
    scope,
  );
  expect(saved?.clientState.queries).toEqual([]);
  await vi.advanceTimersByTimeAsync(120_001);
  expect(drafts()).toHaveLength(0);
});

it('aborts local draft preloads when private queries are cleared', async () => {
  let finish!: (response: Response) => void;
  let signal!: AbortSignal;
  vi.mocked(fetch).mockImplementationOnce((_url, options) => {
    signal = options!.signal!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const preload = preloadReplyDraft(client, scope, 'mail');
  client.removeQueries({ queryKey: ['private', scope.userId] });
  expect(signal.aborted).toBe(true);
  finish(Response.json({ data: replyDraft }));
  await preload;
  expect(client.getQueryData(replyDraftQuery(scope, 'mail').queryKey)).toBeUndefined();
});

it('aborts a removed private request without restoring cached content afterward', async () => {
  let finish!: (value: Response) => void;
  let signal!: AbortSignal;
  vi.mocked(fetch).mockImplementationOnce((_url, options) => {
    signal = options!.signal!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = client.prefetchQuery(emailContentQuery(scope, 'mail'));
  client.removeQueries({ queryKey: ['private', scope.userId] });
  expect(signal.aborted).toBe(true);
  finish(new Response(html, { headers: { 'Content-Type': 'text/html' } }));
  await pending;
  expect(client.getQueryData(emailContentQuery(scope, 'mail').queryKey)).toBeUndefined();
});

it('warms only HTTPS images without referrers, once per cached message', async () => {
  const images: { src?: string; referrerPolicy?: string; fetchPriority?: string }[] = [];
  vi.stubGlobal(
    'Image',
    class {
      constructor() {
        images.push(this);
      }
      src = '';
      referrerPolicy = '';
      fetchPriority = '';
      decode() {
        return Promise.resolve();
      }
    },
  );
  // Stand in only for the browser's inert template parser; exercise the real preload.
  vi.stubGlobal('document', {
    createElement: () => ({
      content: {
        querySelectorAll: () =>
          [
            'https://images.example/cover.png',
            'https://images.example/cover.png',
            '/api/private',
            'javascript:alert(1)',
            'http://images.example/insecure.png',
          ].map((src) => ({ getAttribute: () => src })),
      },
    }),
  });
  await preloadEmail(client, scope, 'mail');
  await preloadEmail(client, scope, 'mail');
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({
    src: 'https://images.example/cover.png',
    referrerPolicy: 'no-referrer',
    fetchPriority: 'low',
  });
});
