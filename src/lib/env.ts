import { z } from 'zod';
// Nothing is required: OAuth and AI keys live in Settings, and the encryption key self-generates.
const schema = z.object({
  APP_MODE: z.enum(['demo', 'live']).default('live'),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  ENCRYPTION_SECRET_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  APP_PASSWORD: z.string().min(12, 'APP_PASSWORD must be at least 12 characters').optional(),
});
export function validateEnv(source: Record<string, string | undefined> = process.env) {
  // Treat empty values from copied .env templates as unset.
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = schema.safeParse(set);
  if (!result.success)
    throw new Error(
      `Invalid environment: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return result.data;
}
export function isDemo() {
  return process.env.APP_MODE === 'demo';
}
/** Public origin used for OAuth redirect URIs; must match the provider app registration. */
export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}
/**
 * DNS-rebinding guard: only the configured host, or loopback on the same port, may reach the app.
 * Without it a hostile page that rebinds its domain to 127.0.0.1 could read an unlocked inbox.
 */
export function allowedHost(host: string | null) {
  if (!host) return false;
  const app = new URL(appUrl());
  if (host === app.host) return true;
  const port = app.port || (app.protocol === 'https:' ? '443' : '80');
  return ['localhost', '127.0.0.1', '[::1]'].some((name) => host === `${name}:${port}`);
}

/**
 * Fail closed: an instance served on a non-loopback address must have APP_PASSWORD,
 * unless the operator explicitly opts out (e.g. a private Tailscale network).
 */
export function unlockedPublicInstance() {
  if (isDemo() || process.env.APP_PASSWORD || process.env.ALLOW_NO_PASSWORD === '1') return false;
  return !['localhost', '127.0.0.1', '[::1]'].includes(new URL(appUrl()).hostname);
}
