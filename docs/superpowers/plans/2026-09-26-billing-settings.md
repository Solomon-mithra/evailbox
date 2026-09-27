# Billing Settings Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in the existing workspace. Preserve the ongoing billing and inbox changes.

**Goal:** Give Settings a complete subscription experience and verify it with Stripe sandbox payments.

**Architecture:** Keep account/profile editing separate from a dedicated subscription panel. Stripe Checkout collects payments; the customer portal manages subscriptions, cards and invoices. Verified server-side Stripe state controls access and return confirmations; URL parameters never grant access.

**Tech Stack:** Next.js 16, React, TanStack Query, Radix Dialog, Stripe SDK, Prisma, Vitest.

### 1. Account return reconciliation

- [x] Add regression tests to `tests/billing-service.test.ts`, `tests/billing-routes.test.ts` and `tests/billing-ui.test.ts`: authenticated refresh uses the stored Stripe customer, success requires verified active access, cancellation remains paid through the period end, and expired paid subscriptions do not claim a free trial ended.
- [x] Add `refreshBilling(userId)` in `src/lib/billing/service.ts`, using `withBillingLock`, `listSubscriptions` and `saveSubscriptionState`. Clear completed/expired owned checkout sessions so a missed webhook cannot strand checkout.
- [x] Add authenticated `POST /api/billing/refresh` returning `getAccountOverview(user.id)`. Accept only an empty body; never accept a customer ID or entitlement from the browser.
- [x] Return portal sessions to `/settings?billing=portal`; add safe sandbox/live mode metadata to account billing details.

### 2. Subscription interface

- [x] Split `src/components/account-profile.tsx` into account loading/profile editing and `src/components/billing-panel.tsx` for billing actions, status and usage. Saving a display name must not imply subscribing or changing a plan.
- [x] Present a subscription summary, usage meter, no-card trial action and Starter/Heavy plan cards. Existing subscriptions use the portal; checkout never creates a duplicate subscription.
- [x] Add a themed checkout review dialog showing the selected price, allowance, immediate first payment, monthly renewal and trial ending. Include cancel, pending and inline failure states.
- [x] Show dismissible verified return banners and explicit scheduled cancellation dates. Include a sandbox badge only for test credentials.
- [x] Add responsive styles in `src/app/globals.css` using the existing forest/cream theme and update the Settings description.

### 3. Verification and sandbox setup

- [x] Run focused billing tests, lint, typecheck and production build. Review the final implementation for duplicate-subscription, stale-state and accessibility problems.
- [x] Validate sandbox prices are 499/799 USD monthly and portal supports payment methods, invoices, immediate prorated plan changes and cancellation at period end.
- [x] Enable billing in ignored `.env.local`, run one local Stripe listener and store its signing secret without printing it.
- [x] Through native Safari computer use, verified checkout cancellation, payment with a Stripe test card, the verified success state, portal invoice history and saved test card, a Starter-to-Heavy upgrade, and cancellation/resumption. Confirmed database/webhook state without exposing credentials or email content. The add-card form opened; Safari stopped exposing its window before the second-card submission could be verified.
- [x] Document local Stripe listener usage and report exactly which scenarios passed.

## Verification result

- `npm test`: 457 passed, 1 existing skipped test, across 48 files.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript.
- Starter sandbox Checkout paid $4.99 with the published Visa test card. Its three payment webhooks returned HTTP 200.
- Heavy upgrade displayed and paid a $3.00 test proration; the renewal date remained October 27, 2026.
- Cancellation was scheduled and correctly reflected in Settings after fixing support for Stripe's `cancel_at` representation. Resumption cleared cancellation in Stripe and the database.
- Final account state: active Heavy sandbox subscription, paid invoice, no scheduled cancellation. Existing manually granted access was preserved in the user record.
- The second-card submission remains unverified because native Safari stopped providing a window tree or screenshot. The existing Visa test card and paid invoice history were verified in the portal.
- Live payments, deployment, and tax automation were not part of this test.
