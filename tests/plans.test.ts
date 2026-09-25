import { expect, it } from 'vitest';
import { plans, planPreview, usagePeriod, accountPatch } from '@/lib/plans';
it('advertises explicit monthly prices and allowances with billing and limits disabled', () => {
  expect(plans.STARTER).toMatchObject({ price: 14, monthlyEmails: 5000 });
  expect(plans.HEAVY).toMatchObject({ price: 24, monthlyEmails: 10000 });
  expect(planPreview).toEqual({ billingEnabled: false, limitsEnforced: false });
});
it('uses a calendar UTC month consistently at month/year boundaries', () => {
  expect(usagePeriod(new Date('2026-12-31T23:59:59Z'))).toEqual({
    start: new Date('2026-12-01T00:00:00Z'),
    end: new Date('2027-01-01T00:00:00Z'),
  });
});
it('allows a plan preference but rejects changes to trusted entitlement or grant source', () => {
  expect(accountPatch.parse({ requestedPlan: 'HEAVY' })).toEqual({ requestedPlan: 'HEAVY' });
  expect(() => accountPatch.parse({ plan: 'HEAVY' })).toThrow();
  expect(() => accountPatch.parse({ planSource: 'manual' })).toThrow();
  expect(() => accountPatch.parse({ requestedPlan: 'ADMIN' })).toThrow();
});
