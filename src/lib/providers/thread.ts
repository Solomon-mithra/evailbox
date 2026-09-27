import 'server-only';
import { z } from 'zod';
import { authHeaders, requestJson } from './http';
import { decodeGmailContent, fetchMessageContent, type MessageContent } from './content';
import type { Provider } from './types';

export type ProviderThreadMessage = {
  id: string;
  sender: string;
  senderName: string;
  receivedAt: string;
  content: MessageContent;
  current: boolean;
  fallback: boolean;
};
export type ProviderThread = { messages: ProviderThreadMessage[]; partial: boolean };
type Candidate = Omit<ProviderThreadMessage, 'content' | 'fallback'> & {
  snippet: string;
  body: () => Promise<MessageContent>;
};
const maxMessages = 100;
const maxBodyBytes = 8_000_000;
const id = z.string().min(1).max(2048);
const gmailBase = 'https://gmail.googleapis.com/gmail/v1/users/me';
const graphBase = 'https://graph.microsoft.com/v1.0/me/messages';
const gmailSchema = z.object({
  id,
  threadId: id.optional(),
  internalDate: z.string().optional(),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(''),
  payload: z.unknown().optional(),
});
const outlookPageSchema = z.object({
  value: z.array(z.unknown()),
  '@odata.nextLink': z.string().optional(),
});
const outlookSchema = z.object({
  id,
  conversationId: id,
  receivedDateTime: z.string().optional(),
  sentDateTime: z.string().optional(),
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
  isDraft: z.boolean().default(false),
  bodyPreview: z.string().default(''),
  body: z.unknown().optional(),
});
function date(value: string | number | undefined) {
  const parsed = new Date(value ?? 0);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
}
function gmailCandidate(
  raw: z.infer<typeof gmailSchema>,
  token: string,
  currentId: string,
  metadata = false,
): Candidate {
  const payload = z
    .object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() })
    .safeParse(raw.payload);
  const from =
    (payload.success
      ? payload.data.headers?.find((h) => h.name.toLowerCase() === 'from')?.value
      : '') ?? '';
  const parsed = /^(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  return {
    id: raw.id,
    sender: (parsed?.[2] ?? from).trim().toLowerCase().slice(0, 2000),
    senderName: (parsed?.[1] ?? '').trim().replace(/^"|"$/g, '').slice(0, 2000),
    receivedAt: date(Number(raw.internalDate ?? 0)),
    current: raw.id === currentId,
    snippet: raw.snippet.slice(0, 2000),
    body: () =>
      metadata
        ? fetchMessageContent('GMAIL', token, raw.id)
        : decodeGmailContent(token, raw.id, raw.payload),
  };
}
function outlookCandidate(raw: z.infer<typeof outlookSchema>, currentId: string): Candidate {
  const sender = raw.from?.emailAddress ?? raw.sender?.emailAddress;
  return {
    id: raw.id,
    sender: (sender?.address ?? '').slice(0, 2000),
    senderName: (sender?.name ?? '').slice(0, 2000),
    receivedAt: date(raw.receivedDateTime ?? raw.sentDateTime),
    current: raw.id === currentId,
    snippet: raw.bodyPreview.slice(0, 2000),
    body: async () => {
      const body = z
        .object({ contentType: z.string(), content: z.string().max(2_000_000) })
        .parse(raw.body);
      return {
        format: body.contentType.toLowerCase() === 'html' ? 'html' : 'text',
        content: body.content,
      };
    },
  };
}
async function gmailThread(token: string, messageId: string) {
  const selected = gmailSchema.parse(
    await requestJson(
      `${gmailBase}/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From`,
      { headers: authHeaders(token) },
    ),
  );
  if (selected.id !== messageId || !selected.threadId) throw new Error('Conversation unavailable');
  const thread = z
    .object({ messages: z.array(z.unknown()) })
    .parse(
      await requestJson(
        `${gmailBase}/threads/${encodeURIComponent(selected.threadId)}?format=full`,
        { headers: authHeaders(token) },
      ),
    );
  const candidates = new Map<string, Candidate>();
  let partial = false;
  for (const value of thread.messages) {
    const parsed = gmailSchema.safeParse(value);
    if (!parsed.success) {
      partial = true;
      continue;
    }
    const raw = parsed.data;
    if (
      raw.id !== messageId &&
      raw.labelIds.some((label) => ['DRAFT', 'TRASH', 'SPAM'].includes(label))
    )
      continue;
    if (raw.threadId && raw.threadId !== selected.threadId) {
      partial = true;
      continue;
    }
    candidates.set(raw.id, gmailCandidate(raw, token, messageId));
  }
  // A provider response can race a new message or omit the selected message.
  if (!candidates.has(messageId))
    candidates.set(messageId, gmailCandidate(selected, token, messageId, true));
  return { candidates: [...candidates.values()], partial };
}
function nextOutlookPage(value: string, filter: string): string {
  const url = new URL(value);
  if (
    url.origin !== 'https://graph.microsoft.com' ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== '/v1.0/me/messages' ||
    url.searchParams.get('$filter') !== filter
  ) {
    throw new Error('Invalid conversation pagination URL');
  }
  return url.href;
}
async function outlookThread(token: string, messageId: string) {
  const headers = {
    ...authHeaders(token),
    Prefer: 'outlook.body-content-type="html", IdType="ImmutableId"',
  };
  const select =
    'id,conversationId,from,sender,receivedDateTime,sentDateTime,isDraft,bodyPreview,body';
  const selected = outlookSchema.parse(
    await requestJson(`${graphBase}/${encodeURIComponent(messageId)}?$select=${select}`, {
      headers,
    }),
  );
  if (selected.id !== messageId) throw new Error('Conversation unavailable');
  const filter = `conversationId eq '${selected.conversationId.replace(/'/g, "''")}' and isDraft eq false`;
  const initial = new URL(graphBase);
  initial.searchParams.set('$filter', filter);
  initial.searchParams.set('$select', select);
  initial.searchParams.set('$top', '50');
  let next: string | undefined = initial.href;
  let partial = false;
  const visited = new Set<string>();
  const candidates = new Map<string, Candidate>([
    [messageId, outlookCandidate(selected, messageId)],
  ]);
  for (let page = 0; next && page < 10; page++) {
    if (visited.has(next)) {
      partial = true;
      break;
    }
    visited.add(next);
    let result: z.infer<typeof outlookPageSchema>;
    try {
      result = outlookPageSchema.parse(await requestJson(next, { headers }));
    } catch (error) {
      // Keep replies already read if a later page fails or the shared deadline expires.
      // An unavailable first page still means the conversation could not be loaded.
      if (page === 0) throw error;
      partial = true;
      break;
    }
    for (const value of result.value) {
      const parsed = outlookSchema.safeParse(value);
      if (!parsed.success) {
        partial = true;
        continue;
      }
      const raw = parsed.data;
      if (raw.isDraft && raw.id !== messageId) continue;
      if (raw.conversationId !== selected.conversationId) {
        partial = true;
        continue;
      }
      candidates.set(raw.id, outlookCandidate(raw, messageId));
    }
    next = result['@odata.nextLink']
      ? nextOutlookPage(result['@odata.nextLink'], filter)
      : undefined;
    if (candidates.size >= maxMessages && next) {
      partial = true;
      break;
    }
  }
  if (next) partial = true;
  return { candidates: [...candidates.values()], partial };
}

