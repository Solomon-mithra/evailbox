import 'server-only';
import { db } from './db';
import { ApiError } from './errors';
import { plans, planPreview, usagePeriod, type PlanId, type AccountOverview } from './plans';
export async function getAccountOverview(userId: string): Promise<AccountOverview> {
  const period = usagePeriod();
  const [user, usage] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.monthlyUsage.findUnique({ where: { userId_month: { userId, month: period.start } } }),
  ]);
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  const plan = plans[user.plan === 'HEAVY' ? 'HEAVY' : 'STARTER'];
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    plan: { ...plan, source: user.planSource, requested: user.requestedPlan as PlanId | null },
    usage: {
      emails: usage?.emails ?? 0,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    },
    ...planPreview,
  };
}
