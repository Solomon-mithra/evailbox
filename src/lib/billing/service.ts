import 'server-only';
import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { ApiError } from '../errors';
import { plans, TRIAL_DAYS, type PlanId } from '../plans';
import { siteUrl } from '../site';
import { billingConfig, billingEnabled, stripeClient } from './config';
import { requestBillingWork, withBillingLock } from './state';
import { isOngoing, listSubscriptions, saveSubscriptionState, stripeId } from './subscriptions';

export async function startTrial(userId: string) {
  if (!billingEnabled())
    throw new ApiError(503, 'BILLING_UNAVAILABLE', 'Trials will be available when billing opens.');
  await withBillingLock(userId, async (tx, state) => {
    if (state.subscriptionStatus || state.planSource === 'manual')
      throw new ApiError(
        409,
        'TRIAL_UNAVAILABLE',
        'This account already has a plan or has subscribed.',
      );
    if (state.trialStartedAt) {
      if (state.trialEndsAt && state.trialEndsAt > new Date()) return;
      throw new ApiError(
        409,
        'TRIAL_USED',
        'Your free trial has ended. Choose a plan to continue processing emails.',
      );
    }
    await tx.$executeRaw(
      Prisma.sql`UPDATE billing_accounts SET "trialStartedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),"trialEndsAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')+${TRIAL_DAYS}*interval '1 day',"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=${userId}::uuid`,
    );
    await requestBillingWork(userId, tx);
  });
}

