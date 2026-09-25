import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims } }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: mocks.find, create: mocks.create, upsert: mocks.upsert } },
}));
import { requireUser } from '@/lib/auth';
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_MODE = 'live';
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'a', email: 'a@example.com' } },
    error: null,
  });
});
it('verifies each API read independently and never writes an existing user', async () => {
  mocks.find.mockResolvedValue({ id: 'a', email: 'a@example.com' });
  await requireUser();
  await requireUser();
  expect(mocks.getUser).toHaveBeenCalledTimes(2);
  expect(mocks.find).toHaveBeenCalledTimes(2);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('bootstraps only missing users and handles concurrent first requests', async () => {
  mocks.find.mockResolvedValueOnce(null).mockResolvedValue({ id: 'a', email: 'a@example.com' });
  mocks.create.mockRejectedValue({ code: 'P2002' });
  expect(await requireUser()).toMatchObject({ id: 'a' });
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('rejects expired or missing auth before database reads', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') });
  await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  expect(mocks.find).not.toHaveBeenCalled();
});

it('hydrates the shell only from verified claims with a usable identity', async () => {
  const { getShellUser } = await import('@/lib/auth');
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: 'a', email: 'a@example.com' } },
    error: null,
  });
  expect(await getShellUser()).toEqual({ id: 'a', email: 'a@example.com' });
  expect(mocks.getUser).not.toHaveBeenCalled();
  expect(mocks.find).not.toHaveBeenCalled();
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: 'a', email: 'a@example.com' } },
    error: new Error('invalid signature'),
  });
  expect(await getShellUser()).toBeNull();
});
