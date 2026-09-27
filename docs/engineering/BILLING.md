# Stripe billing

Updated 2026-09-26. Billing is enabled only by `BILLING_ENABLED=true`. Keep it `false` while keys are blank to preserve the existing preview experience. All Stripe credentials stay on the server.

| Plan    | Monthly price | Emails per billing period |
| ------- | ------------- | ------------------------- |
| Starter | USD 4.99      | 10,000                    |
| Heavy   | USD 7.99      | 20,000                    |

The free trial is managed by evailbox: 72 hours from starting it, no payment card, and a total allowance of 10,000 emails. Starting a trial creates no Stripe subscription. The trial expires without a charge. Choosing to subscribe explicitly opens paid Stripe Checkout and charges immediately, even if trial time remains; Checkout does not create a second Stripe trial. Paid allowances use the subscription's billing period, rather than the calendar month. Changing a plan within the same period does not reset usage.

## Environment

| Name                             | Purpose                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `BILLING_ENABLED`                | Explicit `true` enables billing and enforcement; `false` keeps preview behavior. |
| `STRIPE_SECRET_KEY`              | Stripe test secret key for local verification; live secret key for production.   |
| `STRIPE_WEBHOOK_SECRET`          | Signing secret for this environment's webhook endpoint.                          |
| `STRIPE_STARTER_PRICE_ID`        | Monthly USD 499-cent Starter price from the catalog command.                     |
| `STRIPE_HEAVY_PRICE_ID`          | Monthly USD 799-cent Heavy price from the catalog command.                       |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated evailbox portal configuration from the catalog command.                |

Keep test and live keys, prices, configurations, and webhook signing secrets in their matching environments. Do not copy real credentials into committed examples. The catalog script neither edits environment files nor enables billing.

## Local setup after keys are available

1. Add a test `STRIPE_SECRET_KEY` to `.env.local`; keep `BILLING_ENABLED=false` during setup.
2. Apply migrations against the intended database. This repository’s Prisma config loads Next.js environment files. To make the intended environment explicit, load `.env.local` before the migration command:

   ```sh
   node --env-file=.env.local --run db:migrate
   ```

   This runs the same `db:migrate` script as `npm run db:migrate`, with the environment loaded first. Confirm `DATABASE_URL` and `DIRECT_URL` target the intended database without logging their credential values.

3. Create or reuse the test catalog:

   ```sh
   npm run stripe:catalog
   ```

   The package script runs `node --env-file=.env.local --import tsx scripts/stripe-catalog.ts`. Next.js does not load the environment for this standalone script. Missing keys cause an error before Stripe is called. Successful script output contains only these three nonsecret assignments:

   ```dotenv
   STRIPE_STARTER_PRICE_ID=price_...
   STRIPE_HEAVY_PRICE_ID=price_...
   STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
   ```

   Copy the generated values into the matching environment. Run `npm run --silent stripe:catalog` if collecting stdout without npm's command banner.

4. Forward Stripe test events to the local server:

   ```sh
   stripe listen --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to localhost:3000/api/webhooks/stripe
   ```

   Set `STRIPE_WEBHOOK_SECRET` to the `whsec_...` value printed by this listener. This local signing secret differs from the deployed endpoint's secret. Set `BILLING_ENABLED=true`, restart the app, and exercise Checkout and the portal with Stripe test payment methods.

For a live catalog, place the intended live key in the environment and explicitly opt in:

```sh
npm run stripe:catalog -- --live
```

The command rejects a live key without `--live`, and rejects `--live` when the key is a test key. Running it makes catalog/configuration changes in the selected Stripe account; it never creates customers, charges, subscriptions, or trials. No catalog provisioning is performed as part of the build, migration, or tests.

## Catalog identity and reruns

The setup creates stable product IDs `evailbox_starter` and `evailbox_heavy`, each with one monthly price. Price lookup keys are `evailbox_starter_usd_monthly_v1` and `evailbox_heavy_usd_monthly_v1`. Product, price, and portal metadata identify the evailbox monthly USD catalog. Stripe request idempotency keys also protect repeated create requests.

Rerunning reuses the products and prices and reapplies settings to the dedicated portal configuration. It checks each product's ownership and active status, and validates existing prices for the correct product, USD amount, active status, monthly interval, interval count of one, licensed quantity, per-unit billing, no quantity transformation, and no Stripe trial. A conflicting or archived price stops setup; the script does not transfer lookup keys or replace prices silently. Inspect the conflict in Stripe and make an explicit catalog migration if prices need to change. Multiple matching portal configurations also stop setup for review. Unrelated portal configurations are left alone.