export async function createCheckout(userId: string, planId: PlanId) {
  const config = billingConfig();
  const stripe = stripeClient();
  const price = await stripe.prices.retrieve(config.prices[planId]);
  if (
    !price.active ||
    price.currency !== 'usd' ||
    price.unit_amount !== plans[planId].priceCents ||
    price.recurring?.interval !== 'month' ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== 'licensed'
  )
    throw new ApiError(
      503,
      'BILLING_CATALOG_INVALID',
      'The selected plan is not configured correctly. Please contact support.',
    );
  return withBillingLock(userId, async (tx, state) => {
    let customerId = state.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: state.email, metadata: { evailbox_user_id: userId } },
        { idempotencyKey: `evailbox:customer:${userId}` },
      );
      customerId = customer.id;
      await tx.$executeRaw(
        Prisma.sql`UPDATE billing_accounts SET "stripeCustomerId"=${customerId},"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=${userId}::uuid`,
      );
    }
    const subscriptions = await listSubscriptions(stripe, customerId);
    if (subscriptions.some(isOngoing))
      throw new ApiError(
        409,
        'SUBSCRIPTION_EXISTS',
        'You already have a subscription. Use Manage billing to change your plan.',
      );
    let generation = state.checkoutGeneration;
    if (state.checkoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(state.checkoutSessionId);
      if (stripeId(existing.customer) !== customerId)
        throw new Error('Checkout customer does not match');
      if (existing.status === 'complete')
        throw new ApiError(
          409,
          'CHECKOUT_PROCESSING',
          'Your payment is being confirmed. Refresh your account shortly.',
        );
      if (existing.status === 'open' && state.checkoutPlan === planId && existing.url)
        return { url: existing.url };
      if (existing.status === 'open') await stripe.checkout.sessions.expire(existing.id);
      generation++;
    }
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        // Use standard Billing and our configured customer portal, even on accounts
        // where Stripe enables its separate merchant-of-record offering by default.
        managed_payments: { enabled: false },
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: config.prices[planId], quantity: 1 }],
        payment_method_collection: 'always',
        payment_method_types: ['card'],
        subscription_data: { metadata: { evailbox_user_id: userId } },
        metadata: { evailbox_user_id: userId },
        success_url: siteUrl('/settings?billing=success').href,
        cancel_url: siteUrl('/settings?billing=canceled').href,
      },
      { idempotencyKey: `evailbox:checkout:v2:${userId}:${planId}:${generation}` },
    );
    if (!session.url) throw new Error('Checkout URL missing');
    await tx.$executeRaw(
      Prisma.sql`UPDATE billing_accounts SET "checkoutSessionId"=${session.id},"checkoutPlan"=${planId},"checkoutGeneration"=${generation},"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=${userId}::uuid`,
    );
    return { url: session.url };
  });
}
export async function createPortal(userId: string) {
  const config = billingConfig();
  return withBillingLock(userId, async (_tx, state) => {
    if (!state.stripeCustomerId)
      throw new ApiError(409, 'NO_BILLING_ACCOUNT', 'Choose a paid plan before managing billing.');
    const portal = await stripeClient().billingPortal.sessions.create({
      customer: state.stripeCustomerId,
      configuration: config.portalConfiguration,
      return_url: siteUrl('/settings?billing=portal').href,
    });
    return { url: portal.url };
  });
}
/** Reconcile a hosted billing return without trusting browser-supplied customer or payment IDs. */
export async function refreshBilling(userId: string) {
  const stripe = stripeClient();
  await withBillingLock(userId, async (tx, state) => {
    if (!state.stripeCustomerId) return;
    if (state.checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(state.checkoutSessionId);
      if (stripeId(session.customer) !== state.stripeCustomerId)
        throw new Error('Checkout customer does not match');
      if (session.status === 'complete' || session.status === 'expired')
        await tx.$executeRaw(
          Prisma.sql`UPDATE billing_accounts SET "checkoutSessionId"=NULL,"checkoutPlan"=NULL,"checkoutGeneration"="checkoutGeneration"+1 WHERE "userId"=${userId}::uuid`,
        );
    }
    await saveSubscriptionState(
      userId,
      await listSubscriptions(stripe, state.stripeCustomerId),
      tx,
    );
  });
}
const handledEvents = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);
/** Only call after verifying the raw request signature. Event snapshots never grant access. */
export async function handleBillingEvent(event: Stripe.Event) {
  if (!handledEvents.has(event.type)) return;
  if (event.livemode !== billingConfig().live)
    throw new ApiError(
      400,
      'BILLING_MODE_MISMATCH',
      'Webhook mode does not match this environment.',
    );
  const customer = stripeId((event.data.object as { customer?: unknown }).customer);
  if (!customer) return;
  const rows = await db.$queryRaw<{ userId: string }[]>(
    Prisma.sql`SELECT "userId" FROM billing_accounts WHERE "stripeCustomerId"=${customer}`,
  );
  if (!rows[0]) return; // Customer ownership comes from our database, never browser/event metadata.
  await withBillingLock(rows[0].userId, async (tx, state) => {
    const duplicate = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM stripe_webhook_receipts WHERE id=${event.id}`,
    );
    if (duplicate.length) return;
    // Read within the user lock so overlapping/out-of-order events cannot roll back newer state.
    const subscriptions = await listSubscriptions(stripeClient(), customer);
    await saveSubscriptionState(state.userId, subscriptions, tx);
    if (
      (event.type === 'checkout.session.expired' || event.type === 'checkout.session.completed') &&
      state.checkoutSessionId === event.data.object.id
    )
      await tx.$executeRaw(
        Prisma.sql`UPDATE billing_accounts SET "checkoutSessionId"=NULL,"checkoutPlan"=NULL,"checkoutGeneration"="checkoutGeneration"+1 WHERE "userId"=${state.userId}::uuid`,
      );
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO stripe_webhook_receipts(id) VALUES(${event.id}) ON CONFLICT DO NOTHING`,
    );
  });
}

/** Persist the deletion gate before identity removal, preventing a concurrent new checkout. */
export async function cancelBillingForDeletion(userId: string) {
  await withBillingLock(userId, async (tx, state) => {
    if (state.stripeCustomerId) {
      const stripe = stripeClient(); // Missing credentials must stop deletion, never orphan charges.
      if (state.checkoutSessionId) {
        const session = await stripe.checkout.sessions.retrieve(state.checkoutSessionId);
        if (stripeId(session.customer) !== state.stripeCustomerId)
          throw new Error('Checkout customer does not match');
        if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
      }
      const subscriptions = await listSubscriptions(stripe, state.stripeCustomerId);
      for (const subscription of subscriptions.filter(isOngoing))
        await stripe.subscriptions.cancel(subscription.id);
    }
    await tx.$executeRaw(
      Prisma.sql`UPDATE billing_accounts SET "deletingAt"=CURRENT_TIMESTAMP WHERE "userId"=${userId}::uuid`,
    );
  });
}
export async function clearBillingDeletion(userId: string) {
  await db.$executeRaw(
    Prisma.sql`UPDATE billing_accounts SET "deletingAt"=NULL WHERE "userId"=${userId}::uuid`,
  );
}
