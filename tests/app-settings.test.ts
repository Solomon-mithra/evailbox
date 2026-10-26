import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, resetTestDb, testDb } from './helpers/sqlite';
import { useTempCwd } from './helpers/cwd';

vi.mock('@/lib/db', async () => ({ db: (await import('./helpers/sqlite')).testDb }));

let settings: typeof import('../src/lib/app-settings');
let cleanup: () => void;
const ENV = [
  'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NEXT_PUBLIC_MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_TENANT_ID',
  'JEV_API_KEY',
  'ENCRYPTION_SECRET_KEY',
  'NEXT_PUBLIC_APP_URL',
];
beforeEach(async () => {
  ({ cleanup } = useTempCwd());
  for (const name of ENV) vi.stubEnv(name, undefined);
  vi.resetModules();
  await resetTestDb();
  settings = await import('../src/lib/app-settings');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanup();
});
afterAll(closeTestDb);

describe('secret storage', () => {
  it('encrypts a secret at rest and never returns it', async () => {
    await settings.updateAppSettings({ googleClientId: 'gid', googleClientSecret: 'plain-secret' });
    const row = await testDb.appSettings.findUniqueOrThrow({ where: { id: 'app' } });
    expect(row.googleClientSecret).toMatch(/^v1\./);
    expect(row.googleClientSecret).not.toContain('plain-secret');
    const publicView = await settings.publicAppSettings();
    expect(JSON.stringify(publicView)).not.toContain('plain-secret');
    expect(publicView.google).toMatchObject({ clientId: 'gid', hasSecret: true });
  });
  it('keeps a secret when a later patch omits it, and clears it with null', async () => {
    await settings.updateAppSettings({ googleClientSecret: 'plain-secret' });
    await settings.updateAppSettings({ googleClientId: 'gid' });
    expect((await settings.publicAppSettings()).google.hasSecret).toBe(true);
    expect((await settings.oauthClient('GMAIL')).clientSecret).toBe('plain-secret');
    await settings.updateAppSettings({ googleClientSecret: null });
    expect((await settings.publicAppSettings()).google.hasSecret).toBe(false);
  });
  it('round-trips a stored secret through oauthClient', async () => {
    await settings.updateAppSettings({ googleClientId: 'gid', googleClientSecret: 'plain-secret' });
    expect(await settings.oauthClient('GMAIL')).toMatchObject({
      clientId: 'gid',
      clientSecret: 'plain-secret',
    });
  });
  it('stores the AI key encrypted and reports only hasKey', async () => {
    await settings.updateAppSettings({ jevApiKey: 'ai-key-123' });
    expect(
      (await testDb.appSettings.findUniqueOrThrow({ where: { id: 'app' } })).jevApiKey,
    ).toMatch(/^v1\./);
    expect(await settings.jevApiKey()).toBe('ai-key-123');
    const publicView = await settings.publicAppSettings();
    expect(publicView.ai).toEqual({ hasKey: true });
    expect(JSON.stringify(publicView)).not.toContain('ai-key-123');
  });
});

describe('oauthClient', () => {
  it('throws GOOGLE_NOT_CONFIGURED when nothing is set', async () => {
    await expect(settings.oauthClient('GMAIL')).rejects.toMatchObject({
      code: 'GOOGLE_NOT_CONFIGURED',
    });
    await expect(settings.oauthClient('OUTLOOK')).rejects.toMatchObject({
      code: 'OUTLOOK_NOT_CONFIGURED',
    });
  });
  it('falls back to env vars when the row is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'env-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'env-secret');
    expect(await settings.oauthClient('GMAIL')).toMatchObject({
      clientId: 'env-id',
      clientSecret: 'env-secret',
    });
    await settings.updateAppSettings({ googleClientId: '' });
    expect(await settings.oauthClient('GMAIL')).toMatchObject({ clientId: 'env-id' });
  });
  it('prefers the settings row over env', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'env-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'env-secret');
    await settings.updateAppSettings({
      googleClientId: 'row-id',
      googleClientSecret: 'row-secret',
    });
    expect(await settings.oauthClient('GMAIL')).toMatchObject({
      clientId: 'row-id',
      clientSecret: 'row-secret',
    });
  });
  it('defaults the Microsoft tenant to common', async () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', 'ms-id');
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'ms-secret');
    expect((await settings.oauthClient('OUTLOOK')).tenant).toBe('common');
  });
});

describe('appSettingsSchema', () => {
  it('rejects a bad tenant', () => {
    expect(settings.appSettingsSchema.safeParse({ microsoftTenantId: 'bad tenant!' }).success).toBe(
      false,
    );
    expect(
      settings.appSettingsSchema.safeParse({ microsoftTenantId: 'organizations' }).success,
    ).toBe(true);
  });
  it('rejects unknown keys', () => {
    expect(settings.appSettingsSchema.safeParse({ nope: 'x' }).success).toBe(false);
  });
});

describe('redirectUri', () => {
  it('defaults to localhost', () => {
    expect(settings.redirectUri('OUTLOOK')).toBe(
      'http://localhost:3000/api/accounts/outlook/callback',
    );
    expect(settings.redirectUri('GMAIL')).toBe('http://localhost:3000/api/accounts/gmail/callback');
  });
  it('follows NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mail.example.com/');
    expect(settings.redirectUri('GMAIL')).toBe(
      'https://mail.example.com/api/accounts/gmail/callback',
    );
  });
});
