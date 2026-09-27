import { describe, expect, it } from 'vitest';
import { resolveBillingAccess } from '@/lib/billing/access';
const now = new Date('2026-09-26T12:00:00Z');
const user = { plan: 'STARTER', planSource: 'preview' };
const trial = {
  trialStartedAt: new Date('2026-09-25T12:00:00Z'),
  trialEndsAt: new Date('2026-09-28T12:00:00Z'),
};
const subscription = {
  subscriptionPlan: 'HEAVY',
  subscriptionStatus: 'active',
  invoicePaid: true,
  periodStart: new Date('2026-09-23T12:00:00Z'),
  periodEnd: new Date('2026-10-23T12:00:00Z'),
};
describe('billing access', () => {
  it('keeps explicit preview open without starting a trial', () => {
    expect(resolveBillingAccess(user, null, false, now)).toMatchObject({
      access: 'preview',
      allowed: true,
      enforced: false,
    });
  });
  it('requires an explicit trial start when billing is enabled', () => {
    expect(resolveBillingAccess(user, null, true, now)).toMatchObject({
      access: 'trial_available',
      allowed: false,
      canStartTrial: true,
    });
  });
  it('grants precisely the recorded no-card trial period with the Starter allowance', () => {
    expect(resolveBillingAccess(user, trial, true, now)).toMatchObject({
      access: 'trial',
      allowed: true,
      limit: 10000,
      start: trial.trialStartedAt,
      end: trial.trialEndsAt,
    });
    expect(resolveBillingAccess(user, trial, true, trial.trialEndsAt)).toMatchObject({
      access: 'expired',
      allowed: false,
      canStartTrial: false,
    });
  });
  it('requires a paid invoice, valid price and unexpired billing period', () => {
    expect(resolveBillingAccess(user, subscription, true, now)).toMatchObject({
      access: 'active',
      planId: 'HEAVY',
      limit: 20000,
      start: subscription.periodStart,
    });
    for (const change of [
      { invoicePaid: false },
      { subscriptionStatus: 'past_due' },
      { subscriptionPlan: null },
      { periodEnd: now },
      { periodStart: new Date('2027-01-01') },
      { deletingAt: now },
    ])
      expect(resolveBillingAccess(user, { ...subscription, ...change }, true, now).allowed).toBe(
        false,
      );
  });
  it('does not fall back to a still-running trial after an attempted subscription', () => {
    expect(
      resolveBillingAccess(
        user,
        { ...trial, ...subscription, subscriptionStatus: 'canceled' },
        true,
        now,
      ),
    ).toMatchObject({ allowed: false, canStartTrial: false });
  });
  it('preserves explicit manual grants with calendar-month limits', () => {
    expect(
      resolveBillingAccess({ plan: 'HEAVY', planSource: 'manual' }, null, true, now),
    ).toMatchObject({
      access: 'manual',
      limit: 20000,
      allowed: true,
      start: new Date('2026-09-01T00:00:00Z'),
    });
  });
});
it('honors a paid Heavy subscription above an existing manual Starter grant', () => {
  const manual = { plan: 'STARTER', planSource: 'manual' };
  expect(resolveBillingAccess(manual, subscription, true, now)).toMatchObject({
    access: 'active',
    planId: 'HEAVY',
    limit: 20000,
    start: subscription.periodStart,
  });
  expect(
    resolveBillingAccess(manual, { ...subscription, subscriptionStatus: 'canceled' }, true, now),
  ).toMatchObject({ access: 'manual', planId: 'STARTER', limit: 10000 });
});
