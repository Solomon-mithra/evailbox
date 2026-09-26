import 'server-only';
import { WORK_BATCH_SIZE } from '../inngest/config';
import { z } from 'zod';
import { authHeaders, ProviderHttpError, requestJson } from './http';
import type { ProviderEmail, SyncPage } from './types';
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
export async function fetchOutlookPage(
  token: string,
  serialized: string | null,
): Promise<SyncPage> {
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
      return { ...(await fetchOutlookPage(token, null)), reset: true };
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
