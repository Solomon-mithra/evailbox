import { z } from 'zod';
// Nothing is required: OAuth and AI keys live in Settings, and the encryption key self-generates.
const schema = z.object({
  APP_MODE: z.enum(['demo', 'live']).default('live'),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  ENCRYPTION_SECRET_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  APP_PASSWORD: z.string().min(8).optional(),
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
