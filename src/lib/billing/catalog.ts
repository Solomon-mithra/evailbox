import type Stripe from 'stripe';
import { planIds, plans, type PlanId } from '../plans';

const productIds: Record<PlanId, string> = { STARTER: 'evailbox_starter', HEAVY: 'evailbox_heavy' };
const catalogMetadata = { app: 'evailbox', catalog: 'monthly_usd_v1' };

export class CatalogSetupError extends Error {}

export interface StripeCatalog {
  starterPriceId: string;
  heavyPriceId: string;
  portalConfigurationId: string;
}

export function validateCatalogInvocation(
  secretKey: string | undefined,
  args: string[],
): { secretKey: string; live: boolean } {
  if (args.some((arg) => arg !== '--live')) {
    throw new CatalogSetupError('Unknown catalog argument. Only --live is supported.');
  }
  if (!secretKey || !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
    throw new CatalogSetupError('Set STRIPE_SECRET_KEY to a Stripe secret or restricted key.');
  }
  const live = /^(sk|rk)_live_/.test(secretKey);
  if (live !== args.includes('--live')) {
    throw new CatalogSetupError(
      live
        ? 'Live Stripe keys require the explicit --live argument.'
        : 'The --live argument requires a live Stripe key; omit it for test mode.',
    );
  }
  return { secretKey, live };
}

function ownsCatalog(metadata: Stripe.Metadata | null): boolean {
  return metadata?.app === catalogMetadata.app && metadata.catalog === catalogMetadata.catalog;
}

async function ensureProduct(stripe: Stripe, planId: PlanId): Promise<void> {
  const productId = productIds[planId];
  let product: Stripe.Product | Stripe.DeletedProduct;
  try {
    product = await stripe.products.retrieve(productId);
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'resource_missing'
    )) {
      throw error;
    }
    product = await stripe.products.create(
      {
        id: productId,
        name: `evailbox ${plans[planId].name}`,
        description: `${plans[planId].monthlyEmails.toLocaleString('en-US')} emails per monthly billing period.`,
        metadata: { ...catalogMetadata, plan: planId },
      },
      { idempotencyKey: `evailbox:catalog:product:${productId}` },
    );
  }
  if (product.deleted || !product.active || !ownsCatalog(product.metadata)) {
    throw new CatalogSetupError(
      `Stripe product ${productId} does not match this active evailbox catalog. Review it in Stripe before retrying.`,
    );
  }
}

function checkPrice(price: Stripe.Price, planId: PlanId): void {
  const actualProduct = typeof price.product === 'string' ? price.product : price.product.id;
  const recurring = price.recurring;
  if (
    actualProduct !== productIds[planId] ||
    !price.active ||
    price.currency !== 'usd' ||
    price.unit_amount !== plans[planId].priceCents ||
    price.type !== 'recurring' ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity !== null ||
    recurring?.interval !== 'month' ||
    recurring.interval_count !== 1 ||
    recurring.usage_type !== 'licensed' ||
    recurring.trial_period_days !== null
  ) {
    throw new CatalogSetupError(
      `Stripe price ${price.id} does not match ${planId}. Existing prices and lookup keys will not be repurposed; review the conflict in Stripe.`,
    );
  }
}

async function ensurePrice(stripe: Stripe, planId: PlanId): Promise<string> {
  const plan = plans[planId];
  const lookupKey = `evailbox_${planId.toLowerCase()}_usd_monthly_v1`;
  // Include inactive prices so archiving a price cannot silently replace it.
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 100 });
  if (existing.has_more || existing.data.length > 1) {
    throw new CatalogSetupError(
      `Multiple Stripe prices use the ${planId} lookup key. Review the catalog before retrying.`,
    );
  }
  const price =
    existing.data[0] ??
    (await stripe.prices.create(
      {
        product: productIds[planId],
        nickname: plan.name,
        currency: 'usd',
        unit_amount: plan.priceCents,
        billing_scheme: 'per_unit',
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
        lookup_key: lookupKey,
        metadata: { ...catalogMetadata, plan: planId, monthly_emails: String(plan.monthlyEmails) },
      },
      { idempotencyKey: `evailbox:catalog:price:${lookupKey}` },
    ));
  checkPrice(price, planId);
  return price.id;
}

async function ensurePortal(stripe: Stripe, priceIds: Record<PlanId, string>): Promise<string> {
  const existing: Stripe.BillingPortal.Configuration[] = [];
  let startingAfter: string | undefined;
  do {
    const page = await stripe.billingPortal.configurations.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    existing.push(...page.data.filter((configuration) => ownsCatalog(configuration.metadata)));
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);
  if (existing.length > 1) {
    throw new CatalogSetupError(
      'Multiple evailbox portal configurations exist. Review the duplicate configurations before retrying.',
    );
  }
  const parameters: Stripe.BillingPortal.ConfigurationCreateParams = {
    name: 'evailbox monthly subscriptions',
    metadata: catalogMetadata,
    login_page: { enabled: false },
    business_profile: { headline: 'Manage your evailbox subscription' },
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        billing_cycle_anchor: 'unchanged',
        proration_behavior: 'always_invoice',
        schedule_at_period_end: { conditions: [] },
        products: planIds.map((planId) => ({
          product: productIds[planId],
          prices: [priceIds[planId]],
          adjustable_quantity: { enabled: false },
        })),
      },
    },
  };
  // Immediate invoicing does not itself guarantee payment. Application access
  // must additionally require an active subscription with its latest invoice paid.
  const configuration = existing[0]
    ? await stripe.billingPortal.configurations.update(existing[0].id, {
        ...parameters,
        active: true,
      })
    : await stripe.billingPortal.configurations.create(parameters, {
        idempotencyKey: 'evailbox:catalog:portal:monthly_usd_v1',
      });
  return configuration.id;
}

export async function provisionStripeCatalog(stripe: Stripe): Promise<StripeCatalog> {
  const priceIds = {} as Record<PlanId, string>;
  for (const planId of planIds) {
    await ensureProduct(stripe, planId);
    priceIds[planId] = await ensurePrice(stripe, planId);
  }
  const portalConfigurationId = await ensurePortal(stripe, priceIds);
  return { starterPriceId: priceIds.STARTER, heavyPriceId: priceIds.HEAVY, portalConfigurationId };
}

export function catalogEnvironmentLines(catalog: StripeCatalog): string[] {
  return [
    `STRIPE_STARTER_PRICE_ID=${catalog.starterPriceId}`,
    `STRIPE_HEAVY_PRICE_ID=${catalog.heavyPriceId}`,
    `STRIPE_PORTAL_CONFIGURATION_ID=${catalog.portalConfigurationId}`,
  ];
}
