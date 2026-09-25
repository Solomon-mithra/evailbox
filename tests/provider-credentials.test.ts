import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), find: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: { emailAccount: { updateMany: mocks.updateMany, findFirst: mocks.find } },
}));
vi.mock('@/lib/crypto', () => ({
  decrypt: (s: string) => s.replace('encrypted:', ''),
  encrypt: (s: string) => `encrypted:${s}`,
}));
vi.mock('@/lib/providers', () => ({ refreshAccessToken: mocks.refresh }));
import { withAccountCredentials } from '../src/lib/providers/credentials';
const account = {
  id: 'account',
  userId: 'owner',
  workspace: 'WORK',
  provider: 'GMAIL',
  accessToken: 'encrypted:old',
  refreshToken: 'encrypted:refresh',
  expiresAt: new Date(0),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.find.mockResolvedValue(account);
  mocks.refresh.mockResolvedValue({
    accessToken: 'new',
    refreshToken: 'rotated',
    expiresAt: Date.now() + 3600000,
  });
});
describe('serialized provider credentials', () => {
  it('never refreshes when the sync lease is held', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      withAccountCredentials('owner', 'WORK', 'account', async () => true),
    ).rejects.toMatchObject({ code: 'ACCOUNT_BUSY' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('rereads and refreshes under scoped lease, persists rotated credentials before operation, releases on error', async () => {
    const operation = vi.fn(async (a, token) => {
      expect(a.id).toBe('account');
      expect(token).toBe('new');
      expect(mocks.updateMany).toHaveBeenCalledTimes(2);
      throw new Error('operation failed');
    });
    await expect(withAccountCredentials('owner', 'WORK', 'account', operation)).rejects.toThrow(
      'operation failed',
    );
    expect(mocks.find).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'account',
        userId: 'owner',
        workspace: 'WORK',
        syncLeaseId: expect.any(String),
      }),
    });
    expect(mocks.updateMany.mock.calls[1][0].data).toMatchObject({
      accessToken: 'encrypted:new',
      refreshToken: 'encrypted:rotated',
    });
    expect(mocks.updateMany.mock.calls[2][0].data).toEqual({
      syncLeaseId: null,
      syncLeaseUntil: null,
    });
  });
});
