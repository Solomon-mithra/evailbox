import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ auth: vi.fn(), update: vi.fn(), overview: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: fixture.auth }));
vi.mock('@/lib/db', () => ({ db: { user: { update: fixture.update } } }));
vi.mock('@/lib/account-management', () => ({ getAccountOverview: fixture.overview }));
import { GET, PATCH } from '../src/app/api/account/route';
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  fixture.auth.mockResolvedValue({ id: 'verified-user' });
  fixture.overview.mockResolvedValue({ billingEnabled: false, limitsEnforced: false });
});
const request = (body: unknown, origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/account', {
    method: 'PATCH',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
it('reads the verified user plan without request-supplied identity', async () => {
  expect((await GET(new Request('http://localhost:3000/api/account?userId=other'))).status).toBe(
    200,
  );
  expect(fixture.overview).toHaveBeenCalledWith('verified-user');
});
it('cannot self-grant Heavy or change the trusted plan source', async () => {
  for (const patch of [
    { plan: 'HEAVY' },
    { planSource: 'manual' },
    { userId: 'other', requestedPlan: 'HEAVY' },
  ])
    expect((await PATCH(request(patch))).status).toBe(400);
  expect(fixture.update).not.toHaveBeenCalled();
});
it('saves only a profile and non-billing preference for the verified user', async () => {
  expect((await PATCH(request({ displayName: '  Sam  ', requestedPlan: 'HEAVY' }))).status).toBe(
    200,
  );
  expect(fixture.update).toHaveBeenCalledWith({
    where: { id: 'verified-user' },
    data: { displayName: 'Sam', requestedPlan: 'HEAVY' },
  });
});
it('rejects cross-origin profile writes before auth', async () => {
  expect((await PATCH(request({ displayName: 'bad' }, 'https://other.example'))).status).toBe(403);
  expect(fixture.auth).not.toHaveBeenCalled();
});
