import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, createOAuthState, verifyOAuthState } from '../src/lib/crypto';
import { tagSchema, preferencesSchema } from '../src/lib/validation';
process.env.ENCRYPTION_SECRET_KEY = 'a'.repeat(64);
describe('credential protection', () => {
  it('round trips tokens with unique nonces', () => {
    const a = encrypt('refresh-token');
    expect(decrypt(a)).toBe('refresh-token');
    expect(encrypt('refresh-token')).not.toBe(a);
  });
  it('rejects modified ciphertext', () => {
    const a = encrypt('secret');
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('binds OAuth state to user, provider and expiry', () => {
    const state = createOAuthState('user-1', 'GMAIL', 'verifier');
    expect(verifyOAuthState(state, 'user-1', 'GMAIL').verifier).toBe('verifier');
    expect(() => verifyOAuthState(state, 'user-2', 'GMAIL')).toThrow();
    expect(() => verifyOAuthState(state, 'user-1', 'OUTLOOK')).toThrow();
  });
  it('rejects expired OAuth state', () => {
    const state = createOAuthState('u', 'GMAIL', 'v', Date.now() - 700000);
    expect(() => verifyOAuthState(state, 'u', 'GMAIL')).toThrow();
  });
});
describe('input validation', () => {
  const tag = {
    name: 'Important',
    prompt: 'Messages that require my attention',
    priority: 'HIGH',
    keywords: [],
    senders: [],
  };
  it('rejects weak prompts and malformed sender addresses', () => {
    expect(tagSchema.safeParse({ ...tag, prompt: 'yes' }).success).toBe(false);
    expect(tagSchema.safeParse({ ...tag, senders: ['bad'] }).success).toBe(false);
  });
  it('rejects invalid digest times and timezones', () => {
    expect(preferencesSchema.safeParse({ digestTime: '25:99' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ timezone: 'Mars/Base' }).success).toBe(false);
  });
  it('does not permit unbounded tags', () => {
    expect(tagSchema.safeParse({ ...tag, name: 'a'.repeat(100) }).success).toBe(false);
  });
});
