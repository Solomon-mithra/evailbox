import { hashKey, hydrate, type QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client';
import { get, set, del, keys } from 'idb-keyval';
import { z } from 'zod';
import { workspaceIds, type WorkspaceId } from './workspace-selection';

export const SUMMARY_MAX_AGE = 24 * 60 * 60 * 1000;
const buster = 'inbox-v2';
export const cacheBuster = (scope: CacheScope) =>
  JSON.stringify([buster, scope.cacheVersion ?? 'default']);
const prefix = 'evailbox-summary-v1:';
export interface CacheScope {
  userId: string;
  workspace: WorkspaceId;
  cacheVersion?: string;
}
export interface CacheStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<IDBValidKey[]>;
}
const browserStorage: CacheStorage = { get, set, del, keys };
export const cacheKey = ({ userId, workspace }: CacheScope) =>
  `${prefix}${encodeURIComponent(userId)}:${workspace}`;
const classification = z.object({
  id: z.string(),
  tagId: z.string(),
  tagVersion: z.number(),
  matched: z.boolean(),
  confidence: z.number(),
  reasoning: z.string(),
  decision: z.string(),
  tag: z.object({
    id: z.string(),
    name: z.string(),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    version: z.number(),
  }),
});
// Whitelists are intentional. Never serialize arbitrary server results or TanStack state.
const pageSchema = z.object({
  emails: z
    .array(
      z.object({
        id: z.string(),
        accountId: z.string(),
        subject: z.string(),
        sender: z.string(),
        senderName: z.string(),
        snippet: z.string(),
        receivedAt: z.iso.datetime(),
        isRead: z.boolean(),
        handled: z.boolean(),
        webUrl: z.string(),
        classifications: z.array(classification),
      }),
    )
    .max(50),
  pageSize: z.literal(50),
  nextCursor: z.string().nullable(),
});
const keySchema = z.tuple([
  z.literal('private'),
  z.string(),
  z.enum(workspaceIds),
  z.literal('inbox'),
  z
    .object({
      cacheVersion: z.string().max(1000).optional(),
      search: z.string().max(200).optional(),
      tag: z.string().max(100).optional(),
      account: z.string().max(100).optional(),
      range: z.string().optional(),
      needs: z.string().optional(),
      cursor: z.string().max(3000).optional(),
    })
    .strict(),
]);
const envelope = z.object({
  timestamp: z.number(),
  buster: z.string(),
  clientState: z.object({ queries: z.array(z.unknown()) }),
});
const querySchema = z.object({
  queryKey: keySchema,
  state: z.object({
    status: z.enum(['success', 'error']),
    data: pageSchema,
    dataUpdatedAt: z.number(),
  }),
});
export function sanitizeCache(value: unknown, scope: CacheScope): PersistedClient | undefined {
  const parsed = envelope.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.buster !== cacheBuster(scope) ||
    Date.now() - parsed.data.timestamp > SUMMARY_MAX_AGE ||
    parsed.data.timestamp > Date.now() + 60000
  )
    return;
  const queries = parsed.data.clientState.queries
    .flatMap((value) => {
      const result = querySchema.safeParse(value);
      if (!result.success) return [];
      const { queryKey, state } = result.data;
      if (
        queryKey[1] !== scope.userId ||
        queryKey[2] !== scope.workspace ||
        queryKey[4].cacheVersion !== scope.cacheVersion ||
        Date.now() - state.dataUpdatedAt > SUMMARY_MAX_AGE ||
        state.dataUpdatedAt > Date.now() + 60000
      )
        return [];
      return [
        {
          queryKey,
          queryHash: hashKey(queryKey),
          dehydratedAt: Date.now(),
          state: {
            data: state.data,
            dataUpdatedAt: state.dataUpdatedAt,
            dataUpdateCount: 1,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: true,
            status: 'success' as const,
            fetchStatus: 'idle' as const,
          },
        },
      ];
    })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .slice(0, 8);
  return {
    timestamp: parsed.data.timestamp,
    buster: cacheBuster(scope),
    clientState: { mutations: [], queries },
  };
}

