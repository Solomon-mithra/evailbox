import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  account: vi.fn(),
  request: vi.fn(),
  kick: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: m.auth }));
vi.mock('@/lib/db', () => ({ db: { emailAccount: { findFirst: m.account } } }));
vi.mock('@/lib/work-queue', () => ({ requestWork: m.request }));
vi.mock('@/lib/background', () => ({ kickWork: m.kick }));
import { POST } from '@/app/api/sync/route';
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  m.auth.mockResolvedValue({ id: 'u' });
});
function request(body = {}) {
  return new Request('http://localhost:3000/api/sync?workspace=WORK', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it('returns 202 after durable marking without waiting for the worker', async () => {
  const response = await POST(request());
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ data: { queued: true, workerAvailable: true } });
  expect(m.request).toHaveBeenCalledWith('u', {
    sync: true,
    workspace: 'WORK',
    accountId: undefined,
  });
  expect(m.kick).toHaveBeenCalledOnce();
  expect(m.request.mock.invocationCallOrder[0]).toBeLessThan(m.kick.mock.invocationCallOrder[0]);
});
it('rejects another tenant/workspace account before marking work', async () => {
  m.account.mockResolvedValue(null);
  expect((await POST(request({ accountId: 'other' }))).status).toBe(404);
  expect(m.account.mock.calls[0][0].where).toEqual({ id: 'other', userId: 'u', workspace: 'WORK' });
  expect(m.request).not.toHaveBeenCalled();
});
it('does not return queued success if durable persistence fails', async () => {
  m.request.mockRejectedValue(new Error('database down'));
  expect((await POST(request())).status).toBe(500);
  expect(m.kick).not.toHaveBeenCalled();
});
