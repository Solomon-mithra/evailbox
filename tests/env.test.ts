import { expect, it } from 'vitest';
import { validateEnv } from '../src/lib/env';
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
