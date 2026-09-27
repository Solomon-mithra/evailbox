import { afterEach, expect, it, vi } from 'vitest';
import { billingEnabled, billingConfigured, billingConfig } from '@/lib/billing/config';
afterEach(() => vi.unstubAllEnvs());
it('keeps enforcement independent of missing keys and demo isolated', () => {
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  expect(billingEnabled()).toBe(true);
  expect(billingConfigured()).toBe(false);
  expect(() => billingConfig()).toThrow('Billing is not configured');
  vi.stubEnv('APP_MODE', 'demo');
  expect(billingEnabled()).toBe(false);
});
it('accepts only a complete server catalog with distinct prices', () => {
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_example');
  vi.stubEnv('STRIPE_STARTER_PRICE_ID', 'price_starter');
  vi.stubEnv('STRIPE_HEAVY_PRICE_ID', 'price_heavy');
  vi.stubEnv('STRIPE_PORTAL_CONFIGURATION_ID', 'bpc_example');
  expect(billingConfigured()).toBe(true);
  expect(billingConfig().prices).toEqual({ STARTER: 'price_starter', HEAVY: 'price_heavy' });
  vi.stubEnv('STRIPE_HEAVY_PRICE_ID', 'price_starter');
  expect(billingConfigured()).toBe(false);
});
