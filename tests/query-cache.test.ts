import { beforeEach, expect, it } from 'vitest';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import {
  createSummaryPersister,
  cacheKey,
  cacheBuster,
  sanitizeCache,
  attachSummaryCache,
  clearPrivateCache,
  type CacheStorage,
} from '@/lib/query-cache';
const scope = { userId: 'alice', workspace: 'PERSONAL' as const };
let saved: Map<string, unknown>;
let storage: CacheStorage;
const sample = {
  emails: [
    {
      id: 'mail',
      accountId: 'gmail',
      subject: 'Hello',
      sender: 'a@example.com',
      senderName: 'A',
      snippet: 'Short',
      receivedAt: '2026-09-25T10:00:00.000Z',
      isRead: false,
      handled: false,
      webUrl: 'https://mail.google.com',
      classifications: [],
    },
  ],
  pageSize: 50,
  nextCursor: null,
};
function state(client: QueryClient): PersistedClient {
  return { timestamp: Date.now(), buster: cacheBuster(scope), clientState: dehydrate(client) };
}
beforeEach(() => {
  saved = new Map();
  storage = {
    get: async (k) => saved.get(k),
    set: async (k, v) => {
      saved.set(k, v);
    },
    del: async (k) => {
      saved.delete(k);
    },
    keys: async () => [...saved.keys()],
  };
});
it('persists only body-free summary pages in the authenticated user/workspace partition', async () => {
  const client = new QueryClient();
  const key = ['private', 'alice', 'PERSONAL', 'inbox', {}];
  client.setQueryData(key, {
    ...sample,
    accessToken: 'SECRET',
    emails: [{ ...sample.emails[0], body: 'SECRET BODY', refreshToken: 'SECRET' }],
  });
  client.setQueryData(['auth'], { session: 'SECRET' });
  client.setQueryData(['private', 'alice', 'PERSONAL', 'detail', 'mail'], { body: 'SECRET' });
  client.setQueryData(['private', 'bob', 'PERSONAL', 'inbox', {}], sample);
  client.setQueryData(['private', 'alice', 'WORK', 'inbox', {}], sample);
  const persister = createSummaryPersister(scope, storage);
  await persister.persistClient(state(client));
  const restored = await persister.restoreClient();
  expect(restored?.clientState.queries).toHaveLength(1);
  expect(restored?.clientState.mutations).toEqual([]);
  expect(JSON.stringify(saved.get(cacheKey(scope)))).not.toContain('SECRET');
  expect(restored?.clientState.queries[0].state.data).toEqual(sample);
});
it('validates stored envelopes and drops cross-user data even if the storage key is tampered', () => {
  const client = new QueryClient();
  client.setQueryData(['private', 'bob', 'PERSONAL', 'inbox', {}], sample);
  expect(sanitizeCache(state(client), scope)?.clientState.queries).toEqual([]);
  expect(sanitizeCache({ clientState: { queries: [null] } }, scope)).toBeUndefined();
});
it('bounds saved queries and expires old summaries', () => {
  const client = new QueryClient();
  for (let i = 0; i < 30; i++)
    client.setQueryData(['private', 'alice', 'PERSONAL', 'inbox', { search: String(i) }], sample);
  client.setQueryData(['private', 'alice', 'PERSONAL', 'inbox', { search: 'old' }], sample, {
    updatedAt: Date.now() - 86400001,
  });
  expect(sanitizeCache(state(client), scope)?.clientState.queries).toHaveLength(8);
  expect(JSON.stringify(sanitizeCache(state(client), scope))).not.toContain('"old"');
});
it('degrades to memory when storage is unavailable', async () => {
  const broken = async () => {
    throw new Error('Denied');
  };
  const persister = createSummaryPersister(scope, {
    get: broken,
    set: broken,
    del: broken,
    keys: broken,
  });
  expect(await persister.restoreClient()).toBeUndefined();
  await expect(persister.persistClient(state(new QueryClient()))).resolves.toBeUndefined();
  await expect(persister.removeClient()).resolves.toBeUndefined();
});
it('does not restore a delayed read after the cache was cleared', async () => {
  const client = new QueryClient();
  client.setQueryData(['private', 'alice', 'PERSONAL', 'inbox', {}], sample);
  let finish!: (v: unknown) => void;
  const persister = createSummaryPersister(scope, {
    ...storage,
    get: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const restore = persister.restoreClient();
  await persister.removeClient();
  finish(state(client));
  expect(await restore).toBeUndefined();
});
it('clears disconnected workspace caches in every attached tab and stops late storage writes', async () => {
  const first = new QueryClient(),
    second = new QueryClient();
  const stop1 = attachSummaryCache(first, scope, () => {}, storage);
  const stop2 = attachSummaryCache(second, scope, () => {}, storage);
  await Promise.all([stop1.ready, stop2.ready]);
  for (const c of [first, second]) {
    c.setQueryData(['private', 'alice', 'PERSONAL', 'inbox', {}], sample);
    c.setQueryData(['private', 'alice', 'WORK', 'inbox', {}], sample);
  }
  await clearPrivateCache({ ...scope, reason: 'disconnect' }, storage);
  expect(first.getQueryData(['private', 'alice', 'PERSONAL', 'inbox', {}])).toBeUndefined();
  expect(second.getQueryData(['private', 'alice', 'PERSONAL', 'inbox', {}])).toBeUndefined();
  expect(first.getQueryData(['private', 'alice', 'WORK', 'inbox', {}])).toEqual(sample);
  expect(saved.has(cacheKey(scope))).toBe(false);
  stop1.stop();
  stop2.stop();
  first.clear();
  second.clear();
});

it('clears both workspaces and all memory on account deletion without touching another user partition', async () => {
  const client = new QueryClient();
  const cleared: string[] = [];
  const attached = attachSummaryCache(client, scope, (e) => cleared.push(e.reason), storage);
  await attached.ready;
  saved.set(cacheKey(scope), {});
  saved.set(cacheKey({ ...scope, workspace: 'WORK' }), {});
  saved.set(cacheKey({ ...scope, userId: 'bob' }), {});
  client.setQueryData(['private', 'alice', 'PERSONAL', 'detail', 'mail'], { body: 'private body' });
  client.setQueryData(['auth', 'alice'], { id: 'alice' });
  await clearPrivateCache({ userId: 'alice', reason: 'delete' }, storage);
  expect(client.getQueryCache().getAll()).toEqual([]);
  expect([...saved.keys()]).toEqual([cacheKey({ ...scope, userId: 'bob' })]);
  expect(cleared).toEqual(['delete']);
  attached.stop();
});

it('retains the last successful summary snapshot after a background network failure', () => {
  const client = new QueryClient();
  const key = ['private', 'alice', 'PERSONAL', 'inbox', {}];
  client.setQueryData(key, sample);
  const query = client.getQueryCache().find({ queryKey: key })!;
  query.setState({ status: 'error', error: new Error('Offline') });
  const persisted = {
    timestamp: Date.now(),
    buster: cacheBuster(scope),
    clientState: dehydrate(client, { shouldDehydrateQuery: () => true }),
  };
  expect(sanitizeCache(persisted, scope)?.clientState.queries[0]?.state.data).toEqual(sample);
});

it('rejects persisted decisions from another server-provided model/policy revision', async () => {
  const client = new QueryClient();
  client.setQueryData(
    ['private', 'alice', 'PERSONAL', 'inbox', { cacheVersion: 'model-1' }],
    sample,
  );
  const oldScope = { ...scope, cacheVersion: 'model-1' };
  const persister = createSummaryPersister(oldScope, storage);
  const value = state(client);
  const { cacheBuster } = await import('@/lib/query-cache');
  value.buster = cacheBuster(oldScope);
  await persister.persistClient(value);
  expect((await persister.restoreClient())?.clientState.queries).toHaveLength(1);
  expect(
    await createSummaryPersister({ ...scope, cacheVersion: 'model-2' }, storage).restoreClient(),
  ).toBeUndefined();
});
