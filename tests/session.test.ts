import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempCwd } from './helpers/cwd';

type Session = typeof import('../src/lib/session');
let session: Session;
let cleanup: () => void;
const DAY = 86_400_000;
beforeEach(async () => {
  ({ cleanup } = useTempCwd());
  vi.stubEnv('ENCRYPTION_SECRET_KEY', undefined);
  vi.stubEnv('APP_PASSWORD', 'correct horse');
  vi.resetModules();
  session = await import('../src/lib/session');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanup();
});

describe('session tokens', () => {
  it('accepts anything when no APP_PASSWORD is set', () => {
    vi.stubEnv('APP_PASSWORD', undefined);
    expect(session.verifySessionToken(undefined)).toBe(true);
  });
  it('verifies a freshly created token', () => {
    expect(session.verifySessionToken(session.createSessionToken().token)).toBe(true);
  });
  it('rejects a missing token when a password is set', () => {
    expect(session.verifySessionToken(undefined)).toBe(false);
  });
  it('rejects a tampered signature', () => {
    const [expires, signature] = session.createSessionToken().token.split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(session.verifySessionToken(`${expires}.${flipped}`)).toBe(false);
  });
  it('rejects an expired token', () => {
    const { token } = session.createSessionToken(Date.now() - 31 * DAY);
    expect(session.verifySessionToken(token)).toBe(false);
  });
  it('rejects a token made under a different APP_PASSWORD', async () => {
    const { token } = session.createSessionToken();
    vi.stubEnv('APP_PASSWORD', 'another password');
    expect(session.verifySessionToken(token)).toBe(false);
  });
  it.each(['', 'abc', '1.2.3'])('rejects malformed token %j', (token) => {
    expect(session.verifySessionToken(token)).toBe(false);
  });
});

describe('password check', () => {
  it('accepts only the exact password', () => {
    expect(session.checkPassword('correct horse')).toBe(true);
    expect(session.checkPassword('correct hors')).toBe(false);
    expect(session.checkPassword('correct horse!')).toBe(false);
    expect(session.checkPassword('')).toBe(false);
  });
});

describe('login throttle', () => {
  it('allows five failures, then waits, and resets on success', () => {
    for (let i = 0; i < 5; i++) {
      session.recordLogin(false);
      expect(session.loginWait()).toBe(0);
    }
    session.recordLogin(false);
    expect(session.loginWait()).toBeGreaterThan(0);
    session.recordLogin(true);
    expect(session.loginWait()).toBe(0);
  });
});
