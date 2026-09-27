import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkout: vi.fn(),
  portal: vi.fn(),
  trial: vi.fn(),
  overview: vi.fn(),
  event: vi.fn(),
  publish: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.auth }));
vi.mock('@/lib/billing/service', () => ({
  createCheckout: mocks.checkout,
  createPortal: mocks.portal,
  startTrial: mocks.trial,
  handleBillingEvent: mocks.event,
  refreshBilling: mocks.refresh,
}));
vi.mock('@/lib/account-management', () => ({ getAccountOverview: mocks.overview }));
vi.mock('@/lib/inngest/dispatch', () => ({ publishUserWork: mocks.publish }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (fn: () => void) => fn(),
}));
import { POST as checkout } from '@/app/api/billing/checkout/route';
import { POST as portal } from '@/app/api/billing/portal/route';
import { POST as trial } from '@/app/api/billing/trial/route';
import { POST as webhook } from '@/app/api/webhooks/stripe/route';
import { POST as refresh } from '@/app/api/billing/refresh/route';
const stripe = new Stripe('sk_test_example');
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({
    APP_MODE: 'live',
    BILLING_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_STARTER_PRICE_ID: 'price_starter',
    STRIPE_HEAVY_PRICE_ID: 'price_heavy',
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_example',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  }))
    vi.stubEnv(key, value);
  mocks.auth.mockResolvedValue({ id: 'verified-user' });
  mocks.checkout.mockResolvedValue({ url: 'https://checkout.stripe.com/ours' });
  mocks.portal.mockResolvedValue({ url: 'https://billing.stripe.com/ours' });
  mocks.overview.mockResolvedValue({ billing: { access: 'trial' } });
});
afterEach(() => vi.unstubAllEnvs());
const request = (path: string, data = {}, origin = 'http://localhost:3000') =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
it('refreshes only the signed-in billing account and rejects customer IDs and cross-origin requests', async () => {
  expect((await refresh(request('/api/billing/refresh', {}, 'https://evil.example'))).status).toBe(
    403,
  );
  expect((await refresh(request('/api/billing/refresh', { customer: 'cus_other' }))).status).toBe(
    400,
  );
  expect(mocks.refresh).not.toHaveBeenCalled();
  const response = await refresh(request('/api/billing/refresh'));
  expect(response.status).toBe(200);
  expect(mocks.refresh).toHaveBeenCalledWith('verified-user');
  expect(mocks.overview).toHaveBeenCalledWith('verified-user');
});
it('requires same-origin authenticated checkout and rejects browser prices/customer IDs', async () => {
  expect(
    (
      await checkout(
        request('/api/billing/checkout', { planId: 'STARTER' }, 'https://evil.example'),
      )
    ).status,
  ).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled();
  for (const body of [
    { planId: 'OTHER' },
    { planId: 'HEAVY', customer: 'cus_other' },
    { price: 'price_cheaper' },
  ])
    expect((await checkout(request('/api/billing/checkout', body))).status).toBe(400);
  expect((await checkout(request('/api/billing/checkout', { planId: 'HEAVY' }))).status).toBe(200);
  expect(mocks.checkout).toHaveBeenCalledWith('verified-user', 'HEAVY');
});
it('starts trial and opens portal only for the authenticated identity', async () => {
  expect((await trial(request('/api/billing/trial'))).status).toBe(200);
  expect(mocks.trial).toHaveBeenCalledWith('verified-user');
  expect((await portal(request('/api/billing/portal'))).status).toBe(200);
  expect(mocks.portal).toHaveBeenCalledWith('verified-user');
});
it('accepts signed raw webhooks without browser origin and rejects missing/tampered signatures', async () => {
  const payload = JSON.stringify({
    id: 'evt_test',
    type: 'invoice.paid',
    livemode: false,
    data: { object: { customer: 'cus_ours' } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_example' });
  const signed = (body: string, sig?: string) =>
    new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: sig ? { 'stripe-signature': sig } : {},
      body,
    });
  expect((await webhook(signed(payload))).status).toBe(400);
  expect((await webhook(signed(payload + ' ', signature))).status).toBe(400);
  expect(mocks.event).not.toHaveBeenCalled();
  expect((await webhook(signed(payload, signature))).status).toBe(200);
  expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt_test' }));
});
it('asks Stripe to retry if reconciliation fails and disables unconfigured/demo webhooks', async () => {
  const payload = JSON.stringify({
    id: 'evt_test',
    type: 'invoice.paid',
    livemode: false,
    data: { object: {} },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_example' });
  const signed = () =>
    new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: payload,
    });
  mocks.event.mockRejectedValueOnce(new Error('database failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await webhook(signed())).status).toBe(500);
  log.mockRestore();
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
  expect((await webhook(signed())).status).toBe(503);
});
