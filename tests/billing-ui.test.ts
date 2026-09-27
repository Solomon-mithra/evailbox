import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountOverview } from '@/lib/plans';

const mocks = vi.hoisted(() => ({ query: vi.fn(), demo: false, search: '' }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.query,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/components/providers', () => ({
  useDemo: () => mocks.demo,
  usePrivateCache: () => ({ user: { id: 'alice' }, ready: true }),
}));
vi.mock('@/components/workspace-selection', () => ({
  useWorkspaceSelection: () => ({ workspace: 'PERSONAL' }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mocks.search) }));
import { AccountProfile } from '@/components/account-profile';
import { CheckoutSummary } from '@/components/billing-panel';
import PricingPage, { metadata } from '@/app/pricing/page';

vi.stubGlobal('React', React);
let account: AccountOverview;
beforeEach(() => {
  mocks.demo = false;
  mocks.search = '';
  account = {
    user: {
      id: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      createdAt: '2026-09-01T00:00:00Z',
    },
    plan: {
      id: 'STARTER',
      name: 'Starter',
      price: 4.99,
      monthlyEmails: 10000,
      source: 'trial',
      requested: null,
    },
    usage: { emails: 12, periodStart: '2026-09-26T12:00:00Z', periodEnd: '2026-09-29T12:00:00Z' },
    billingEnabled: true,
    limitsEnforced: true,
    billing: {
      configured: true,
      access: 'trial_available',
      status: null,
      trialEndsAt: null,
      canStartTrial: true,
      canManage: false,
      cancelAtPeriodEnd: false,
      processingAllowed: false,
    },
  };
  mocks.query.mockImplementation(() => ({
    data: account,
    isPending: false,
    isError: false,
    isFetching: false,
    isFetchedAfterMount: true,
  }));
});
afterEach(() => vi.useRealTimers());

function render() {
  return renderToStaticMarkup(React.createElement(AccountProfile));
}
function button(html: string, label: string) {
  const result = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(([element]) =>
    element.includes(label),
  );
  expect(result, `Expected a ${label} button`).toBeDefined();
  return result![0];
}
it('separates profile saving from subscription management and shows both plan allowances', () => {
  const html = render();
  expect(html).toContain('Subscription');
  expect(html).toContain('Save profile');
  expect(html).toContain('20,000');
  expect(html).toContain('10,000');
  expect(html).toContain('<progress');
  expect(html).not.toContain('Save your display name and plan preference');
});
it('shows the verified plan compactly without a persistent success banner', () => {
  mocks.search = 'billing=success';
  account.billing.access = 'active';
  account.billing.status = 'active';
  account.billing.mode = 'test';
  const html = render();
  expect(html).toContain('<h3>Starter</h3>');
  expect(html).toContain('>Active</span>');
  expect(html).not.toContain('billing-notice');
  expect(html).toContain('Sandbox');
  expect(html).toContain('No real money is charged');
});
it('does not confirm payment using stale cached active access', () => {
  mocks.search = 'billing=success';
  account.billing.access = 'active';
  mocks.query.mockReturnValue({
    data: account,
    isPending: false,
    isError: false,
    isFetching: true,
    isFetchedAfterMount: false,
  });
  expect(render()).toContain('Waiting for payment confirmation');
  expect(render()).not.toContain('Your Starter subscription is active');
});
it('explains a ended paid subscription without saying a free trial ended', () => {
  account.billing.access = 'expired';
  account.billing.status = 'canceled';
  account.billing.canStartTrial = false;
  expect(render()).toContain('Your subscription has ended');
  expect(render()).not.toContain('Your free trial has ended');
});
it('describes a canceled subscription as ended instead of a failed payment', () => {
  account.billing.access = 'payment_required';
  account.billing.status = 'canceled';
  account.billing.canStartTrial = false;
  expect(render()).toContain('Your subscription has ended');
  expect(render()).not.toContain('Payment needs attention');
});
it.each(['STARTER', 'HEAVY'] as const)(
  'reviews the %s checkout charge, renewal and cancellation terms',
  (planId) => {
    const html = renderToStaticMarkup(
      React.createElement(CheckoutSummary, { planId, sandbox: true }),
    );
    expect(html).toContain(planId === 'STARTER' ? '$4.99' : '$7.99');
    expect(html).toContain(planId === 'STARTER' ? '10,000' : '20,000');
    expect(html).toContain('first payment is collected when you confirm in Stripe');
    expect(html).toContain('ends any remaining free trial');
    expect(html).toContain('Renews monthly until canceled');
    expect(html).toContain('No real money is charged');
  },
);
it('clearly confirms scheduled cancellation without claiming access is already gone', () => {
  mocks.search = 'billing=portal';
  account.billing.access = 'active';
  account.billing.status = 'active';
  account.billing.cancelAtPeriodEnd = true;
  expect(render()).toContain('>Ending</span>');
  expect(render()).toContain('Access ends');
  expect(render()).not.toContain('Renews');
  expect(render()).not.toContain('billing-notice');
});

