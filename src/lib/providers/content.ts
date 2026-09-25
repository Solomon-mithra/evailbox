import 'server-only';
import { z } from 'zod';
import { authHeaders, requestJson } from './http';
import type { Provider } from './types';
import { gmailPlainText } from './gmail';

export type MessageContent = { format: 'html' | 'text'; content: string };
const maxBytes = 2_000_000;
const bodySchema = z.object({
  data: z
    .string()
    .max(maxBytes * 2)
    .optional(),
  attachmentId: z.string().max(1024).optional(),
  size: z.number().optional(),
});
// Parse each level separately so untrusted MIME depth and part counts are bounded.
const partSchema = z.object({
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  body: bodySchema.optional(),
  parts: z.array(z.unknown()).optional(),
});

export async function fetchMessageContent(
  provider: Provider,
  token: string,
  messageId: string,
): Promise<MessageContent> {
  if (provider === 'OUTLOOK') {
    const result = z
      .object({
        body: z.object({
          contentType: z.string(),
          content: z.string().max(maxBytes),
        }),
      })
      .parse(
        await requestJson(
          `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=body`,
          {
            headers: {
              ...authHeaders(token),
              Prefer: 'outlook.body-content-type="html", IdType="ImmutableId"',
            },
          },
        ),
      );
    return {
      format: result.body.contentType.toLowerCase() === 'html' ? 'html' : 'text',
      content: result.body.content,
    };
  }

  const base = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`;
  const message = z
    .object({ payload: z.unknown() })
    .parse(await requestJson(`${base}?format=full`, { headers: authHeaders(token) }));
  const candidates: z.infer<typeof partSchema>[] = [];
  let visited = 0;
  function visit(value: unknown, depth: number) {
    if (++visited > 200 || depth > 20) return;
    const part = partSchema.parse(value);
    if (
      part.filename ||
      part.mimeType === 'message/rfc822' ||
      part.headers?.some(
        (header) =>
          header.name.toLowerCase() === 'content-disposition' &&
          /^attachment\b/i.test(header.value),
      )
    )
      return;
    if (part.mimeType === 'text/html' || part.mimeType === 'text/plain') candidates.push(part);
    for (const child of part.parts ?? []) visit(child, depth + 1);
  }
  visit(message.payload, 0);
  // The HTML and text in multipart/alternative represent the same message.
  const part = candidates.find((p) => p.mimeType === 'text/html') ?? candidates[0];
  if (!part) throw new Error('Message has no readable body');
  if ((part.body?.size ?? 0) > maxBytes) throw new Error('Message body too large');
  const data =
    part.body?.data ??
    (part.body?.attachmentId
      ? bodySchema.parse(
          await requestJson(`${base}/attachments/${encodeURIComponent(part.body.attachmentId)}`, {
            headers: authHeaders(token),
          }),
        ).data
      : undefined);
  if (!data) throw new Error('Message body unavailable');
  const bytes = Buffer.from(data, 'base64url');
  if (bytes.length > maxBytes) throw new Error('Message body too large');
  const contentType = part.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value;
  const charset = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType ?? '')?.[1] ?? 'utf-8';
  let content: string;
  try {
    content = new TextDecoder(charset).decode(bytes);
  } catch {
    content = bytes.toString('utf8');
  }
  return { format: part.mimeType === 'text/html' ? 'html' : 'text', content };
}

/** Classification input fetched on demand; bodies are never persisted server-side. */
export async function fetchMessageText(
  provider: Provider,
  token: string,
  messageId: string,
): Promise<string | null> {
  if (provider === 'OUTLOOK') {
    const result = z
      .object({ body: z.object({ contentType: z.string(), content: z.string() }).optional() })
      .parse(
        await requestJson(
          `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=body`,
          {
            headers: {
              ...authHeaders(token),
              Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"',
            },
          },
        ),
      );
    return result.body?.contentType.toLowerCase() === 'text'
      ? result.body.content.slice(0, 64000)
      : null;
  }
  const message = z
    .object({ payload: z.unknown() })
    .parse(
      await requestJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
        { headers: authHeaders(token) },
      ),
    );
  return gmailPlainText(message.payload);
}
