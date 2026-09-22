import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: auth.createClient }));
import { proxy } from '../src/proxy';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  auth.getUser.mockResolvedValue({ data: { user: null } });
  auth.createClient.mockReturnValue({ auth: { getUser: auth.getUser } });
});
afterEach(() => vi.unstubAllEnvs());

const request = (path: string) => new NextRequest(`https://app.example${path}`);

describe('public homepage and inbox routing', () => {
  it('serves the landing page without initializing authentication', async () => {
    const response = await proxy(request('/?utm_source=launch'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(auth.createClient).not.toHaveBeenCalled();
  });

  it.each(['live', 'demo'])('preserves old email links in %s mode', async (mode) => {
    vi.stubEnv('APP_MODE', mode);
    const response = await proxy(request('/?workspace=WORK&email=mail%2F123'));
    expect(response.headers.get('location')).toBe(
      'https://app.example/inbox?workspace=WORK&email=mail%2F123',
    );
    expect(auth.createClient).not.toHaveBeenCalled();
  });

  it('preserves old workspace bookmarks', async () => {
    const response = await proxy(request('/?workspace=PERSONAL'));
    expect(response.headers.get('location')).toBe('https://app.example/inbox?workspace=PERSONAL');
  });

  it.each(['/inbox', '/tags', '/accounts', '/settings'])(
    'protects %s in live mode',
    async (path) => {
      const response = await proxy(request(path));
      expect(response.headers.get('location')).toBe('https://app.example/signin');
      expect(auth.getUser).toHaveBeenCalledOnce();
    },
  );

  it('lets authenticated users enter the inbox', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const response = await proxy(request('/inbox'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('sends an authenticated sign-in to the inbox and keeps refreshed cookies', async () => {
    auth.createClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([
        { name: 'refreshed-session', value: 'fixture', options: { httpOnly: true } },
      ]);
      return { auth: { getUser: auth.getUser } };
    });
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const response = await proxy(request('/signin'));
    expect(response.headers.get('location')).toBe('https://app.example/inbox');
    expect(response.cookies.get('refreshed-session')?.value).toBe('fixture');
  });

  it('opens the demo inbox without authentication', async () => {
    vi.stubEnv('APP_MODE', 'demo');
    const response = await proxy(request('/inbox'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(auth.createClient).not.toHaveBeenCalled();
  });
});
