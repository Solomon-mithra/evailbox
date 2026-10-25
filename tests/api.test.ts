import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
afterEach(() => vi.unstubAllEnvs());
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  tagFind: vi.fn(),
  tagDelete: vi.fn(),
  accountDelete: vi.fn(),
  accountList: vi.fn(),
  emailUpdate: vi.fn(),
  raw: vi.fn(),
  tagList: vi.fn(),
  prefFind: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  adminAuth: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    tag: { findFirst: mocks.tagFind, delete: mocks.tagDelete, findMany: mocks.tagList },
    emailAccount: { deleteMany: mocks.accountDelete, findMany: mocks.accountList },
    email: { updateMany: mocks.emailUpdate },
    notificationPref: { findUnique: mocks.prefFind },
    $queryRaw: mocks.raw,
  },
}));
vi.mock('@/lib/sync', () => ({ syncUser: vi.fn() }));
import { GET, POST, PATCH, DELETE } from '../src/app/api/[...path]/route';
import { ApiError } from '../src/lib/errors';
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_MODE = 'live';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  mocks.requireUser.mockResolvedValue({ id: 'tenant-a', email: 'a@example.com' });
});
function request(path: string, method: string, body?: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/' + path, {
    method,
    headers: { origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
describe('API authorization and isolation', () => {
  it('rejects mutation requests from foreign origins before database access', async () => {
    const response = await POST(request('tags', 'POST', {}, 'https://evil.example'));
    expect(response.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });
  it('returns a typed unauthorized response', async () => {
    mocks.requireUser.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Sign in'));
    const response = await GET(request('accounts', 'GET'));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
  });
  it('does not delete another tenant’s tag', async () => {
    mocks.tagFind.mockResolvedValue(null);
    const response = await DELETE(request('tags/other', 'DELETE'));
    expect(response.status).toBe(404);
    expect(mocks.tagFind).toHaveBeenCalledWith({
      where: { id: 'other', userId: 'tenant-a', workspace: 'PERSONAL' },
    });
    expect(mocks.tagDelete).not.toHaveBeenCalled();
  });
  it('projects account results without secrets', async () => {
    mocks.accountList.mockResolvedValue([]);
    expect((await GET(request('accounts', 'GET'))).status).toBe(200);
    const args = mocks.accountList.mock.calls[0][0];
    expect(args.where.userId).toBe('tenant-a');
    expect(args.select.accessToken).toBeUndefined();
    expect(args.select.refreshToken).toBeUndefined();
  });
  it('scopes handled updates and rejects missing emails', async () => {
    mocks.emailUpdate.mockResolvedValue({ count: 0 });
    const response = await PATCH(request('emails/other', 'PATCH', { handled: true }));
    expect(response.status).toBe(404);
    expect(mocks.emailUpdate).toHaveBeenCalledWith({
      where: { id: 'other', userId: 'tenant-a', workspace: 'PERSONAL' },
      data: { handled: true },
    });
  });
  it('never executes live actions in demo mode', async () => {
    process.env.APP_MODE = 'demo';
    const response = await GET(request('accounts', 'GET'));
    expect(response.status).toBe(503);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });
  it('validates settings before any write', async () => {
    const response = await PATCH(request('settings', 'PATCH', { minConfidence: 200 }));
    expect(response.status).toBe(400);
  });
  it('rejects removed digest settings', async () => {
    const response = await PATCH(request('settings', 'PATCH', { dailyDigest: true }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });
});

it('scopes Work account lists and message mutations to Work', async () => {
  mocks.accountList.mockResolvedValue([]);
  expect((await GET(request('accounts?workspace=WORK', 'GET'))).status).toBe(200);
  expect(mocks.accountList.mock.calls[0][0].where).toEqual({
    userId: 'tenant-a',
    workspace: 'WORK',
  });
  mocks.emailUpdate.mockResolvedValue({ count: 0 });
  expect(
    (await PATCH(request('emails/personal-email?workspace=WORK', 'PATCH', { handled: true })))
      .status,
  ).toBe(404);
  expect(mocks.emailUpdate.mock.calls[0][0].where).toEqual({
    id: 'personal-email',
    userId: 'tenant-a',
    workspace: 'WORK',
  });
});
it('rejects unknown workspaces before accessing mailbox data', async () => {
  expect((await GET(request('accounts?workspace=OTHER', 'GET'))).status).toBe(400);
  expect(mocks.accountList).not.toHaveBeenCalled();
});

it('loads inbox summaries independently of metadata, counts and settings', async () => {
  mocks.raw.mockResolvedValue([]);
  const response = await GET(request('inbox?workspace=WORK', 'GET'));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ emails: [], pageSize: 50, nextCursor: null });
  expect(mocks.requireUser).toHaveBeenCalledOnce();
  expect(mocks.raw).toHaveBeenCalledOnce();
  expect(mocks.tagList).not.toHaveBeenCalled();
  expect(mocks.prefFind).not.toHaveBeenCalled();
  expect(mocks.accountList).not.toHaveBeenCalled();
});
it('checks inbox API authorization even when the proxy is bypassed', async () => {
  mocks.requireUser.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Sign in'));
  expect((await GET(request('inbox', 'GET'))).status).toBe(401);
  expect(mocks.raw).not.toHaveBeenCalled();
});
it('loads separate metadata and defaults for missing settings without loading mail or writing preferences', async () => {
  mocks.tagList.mockResolvedValue([]);
  mocks.accountList.mockResolvedValue([]);
  mocks.prefFind.mockResolvedValue(null);
  const metadata = await GET(request('workspace/metadata?workspace=WORK', 'GET'));
  expect(metadata.status).toBe(200);
  expect((await metadata.json()).data).toMatchObject({
    user: { id: 'tenant-a' },
    tags: [],
    accounts: [],
  });
  expect(mocks.tagList.mock.calls[0][0].where).toEqual({ userId: 'tenant-a', workspace: 'WORK' });
  const settings = await GET(request('workspace/settings', 'GET'));
  expect((await settings.json()).data.refreshMinutes).toBe(5);
  expect(mocks.raw).not.toHaveBeenCalled();
});
