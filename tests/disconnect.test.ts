import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  find: vi.fn(),
  remove: vi.fn(),
  lock: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ id: 'u' }) }));
vi.mock('@/lib/db', () => ({ db: { emailAccount: { findFirst: m.find, deleteMany: m.remove } } }));
vi.mock('@/lib/providers/credentials', () => ({ withAccountLock: m.lock }));
vi.mock('@/lib/crypto', () => ({ decrypt: m.decrypt, constantTimeEqual: vi.fn() }));
import { DELETE } from '../src/app/api/[...path]/route';
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_MODE = 'live';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  m.find.mockResolvedValue({ id: 'a' });
  m.lock.mockImplementation(async (_u, _w, _id, fn) =>
    fn({ id: 'a', userId: 'u', workspace: 'WORK', syncLeaseId: 'held', accessToken: 'encrypted' }),
  );
  m.decrypt.mockReturnValue('token');
  m.remove.mockResolvedValue({ count: 1 });
});
const request = () =>
  new Request('http://localhost:3000/api/accounts/a?workspace=WORK', {
    method: 'DELETE',
    headers: { origin: 'http://localhost:3000' },
  });
it('scopes lookup and holds account lease through provider cleanup and local removal', async () => {
  const response = await DELETE(request());
  expect(response.status).toBe(200);
  expect(m.find).toHaveBeenCalledWith({
    where: { id: 'a', userId: 'u', workspace: 'WORK' },
    select: { id: true },
  });
  expect(m.remove).toHaveBeenCalledWith({
    where: { id: 'a', userId: 'u', workspace: 'WORK', syncLeaseId: 'held' },
  });
  expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.remove.mock.invocationCallOrder[0]);
});
it('disconnects locally even when provider credentials can no longer decrypt', async () => {
  m.decrypt.mockImplementation(() => {
    throw new Error('invalid');
  });
  expect((await DELETE(request())).status).toBe(200);
  expect(m.remove).toHaveBeenCalledOnce();
});
it('does not touch another workspace account', async () => {
  m.find.mockResolvedValue(null);
  expect((await DELETE(request())).status).toBe(404);
  expect(m.lock).not.toHaveBeenCalled();
});
it('reports failure if local deletion fails', async () => {
  m.remove.mockRejectedValue(new Error('offline'));
  expect((await DELETE(request())).status).toBe(500);
});
