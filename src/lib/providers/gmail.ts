import 'server-only';
import { WORK_BATCH_SIZE } from '../inngest/config';
import { z } from 'zod';
import { authHeaders, ProviderHttpError, requestJson } from './http';
import type { ProviderEmail, SyncPage } from './types';
const base = 'https://gmail.googleapis.com/gmail/v1/users/me';
const id = z.string().min(1).max(1024);
const cursorSchema = z.discriminatedUnion('phase', [
  z.object({
    v: z.literal(1),
    provider: z.literal('GMAIL'),
    phase: z.literal('initial'),
    historyId: id,
    after: z.number().int().nonnegative(),
    pageToken: z.string().optional(),
  }),
  z.object({
    v: z.literal(1),
    provider: z.literal('GMAIL'),
    phase: z.literal('history'),
    historyId: id,
    pageToken: z.string().optional(),
  }),
]);
type Cursor = z.infer<typeof cursorSchema>;
type MimePart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: MimePart[];
};
const partSchema: z.ZodType<MimePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);
const messageSchema = z.object({
  id,
  internalDate: z.string().regex(/^\d+$/),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(''),
  payload: partSchema,
});
function plainText(part: MimePart, depth = 0): string {
  if (depth > 20 || part.filename) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    const bytes = Buffer.from(part.body.data, 'base64url');
    const contentType = part.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value;
    const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '')?.[1] ?? 'utf-8';
    try {
      return new TextDecoder(charset).decode(bytes).slice(0, 64000);
    } catch {
      return bytes.toString('utf8').slice(0, 64000);
    }
  }
  return (part.parts ?? [])
    .map((child) => plainText(child, depth + 1))
    .filter(Boolean)
    .join('\n')
    .slice(0, 64000);
}
/** Same bounded text/plain extraction that sync used; null when no plain-text part exists. */
export function gmailPlainText(payload: unknown): string | null {
  return plainText(partSchema.parse(payload)) || null;
}
function normalize(raw: unknown): ProviderEmail | null {
  const message = messageSchema.parse(raw);
  if (
    !message.labelIds.includes('INBOX') ||
    message.labelIds.includes('TRASH') ||
    message.labelIds.includes('SPAM')
  )
    return null;
  const header = (name: string) =>
    message.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const from = header('from');
  const parsed = /^(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  const receivedAt = new Date(Number(message.internalDate));
  if (!Number.isFinite(receivedAt.getTime())) throw new Error('Invalid Gmail message timestamp');
  return {
    providerMessageId: message.id,
    subject: header('subject').slice(0, 2000),
    sender: (parsed?.[2] ?? from).trim().toLowerCase(),
    senderName: (parsed?.[1] ?? '').trim().replace(/^"|"$/g, ''),
    snippet: message.snippet.slice(0, 2000),
    body: plainText(message.payload) || null,
    receivedAt,
    isRead: !message.labelIds.includes('UNREAD'),
    webUrl: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(message.id)}`,
  };
}
const reference = z.object({ id });
const historySchema = z.object({
  historyId: id,
  nextPageToken: z.string().optional(),
  history: z
    .array(
      z.object({
        messages: z.array(reference).optional(),
        messagesAdded: z.array(z.object({ message: reference })).optional(),
        messagesDeleted: z.array(z.object({ message: reference })).optional(),
        labelsAdded: z.array(z.object({ message: reference })).optional(),
        labelsRemoved: z.array(z.object({ message: reference })).optional(),
      }),
    )
    .default([]),
});
async function hydrate(
  ids: string[],
  token: string,
  deleted: Set<string>,
): Promise<ProviderEmail[]> {
  const messages: ProviderEmail[] = [];
  // Four concurrent requests bounds quota pressure; failures prevent cursor advancement.
  for (let offset = 0; offset < ids.length; offset += 4) {
    const chunk = await Promise.all(
      ids.slice(offset, offset + 4).map(async (messageId) => {
        try {
          const message = normalize(
            await requestJson(`${base}/messages/${encodeURIComponent(messageId)}?format=full`, {
              headers: authHeaders(token),
            }),
          );
          if (!message) deleted.add(messageId);
          return message;
        } catch (error) {
          if (error instanceof ProviderHttpError && error.status === 404) {
            deleted.add(messageId);
            return null;
          }
          throw error;
        }
      }),
    );
    messages.push(...chunk.filter((message): message is ProviderEmail => message !== null));
  }
  return messages;
}
export async function fetchGmailPage(
  token: string,
  serialized: string | null,
  fullRescan = false,
): Promise<SyncPage> {
  let cursor: Cursor;
  if (serialized) cursor = cursorSchema.parse(JSON.parse(serialized));
  else {
    const profile = z
      .object({ historyId: id })
      .parse(await requestJson(`${base}/profile`, { headers: authHeaders(token) }));
    cursor = {
      v: 1,
      provider: 'GMAIL',
      phase: 'initial',
      historyId: profile.historyId,
      after: fullRescan ? 0 : Math.floor(Date.now() / 1000) - 30 * 86400,
    };
  }
  if (cursor.phase === 'initial') {
    const url = new URL(`${base}/messages`);
    url.search = new URLSearchParams({
      maxResults: String(WORK_BATCH_SIZE),
      labelIds: 'INBOX',
      q: `after:${cursor.after}`,
      ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
    }).toString();
    const list = z
      .object({ messages: z.array(reference).default([]), nextPageToken: z.string().optional() })
      .parse(await requestJson(url, { headers: authHeaders(token) }));
    const deleted = new Set<string>();
    const messages = await hydrate(
      [...new Set(list.messages.map((message) => message.id))],
      token,
      deleted,
    );
    const next: Cursor = list.nextPageToken
      ? { ...cursor, pageToken: list.nextPageToken }
      : { v: 1, provider: 'GMAIL', phase: 'history', historyId: cursor.historyId };
    return { messages, deletedIds: [...deleted], cursor: JSON.stringify(next), hasMore: true };
  }
  const url = new URL(`${base}/history`);
  url.search = new URLSearchParams({
    startHistoryId: cursor.historyId,
    maxResults: String(WORK_BATCH_SIZE),
    ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
  }).toString();
  let raw: unknown;
  try {
    raw = await requestJson(url, { headers: authHeaders(token) });
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 404)
      return { ...(await fetchGmailPage(token, null, true)), reset: true };
    throw error;
  }
  const history = historySchema.parse(raw);
  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (const item of history.history) {
    for (const message of item.messages ?? []) changed.add(message.id);
    for (const events of [item.messagesAdded, item.labelsAdded, item.labelsRemoved])
      for (const event of events ?? []) changed.add(event.message.id);
    for (const event of item.messagesDeleted ?? []) deleted.add(event.message.id);
  }
  const messages = await hydrate(
    [...changed].filter((messageId) => !deleted.has(messageId)),
    token,
    deleted,
  );
  const next: Cursor = {
    v: 1,
    provider: 'GMAIL',
    phase: 'history',
    historyId: history.nextPageToken ? cursor.historyId : history.historyId,
    ...(history.nextPageToken ? { pageToken: history.nextPageToken } : {}),
  };
  return {
    messages,
    deletedIds: [...deleted],
    cursor: JSON.stringify(next),
    hasMore: Boolean(history.nextPageToken),
  };
}
