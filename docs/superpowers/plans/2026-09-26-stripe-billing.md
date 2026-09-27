# Stripe billing implementation plan

**Goal:** Starter costs $4.99/month for 10,000 first-time email classifications; Heavy costs $7.99/month for 20,000. A single, explicitly started, three-day Starter trial requires no card and never charges automatically.

**Architecture:** Application-managed trial; Stripe-hosted subscription checkout and customer portal; signed webhooks reconcile authoritative subscription state. Server-side processing gates use trial/subscription dates and first-classification allowances shared across workspaces. Existing calendar usage remains for preview/manual access. Billing activation is explicit and independent of whether secrets are missing.

**Tech stack:** Next.js route handlers, Prisma/PostgreSQL, Stripe Node SDK, Vitest/PGlite, existing Inngest worker.

## Decisions

- Trial starts only on an authenticated, same-origin Start free trial request. It lasts exactly 72 hours, includes 10,000 emails total, and cannot be restarted. Trial eligibility and usage persist separately from Stripe subscription state.
- Subscribing is a separate explicit action; Checkout starts the paid monthly plan immediately, with clear UI copy. There is no second Stripe trial.
- Allowances reset on the Stripe subscription period boundary. Immediate prorated upgrades/downgrades retain usage and the billing date. No overage charges. At the cap/expiry, AI processing pauses; inbox access, sync, reading and replies remain.
- Stripe customer IDs are bound to the authenticated user. Never accept prices/customer IDs/entitlements from the browser. Serialize checkout/reconciliation per user, reuse an open checkout, and refuse duplicate subscriptions.
- Webhooks verify the raw body. Retrieve current subscription state rather than trusting out-of-order payloads. Only configured prices grant access, and failed payments/expired periods do not grant processing.
- BILLING_ENABLED=false preserves current preview until deployment is ready. When enabled, missing Stripe configuration blocks checkout instead of bypassing payment gates. Demo never calls Stripe.
- Catalog provisioning creates/reuses two USD monthly prices and a customer portal configuration. It is runnable after credentials exist; no live catalog can be created in this session without keys.
- Account deletion cancels ongoing billing and expires outstanding checkout before deleting identity/local ownership.

## Implementation and verification

- [x] Update shared plan contract and add failing plan/trial/entitlement tests.
- [x] Add billing account, billing-period usage, webhook receipt schema and migration with private RLS.
- [x] Implement trial, checkout, portal, reconciliation and signed webhook routes; test ownership, invalid signatures, duplicate delivery, stale events, repeated checkout, expired trial and missing configuration.
- [x] Enforce processing limits before inference and atomically when saving first classifications; test with real SQL and ensure blocked work settles instead of endlessly retrying.
- [x] Implement catalog provisioning and setup guide, with a mock-provider rerun test. Preserve all existing environment values when adding blank slots.
- [x] Update pricing/settings/demo/metadata copy and expose trial/subscription/usage state and billing actions.
- [x] Run focused tests, full suite, lint, typecheck/build, environment parity and browser review. Independently review billing code before completion.

The user requested implementation and will supply keys later; no additional design approval or live activation is needed for the local work.

Verification: 420 tests passed; the opt-in burst fixture was skipped in the regular run. Lint, typecheck, production build, environment parity and whitespace checks passed. Independent review findings were fixed. T3 browser interaction/DOM checks covered plan selection, demo trial start without billing requests, and 375px/1280px layouts; the preview screenshot tool failed, so no screenshot inspection is claimed. Live Stripe and hosted migration checks await credentials and activation.
