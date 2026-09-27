import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import Stripe from 'stripe';
import {
  catalogEnvironmentLines,
  provisionStripeCatalog,
  validateCatalogInvocation,
} from '@/lib/billing/catalog';

// Stateful Stripe API boundary: reruns see resources created by earlier calls.
function stripeFixture() {
  const products = new Map<string, Stripe.Product>();
  const prices = new Map<string, Stripe.Price>();
  const configurations: Stripe.BillingPortal.Configuration[] = [];
  const api = {
    products: {
      retrieve: vi.fn(async (id: string) => {
        const product = products.get(id);
        if (!product)
          throw Object.assign(new Error('No such product'), { code: 'resource_missing' });
        return product;
      }),
      create: vi.fn(async (params: Stripe.ProductCreateParams) => {
        const product = {
          ...params,
          id: params.id!,
          object: 'product',
          active: true,
          created: 0,
          updated: 0,
          livemode: false,
        } as Stripe.Product;
        products.set(product.id, product);
        return product;
      }),
    },
    prices: {
      list: vi.fn(async (params: Stripe.PriceListParams) => ({
        data: [...prices.values()].filter((price) =>
          params.lookup_keys?.includes(price.lookup_key!),
        ),
        has_more: false,
      })),
      create: vi.fn(async (params: Stripe.PriceCreateParams) => {
        const price = {
          ...params,
          id: `price_${prices.size + 1}`,
          object: 'price',
          active: true,
          created: 0,
          livemode: false,
          type: 'recurring',
          billing_scheme: 'per_unit',
          unit_amount_decimal: Stripe.Decimal.from(params.unit_amount!),
          transform_quantity: null,
          recurring: { ...params.recurring, interval_count: 1, trial_period_days: null },
        } as Stripe.Price;
        prices.set(price.id, price);
        return price;
      }),
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({ data: configurations, has_more: false })),
        create: vi.fn(async (params: Stripe.BillingPortal.ConfigurationCreateParams) => {
          const configuration = {
            ...params,
            id: `bpc_${configurations.length + 1}`,
            active: true,
          } as Stripe.BillingPortal.Configuration;
          configurations.push(configuration);
          return configuration;
        }),
        update: vi.fn(
          async (id: string, params: Stripe.BillingPortal.ConfigurationUpdateParams) => {
            const configuration = configurations.find((candidate) => candidate.id === id)!;
            Object.assign(configuration, params);
            return configuration;
          },
        ),
      },
    },
  };
  return { api, stripe: api as unknown as Stripe, products, prices, configurations };
}

describe('catalog invocation safety', () => {
  it('requires a secret key, uses test mode by default, and requires --live for live keys', () => {
    expect(() => validateCatalogInvocation(undefined, [])).toThrow(/STRIPE_SECRET_KEY/);
    expect(validateCatalogInvocation('sk_test_example', [])).toEqual({
      secretKey: 'sk_test_example',
      live: false,
    });
    expect(() => validateCatalogInvocation('sk_live_example', [])).toThrow(/--live/);
    expect(validateCatalogInvocation('sk_live_example', ['--live'])).toEqual({
      secretKey: 'sk_live_example',
      live: true,
    });
    expect(() => validateCatalogInvocation('sk_test_example', ['--live'])).toThrow(/live/);
    expect(() => validateCatalogInvocation('pk_test_example', [])).toThrow(/secret/i);
    expect(() => validateCatalogInvocation('sk_test_example', ['--anything'])).toThrow(/Unknown/);
  });

  it.each(['', 'sk_live_example'])(
    'the CLI exits without output or network access for unsafe keys',
    (secretKey) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/stripe-catalog.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, STRIPE_SECRET_KEY: secretKey },
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(secretKey ? /--live/ : /STRIPE_SECRET_KEY/);
      if (secretKey) expect(result.stderr).not.toContain(secretKey);
    },
  );
});

