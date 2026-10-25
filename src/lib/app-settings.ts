import 'server-only';
import { z } from 'zod';
import { db } from './db';
import { decrypt, encrypt } from './crypto';
import { appUrl } from './env';
import { ApiError } from './errors';
import type { Provider } from './providers/types';

/** Settings win; the env names are a fallback for container deployments and tests. */
async function row() {
  return db.appSettings.findUnique({ where: { id: 'app' } });
}
const reveal = (value: string | null | undefined) => (value ? decrypt(value) : '');

export const redirectUri = (provider: Provider) =>
  `${appUrl()}/api/accounts/${provider.toLowerCase()}/callback`;

export async function oauthClient(provider: Provider) {
  const settings = await row();
  const client =
    provider === 'GMAIL'
      ? {
          clientId: settings?.googleClientId || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
          clientSecret:
            reveal(settings?.googleClientSecret) || process.env.GOOGLE_CLIENT_SECRET || '',
          tenant: '',
        }
      : {
          clientId:
            settings?.microsoftClientId || process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID || '',
          clientSecret:
            reveal(settings?.microsoftClientSecret) || process.env.MICROSOFT_CLIENT_SECRET || '',
          tenant: settings?.microsoftTenantId || process.env.MICROSOFT_TENANT_ID || 'common',
        };
  if (!client.clientId || !client.clientSecret)
    throw new ApiError(
      503,
      provider === 'GMAIL' ? 'GOOGLE_NOT_CONFIGURED' : 'OUTLOOK_NOT_CONFIGURED',
      `Add your ${provider === 'GMAIL' ? 'Google' : 'Microsoft'} OAuth client in Settings first.`,
    );
  return client;
}

export async function jevApiKey() {
  return reveal((await row())?.jevApiKey) || process.env.JEV_API_KEY || '';
}

/** Never returns secrets: only whether one is stored. */
export async function publicAppSettings() {
  const settings = await row();
  return {
    google: {
      clientId: settings?.googleClientId ?? '',
      hasSecret: !!settings?.googleClientSecret,
      redirectUri: redirectUri('GMAIL'),
    },
    microsoft: {
      clientId: settings?.microsoftClientId ?? '',
      hasSecret: !!settings?.microsoftClientSecret,
      tenantId: settings?.microsoftTenantId ?? 'common',
      redirectUri: redirectUri('OUTLOOK'),
    },
    ai: { hasKey: !!settings?.jevApiKey },
  };
}

const clientId = z
  .string()
  .trim()
  .max(300)
  .regex(/^[^\s]*$/, 'Client IDs cannot contain spaces.');
// A string stores a new secret, null clears it, and omission keeps the saved value.
const secret = z.string().trim().min(1).max(2000).nullable().optional();
export const appSettingsSchema = z
  .object({
    googleClientId: clientId,
    googleClientSecret: secret,
    microsoftClientId: clientId,
    microsoftClientSecret: secret,
    microsoftTenantId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9.-]+$/, 'Use common, organizations, consumers, or your tenant ID.'),
    jevApiKey: secret,
  })
  .partial()
  .strict();

export async function updateAppSettings(patch: z.infer<typeof appSettingsSchema>) {
  const data: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const isSecret = key.endsWith('Secret') || key === 'jevApiKey';
    data[key] = isSecret && value !== null ? encrypt(value) : value;
  }
  await db.appSettings.upsert({
    where: { id: 'app' },
    create: { id: 'app', ...data },
    update: data,
  });
  return publicAppSettings();
}