export function createSummaryPersister(
  scope: CacheScope,
  storage: CacheStorage = browserStorage,
): Persister & { close(): void } {
  let generation = 0;
  let closed = false;
  let pending = Promise.resolve();
  return {
    persistClient(value) {
      const epoch = generation;
      const safe = sanitizeCache(value, scope);
      pending = pending
        .then(async () => {
          if (!closed && epoch === generation && safe) await storage.set(cacheKey(scope), safe);
        })
        .catch(() => {});
      return pending;
    },
    async restoreClient() {
      const epoch = generation;
      try {
        const value = await storage.get(cacheKey(scope));
        if (closed || epoch !== generation) return;
        return sanitizeCache(value, scope);
      } catch {
        /* IndexedDB may be blocked, unavailable, full or evicted. */
      }
    },
    async removeClient() {
      generation++;
      pending = pending.then(() => storage.del(cacheKey(scope))).catch(() => {});
      await pending;
    },
    close() {
      closed = true;
      generation++;
    },
  };
}
const clearSchema = z.object({
  userId: z.string().optional(),
  workspace: z.enum(workspaceIds).optional(),
  reason: z.enum(['signout', 'disconnect', 'delete']),
  nonce: z.string().optional(),
});
export type CacheClear = z.infer<typeof clearSchema>;
interface Attached {
  client: QueryClient;
  scope: CacheScope;
  persister: ReturnType<typeof createSummaryPersister>;
  onClear(event: CacheClear): void;
  stopSubscription(): void;
}
const attached = new Set<Attached>();
let channel: BroadcastChannel | undefined;
let listening = false;
const seen = new Set<string>();
const eventKey = 'evailbox-private-cache-clear';
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const receive = (value: unknown) => {
    const parsed = clearSchema.safeParse(value);
    if (parsed.success) void applyClear(parsed.data, browserStorage);
  };
  try {
    channel = new BroadcastChannel(eventKey);
    channel.onmessage = (event) => receive(event.data);
  } catch {
    /* storage events provide the fallback */
  }
  window.addEventListener('storage', (event) => {
    if (event.key === eventKey && event.newValue) {
      try {
        receive(JSON.parse(event.newValue));
      } catch {}
    }
  });
}

export function attachSummaryCache(
  client: QueryClient,
  scope: CacheScope,
  onClear: (event: CacheClear) => void,
  storage: CacheStorage = browserStorage,
) {
  listen();
  const persister = createSummaryPersister(scope, storage);
  const options = {
    queryClient: client,
    persister,
    buster: cacheBuster(scope),
    maxAge: SUMMARY_MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query: {
        queryKey: readonly unknown[];
        state: { status: string; data: unknown };
      }) =>
        query.queryKey[0] === 'private' &&
        query.queryKey[1] === scope.userId &&
        query.queryKey[2] === scope.workspace &&
        query.queryKey[3] === 'inbox' &&
        query.state.data !== undefined,
    },
  };
  let stopped = false;
  let unsubscribe = () => {};
  const entry: Attached = {
    client,
    scope,
    persister,
    onClear,
    stopSubscription: () => {
      stopped = true;
      unsubscribe();
    },
  };
  attached.add(entry);
  const ready = Promise.resolve(persister.restoreClient())
    .then((value) => {
      // Check the attachment after the async read, immediately before synchronous hydration.
      if (stopped) return;
      if (value) hydrate(client, value.clientState);
      unsubscribe = persistQueryClientSubscribe(options);
    })
    .catch(() => {});
  return {
    ready,
    stop() {
      entry.stopSubscription();
      persister.close();
      attached.delete(entry);
    },
  };
}
async function applyClear(event: CacheClear, storage: CacheStorage) {
  if (event.nonce && seen.has(event.nonce)) return;
  if (event.nonce) {
    seen.add(event.nonce);
    if (seen.size > 50) seen.delete(seen.values().next().value!);
  }
  const matching = [...attached].filter(
    (entry) => !event.userId || entry.scope.userId === event.userId,
  );
  // Stop subscriptions before cache mutations so a late write cannot resurrect deleted mail.
  for (const entry of matching) {
    if (!event.workspace || entry.scope.workspace === event.workspace) {
      entry.stopSubscription();
      entry.persister.close();
    }
  }
  const clients = [...new Set(matching.map((entry) => entry.client))];
  for (const client of clients) {
    await client.cancelQueries({
      predicate: (query) =>
        query.queryKey[0] === 'private' &&
        (!event.userId || query.queryKey[1] === event.userId) &&
        (!event.workspace || query.queryKey[2] === event.workspace),
    });
    if (event.reason !== 'disconnect') client.clear();
    else
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === 'private' &&
          (!event.userId || query.queryKey[1] === event.userId) &&
          (!event.workspace || query.queryKey[2] === event.workspace),
      });
  }
  await Promise.all(
    matching
      .filter((entry) => !event.workspace || entry.scope.workspace === event.workspace)
      .map((entry) => entry.persister.removeClient()),
  );
  try {
    // Also remove inactive workspace partitions and previous browser identities on sign-out.
    const storedKeys = await storage.keys();
    await Promise.all(
      storedKeys
        .filter(
          (key): key is string =>
            typeof key === 'string' &&
            key.startsWith(
              event.userId ? `${prefix}${encodeURIComponent(event.userId)}:` : prefix,
            ) &&
            (!event.workspace || key.endsWith(`:${event.workspace}`)),
        )
        .map((key) => storage.del(key)),
    );
  } catch {}
  for (const entry of matching)
    if (!event.workspace || entry.scope.workspace === event.workspace) entry.onClear(event);
}
export async function clearPrivateCache(event: CacheClear, storage: CacheStorage = browserStorage) {
  const message = { ...event, nonce: crypto.randomUUID() };
  // Notify peers promptly, then wait for local pending writes/deletions to finish.
  try {
    channel?.postMessage(message);
  } catch {}
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(eventKey, JSON.stringify(message));
      window.localStorage.removeItem(eventKey);
    } catch {}
  }
  await applyClear(message, storage);
}