## Portal behavior and payment safety

Checkout explicitly uses standard Stripe Billing (`managed_payments.enabled=false`). Some new Stripe accounts enable the separate Managed Payments merchant-of-record product by default; that product rejects the explicit card configuration used here. The application does not change the account-wide setting. This integration does not provide Managed Payments tax collection or merchant-of-record services. See [Managed Payments Checkout differences](https://docs.stripe.com/payments/managed-payments/update-checkout).

Settings separates the subscription from profile editing. It shows the verified plan, billing dates, usage allowance and a sandbox label for test credentials. New subscriptions pass through a review dialog before hosted Checkout; existing subscriptions use Manage billing for plan changes, cards, invoices and cancellation. Saving a display name never changes a subscription. The no-card trial remains separate from paid checkout.

The dedicated portal enables invoice history, payment-method updates, and cancellation at the current period's end. Plan changes are limited to the two catalog products and prices, with adjustable quantity and promotion-code changes disabled. Upgrades and downgrades both take effect immediately and invoice prorations (`always_invoice`) while keeping the billing date. Stripe presents the prorated charge or credit before the customer confirms. An immediate downgrade reduces the allowance to 10,000 without resetting usage, so an account already above that allowance must wait for the next billing period or upgrade again. See [Stripe portal configuration](https://docs.stripe.com/customer-management/configure-portal) and the [configuration API](https://docs.stripe.com/api/customer_portal/configurations/create).

Reconciliation treats either `cancel_at_period_end=true` or `cancel_at` equal to the item's current period end as scheduled period-end cancellation. The sandbox portal uses the latter representation. Resumption clears the scheduled-cancellation state, and Settings returns to showing the renewal date.

This catalog deliberately does not schedule portal downgrades. Stripe's portal disallows two prices with the same product and billing interval; its period-end downgrade option only supports prices on the same product. Separate products with immediate plan changes satisfy those constraints for two monthly plans. See [Stripe portal limitations](https://docs.stripe.com/customer-management#limitations). Adding scheduled downgrades would require a separate application-managed subscription-schedule flow.

Immediate invoicing does not prove that payment succeeded. The portal API does not expose subscription `payment_behavior`; evailbox must require an active subscription with the latest invoice paid before granting paid processing access. In particular, an unpaid or failed Starter-to-Heavy upgrade must not grant Heavy access. Stripe's current subscription state and the configured price allowlist determine entitlements, not browser parameters or Checkout's return URL. See [Stripe subscription payment behavior](https://docs.stripe.com/api/subscriptions/update).

## Endpoints and webhook verification

Classification persists results in batches of up to `JEV_CONCURRENCY` emails (currently 4 by default). Each save transaction performs a bulk classification upsert and bulk email update, then adds the number of first-time classifications to the monthly counter and, for trial/paid access, the billing-period counter. Reclassification does not increment those counters again. A lone arriving email can still cause a one-email batch; this is not a claim that per-email row writes disappear. Keeping counter updates in the same locked transaction as saved results preserves exact limits across retries and concurrent workers.

Authenticated billing actions are `POST /api/billing/trial`, `POST /api/billing/checkout`, `POST /api/billing/portal`, and `POST /api/billing/refresh`. The refresh endpoint reconciles the stored customer's current Stripe state after a Checkout or portal return, including recovery from a missed checkout webhook. It accepts no customer or subscription IDs from the browser. Return messages wait for that verification before confirming active access or scheduled cancellation. The Stripe webhook endpoint is `POST /api/webhooks/stripe`; register the public HTTPS URL in Stripe for deployment. Select these events:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Verify webhook signatures using the unmodified request body and the endpoint's signing secret. Webhook deliveries can repeat or arrive out of order; reconcile against the current Stripe subscription and process event IDs idempotently. A Checkout success redirect does not grant access. Use the [Stripe CLI local webhook guide](https://docs.stripe.com/webhooks/test) for forwarding and the [webhook guide](https://docs.stripe.com/webhooks) for production endpoint setup.

Before enabling production billing, verify a complete test-mode signup, the no-card trial and its expiration, successful and declined paid Checkout, portal payment-method updates, a paid and failed upgrade, an immediate downgrade with prorated credit, period-end cancellation, allowance exhaustion, and duplicate webhook delivery. The mocked catalog suite runs with `npm test -- tests/stripe-catalog.test.ts`; it never calls Stripe.