describe('Stripe catalog', () => {
  it('creates exact monthly USD plans without a Stripe trial and reuses every resource on rerun', async () => {
    const fixture = stripeFixture();
    const first = await provisionStripeCatalog(fixture.stripe);
    const second = await provisionStripeCatalog(fixture.stripe);
    expect(second).toEqual(first);
    expect(fixture.products.size).toBe(2);
    expect(fixture.prices.size).toBe(2);
    expect(fixture.configurations).toHaveLength(1);
    expect([...fixture.prices.values()]).toMatchObject([
      {
        currency: 'usd',
        unit_amount: 499,
        nickname: 'Starter',
        recurring: { interval: 'month', usage_type: 'licensed', trial_period_days: null },
        metadata: { plan: 'STARTER', monthly_emails: '10000' },
      },
      {
        currency: 'usd',
        unit_amount: 799,
        nickname: 'Heavy',
        recurring: { interval: 'month', usage_type: 'licensed', trial_period_days: null },
        metadata: { plan: 'HEAVY', monthly_emails: '20000' },
      },
    ]);
    expect(fixture.api.prices.create).toHaveBeenCalledTimes(2);
    expect(fixture.api.billingPortal.configurations.create).toHaveBeenCalledTimes(1);
    expect(fixture.api.billingPortal.configurations.update).toHaveBeenCalledTimes(1);
    expect(catalogEnvironmentLines(first)).toEqual([
      'STRIPE_STARTER_PRICE_ID=price_1',
      'STRIPE_HEAVY_PRICE_ID=price_2',
      'STRIPE_PORTAL_CONFIGURATION_ID=bpc_1',
    ]);
  });

  it('constrains portal switches to two distinct products and invoices immediate prorated changes', async () => {
    const fixture = stripeFixture();
    await provisionStripeCatalog(fixture.stripe);
    expect(fixture.configurations[0].features).toMatchObject({
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        billing_cycle_anchor: 'unchanged',
        proration_behavior: 'always_invoice',
        schedule_at_period_end: { conditions: [] },
        products: [
          {
            product: 'evailbox_starter',
            prices: ['price_1'],
            adjustable_quantity: { enabled: false },
          },
          {
            product: 'evailbox_heavy',
            prices: ['price_2'],
            adjustable_quantity: { enabled: false },
          },
        ],
      },
    });
  });

  it.each([
    { currency: 'eur' },
    { unit_amount: 500 },
    { active: false },
    { type: 'one_time', recurring: null },
    {
      recurring: {
        interval: 'year',
        interval_count: 1,
        usage_type: 'licensed',
        trial_period_days: null,
      },
    },
    {
      recurring: {
        interval: 'month',
        interval_count: 2,
        usage_type: 'licensed',
        trial_period_days: null,
      },
    },
    {
      recurring: {
        interval: 'month',
        interval_count: 1,
        usage_type: 'metered',
        trial_period_days: null,
      },
    },
    {
      recurring: {
        interval: 'month',
        interval_count: 1,
        usage_type: 'licensed',
        trial_period_days: 3,
      },
    },
    { product: 'prod_someone_else' },
    { billing_scheme: 'tiered' },
    { transform_quantity: { divide_by: 100, round: 'up' } },
  ])('refuses to repurpose a conflicting price: %j', async (change) => {
    const fixture = stripeFixture();
    await provisionStripeCatalog(fixture.stripe);
    Object.assign(fixture.prices.get('price_1')!, change);
    fixture.api.prices.create.mockClear();
    fixture.api.billingPortal.configurations.update.mockClear();
    await expect(provisionStripeCatalog(fixture.stripe)).rejects.toThrow(/price_1.*does not match/);
    expect(fixture.api.prices.create).not.toHaveBeenCalled();
    expect(fixture.api.billingPortal.configurations.update).not.toHaveBeenCalled();
  });

  it('refuses an existing product that is not owned by this catalog', async () => {
    const fixture = stripeFixture();
    fixture.products.set('evailbox_starter', {
      id: 'evailbox_starter',
      active: true,
      metadata: {},
    } as Stripe.Product);
    await expect(provisionStripeCatalog(fixture.stripe)).rejects.toThrow(
      /product.*does not match/i,
    );
    expect(fixture.api.prices.create).not.toHaveBeenCalled();
  });

  it('does not create a replacement product when retrieving it fails for another reason', async () => {
    const fixture = stripeFixture();
    fixture.api.products.retrieve.mockRejectedValueOnce(new Error('connection failed'));
    await expect(provisionStripeCatalog(fixture.stripe)).rejects.toThrow('connection failed');
    expect(fixture.api.products.create).not.toHaveBeenCalled();
  });

  it('finds its dedicated portal after unrelated configurations without changing the default', async () => {
    const fixture = stripeFixture();
    await provisionStripeCatalog(fixture.stripe);
    const unrelated = {
      id: 'bpc_unrelated',
      is_default: true,
      metadata: {},
      features: {},
    } as Stripe.BillingPortal.Configuration;
    fixture.api.billingPortal.configurations.list
      .mockResolvedValueOnce({ data: [unrelated], has_more: true })
      .mockResolvedValueOnce({ data: fixture.configurations, has_more: false });
    await provisionStripeCatalog(fixture.stripe);
    expect(fixture.api.billingPortal.configurations.list).toHaveBeenLastCalledWith({
      limit: 100,
      starting_after: 'bpc_unrelated',
    });
    expect(fixture.api.billingPortal.configurations.update).toHaveBeenCalledWith(
      'bpc_1',
      expect.objectContaining({ active: true }),
    );
    expect(unrelated.features).toEqual({});
  });

  it('refuses ambiguous duplicate portal configurations', async () => {
    const fixture = stripeFixture();
    await provisionStripeCatalog(fixture.stripe);
    fixture.configurations.push({ ...fixture.configurations[0], id: 'bpc_duplicate' });
    await expect(provisionStripeCatalog(fixture.stripe)).rejects.toThrow(/Multiple.*portal/);
    expect(fixture.api.billingPortal.configurations.update).not.toHaveBeenCalled();
  });
});
