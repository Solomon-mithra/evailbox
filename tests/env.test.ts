import { expect, it } from 'vitest';
import { validateEnv } from '../src/lib/env';

it('requires nothing: an empty environment is valid', () => {
  expect(validateEnv({})).toMatchObject({ APP_MODE: 'live' });
});
it('accepts a fully specified environment', () => {
  expect(
    validateEnv({
      APP_MODE: 'live',
      NEXT_PUBLIC_APP_URL: 'https://mail.example.com',
      ENCRYPTION_SECRET_KEY: 'a'.repeat(64),
      APP_PASSWORD: 'a long enough password',
    }).APP_PASSWORD,
  ).toBe('a long enough password');
});
it('rejects an encryption key that is not 64 hex characters', () => {
  expect(() => validateEnv({ ENCRYPTION_SECRET_KEY: 'a'.repeat(63) })).toThrow(
    'ENCRYPTION_SECRET_KEY',
  );
  expect(() => validateEnv({ ENCRYPTION_SECRET_KEY: 'z'.repeat(64) })).toThrow(
    'ENCRYPTION_SECRET_KEY',
  );
});
it('rejects a too-short APP_PASSWORD', () => {
  expect(() => validateEnv({ APP_PASSWORD: 'x'.repeat(7) })).toThrow('APP_PASSWORD');
  expect(() => validateEnv({ APP_PASSWORD: 'x'.repeat(40) })).not.toThrow();
});
it('treats empty strings from copied .env templates as unset', () => {
  expect(() =>
    validateEnv({
      APP_MODE: '',
      NEXT_PUBLIC_APP_URL: '',
      ENCRYPTION_SECRET_KEY: '',
      APP_PASSWORD: '',
    }),
  ).not.toThrow();
});
it('permits explicitly configured demo mode', () => {
  expect(
    validateEnv({ APP_MODE: 'demo', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }).APP_MODE,
  ).toBe('demo');
});
it('does not expose supplied values in validation errors', () => {
  expect(() =>
    validateEnv({ APP_MODE: 'live', NEXT_PUBLIC_APP_URL: 'bad-sensitive-value' }),
  ).toThrow('NEXT_PUBLIC_APP_URL');
  try {
    validateEnv({ APP_MODE: 'live', NEXT_PUBLIC_APP_URL: 'bad-sensitive-value' });
  } catch (e) {
    expect(String(e)).not.toContain('bad-sensitive-value');
  }
});
