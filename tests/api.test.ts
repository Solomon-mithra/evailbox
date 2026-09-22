import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  tagFind: vi.fn(),
  tagDelete: vi.fn(),
  accountDelete: vi.fn(),
  accountList: vi.fn(),
  emailUpdate: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  supabaseServer: vi.fn(),
  adminAuth: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    tag: { findFirst: mocks.tagFind, delete: mocks.tagDelete },
    emailAccount: { deleteMany: mocks.accountDelete, findMany: mocks.accountList },
    email: { updateMany: mocks.emailUpdate },
  },
}));
vi.mock('@/lib/sync', () => ({ syncUser: vi.fn() }));
vi.mock('@/lib/digest', () => ({ sendDigests: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notifyUser: vi.fn() }));
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
  it('protects cron endpoints', async () => {
    process.env.CRON_SECRET = 'secret';
    expect((await GET(request('cron/sync', 'GET'))).status).toBe(401);
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