it('offers a no-card trial before Stripe is configured, while disabling paid checkout', () => {
  account.billing.configured = false;
  const html = render();
  expect(button(html, 'Start 3-day free trial')).not.toContain('disabled');
  expect(button(html, 'Subscribe to Starter')).toContain('disabled');
  expect(html).toContain('No credit card required');
  expect(html).toContain('3 days free');
  expect(html).toContain('10,000 emails');
});

it('states the immediate paid charge separately from the free trial', () => {
  account.billing.access = 'trial';
  account.billing.canStartTrial = false;
  account.billing.trialEndsAt = '2026-09-29T12:00:00Z';
  account.billing.processingAllowed = true;
  const html = render();
  expect(html).toContain('Free trial active');
  expect(html).toContain('Sep 29, 2026');
  expect(html).toContain('Billed monthly. Cancel anytime.');
  const review = renderToStaticMarkup(
    React.createElement(CheckoutSummary, { planId: 'STARTER', sandbox: false }),
  );
  expect(review).toContain('$4.99 USD / month');
  expect(review).toContain('first payment is collected when you confirm in Stripe');
  expect(review).toContain('ends any remaining free trial');
  expect(html).toContain('No automatic charge');
  expect(html).not.toContain('Start 3-day free trial');
});

it('labels paused AI and preserves reading and replying after the trial ends', () => {
  account.billing.access = 'expired';
  account.billing.canStartTrial = false;
  const html = render();
  expect(html).toContain('AI processing paused');
  expect(html).toContain('Reading and replying remain available');
  expect(html).not.toContain('Start 3-day free trial');
});

it('shows a reached allowance without promising overages or blocking mail access', () => {
  account.usage.emails = 10000;
  account.billing.access = 'limit_reached';
  account.billing.canStartTrial = false;
  const html = render();
  expect(html).toContain('Email allowance reached');
  expect(html).toContain('No overage charges');
  expect(html).toContain('Reading and replying remain available');
});

it('offers billing management for an active subscription and explains scheduled cancellation', () => {
  account.billing = {
    ...account.billing,
    access: 'active',
    status: 'active',
    canStartTrial: false,
    canManage: true,
    cancelAtPeriodEnd: true,
    processingAllowed: true,
  };
  const html = render();
  expect(html).toContain('<h3>Starter</h3>');
  expect(html).toContain('>Ending</span>');
  expect(html).toContain('Access ends');
  expect(html).toContain('Sep 29, 2026');
  expect(button(html, 'Manage billing')).not.toContain('disabled');
  expect(html).not.toContain('Subscribe to Starter');
});

it('directs failed payments to billing management without claiming active access', () => {
  account.billing = {
    ...account.billing,
    access: 'payment_required',
    status: 'past_due',
    canStartTrial: false,
    canManage: true,
  };
  const html = render();
  expect(html).toContain('Payment needs attention');
  expect(button(html, 'Manage billing')).not.toContain('disabled');
  expect(html).toContain('Reading and replying remain available');
  expect(html).not.toContain('subscription active');
});

it('identifies setup preview instead of implying a paid subscription', () => {
  account.billingEnabled = false;
  account.limitsEnforced = false;
  account.billing = {
    ...account.billing,
    access: 'preview',
    configured: false,
    canStartTrial: false,
    processingAllowed: true,
  };
  const html = render();
  expect(html).toContain('Billing setup pending');
  expect(html).not.toContain('subscription active');
  expect(html).not.toContain('Start 3-day free trial');
  expect(button(html, 'Subscribe to Starter')).toContain('disabled');
});

