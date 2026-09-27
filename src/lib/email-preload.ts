import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { workspacePath, type WorkspaceId } from './workspace-selection';
import type { Email } from '@/types';
import type { EmailThread } from '@/types/email-thread';
import type { ReplyDraftResult } from './mail-actions';

interface EmailScope {
  userId: string;
  workspace: WorkspaceId;
}
interface EmailContent {
  html: string;
  fallback: boolean;
}
const lifetime = 2 * 60 * 1000;
const warmed = new WeakSet<EmailContent>();

export function createEmailIntent(load: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    start() {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        load();
      }, 1000);
    },
    cancel,
    open() {
      cancel();
      load();
    },
  };
}

export function emailDetailQuery(scope: EmailScope, id: string) {
  return queryOptions({
    queryKey: ['private', scope.userId, scope.workspace, 'detail', id],
    queryFn: ({ signal }) =>
      api.get<Email>(
        workspacePath(`/api/emails/${encodeURIComponent(id)}`, scope.workspace),
        signal,
      ),
    staleTime: lifetime,
    gcTime: lifetime,
  });
}

export function emailContentQuery(scope: EmailScope, id: string, images = true) {
  return queryOptions({
    queryKey: ['private', scope.userId, scope.workspace, 'content', id, images],
    queryFn: async ({ signal }): Promise<EmailContent> => {
      const response = await fetch(
        workspacePath(
          `/api/emails/${encodeURIComponent(id)}/content?images=${images ? '1' : '0'}`,
          scope.workspace,
        ),
        { credentials: 'same-origin', cache: 'no-store', signal },
      );
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/html'))
        throw new Error('Could not load this message. Please try again.');
      const html = await response.text();
      signal.throwIfAborted();
      return { html, fallback: response.headers.get('X-Email-Content-Fallback') === '1' };
    },
    // Mail content is immutable during this short cache lifetime. Inbox/tagging
    // invalidations must not reload the iframe while the user is reading it.
    // A provider outage can return a snippet; opening that must retry the message.
    staleTime: (query) => (query.state.data?.fallback ? 0 : 'static'),
    gcTime: lifetime,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function emailThreadQuery(scope: EmailScope, id: string, images = true) {
  return queryOptions({
    queryKey: ['private', scope.userId, scope.workspace, 'thread', id, images],
    queryFn: ({ signal }) =>
      api.get<EmailThread>(
        workspacePath(
          `/api/emails/${encodeURIComponent(id)}/thread?images=${images ? '1' : '0'}`,
          scope.workspace,
        ),
        signal,
      ),
    // Refresh an older conversation on reader open, or explicitly after a sent reply.
    // Never refresh on background inbox updates.
    // Replacing sanitized documents while reading would reset iframe heights.
    staleTime: 'static',
    gcTime: lifetime,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function emailThreadNeedsRefresh(
  thread: EmailThread | undefined,
  updatedAt: number,
  now = Date.now(),
) {
  return !thread || thread.partial || now - updatedAt >= 30_000;
}

export function replyDraftQuery(scope: EmailScope, id: string) {
  return queryOptions({
    queryKey: ['private', scope.userId, scope.workspace, 'reply-draft', id],
    queryFn: ({ signal }) =>
      api.get<ReplyDraftResult>(
        workspacePath(`/api/emails/${encodeURIComponent(id)}/draft?context=0`, scope.workspace),
        signal,
      ),
    // The saved local draft loads independently of slower provider recipients.
    // Saves and sends update this private cache; it is never persisted to disk.
    staleTime: 15_000,
    gcTime: lifetime,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export async function preloadReplyDraft(client: QueryClient, scope: EmailScope, id: string) {
  const options = replyDraftQuery(scope, id);
  const otherDrafts = client
    .getQueryCache()
    .findAll()
    .filter(
      (query) =>
        query.queryKey[0] === 'private' &&
        query.queryKey[3] === 'reply-draft' &&
        query.getObserversCount() === 0 &&
        JSON.stringify(query.queryKey) !== JSON.stringify(options.queryKey),
    )
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of otherDrafts.slice(2))
    client.removeQueries({ queryKey: query.queryKey, exact: true });
  await client.prefetchQuery(options);
}

function warmImages(content: EmailContent) {
  if (typeof document === 'undefined' || warmed.has(content) || content.fallback) return;
  warmed.add(content);
  // Only parse the server-sanitized document, in an inert template, never in the app DOM.
  const template = document.createElement('template');
  template.innerHTML = content.html;
  const urls = new Set(
    Array.from(template.content.querySelectorAll('img[src]'), (img) => img.getAttribute('src')!),
  );
  for (const url of [...urls].filter((url) => /^https:\/\//i.test(url)).slice(0, 32)) {
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.fetchPriority = 'low';
    image.src = url;
    void image.decode().catch(() => {});
  }
}

export async function preloadEmail(client: QueryClient, scope: EmailScope, id: string) {
  const options = emailContentQuery(scope, id);
  // Keep at most three speculative bodies across workspaces, plus any open reader.
  // These private queries are deliberately excluded by the summary-only persister.
  const otherBodies = client
    .getQueryCache()
    .findAll()
    .filter(
      (query) =>
        query.queryKey[0] === 'private' &&
        query.queryKey[3] === 'content' &&
        query.getObserversCount() === 0 &&
        JSON.stringify(query.queryKey) !== JSON.stringify(options.queryKey),
    )
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of otherBodies.slice(2))
    client.removeQueries({ queryKey: query.queryKey, exact: true });
  await Promise.all([
    client.prefetchQuery(emailDetailQuery(scope, id)),
    client
      .fetchQuery(options)
      .then((content) => {
        // Sign-out or a disconnection may have removed this request while it was pending.
        if (client.getQueryData(options.queryKey) === content) warmImages(content);
      })
      .catch(() => {}),
  ]);
}
