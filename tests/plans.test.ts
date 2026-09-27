import { expect, it } from 'vitest';
import { plans, TRIAL_DAYS, TRIAL_EMAILS, usagePeriod, accountPatch } from '@/lib/plans';
it('offers the approved USD monthly catalog and no-card trial allowance', () => {
  expect(plans.STARTER).toMatchObject({ price: 4.99, priceCents: 499, monthlyEmails: 10000 });
  expect(plans.HEAVY).toMatchObject({ price: 7.99, priceCents: 799, monthlyEmails: 20000 });
  expect(TRIAL_DAYS).toBe(3);
  expect(TRIAL_EMAILS).toBe(10000);
});
it('uses a calendar UTC month for preview and manual grants', () => {
  expect(usagePeriod(new Date('2026-12-31T23:59:59Z'))).toEqual({
    start: new Date('2026-12-01T00:00:00Z'),
    end: new Date('2027-01-01T00:00:00Z'),
  });
});
it('accepts preferences but never browser-supplied entitlements or Stripe ownership', () => {
  expect(accountPatch.parse({ requestedPlan: 'HEAVY' })).toEqual({ requestedPlan: 'HEAVY' });
  for (const patch of [
    { plan: 'HEAVY' },
    { planSource: 'manual' },
    { stripeCustomerId: 'cus_other' },
    { requestedPlan: 'ADMIN' },
  ])
    expect(() => accountPatch.parse(patch)).toThrow();
});