it('keeps paid actions disabled in the demo', () => {
  mocks.demo = true;
  const html = render();
  expect(html).toContain('Demo only');
  expect(html).toContain('No payment will be collected');
  expect(button(html, 'Subscribe to Starter')).toContain('disabled');
  account.billing.canManage = true;
  expect(button(render(), 'Manage billing')).toContain('disabled');
});

it('keeps billing management disabled until Stripe is configured', () => {
  account.billing.canManage = true;
  account.billing.configured = false;
  expect(button(render(), 'Manage billing')).toContain('disabled');
});

it('preselects the linked plan without claiming that access has changed', () => {
  const html = renderToStaticMarkup(
    React.createElement(AccountProfile, { suggestedPlan: 'HEAVY' }),
  );
  expect(button(html, 'Subscribe to Heavy')).not.toContain('disabled');
  expect(html).toContain('value="HEAVY"');
  expect(html).toContain('Your free trial is ready');
  expect(html).not.toContain('Heavy subscription active');
});

it('labels manually granted access without offering another trial', () => {
  account.billing.access = 'manual';
  account.billing.canStartTrial = false;
  account.billing.processingAllowed = true;
  const html = render();
  expect(html).toContain('Starter access granted');
  expect(html).not.toContain('Start 3-day free trial');
  expect(html).not.toContain('subscription active');
});

it('does not treat the checkout return URL as confirmation of payment', () => {
  mocks.search = 'billing=success';
  const html = render();
  expect(html).toContain('Waiting for payment confirmation');
  expect(html).not.toContain('subscription active');
});

it('explains canceled checkout without claiming a change to access', () => {
  mocks.search = 'billing=canceled';
  const html = render();
  expect(html).toContain('Checkout was closed');
  expect(html).toContain('Your existing access has not changed');
});

it.each([null, 'canceled', 'incomplete_expired'])(
  'offers checkout alongside the portal when subscription status is %s',
  (status) => {
    account.billing.canManage = true;
    account.billing.status = status;
    const html = render();
    expect(button(html, 'Subscribe to Starter')).not.toContain('disabled');
    expect(button(html, 'Manage billing')).not.toContain('disabled');
  },
);

it.each(['active', 'past_due', 'unpaid', 'incomplete', 'paused', 'trialing'])(
  'directs the existing %s subscription to the portal without starting another subscription',
  (status) => {
    account.billing.canManage = true;
    account.billing.status = status;
    const html = render();
    expect(button(html, 'Manage billing')).not.toContain('disabled');
    expect(html).not.toContain('Subscribe to Starter');
    expect(html).not.toContain('Secure billing, managed by Stripe');
    expect(html).toContain('Usage details');
  },
);

it('polls briefly after checkout and stops once billing is confirmed', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
  mocks.search = 'billing=success';
  render();
  const { refetchInterval } = mocks.query.mock.lastCall![0];
  expect(refetchInterval({ state: { data: account } })).toBe(2000);
  account.billing.status = 'active';
  account.billing.access = 'active';
  expect(refetchInterval({ state: { data: account } })).toBe(false);
  account.billing.status = null;
  account.billing.access = 'trial_available';
  vi.advanceTimersByTime(61000);
  expect(refetchInterval({ state: { data: account } })).toBe(false);
});

it('publishes the paid prices, allowances and no-card trial on the pricing page', () => {
  const html = renderToStaticMarkup(React.createElement(PricingPage));
  expect(html).toContain('$4.99');
  expect(html).toContain('$7.99');
  expect(html).toContain('10,000 emails');
  expect(html).toContain('20,000 emails');
  expect(html).toContain('USD');
  expect(html).toContain('No credit card required');
  expect(html).toContain('72 hours');
  expect(html).toContain('10,000 emails total');
  expect(html).toContain('No overage charges');
  expect(html).toContain('href="/settings?plan=STARTER"');
  expect(html).toContain('href="/settings?plan=HEAVY"');
  expect(metadata.description).toContain('$4.99');
  expect(html).not.toContain('allowances are not enforced');
});