/** Provider bodies are read only for this request and never persisted. */
export async function fetchMessageThread(
  provider: Provider,
  token: string,
  messageId: string,
): Promise<ProviderThread> {
  const result =
    provider === 'GMAIL'
      ? await gmailThread(token, messageId)
      : await outlookThread(token, messageId);
  const ordered = result.candidates.sort(
    (a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id),
  );
  const selected = ordered.find((message) => message.current);
  let candidates = ordered.slice(-maxMessages);
  if (selected && !candidates.includes(selected)) candidates = [selected, ...candidates.slice(1)];
  let partial = result.partial || ordered.length > maxMessages;
  let bodyBytes = 0;
  const messages = new Map<string, ProviderThreadMessage>();
  // Reserve body budget for the selected email, even in a very long conversation.
  const bodyOrder = [...candidates].sort((a, b) => Number(b.current) - Number(a.current));
  for (const candidate of bodyOrder) {
    let content: MessageContent = {
      format: 'text',
      content: candidate.snippet || 'No preview available.',
    };
    let fallback = false;
    try {
      if (bodyBytes >= maxBodyBytes) throw new Error('Conversation body limit');
      const body = await candidate.body();
      const bytes = Buffer.byteLength(body.content, 'utf8');
      if (bytes > 2_000_000 || bodyBytes + bytes > maxBodyBytes)
        throw new Error('Conversation body limit');
      content = body;
      bodyBytes += bytes;
    } catch {
      fallback = true;
      partial = true;
    }
    messages.set(candidate.id, {
      id: candidate.id,
      sender: candidate.sender,
      senderName: candidate.senderName,
      receivedAt: candidate.receivedAt,
      current: candidate.current,
      content,
      fallback,
    });
  }
  return { messages: candidates.map((candidate) => messages.get(candidate.id)!), partial };
}
