import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), thread: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.user }));
vi.mock('@/lib/email-thread', () => ({ getEmailThread: mocks.thread }));
import { GET } from '../src/app/api/emails/[id]/thread/route';
import { ApiError } from '../src/lib/errors';
const context = { params: Promise.resolve({ id: 'email' }) };
const request = (query = '') =>
  new Request(`https://app.example.com/api/emails/email/thread${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 'owner' });
  mocks.thread.mockResolvedValue({ messages: [], partial: false });
});
describe('conversation route', () => {
  it('returns authenticated conversation data without browser or shared caching', async () => {
    const response = await GET(request('?workspace=WORK&images=1'), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({ data: { messages: [], partial: false } });
    expect(mocks.thread).toHaveBeenCalledWith('owner', 'WORK', 'email', true);
  });
  it('defaults to personal workspace with remote images blocked', async () => {
    await GET(request(), context);
    expect(mocks.thread).toHaveBeenCalledWith('owner', 'PERSONAL', 'email', false);
  });
  it('rejects unauthenticated callers and prevents error caching', async () => {
    mocks.user.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Sign in.'));
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.thread).not.toHaveBeenCalled();
  });
  it('rejects invalid workspace and image flags before loading any conversation', async () => {
    expect((await GET(request('?workspace=OTHER'), context)).status).toBe(400);
    expect((await GET(request('?images=anything'), context)).status).toBe(400);
    expect(mocks.thread).not.toHaveBeenCalled();
  });
});
