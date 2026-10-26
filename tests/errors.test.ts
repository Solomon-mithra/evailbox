import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { route, ok } from '../src/lib/errors';

const handler = vi.fn(async () => ok({ reached: true }));
const run = route(handler);
beforeEach(() => {
  handler.mockClear();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
});
afterEach(() => vi.unstubAllEnvs());
const call = (method: string, origin?: string) =>
  run(
    new Request('http://localhost:3000/api/tags', {
      method,
      headers: origin ? { origin } : {},
    }),
  );

describe('route() origin check', () => {
  it('lets a same-origin POST reach the handler', async () => {
    expect((await call('POST', 'http://localhost:3000')).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
  it('rejects a foreign Origin with 403 INVALID_ORIGIN', async () => {
    const response = await call('POST', 'http://evil.example');
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('INVALID_ORIGIN');
    expect(handler).not.toHaveBeenCalled();
  });
  it('rejects a POST with no Origin', async () => {
    expect((await call('POST')).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it('lets a GET without Origin through', async () => {
    expect((await call('GET')).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
