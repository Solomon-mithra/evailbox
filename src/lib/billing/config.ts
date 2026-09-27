import 'server-only';
import Stripe from 'stripe';
import { z } from 'zod';
import { ApiError } from '../errors';
import { isDemo } from '../env';
const schema = z
  .object({
    STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/),
    STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9]+$/),
    STRIPE_STARTER_PRICE_ID: z.string().regex(/^price_[A-Za-z0-9]+$/),
    STRIPE_HEAVY_PRICE_ID: z.string().regex(/^price_[A-Za-z0-9]+$/),
    STRIPE_PORTAL_CONFIGURATION_ID: z.string().regex(/^bpc_[A-Za-z0-9]+$/),
  })
  .refine((v) => v.STRIPE_STARTER_PRICE_ID !== v.STRIPE_HEAVY_PRICE_ID);
export function billingEnabled() {
  return !isDemo() && process.env.BILLING_ENABLED === 'true';
}
export function billingConfigured() {
  return billingEnabled() && schema.safeParse(process.env).success;
}
export function billingConfig() {
  const parsed = schema.safeParse(process.env);
  if (!billingEnabled() || !parsed.success)
    throw new ApiError(
      503,
      'BILLING_UNAVAILABLE',
      'Billing is not configured yet. Please try again later.',
    );
  const value = parsed.data;
  return {
    secretKey: value.STRIPE_SECRET_KEY,
    webhookSecret: value.STRIPE_WEBHOOK_SECRET,
    portalConfiguration: value.STRIPE_PORTAL_CONFIGURATION_ID,
    prices: { STARTER: value.STRIPE_STARTER_PRICE_ID, HEAVY: value.STRIPE_HEAVY_PRICE_ID },
    live: /^(sk|rk)_live_/.test(value.STRIPE_SECRET_KEY),
  };
}
export function stripeClient() {
  return new Stripe(billingConfig().secretKey, { timeout: 8000, maxNetworkRetries: 1 });
}
