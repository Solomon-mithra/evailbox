import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  customer: vi.fn(),
  subscriptions: vi.fn(),
  checkout: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
  portal: vi.fn(),
  cancel: vi.fn(),
  price: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { $queryRaw: mocks.query, $executeRaw: mocks.execute, $transaction: mocks.transaction },
}));
vi.mock('@/lib/billing/config', async (original) => ({
  ...(await original<typeof import('@/lib/billing/config')>()),
  stripeClient: () => ({
    customers: { create: mocks.customer },
    subscriptions: { list: mocks.subscriptions, cancel: mocks.cancel },
    prices: { retrieve: mocks.price },
    checkout: {
      sessions: { create: mocks.checkout, retrieve: mocks.retrieve, expire: mocks.expire },
    },
    billingPortal: { sessions: { create: mocks.portal } },
  }),
}));
import {
  startTrial,
  createCheckout,
  createPortal,
  refreshBilling,
  handleBillingEvent,
  cancelBillingForDeletion,
} from '@/lib/billing/service';
import { processingAccess } from '@/lib/billing/state';
const database = new PGlite();
const uid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sqlClient = (connection: Pick<PGlite, 'query'>) => ({
  $queryRaw: async (q: Prisma.Sql) => (await connection.query(q.text, q.values)).rows,
  $executeRaw: async (q: Prisma.Sql) => (await connection.query(q.text, q.values)).affectedRows,
});
beforeAll(async () => {
  await database.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE users(id uuid PRIMARY KEY,email text NOT NULL,plan text DEFAULT 'STARTER',"planSource" text DEFAULT 'preview',"workRequested" boolean DEFAULT false,"workRevision" integer DEFAULT 0); CREATE TABLE monthly_usage("userId" uuid,month date,emails integer);`,
  );
  await database.exec(
    await readFile('prisma/migrations/20260927000000_stripe_billing/migration.sql', 'utf8'),
  );
}, 30000);
afterAll(() => database.close());
beforeEach(async () => {
  await database.exec(
    'TRUNCATE users CASCADE; TRUNCATE stripe_webhook_receipts; TRUNCATE monthly_usage;',
  );
  await database.query(
    "INSERT INTO users(id,email) VALUES($1,'a@example.com'),($2,'b@example.com')",
    [uid, other],
  );
  vi.resetAllMocks();
  mocks.query.mockImplementation(sqlClient(database).$queryRaw);
  mocks.execute.mockImplementation(sqlClient(database).$executeRaw);
  mocks.transaction.mockImplementation(async (fn) =>
    database.transaction(async (tx) => fn(sqlClient(tx))),
  );
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
  mocks.customer.mockResolvedValue({ id: 'cus_ours' });
  mocks.subscriptions.mockResolvedValue({ data: [], has_more: false });
  mocks.checkout.mockResolvedValue({
    id: 'cs_ours',
    url: 'https://checkout.stripe.com/c/pay/ours',
    status: 'open',
    customer: 'cus_ours',
  });
  mocks.portal.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/ours' });
  mocks.price.mockImplementation(async (id) => ({
    id,
    active: true,
    currency: 'usd',
    unit_amount: id === 'price_starter' ? 499 : 799,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  }));
});
afterEach(() => vi.unstubAllEnvs());
async function state() {
  return (
    await database.query<Record<string, unknown>>(
      'SELECT * FROM billing_accounts WHERE "userId"=$1',
      [uid],
    )
  ).rows[0];
}
const paid = (changes: Record<string, unknown> = {}) => ({
  id: 'sub_ours',
  customer: 'cus_ours',
  status: 'active',
  created: 100,
  cancel_at_period_end: false,
  latest_invoice: { status: 'paid' },
  items: {
    data: [
      {
        quantity: 1,
        current_period_start: Math.floor(Date.now() / 1000) - 10,
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        price: {
          id: 'price_heavy',
          currency: 'usd',
          unit_amount: 799,
          recurring: { interval: 'month', interval_count: 1 },
        },
      },
    ],
  },
  ...changes,
});
const event = (id = 'evt_one', customer = 'cus_ours') =>
  ({
    id,
    type: 'customer.subscription.updated',
    livemode: false,
    data: { object: { customer } },
  }) as Stripe.Event;
it('reconciles a return using only the stored customer and recovers a missed checkout webhook', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.retrieve.mockResolvedValue({ id: 'cs_ours', customer: 'cus_ours', status: 'complete' });
  mocks.subscriptions.mockResolvedValue({ data: [paid()], has_more: false });
  await refreshBilling(uid);
  expect(mocks.subscriptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ customer: 'cus_ours' }),
  );
  expect((await processingAccess(uid)).access).toBe('active');
  expect(await state()).toMatchObject({
    checkoutSessionId: null,
    checkoutPlan: null,
    checkoutGeneration: 1,
  });
  expect(mocks.checkout).toHaveBeenCalledTimes(1);
});
it('never turns a checkout return into paid access before Stripe confirms payment', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.retrieve.mockResolvedValue({ id: 'cs_ours', customer: 'cus_ours', status: 'open' });
  await refreshBilling(uid);
  expect((await processingAccess(uid)).access).toBe('trial_available');
  expect((await state()).checkoutSessionId).toBe('cs_ours');
});
it('does not query Stripe for a return without a stored customer', async () => {
  await refreshBilling(uid);
  expect(mocks.subscriptions).not.toHaveBeenCalled();
  expect((await processingAccess(uid)).access).toBe('trial_available');
});
it('recognizes portal cancellation dates as period-end cancellation and clears them on resumption', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.retrieve.mockResolvedValue({ customer: 'cus_ours', status: 'complete' });
  const subscription = paid();
  mocks.subscriptions.mockResolvedValue({
    data: [
      {
        ...subscription,
        cancel_at: subscription.items.data[0].current_period_end,
        cancel_at_period_end: false,
      },
    ],
    has_more: false,
  });
  await refreshBilling(uid);
  expect((await state()).cancelAtPeriodEnd).toBe(true);
  expect((await processingAccess(uid)).access).toBe('active');
  mocks.subscriptions.mockResolvedValue({
    data: [{ ...subscription, cancel_at: null }],
    has_more: false,
  });
  await refreshBilling(uid);
  expect((await state()).cancelAtPeriodEnd).toBe(false);
});
it('rejects a mismatched checkout customer while refreshing', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.retrieve.mockResolvedValue({ id: 'cs_ours', customer: 'cus_other', status: 'complete' });
  await expect(refreshBilling(uid)).rejects.toThrow('Checkout customer does not match');
  expect((await state()).checkoutSessionId).toBe('cs_ours');
});
it('starts one 72-hour trial without calling Stripe and never renews it on retries', async () => {
  await startTrial(uid);
  const first = await state();
  expect((first.trialEndsAt as Date).getTime() - (first.trialStartedAt as Date).getTime()).toBe(
    3 * 86400000,
  );
  expect((await processingAccess(uid)).access).toBe('trial');
  await startTrial(uid);
  expect((await state()).trialEndsAt).toEqual(first.trialEndsAt);
  await database.query(
    'UPDATE billing_accounts SET "trialStartedAt"=now()-interval \'4 days\',"trialEndsAt"=now()-interval \'1 day\' WHERE "userId"=$1',
    [uid],
  );
  await expect(startTrial(uid)).rejects.toMatchObject({ code: 'TRIAL_USED' });
  expect(mocks.customer).not.toHaveBeenCalled();
});
it('creates a server-priced paid checkout bound to this user, with no automatic trial conversion', async () => {
  await startTrial(uid);
  expect(await createCheckout(uid, 'STARTER')).toEqual({
    url: 'https://checkout.stripe.com/c/pay/ours',
  });
  expect(mocks.checkout).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: 'cus_ours',
      client_reference_id: uid,
      mode: 'subscription',
      managed_payments: { enabled: false },
      payment_method_types: ['card'],
      line_items: [{ price: 'price_starter', quantity: 1 }],
      success_url: 'http://localhost:3000/settings?billing=success',
      cancel_url: 'http://localhost:3000/settings?billing=canceled',
    }),
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  );
  const params = mocks.checkout.mock.calls[0][0];
  expect(params.subscription_data.trial_period_days).toBeUndefined();
  expect(params.subscription_data.trial_end).toBeUndefined();
  expect((await state()).subscriptionStatus).toBeNull();
});
it('reuses an open checkout and blocks duplicates before a webhook arrives', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.retrieve.mockResolvedValue({
    id: 'cs_ours',
    customer: 'cus_ours',
    status: 'open',
    url: 'https://checkout.stripe.com/c/pay/ours',
  });
  await createCheckout(uid, 'STARTER');
  expect(mocks.checkout).toHaveBeenCalledTimes(1);
  mocks.subscriptions.mockResolvedValue({ data: [paid()], has_more: false });
  await expect(createCheckout(uid, 'HEAVY')).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
});
it('refuses a misconfigured amount before creating checkout', async () => {
  mocks.price.mockResolvedValue({
    id: 'price_starter',
    active: true,
    currency: 'usd',
    unit_amount: 1499,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  });
  await expect(createCheckout(uid, 'STARTER')).rejects.toMatchObject({
    code: 'BILLING_CATALOG_INVALID',
  });
  expect(mocks.checkout).not.toHaveBeenCalled();
});
it('reconciles current Stripe state and duplicate webhook delivery exactly once', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.subscriptions.mockResolvedValue({ data: [paid()], has_more: false });
  await handleBillingEvent(event());
  expect(await processingAccess(uid)).toMatchObject({
    access: 'active',
    planId: 'HEAVY',
    limit: 20000,
  });
  const count = mocks.subscriptions.mock.calls.length;
  await handleBillingEvent(event());
  expect(mocks.subscriptions).toHaveBeenCalledTimes(count);
  // A later-delivered old event must fetch CURRENT cancellation, never grant its old active payload.
  mocks.subscriptions.mockResolvedValue({ data: [paid({ status: 'canceled' })], has_more: false });
  await handleBillingEvent(event('evt_old'));
  expect((await processingAccess(uid)).allowed).toBe(false);
});
it('does not grant paid access for an unpaid upgrade or unknown catalog price', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.subscriptions.mockResolvedValue({
    data: [paid({ latest_invoice: { status: 'open' } })],
    has_more: false,
  });
  await handleBillingEvent(event());
  expect((await processingAccess(uid)).allowed).toBe(false);
  const unknown = paid();
  unknown.items.data[0].price.id = 'price_unknown';
  mocks.subscriptions.mockResolvedValue({ data: [unknown], has_more: false });
  await handleBillingEvent(event('evt_unknown'));
  expect((await processingAccess(uid)).allowed).toBe(false);
});
it('never accepts event metadata as ownership and keeps failed events retryable', async () => {
  await createCheckout(uid, 'STARTER');
  await handleBillingEvent(event('evt_other', 'cus_other'));
  expect((await state()).subscriptionStatus).toBeNull();
  mocks.subscriptions.mockRejectedValueOnce(new Error('network'));
  await expect(handleBillingEvent(event())).rejects.toThrow();
  expect(
    (await database.query("SELECT id FROM stripe_webhook_receipts WHERE id='evt_one'")).rows,
  ).toHaveLength(0);
});
it('creates portal only for the authenticated user’s stored customer', async () => {
  await expect(createPortal(other)).rejects.toMatchObject({ code: 'NO_BILLING_ACCOUNT' });
  await createCheckout(uid, 'STARTER');
  expect(await createPortal(uid)).toEqual({ url: 'https://billing.stripe.com/p/session/ours' });
  expect(mocks.portal).toHaveBeenCalledWith({
    customer: 'cus_ours',
    configuration: 'bpc_example',
    return_url: 'http://localhost:3000/settings?billing=portal',
  });
});
it('cancels subscriptions and expires checkout before marking an account for deletion', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.retrieve.mockResolvedValue({ id: 'cs_ours', status: 'open', customer: 'cus_ours' });
  mocks.subscriptions.mockResolvedValue({ data: [paid()], has_more: false });
  await cancelBillingForDeletion(uid);
  expect(mocks.cancel).toHaveBeenCalledWith('sub_ours');
  expect(mocks.expire).toHaveBeenCalledWith('cs_ours');
  expect((await state()).deletingAt).toBeInstanceOf(Date);
  await expect(createCheckout(uid, 'HEAVY')).rejects.toMatchObject({ code: 'ACCOUNT_DELETING' });
});
it('keeps usage on a same-period plan change and resets only at the next billing period', async () => {
  await createCheckout(uid, 'STARTER');
  const first = paid();
  mocks.subscriptions.mockResolvedValue({ data: [first], has_more: false });
  await handleBillingEvent(event());
  const access = await processingAccess(uid);
  await database.query(
    'INSERT INTO billing_usage("userId","periodStart",emails) VALUES($1,$2::timestamp,1234)',
    [uid, access.start.toISOString()],
  );
  const downgrade = paid();
  downgrade.items.data[0].price.id = 'price_starter';
  downgrade.items.data[0].price.unit_amount = 499;
  mocks.subscriptions.mockResolvedValue({ data: [downgrade], has_more: false });
  await handleBillingEvent(event('evt_downgrade'));
  expect(await processingAccess(uid)).toMatchObject({
    used: 1234,
    remaining: 8766,
    planId: 'STARTER',
  });
  const renewed = paid();
  renewed.items.data[0].current_period_start += 5;
  mocks.subscriptions.mockResolvedValue({ data: [renewed], has_more: false });
  await handleBillingEvent(event('evt_renewed'));
  expect(await processingAccess(uid)).toMatchObject({ used: 0, remaining: 20000 });
});
it('allows resubscription after a completed checkout and subsequent cancellation', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.subscriptions.mockResolvedValue({ data: [paid()], has_more: false });
  await handleBillingEvent({
    ...event('evt_completed'),
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_ours', customer: 'cus_ours' } },
  } as Stripe.Event);
  mocks.subscriptions.mockResolvedValue({ data: [paid({ status: 'canceled' })], has_more: false });
  await handleBillingEvent(event('evt_canceled'));
  mocks.checkout.mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/new' });
  expect(await createCheckout(uid, 'HEAVY')).toEqual({
    url: 'https://checkout.stripe.com/c/pay/new',
  });
});
it('retains manual entitlement provenance after the fallback allowance is exhausted', async () => {
  await createCheckout(uid, 'STARTER');
  mocks.subscriptions.mockResolvedValue({ data: [paid({ status: 'canceled' })], has_more: false });
  await handleBillingEvent(event());
  await database.query('UPDATE users SET "planSource"=\'manual\' WHERE id=$1', [uid]);
  const access = await processingAccess(uid);
  await database.query(
    'INSERT INTO monthly_usage("userId",month,emails) VALUES($1,$2::date,10000)',
    [uid, access.start.toISOString()],
  );
  expect(await processingAccess(uid)).toMatchObject({
    access: 'limit_reached',
    source: 'manual',
    allowed: false,
  });
});
