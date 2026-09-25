import { expect, it } from 'vitest';
import { validateEnv } from '../src/lib/env';
const gmailEnvironment = {
  APP_MODE: 'live',
  NEXT_PUBLIC_APP_URL: 'https://app.example',
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
  SUPABASE_SECRET_KEY: 'secret-fixture',
  DATABASE_URL: 'postgresql://fixture:fixture@localhost/app',
  DIRECT_URL: 'postgresql://fixture:fixture@localhost/app',
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  JEV_GATEWAY_URL: 'https://gateway.example',
  JEV_API_KEY: 'gateway-key',
  ENCRYPTION_SECRET_KEY: 'a'.repeat(64),
  CRON_SECRET: 'b'.repeat(32),
};
it('starts live Gmail without Outlook or digest credentials', () => {
  expect(validateEnv(gmailEnvironment).APP_MODE).toBe('live');
});
it('allows unused integration placeholders without enabling demo mode', () => {
  expect(
    validateEnv({
      ...gmailEnvironment,
      NEXT_PUBLIC_MICROSOFT_CLIENT_ID: 'replace-with-microsoft-client-id',
      MICROSOFT_CLIENT_SECRET: 'replace-with-microsoft-client-secret',
      RESEND_API_KEY: 'replace-with-resend-key',
    }).APP_MODE,
  ).toBe('live');
});
it('still rejects missing core credentials with optional services absent', () => {
  expect(() => validateEnv({ ...gmailEnvironment, SUPABASE_SECRET_KEY: '' })).toThrow(
    'SUPABASE_SECRET_KEY',
  );
});
it('fails closed when live mode credentials are absent', () => {
  expect(() => validateEnv({ NEXT_PUBLIC_APP_URL: 'https://app.example' })).toThrow(
    /Invalid environment/,
  );
});
it('permits only explicitly configured demo mode without credentials', () => {
  expect(
    validateEnv({ APP_MODE: 'demo', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }).APP_MODE,
  ).toBe('demo');
});
it('does not expose supplied secret values in validation errors', () => {
  expect(() =>
    validateEnv({ APP_MODE: 'live', NEXT_PUBLIC_APP_URL: 'bad-sensitive-value' }),
  ).toThrow('NEXT_PUBLIC_APP_URL');
  try {
    validateEnv({ APP_MODE: 'live', NEXT_PUBLIC_APP_URL: 'bad-sensitive-value' });
  } catch (e) {
    expect(String(e)).not.toContain('bad-sensitive-value');
  }
});
