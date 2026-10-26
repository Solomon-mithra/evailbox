import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, resetTestDb, testDb } from './helpers/sqlite';
import { useTempCwd } from './helpers/cwd';

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.value && name === 'evailbox_session' ? { value: jar.value } : undefined,
  }),
}));
vi.mock('@/lib/db', async () => ({ db: (await import('./helpers/sqlite')).testDb }));

let auth: typeof import('../src/lib/auth');
let cleanup: () => void;
beforeEach(async () => {
  ({ cleanup } = useTempCwd());
  jar.value = undefined;
  for (const name of ['ENCRYPTION_SECRET_KEY', 'APP_PASSWORD']) vi.stubEnv(name, undefined);
  vi.stubEnv('APP_MODE', 'live');
  vi.resetModules();
  await resetTestDb();
  auth = await import('../src/lib/auth');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanup();
});
afterAll(closeTestDb);

describe('without APP_PASSWORD', () => {
  it('requireUser returns the local owner and creates the row', async () => {
    expect(await testDb.user.count()).toBe(0);
    const user = await auth.requireUser();
    expect(user.id).toBe(auth.LOCAL_USER.id);
    expect(await testDb.user.count()).toBe(1);
    // A second call upserts instead of failing on the unique key.
    expect((await auth.requireUser()).id).toBe(auth.LOCAL_USER.id);
    expect(await testDb.user.count()).toBe(1);
  });
  it('getShellUser cannot sign out', async () => {
    expect(await auth.getShellUser()).toMatchObject({ id: auth.LOCAL_USER.id, canSignOut: false });
  });
});

describe('with APP_PASSWORD', () => {
  beforeEach(() => {
    vi.stubEnv('APP_PASSWORD', 'correct horse battery');
  });
  it('requireUser rejects with 401 and no cookie, and getShellUser returns null', async () => {
    await expect(auth.requireUser()).rejects.toMatchObject({ status: 401 });
    expect(await auth.getShellUser()).toBeNull();
    expect(await testDb.user.count()).toBe(0);
  });
  it('accepts a valid session cookie and can sign out', async () => {
    jar.value = (await import('../src/lib/session')).createSessionToken().token;
    expect((await auth.requireUser()).id).toBe(auth.LOCAL_USER.id);
    expect(await auth.getShellUser()).toMatchObject({ canSignOut: true });
  });
});

it('demo mode rejects live API calls with 503 DEMO_MODE', async () => {
  vi.stubEnv('APP_MODE', 'demo');
  await expect(auth.requireUser()).rejects.toMatchObject({ status: 503, code: 'DEMO_MODE' });
  expect(await testDb.user.count()).toBe(0);
});
