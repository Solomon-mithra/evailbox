import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempCwd } from './helpers/cwd';

let proxy: typeof import('../src/proxy').proxy;
let session: typeof import('../src/lib/session');
let cleanup: () => void;
beforeEach(async () => {
  ({ cleanup } = useTempCwd());
  for (const name of [
    'ENCRYPTION_SECRET_KEY',
    'APP_PASSWORD',
    'NEXT_PUBLIC_APP_URL',
    'ALLOW_NO_PASSWORD',
  ])
    vi.stubEnv(name, undefined);
  vi.stubEnv('APP_MODE', 'live');
  vi.resetModules();
  ({ proxy } = await import('../src/proxy'));
  session = await import('../src/lib/session');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanup();
});

const request = (path: string, host = 'localhost:3000', cookie?: string) =>
  new NextRequest(`http://${host}${path}`, {
    headers: { host, ...(cookie ? { cookie } : {}) },
  });
const passes = (response: Response) => response.headers.get('x-middleware-next') === '1';
const redirectsTo = (response: Response) =>
  new URL(response.headers.get('location') ?? '').pathname;

describe('host allow-list (DNS-rebinding guard)', () => {
  it.each(['/inbox', '/api/health'])('rejects an unknown host on %s with 421', async (path) => {
    expect((await proxy(request(path, 'evil.example:3000'))).status).toBe(421);
  });
  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000'])(
    'allows loopback %s',
    async (host) => {
      expect(passes(await proxy(request('/inbox', host)))).toBe(true);
    },
  );
  it('allows the configured host and drops loopback when NEXT_PUBLIC_APP_URL is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mail.example.com');
    vi.stubEnv('ALLOW_NO_PASSWORD', '1');
    expect(passes(await proxy(request('/inbox', 'mail.example.com')))).toBe(true);
    expect((await proxy(request('/inbox', 'localhost:3000'))).status).toBe(421);
  });
  it('refuses to serve a public address without a password', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mail.example.com');
    expect((await proxy(request('/inbox', 'mail.example.com'))).status).toBe(503);
  });
  it('refuses to serve when bound beyond loopback without a password', async () => {
    vi.stubEnv('HOST', '0.0.0.0');
    expect((await proxy(request('/inbox'))).status).toBe(503);
    vi.stubEnv('ALLOW_NO_PASSWORD', '1');
    expect(passes(await proxy(request('/inbox')))).toBe(true);
  });
});

describe('without APP_PASSWORD', () => {
  it('lets /inbox through', async () => {
    expect(passes(await proxy(request('/inbox')))).toBe(true);
  });
  it('redirects /signin to /inbox', async () => {
    expect(redirectsTo(await proxy(request('/signin')))).toBe('/inbox');
  });
});

describe('with APP_PASSWORD', () => {
  beforeEach(() => {
    vi.stubEnv('APP_PASSWORD', 'correct horse battery');
  });
  const cookie = () => `${session.SESSION_COOKIE}=${session.createSessionToken().token}`;

  it('redirects /inbox to /signin without a cookie', async () => {
    expect(redirectsTo(await proxy(request('/inbox')))).toBe('/signin');
  });
  it('lets /inbox through with a valid session cookie', async () => {
    expect(passes(await proxy(request('/inbox', 'localhost:3000', cookie())))).toBe(true);
  });
  it('rejects a forged session cookie', async () => {
    const forged = `${session.SESSION_COOKIE}=${Date.now() + 1e9}.AAAA`;
    expect(redirectsTo(await proxy(request('/inbox', 'localhost:3000', forged)))).toBe('/signin');
  });
  it('shows /signin to signed-out visitors', async () => {
    expect(passes(await proxy(request('/signin')))).toBe(true);
  });
  it('redirects /signin to /inbox with a valid cookie', async () => {
    expect(redirectsTo(await proxy(request('/signin', 'localhost:3000', cookie())))).toBe('/inbox');
  });
  it('leaves /api/inbox to the handler, which checks auth itself', async () => {
    expect(passes(await proxy(request('/api/inbox')))).toBe(true);
  });
});
