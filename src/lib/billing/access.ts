import { plans, TRIAL_EMAILS, usagePeriod, type BillingAccess, type PlanId } from '../plans';

type Snapshot = {
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  invoicePaid?: boolean;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  deletingAt?: Date | null;
};
export function resolveBillingAccess(
  user: { plan: string; planSource: string },
  billing: Snapshot | null,
  enabled: boolean,
  now = new Date(),
) {
  const planId: PlanId = user.plan === 'HEAVY' ? 'HEAVY' : 'STARTER';
  const calendar = usagePeriod(now);
  const base = {
    planId,
    limit: plans[planId].monthlyEmails as number,
    start: calendar.start,
    end: calendar.end,
    enforced: enabled,
    canStartTrial: false,
  };
  const result = (
    access: BillingAccess,
    allowed: boolean,
    overrides: Partial<typeof base> = {},
  ) => ({ ...base, access, allowed, ...overrides });
  if (billing?.deletingAt) return result('payment_required', false);
  if (!enabled) return result('preview', true);
  if (billing?.subscriptionStatus) {
    const paidPlan = billing.subscriptionPlan;
    if (
      billing.subscriptionStatus === 'active' &&
      billing.invoicePaid &&
      (paidPlan === 'STARTER' || paidPlan === 'HEAVY') &&
      billing.periodStart &&
      billing.periodEnd &&
      billing.periodStart <= now &&
      billing.periodEnd > now
    )
      return result('active', true, {
        planId: paidPlan,
        limit: plans[paidPlan].monthlyEmails,
        start: billing.periodStart,
        end: billing.periodEnd,
      });
    if (user.planSource === 'manual') return result('manual', true);
    return result(
      'payment_required',
      false,
      (paidPlan === 'STARTER' || paidPlan === 'HEAVY') && billing.periodStart && billing.periodEnd
        ? {
            planId: paidPlan,
            limit: plans[paidPlan].monthlyEmails,
            start: billing.periodStart,
            end: billing.periodEnd,
          }
        : {},
    );
  }
  if (user.planSource === 'manual') return result('manual', true);
  if (billing?.trialStartedAt && billing.trialEndsAt) {
    const trial = {
      planId: 'STARTER' as const,
      limit: TRIAL_EMAILS,
      start: billing.trialStartedAt,
      end: billing.trialEndsAt,
    };
    return result(
      billing.trialEndsAt > now ? 'trial' : 'expired',
      billing.trialStartedAt <= now && billing.trialEndsAt > now,
      trial,
    );
  }
  return result('trial_available', false, {
    planId: 'STARTER',
    limit: TRIAL_EMAILS,
    canStartTrial: true,
  });
}
