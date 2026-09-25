import 'server-only';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { isConfigured, isDemo } from '../env';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 5000,
});
export const OUTLOOK_INBOX_RESOURCE = "/me/mailFolders('inbox')/messages";
export function isOutlookInboxResource(resource: string | null | undefined): boolean {
  return (
    resource?.replace(/^\//, '').toLowerCase() === OUTLOOK_INBOX_RESOURCE.slice(1).toLowerCase()
  );
}
export type GmailWebhookConfiguration = {
  topic: string;
  subscription: string;
  audience: string;
  serviceAccountEmail: string;
};
export function gmailWebhookConfiguration(): GmailWebhookConfiguration | null {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  const subscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION;
  const audience = process.env.GMAIL_PUBSUB_AUDIENCE;
  const serviceAccountEmail = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL;
  if (
    isDemo() ||
    ![topic, subscription, audience, serviceAccountEmail].every(isConfigured) ||
    !/^projects\/[^/\s]+\/topics\/[^/\s]+$/.test(topic!) ||
    !/^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/.test(subscription!) ||
    !z.email().safeParse(serviceAccountEmail).success ||
    !httpsUrl(audience)
  )
    return null;
  return {
    topic: topic!,
    subscription: subscription!,
    audience: audience!,
    serviceAccountEmail: serviceAccountEmail!,
  };
}
function httpsUrl(value: string | undefined): string | null {
  if (!value || !isConfigured(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? value : null;
  } catch {
    return null;
  }
}
export function outlookWebhookUrl(): string | null {
  return isDemo() ? null : httpsUrl(process.env.OUTLOOK_WEBHOOK_URL);
}
/** Only keys from Google's fixed certificate endpoint are trusted in production. */
export async function verifyGmailPushToken(
  authorization: string | null,
  configuration: GmailWebhookConfiguration,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<void> {
  if (!authorization || authorization.length > 8192 || !/^Bearer \S+$/.test(authorization))
    throw new Error('Invalid push authentication');
  const { payload } = await jwtVerify(authorization.slice(7), keys, {
    algorithms: ['RS256'],
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: configuration.audience,
    requiredClaims: ['exp', 'iat', 'sub', 'email', 'email_verified'],
  });
  if (payload.email_verified !== true || payload.email !== configuration.serviceAccountEmail)
    throw new Error('Invalid push identity');
}
export class WebhookInputError extends Error {
  constructor(public readonly status: number) {
    super('Invalid webhook request');
  }
}
/** Count streamed bytes: Content-Length alone is not a trustworthy bound. */
export async function readBoundedJson(request: Request, maxBytes = 65536): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new WebhookInputError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new WebhookInputError(400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new WebhookInputError(413);
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof WebhookInputError) throw error;
    throw new WebhookInputError(400);
  } finally {
    reader.releaseLock();
  }
}
const gmailEnvelope = z.object({
  subscription: z.string().max(1024),
  message: z.object({
    data: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[A-Za-z0-9_+/-]+={0,2}$/),
  }),
});
const gmailPayload = z.object({
  emailAddress: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  historyId: z.string().regex(/^\d{1,40}$/),
});
export function parseGmailNotification(value: unknown) {
  const envelope = gmailEnvelope.parse(value);
  const payload = gmailPayload.parse(
    JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf8')),
  );
  return { subscription: envelope.subscription, ...payload };
}
export const outlookNotifications = z.object({
  value: z
    .array(
      z.object({
        subscriptionId: z.string().min(1).max(200),
        clientState: z.string().min(1).max(256),
        resource: z.string().min(1).max(4096).optional(),
        changeType: z.enum(['created', 'updated', 'deleted']).optional(),
        lifecycleEvent: z
          .enum(['subscriptionRemoved', 'missed', 'reauthorizationRequired'])
          .optional(),
      }),
    )
    .max(100),
});
export function outlookValidationResponse(request: Request): Response | null {
  const values = new URL(request.url).searchParams.getAll('validationToken');
  if (!values.length) return null;
  // URLSearchParams decodes once. A second decode corrupts literal percent escapes.
  const value = values[0];
  if (values.length !== 1 || !value || value.length > 4096 || /[\u0000\ufffd]/.test(value))
    return new Response(null, { status: 400 });
  return new Response(value, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export function matchesOutlookResource(
  resource: string,
  subscription: { resource: string | null; providerMailboxId: string | null },
): boolean {
  if (!isOutlookInboxResource(subscription.resource)) return false;
  const value = resource.replace(/^\//, '');
  const inbox = /^me\/mailFolders\('inbox'\)\/messages(?:\/([A-Za-z0-9_=+.-]+))?$/i.exec(value);
  if (inbox) return !inbox[1] || !['.', '..'].includes(inbox[1]);
  // Graph's basic notifications omit folder identity. The authenticated stored
  // subscription establishes Inbox scope; still enforce its exact mailbox owner.
  const match = /^users\/([^/]+)\/messages\/([A-Za-z0-9_=+.-]+)$/i.exec(value);
  return !!match && match[1] === subscription.providerMailboxId && !['.', '..'].includes(match[2]);
}
