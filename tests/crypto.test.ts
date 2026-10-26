import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTempCwd } from './helpers/cwd';

let dir: string, cleanup: () => void;
beforeEach(() => {
  ({ dir, cleanup } = useTempCwd());
  vi.stubEnv('ENCRYPTION_SECRET_KEY', undefined);
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanup();
});

it('creates data/secret.key (0600) on first use and round-trips', async () => {
  const crypto = await import('../src/lib/crypto');
  const file = join(dir, 'data', 'secret.key');
  expect(existsSync(file)).toBe(false);
  expect(crypto.decrypt(crypto.encrypt('hello'))).toBe('hello');
  expect(existsSync(file)).toBe(true);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});
it('a fresh module import reads the same key', async () => {
  const first = await import('../src/lib/crypto');
  const ciphertext = first.encrypt('persisted');
  vi.resetModules();
  const second = await import('../src/lib/crypto');
  expect(second).not.toBe(first);
  expect(second.decrypt(ciphertext)).toBe('persisted');
});
it('ENCRYPTION_SECRET_KEY overrides the generated key', async () => {
  const crypto = await import('../src/lib/crypto');
  const ciphertext = crypto.encrypt('generated-key');
  vi.stubEnv('ENCRYPTION_SECRET_KEY', 'c'.repeat(64));
  expect(() => crypto.decrypt(ciphertext)).toThrow();
  const overridden = crypto.encrypt('env-key');
  expect(crypto.decrypt(overridden)).toBe('env-key');
  vi.stubEnv('ENCRYPTION_SECRET_KEY', undefined);
  expect(() => crypto.decrypt(overridden)).toThrow();
});
