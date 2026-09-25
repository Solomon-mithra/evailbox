import 'server-only';
import { z } from 'zod';
import { authHeaders, ProviderHttpError, requestJson } from './http';
import type { Provider } from './types';
export type ReplyMode = 'reply' | 'reply-all';
export type MailboxAction = 'read' | 'unread' | 'archive';
export interface ReplyContext {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}
const gmail = 'https://gmail.googleapis.com/gmail/v1/users/me';
const graph = 'https://graph.microsoft.com/v1.0/me';
const id = z.string().min(1).max(2048);
const reference = z.object({ id });
const address = z.object({ emailAddress: z.object({ address: z.string() }) });
const immutable = { Prefer: 'IdType="ImmutableId"' };
export class ProviderActionUnknown extends Error {
  constructor() {
    super('The email provider did not confirm the operation.');
    this.name = 'ProviderActionUnknown';
  }
}
// Sends and draft creation are never automatically retried, including 429/5xx.
// A timeout, network failure, malformed success, or 5xx can follow a completed write.
async function writeOnce(
  url: string,
  token: string,
  method: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...authHeaders(token), ...immutable, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ProviderActionUnknown();
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status >= 500 || response.status === 408) throw new ProviderActionUnknown();
    throw new ProviderHttpError(response.status);
  }
  if (response.status === 202 || response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ProviderActionUnknown();
  }
}
function cleanHeader(value: string) {
  const unfolded = value.replace(/\r?\n[\t ]+/g, ' ').trim();
  if (/[\r\n\0]/.test(unfolded)) throw new Error('Unsafe message header');
  return unfolded;
}
function emailAddress(value: string) {
  return z.email().max(320).parse(cleanHeader(value)).toLowerCase();
}
// Split commas only outside quoted names / angle brackets; never forward raw headers into MIME.
function addresses(value: string): string[] {
  const parts: string[] = [];
  let part = '',
    quoted = false,
    escaped = false,
    angle = false;
  for (const char of cleanHeader(value)) {
    if (escaped) {
      part += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      part += char;
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '<') angle = true;
    if (!quoted && char === '>') angle = false;
    if (!quoted && !angle && char === ',') {
      parts.push(part);
      part = '';
    } else part += char;
  }
  if (quoted || angle) throw new Error('Unsupported recipient header');
  parts.push(part);
  return parts
    .filter((p) => p.trim())
    .map((p) => emailAddress(/<([^<>]+)>\s*$/.exec(p)?.[1] ?? p.trim()));
}
function recipients(
  primary: string[],
  to: string[],
  cc: string[],
  selves: string[],
  mode: ReplyMode,
) {
  const seen = new Set(selves.map((v) => v.toLowerCase()));
  const unique = (values: string[]) =>
    values.filter((v) => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
  const result = {
    to: unique([...primary, ...(mode === 'reply-all' ? to : [])]),
    cc: mode === 'reply-all' ? unique(cc) : [],
  };
  if (!result.to.length || result.to.length + result.cc.length > 100)
    throw new Error('No supported reply recipients');
  return result;
}
export async function fetchReplyContext(
  provider: Provider,
  token: string,
  messageId: string,
  accountEmail: string,
  mode: ReplyMode,
): Promise<ReplyContext> {
  const from = emailAddress(accountEmail);
  if (provider === 'OUTLOOK') {
    const original = z
      .object({
        subject: z.string().default(''),
        from: address,
        replyTo: z.array(address).default([]),
        toRecipients: z.array(address).default([]),
        ccRecipients: z.array(address).default([]),
        internetMessageId: z.string().optional(),
      })
      .parse(
        await requestJson(
          `${graph}/messages/${encodeURIComponent(messageId)}?$select=subject,from,replyTo,toRecipients,ccRecipients,internetMessageId`,
          { headers: { ...authHeaders(token), ...immutable } },
        ),
      );
    const values = (list: z.infer<typeof address>[]) =>
      list.map((a) => emailAddress(a.emailAddress.address));
    const primary = values(original.replyTo.length ? original.replyTo : [original.from]);
    return {
      from,
      ...recipients(
        primary,
        values(original.toRecipients),
        values(original.ccRecipients),
        [from],
        mode,
      ),
      subject: replySubject(original.subject),
      ...(original.internetMessageId ? { inReplyTo: cleanHeader(original.internetMessageId) } : {}),
    };
  }
  const original = z
    .object({
      threadId: id,
      payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })) }),
    })
    .parse(
      await requestJson(
        `${gmail}/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Delivered-To`,
        { headers: authHeaders(token) },
      ),
    );
  const header = (name: string) => {
    const found = original.payload.headers.filter((h) => h.name.toLowerCase() === name);
    if (found.length > 1 && name !== 'delivered-to') throw new Error('Duplicate message header');
    return cleanHeader(found[0]?.value ?? '');
  };
  const parent = header('message-id');
  if (parent.length > 900 || !/^<[^<>\s]+>$/.test(parent))
    throw new Error('Original message has no valid Message-ID');
  const refs = (header('references').match(/<[^<>\s]+>/g) ?? []).filter(
    (value) => value.length <= 900,
  );
  return {
    from,
    ...recipients(
      addresses(header('reply-to') || header('from')),
      addresses(header('to')),
      addresses(header('cc')),
      [from, ...addresses(header('delivered-to'))],
      mode,
    ),
    subject: replySubject(header('subject')),
    threadId: original.threadId,
    inReplyTo: parent,
    references: [...refs.slice(-30), parent].join(' '),
  };
}
function replySubject(value: string) {
  const clean = cleanHeader(value);
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}
function mime(context: ReplyContext, body: string, messageId: string) {
  const words: string[] = [];
  let chunk = '';
  for (const character of cleanHeader(context.subject)) {
    if (Buffer.byteLength(chunk + character) > 42) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
  const encodedSubject = words.join('\r\n ');
  return [
    `From: ${emailAddress(context.from)}`,
    `To: ${context.to.map(emailAddress).join(',\r\n ')}`,
    ...(context.cc.length ? [`Cc: ${context.cc.map(emailAddress).join(',\r\n ')}`] : []),
    `Subject: ${encodedSubject}`,
    `Message-ID: ${cleanHeader(messageId)}`,
    ...(context.inReplyTo ? [`In-Reply-To: ${cleanHeader(context.inReplyTo)}`] : []),
    ...(context.references ? [`References: ${cleanHeader(context.references)}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body.replace(/\r?\n/g, '\r\n'))
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? '',
  ].join('\r\n');
}
export async function prepareProviderReply(
  provider: Provider,
  token: string,
  originalId: string,
  mode: ReplyMode,
  context: ReplyContext,
  body: string,
  rfcMessageId: string,
  providerDraftId: string | null,
  onCreated?: (id: string) => Promise<void>,
): Promise<string> {
  if (provider === 'GMAIL') {
    const payload = {
      message: {
        threadId: context.threadId,
        raw: Buffer.from(mime(context, body, rfcMessageId)).toString('base64url'),
      },
    };
    const raw = await writeOnce(
      `${gmail}/drafts${providerDraftId ? `/${encodeURIComponent(providerDraftId)}` : ''}`,
      token,
      providerDraftId ? 'PUT' : 'POST',
      payload,
    );
    const parsed = reference.safeParse(raw);
    if (!parsed.success) throw new ProviderActionUnknown();
    if (onCreated) await onCreated(parsed.data.id);
    return parsed.data.id;
  }
  let draftId = providerDraftId;
  if (!draftId) {
    const raw = await writeOnce(
      `${graph}/messages/${encodeURIComponent(originalId)}/${mode === 'reply-all' ? 'createReplyAll' : 'createReply'}`,
      token,
      'POST',
      {},
    );
    const parsed = reference.safeParse(raw);
    if (!parsed.success) throw new ProviderActionUnknown();
    draftId = parsed.data.id;
    // Persist this immutable provider id before any subsequent write or send.
    if (onCreated) await onCreated(draftId);
  }
  const values = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  await writeOnce(`${graph}/messages/${encodeURIComponent(draftId)}`, token, 'PATCH', {
    body: { contentType: 'Text', content: body },
    toRecipients: values(context.to),
    ccRecipients: values(context.cc),
    bccRecipients: [],
  });
  return draftId;
}
export async function sendProviderReply(
  provider: Provider,
  token: string,
  providerDraftId: string,
): Promise<string | null> {
  if (provider === 'OUTLOOK') {
    await writeOnce(`${graph}/messages/${encodeURIComponent(providerDraftId)}/send`, token, 'POST');
    return null;
  }
  const parsed = reference.safeParse(
    await writeOnce(`${gmail}/drafts/send`, token, 'POST', { id: providerDraftId }),
  );
  if (!parsed.success) throw new ProviderActionUnknown();
  return parsed.data.id;
}
export async function reconcileProviderReply(
  provider: Provider,
  token: string,
  providerDraftId: string | null,
  rfcMessageId: string,
): Promise<{ status: 'accepted'; providerMessageId: string } | { status: 'unknown' }> {
  if (provider === 'GMAIL') {
    const params = new URLSearchParams({
      q: `rfc822msgid:${rfcMessageId.replace(/^<|>$/g, '')}`,
      labelIds: 'SENT',
      maxResults: '2',
    });
    const result = z
      .object({ messages: z.array(reference).default([]) })
      .parse(await requestJson(`${gmail}/messages?${params}`, { headers: authHeaders(token) }));
    return result.messages.length
      ? { status: 'accepted', providerMessageId: result.messages[0].id }
      : { status: 'unknown' };
  }
  if (!providerDraftId) return { status: 'unknown' };
  try {
    const result = z
      .object({ id, isDraft: z.boolean() })
      .parse(
        await requestJson(
          `${graph}/messages/${encodeURIComponent(providerDraftId)}?$select=id,isDraft`,
          { headers: { ...authHeaders(token), ...immutable } },
        ),
      );
    return result.isDraft
      ? { status: 'unknown' }
      : { status: 'accepted', providerMessageId: result.id };
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 404) return { status: 'unknown' };
    throw error;
  }
}
export async function applyProviderAction(
  provider: Provider,
  token: string,
  messageId: string,
  action: MailboxAction,
): Promise<void> {
  const message = `${provider === 'GMAIL' ? gmail : graph}/messages/${encodeURIComponent(messageId)}`;
  let archiveId: string | undefined;
  if (provider === 'OUTLOOK' && action === 'archive') {
    archiveId = reference.parse(
      await requestJson(`${graph}/mailFolders/archive?$select=id`, {
        headers: { ...authHeaders(token), ...immutable },
      }),
    ).id;
    const original = z.object({ parentFolderId: id }).parse(
      await requestJson(`${message}?$select=parentFolderId`, {
        headers: { ...authHeaders(token), ...immutable },
      }),
    );
    if (original.parentFolderId === archiveId) return;
  }
  try {
    if (provider === 'GMAIL')
      await writeOnce(
        `${message}/modify`,
        token,
        'POST',
        action === 'unread'
          ? { addLabelIds: ['UNREAD'] }
          : { removeLabelIds: [action === 'read' ? 'UNREAD' : 'INBOX'] },
      );
    else if (action === 'archive')
      await writeOnce(`${message}/move`, token, 'POST', { destinationId: archiveId });
    else await writeOnce(message, token, 'PATCH', { isRead: action === 'read' });
  } catch (error) {
    if (!(error instanceof ProviderActionUnknown)) throw error;
    // Desired-state actions may be verified after a lost response; local state changes only after proof.
    if (provider === 'GMAIL') {
      const current = z
        .object({ labelIds: z.array(z.string()) })
        .parse(await requestJson(`${message}?format=minimal`, { headers: authHeaders(token) }));
      if (
        action === 'archive'
          ? !current.labelIds.includes('INBOX')
          : (action === 'unread') === current.labelIds.includes('UNREAD')
      )
        return;
    } else {
      const current = z
        .object({ parentFolderId: z.string().optional(), isRead: z.boolean().optional() })
        .parse(
          await requestJson(`${message}?$select=parentFolderId,isRead`, {
            headers: { ...authHeaders(token), ...immutable },
          }),
        );
      if (
        action === 'archive'
          ? current.parentFolderId === archiveId
          : current.isRead === (action === 'read')
      )
        return;
    }
    throw error;
  }
}
