import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
  deleteIdentity: vi.fn(),
  deleteLocal: vi.fn(),
  signOut: vi.fn(),
  query: vi.fn(),
  tag: vi.fn(),
  updateTag: vi.fn(),
  updateUser: vi.fn(),
  deleteClassifications: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  requireUser: m.auth,
  adminAuth: () => ({ deleteUser: m.deleteIdentity }),
  supabaseServer: async () => ({ auth: { signOut: m.signOut } }),
}));
vi.mock('@/lib/db', () => ({
  db: {
    user: { deleteMany: m.deleteLocal },
    tag: { findFirst: m.tag },
    $transaction: m.transaction,
  },
}));
vi.mock('@/lib/billing/service', () => ({
  cancelBillingForDeletion: m.cancel,
  clearBillingDeletion: m.clear,
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: vi.fn(),
}));
import { DELETE, PATCH } from '@/app/api/[...path]/route';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  m.auth.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
  m.deleteIdentity.mockResolvedValue({ error: null });
  m.query.mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]);
  m.transaction.mockImplementation(async (fn) =>
    fn({
      $queryRaw: m.query,
      tag: { findUniqueOrThrow: m.tag, update: m.updateTag },
      user: { update: m.updateUser },
      emailClassification: { deleteMany: m.deleteClassifications },
    }),
  );
  m.tag.mockResolvedValue({
    id: 'tag',
    userId: '11111111-1111-4111-8111-111111111111',
    workspace: 'PERSONAL',
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const request = (method = 'DELETE', path = '/api/user', body: unknown = { confirm: 'DELETE' }) =>
  new Request('http://localhost:3000' + path, {
    method,
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
it('cancels recurring charges before deleting identity and local billing ownership', async () => {
  expect((await DELETE(request())).status).toBe(200);
  expect(m.cancel.mock.invocationCallOrder[0]).toBeLessThan(
    m.deleteIdentity.mock.invocationCallOrder[0],
  );
  expect(m.deleteIdentity.mock.invocationCallOrder[0]).toBeLessThan(
    m.deleteLocal.mock.invocationCallOrder[0],
  );
});
it('preserves ownership if Stripe cancellation fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.cancel.mockRejectedValue(new Error('Stripe unavailable'));
  expect((await DELETE(request())).status).toBe(500);
  expect(m.deleteIdentity).not.toHaveBeenCalled();
  expect(m.deleteLocal).not.toHaveBeenCalled();
});
it.each(['returned', 'thrown'])(
  'preserves local ownership and releases the deletion gate for %s identity errors',
  async (failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    if (failure === 'returned')
      m.deleteIdentity.mockResolvedValue({ error: new Error('identity failure') });
    else m.deleteIdentity.mockRejectedValue(new Error('identity failure'));
    expect((await DELETE(request())).status).toBe(502);
    expect(m.deleteLocal).not.toHaveBeenCalled();
    expect(m.clear).toHaveBeenCalledOnce();
  },
);
it('locks the user before editing a tag to avoid deadlocks with allowance saves', async () => {
  expect((await PATCH(request('PATCH', '/api/tags/tag', { name: 'Updated' }))).status).toBe(200);
  expect(m.query).toHaveBeenCalled();
  expect(m.query.mock.invocationCallOrder[0]).toBeLessThan(m.updateTag.mock.invocationCallOrder[0]);
});
