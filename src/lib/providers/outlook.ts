import 'server-only';
import { WORK_BATCH_SIZE } from './sync-policy';
import { z } from 'zod';
import { authHeaders, ProviderHttpError, requestJson } from './http';
import type { ProviderEmail, SyncPage } from './types';
import { INITIAL_IMPORT_LIMIT } from './sync-policy';
const cursorSchema = z.object({
  v: z.literal(1),
  provider: z.literal('OUTLOOK'),
  url: z.string().max(32000),
});
function trustedDeltaUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'graph.microsoft.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/v1\.0\/me\/mailfolders(?:\/[^/]+|\('[^']+'\))\/messages\/delta$/i.test(url.pathname)
  )
    throw new Error('Invalid Outlook sync cursor');
  return value;
}
const messageSchema = z.object({
  id: z.string().min(1),
  '@removed': z.unknown().optional(),
  subject: z.string().optional(),
  receivedDateTime: z.string().optional(),
  from: z
    .object({
      emailAddress: z.object({ address: z.string().optional(), name: z.string().optional() }),
    })
    .optional(),
  sender: z
    .object({
      emailAddress: z.object({ address: z.string().optional(), name: z.string().optional() }),
    })
    .optional(),
  body: z.object({ contentType: z.string(), content: z.string() }).optional(),
  bodyPreview: z.string().optional(),
  isRead: z.boolean().optional(),
  webLink: z.string().optional(),
});
function safeWebUrl(value: string | undefined): string {
  if (!value) return 'https://outlook.office.com/mail/inbox';
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'].includes(url.hostname)
    )
      return value;
  } catch {
    /* Use the provider's inbox fallback. */
  }
  return 'https://outlook.office.com/mail/inbox';
}
async function fetchLegacyOutlookPage(token: string, serialized: string | null): Promise<SyncPage> {
  const initial = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,subject,from,sender,bodyPreview,body,receivedDateTime,isRead,webLink&$top=${WORK_BATCH_SIZE}`;
  const url = serialized
    ? trustedDeltaUrl(cursorSchema.parse(JSON.parse(serialized)).url)
    : initial;
  let raw: unknown;
  try {
    raw = await requestJson(url, {
      headers: {
        ...authHeaders(token),
        Prefer: `odata.maxpagesize=${WORK_BATCH_SIZE}, outlook.body-content-type="text", IdType="ImmutableId"`,
      },
    });
  } catch (error) {
    if (serialized && error instanceof ProviderHttpError && error.status === 410)
      return { ...(await fetchLegacyOutlookPage(token, null)), reset: true };
    throw error;
  }
  const page = z
    .object({
      value: z.array(messageSchema),
      '@odata.nextLink': z.string().optional(),
      '@odata.deltaLink': z.string().optional(),
    })
    .parse(raw);
  const next = page['@odata.nextLink'] || page['@odata.deltaLink'];
  if (!next) throw new Error('Outlook response omitted a sync cursor');
  const messages: ProviderEmail[] = [];
  const deletedIds: string[] = [];
  for (const message of page.value) {
    if (message['@removed']) {
      deletedIds.push(message.id);
      continue;
    }
    const receivedAt = new Date(message.receivedDateTime ?? '');
    if (!Number.isFinite(receivedAt.getTime()))
      throw new Error('Invalid Outlook message timestamp');
    const from = message.from?.emailAddress ?? message.sender?.emailAddress;
    messages.push({
      providerMessageId: message.id,
      subject: (message.subject ?? '').slice(0, 2000),
      sender: (from?.address ?? '').toLowerCase(),
      senderName: from?.name ?? '',
      snippet: (message.bodyPreview ?? '').slice(0, 2000),
      body:
        message.body?.contentType.toLowerCase() === 'text'
          ? message.body.content.slice(0, 64000)
          : null,
      receivedAt,
      isRead: message.isRead ?? false,
      webUrl: safeWebUrl(message.webLink),
    });
  }
  return {
    messages,
    deletedIds,
    cursor: JSON.stringify({ v: 1, provider: 'OUTLOOK', url: trustedDeltaUrl(next) }),
    hasMore: Boolean(page['@odata.nextLink']),
  };
}

const boundedCursorSchema = z.object({
  v: z.literal(2),
  provider: z.literal('OUTLOOK'),
  url: z.string().max(32000),
  phase: z.enum(['initial', 'delta', 'rescan']),
  remaining: z.number().int().min(0).max(INITIAL_IMPORT_LIMIT),
  startedAt: z.iso.datetime(),
  oldestAt: z.iso.datetime().optional(),
});
type BoundedCursor = z.infer<typeof boundedCursorSchema>;
const deltaBase = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta';
function referenceDeltaUrl() {
  const url = new URL(deltaBase);
  url.search = new URLSearchParams({
    $select: 'id,receivedDateTime',
    $orderby: 'receivedDateTime desc',
    $top: String(WORK_BATCH_SIZE),
  }).toString();
  return url.toString();
}

/** Graph needs the terminal delta token. Older pages contain references only, never bodies. */
export async function fetchOutlookPage(
  token: string,
  serialized: string | null,
): Promise<SyncPage> {
  const decoded: unknown = serialized ? JSON.parse(serialized) : null;
  if (decoded && typeof decoded === 'object' && 'v' in decoded && decoded.v === 1)
    return fetchLegacyOutlookPage(token, serialized);
  const cursor: BoundedCursor = decoded
    ? boundedCursorSchema.parse(decoded)
    : {
        v: 2,
        provider: 'OUTLOOK',
        url: referenceDeltaUrl(),
        phase: 'initial',
        remaining: INITIAL_IMPORT_LIMIT,
        startedAt: new Date(Date.now()).toISOString(),
      };
  const url = trustedDeltaUrl(cursor.url);
  const pageSize = cursor.phase === 'initial' && cursor.remaining === 0 ? 1000 : WORK_BATCH_SIZE;
  let raw: unknown;
  try {
    raw = await requestJson(url, {
      headers: {
        ...authHeaders(token),
        Prefer: `odata.maxpagesize=${pageSize}, IdType="ImmutableId"`,
      },
    });
  } catch (error) {
    const query = new URL(url).searchParams;
    if (
      error instanceof ProviderHttpError &&
      error.status === 410 &&
      (query.has('$deltatoken') || query.has('$skiptoken'))
    ) {
      return {
        ...(await fetchOutlookPage(
          token,
          cursor.phase === 'initial'
            ? null
            : JSON.stringify({ ...cursor, phase: 'rescan', url: referenceDeltaUrl() }),
        )),
        reset: true,
      };
    }
    throw error;
  }
  const page = z
    .object({
      value: z.array(messageSchema),
      '@odata.nextLink': z.string().optional(),
      '@odata.deltaLink': z.string().optional(),
    })
    .parse(raw);
  const next = page['@odata.nextLink'] || page['@odata.deltaLink'];
  if (!next) throw new Error('Outlook response omitted a sync cursor');
  trustedDeltaUrl(next);
  const deleted = new Set(page.value.filter((m) => m['@removed']).map((m) => m.id));
  const references = [
    ...new Map(page.value.filter((m) => !m['@removed']).map((m) => [m.id, m])).values(),
  ];
  for (const message of references)
    if (
      !(cursor.phase === 'delta' && message.receivedDateTime === undefined) &&
      !Number.isFinite(Date.parse(message.receivedDateTime ?? ''))
    )
      throw new Error('Invalid Outlook message timestamp');
  let remaining = cursor.remaining;
  const selected = references.filter((message) => {
    // Read/unread delta updates can omit unchanged fields. Hydration supplies their date.
    if (cursor.phase === 'delta' && message.receivedDateTime === undefined) return true;
    const receivedAt = Date.parse(message.receivedDateTime!);
    // New arrivals during bootstrap must survive after the historical allowance is exhausted.
    if (receivedAt >= Date.parse(cursor.startedAt)) return true;
    if (cursor.phase === 'initial') {
      if (remaining === 0) return false;
      remaining--;
      return true;
    }
    return receivedAt >= Date.parse(cursor.oldestAt ?? cursor.startedAt);
  });
  const messages: ProviderEmail[] = [];
  for (let offset = 0; offset < selected.length; offset += 4) {
    const chunk = await Promise.all(
      selected.slice(offset, offset + 4).map(async (reference) => {
        try {
          const message = messageSchema.parse(
            await requestJson(
              `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(reference.id)}?$select=id,subject,from,sender,bodyPreview,body,receivedDateTime,isRead,webLink`,
              {
                headers: {
                  ...authHeaders(token),
                  Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"',
                },
              },
            ),
          );
          const receivedAt = new Date(message.receivedDateTime ?? '');
          if (!Number.isFinite(receivedAt.getTime()))
            throw new Error('Invalid Outlook message timestamp');
          const from = message.from?.emailAddress ?? message.sender?.emailAddress;
          return {
            providerMessageId: message.id,
            subject: (message.subject ?? '').slice(0, 2000),
            sender: (from?.address ?? '').toLowerCase(),
            senderName: from?.name ?? '',
            snippet: (message.bodyPreview ?? '').slice(0, 2000),
            body:
              message.body?.contentType.toLowerCase() === 'text'
                ? message.body.content.slice(0, 64000)
                : null,
            receivedAt,
            isRead: message.isRead ?? false,
            webUrl: safeWebUrl(message.webLink),
          } satisfies ProviderEmail;
        } catch (error) {
          if (error instanceof ProviderHttpError && error.status === 404) {
            deleted.add(reference.id);
            return null;
          }
          throw error;
        }
      }),
    );
    messages.push(...chunk.filter((m): m is ProviderEmail => m !== null));
  }
  const oldestAt = new Date(
    Math.min(
      Date.parse(cursor.oldestAt ?? cursor.startedAt),
      ...messages.map((m) => m.receivedAt.getTime()),
    ),
  ).toISOString();
  return {
    messages,
    deletedIds: [...deleted],
    hasMore: Boolean(page['@odata.nextLink']),
    cursor: JSON.stringify({
      ...cursor,
      url: next,
      oldestAt,
      remaining,
      phase: page['@odata.nextLink'] ? cursor.phase : 'delta',
    }),
    ...(cursor.phase !== 'initial'
      ? {
          createIds: messages
            .filter((m) => m.receivedAt.getTime() >= Date.parse(cursor.startedAt))
            .map((m) => m.providerMessageId),
        }
      : {}),
  };
}
