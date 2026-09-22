import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import { GET as llms } from '../src/app/llms.txt/route';
import { siteUrl } from '../src/lib/site';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://evailbox.example/');
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

it('publishes only the public homepage in the sitemap', () => {
  expect(sitemap().map((page) => page.url)).toEqual(['https://evailbox.example/']);
});

it('keeps private application routes out of crawler access rules', () => {
  const rules = robots();
  expect(rules.sitemap).toBe('https://evailbox.example/sitemap.xml');
  expect(rules.rules).toMatchObject({
    userAgent: '*',
    allow: '/',
    disallow: expect.arrayContaining(['/inbox', '/tags', '/accounts', '/settings', '/api/']),
  });
});

it('does not invite indexing on a preview deployment', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect(sitemap()).toEqual([]);
  expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
});

it('resolves canonical assets against the configured origin without carrying query parameters', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://evailbox.example/?utm_source=launch');
  expect(siteUrl('/og/evailbox.png').href).toBe('https://evailbox.example/og/evailbox.png');
});

it('requires a configured public URL rather than publishing a guessed domain', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  expect(() => siteUrl()).toThrow('NEXT_PUBLIC_APP_URL');
});

it('serves an account-aware product summary with public, configured links', async () => {
  const response = llms();
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  const body = await response.text();
  expect(body).toContain('https://evailbox.example/index.md');
  expect(body).toContain('The product uses accounts');
  expect(body).not.toMatch(/No account needed|localhost|jevinbox/i);
});
