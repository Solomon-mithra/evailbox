import 'server-only';
import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { plans, type PlanId } from '../plans';
import { ApiError } from '../errors';
import { billingConfig } from './config';
import { requestBillingWork } from './state';
export const isOngoing = (subscription: Stripe.Subscription) =>
  !['canceled', 'incomplete_expired'].includes(subscription.status);
export async function listSubscriptions(stripe: Stripe, customer: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer,
    status: 'all',
    limit: 100,
    expand: ['data.latest_invoice'],
  });
  // Never accidentally create another subscription when the history is incomplete.
  if (subscriptions.has_more)
    throw new ApiError(
      409,
      'BILLING_REVIEW_REQUIRED',
      'Please contact support to review this billing account.',
    );
  return subscriptions.data;
}
export function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string')
    return value.id;
  return null;
}
export async function saveSubscriptionState(
  userId: string,
  subscriptions: Stripe.Subscription[],
  tx: Prisma.TransactionClient,
) {
  const subscription = [...subscriptions].sort(
    (a, b) => Number(isOngoing(b)) - Number(isOngoing(a)) || b.created - a.created,
  )[0];
  if (!subscription) return;
  const item = subscription.items.data.length === 1 ? subscription.items.data[0] : null;
  const config = billingConfig();
  const planId =
    (Object.entries(config.prices).find(([, id]) => id === item?.price.id)?.[0] as
      PlanId | undefined) ?? null;
  const validPlan =
    planId &&
    item?.quantity === 1 &&
    item.price.currency === 'usd' &&
    item.price.unit_amount === plans[planId].priceCents &&
    item.price.recurring?.interval === 'month' &&
    item.price.recurring.interval_count === 1
      ? planId
      : null;
  const invoice = subscription.latest_invoice;
  const invoicePaid =
    !!invoice &&
    typeof invoice !== 'string' &&
    invoice.status === 'paid' &&
    !subscription.pause_collection;
  const start = item?.current_period_start
    ? new Date(item.current_period_start * 1000).toISOString()
    : null;
  const end = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;
  // The portal can set cancel_at to the period end while leaving the older flag false.
  const cancelAtPeriodEnd =
    subscription.cancel_at_period_end ||
    (!!subscription.cancel_at && subscription.cancel_at === item?.current_period_end);
  await tx.$executeRaw(Prisma.sql`UPDATE billing_accounts SET
    "stripeSubscriptionId"=${subscription.id},"stripePriceId"=${item?.price.id ?? null},
    "subscriptionPlan"=${validPlan},"subscriptionStatus"=${subscription.status},"invoicePaid"=${invoicePaid},
    "periodStart"=${start}::timestamp,"periodEnd"=${end}::timestamp,"cancelAtPeriodEnd"=${cancelAtPeriodEnd},"updatedAt"=CURRENT_TIMESTAMP
    WHERE "userId"=${userId}::uuid`);
  await requestBillingWork(userId, tx);
}
