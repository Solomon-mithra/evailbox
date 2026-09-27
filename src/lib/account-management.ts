import 'server-only';
import { db } from './db';
import { ApiError } from './errors';
import { plans, type PlanId, type AccountOverview } from './plans';
import { billingConfig, billingConfigured, billingEnabled } from './billing/config';
import { processingAccess } from './billing/state';
export async function getAccountOverview(userId: string): Promise<AccountOverview> {
  const [user, access] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    processingAccess(userId),
  ]);
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  const plan = plans[access.planId];
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    plan: {
      ...plan,
      monthlyEmails: access.limit,
      source: access.source,
      requested: user.requestedPlan as PlanId | null,
    },
    usage: {
      emails: access.used,
      periodStart: access.start.toISOString(),
      periodEnd: access.end.toISOString(),
    },
    billingEnabled: billingEnabled(),
    limitsEnforced: billingEnabled(),
    billing: {
      mode: billingConfigured() ? (billingConfig().live ? 'live' : 'test') : undefined,
      configured: billingConfigured(),
      access: access.access,
      status: access.state.subscriptionStatus,
      trialEndsAt: access.state.trialEndsAt?.toISOString() ?? null,
      canStartTrial: access.canStartTrial,
      canManage: !!access.state.stripeCustomerId,
      cancelAtPeriodEnd: access.state.cancelAtPeriodEnd ?? false,
      processingAllowed: access.allowed,
    },
  };
}
