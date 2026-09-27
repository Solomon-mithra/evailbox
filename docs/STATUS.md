# Current implementation and activation status

Updated 2026-09-26 (America/Los_Angeles), following the deployment-readiness audit of `d3292a6`. This is a dated evidence summary, not a guarantee that external configuration remains unchanged.

**Live launch is not ready yet.** Local checks pass, but production service configuration is incomplete. Gmail Pub/Sub and Outlook setup are pending. Stripe test credentials are present locally, but development webhook delivery and reconciliation remain unverified.

## Implemented and locally verified

- Durable signup-burst processing: default 5 global concurrent steps, configurable up to 100; one provider page and up to 20 classification attempts per user turn. Inngest keyed scheduling offers best-effort fairness, not strict round-robin guarantees.
- Same-step transient body reuse; no imported email bodies in Postgres or Inngest step results. Summaries, classifications, encrypted credentials and explicit reply drafts remain persisted.
- Metadata-first inbox rendering, current-decision progress counts, realtime signals and active-work polling.
- Latest audit: 575 tests passed across 57 files, with one opt-in burst test skipped. Environment-name parity, Prisma generation, lint, typecheck and production build passed. `npm audit --omit=dev` reported zero known vulnerabilities. GitHub CI passed for `d3292a6`.
- The local production server rendered sign-in successfully. Earlier browser checks covered pricing, plan selection, demo trial start and mobile widths. These checks do not establish hosted authentication, mailbox processing or payment readiness.
- Synthetic 100-user fixtures passed at 10,000 and 123,400 emails. A 10,000-email fixture also passed with worker concurrency 100. These use mocked providers/inference, PGlite and a local FIFO scheduler; they do not measure hosted Gmail/Jev/Inngest latency.

## Initial-import limit and authorized mail reset

New Gmail and Outlook connections now import at most 100 existing Inbox messages, preserving the allowance across worker turns. New arrivals and updates to retained messages continue through incremental checkpoints. Outlook uses lightweight older delta references to obtain its checkpoint without importing their content; legacy cursors remain readable.

On 2026-09-26, the owner authorized clearing only their app-side mail data and restarting sync. The transaction removed 740 cached emails and 20 AI decisions (zero drafts), preserving the user, four tags, one Gmail connection, billing, usage and cooldowns. At 23:39:22 UTC, the restarted local worker had saved exactly 100 emails, reached Gmail history mode, and cleared the mailbox sync request with no sync error. Five emails were tagged at that observation; inference continued under the existing provider 429 cooldown. Outlook coverage is fixture-based; this live check used Gmail. Provider mail was not deleted and no deployment was made.

The local app uses `INNGEST_DEV=1`; its worker was started with `npx --yes inngest-cli@latest dev --no-discovery -u http://localhost:3000/api/inngest`. Both processes must run for ongoing local processing. Earlier cloud-configuration observations below remain historical, not evidence of current hosted activation.

## Stripe billing implementation

Starter is $4.99/month for 10,000 emails; Heavy is $7.99/month for 20,000. The three-day trial requires no card, starts explicitly, and expires without charging. The integration includes hosted checkout, portal plan changes/cancellation, signed webhook reconciliation, billing-period usage caps and private billing tables. `BILLING_ENABLED=false` retains preview access until setup is complete.

- `.env.local` currently has `BILLING_ENABLED=true`, a **test-mode** Stripe secret key, a webhook signing secret, both price IDs and a portal configuration ID. Presence of these values does not verify the Stripe catalog or webhook delivery.
- **Development webhook verification is pending.** The audit did not establish that a Stripe CLI listener is running, that its signing secret matches the app, or that an actual test event reaches `/api/webhooks/stripe` and updates billing state. This is unverified, not a confirmed webhook failure.
- A Checkout/portal return can reconcile billing through `/api/billing/refresh`; a successful UI return alone does not prove the webhook works.
- `.env.production` has billing disabled and blank Stripe settings. The linked Vercel project's Production environment has no Stripe configuration. Live catalog, deployed webhook registration and paid-launch acceptance remain pending.
- The configured Supabase database already has the billing migration applied. Follow [billing setup and acceptance](engineering/BILLING.md) for the remaining work.

## Service/configuration observations

- **Vercel:** The linked project is `jevinbox`. Its Production environment has only three app-defined variables: `APP_MODE`, `CRON_SECRET` and `NEXT_PUBLIC_APP_URL`. Database, Supabase, Gmail, AI and Inngest credentials are absent there. The public site still serves the September 21 demo deployment. The local `.env.production` file also selects `APP_MODE=demo`; local files do not establish hosted configuration.
- **Gmail API:** Local OAuth credentials are present, and the earlier live import verified Gmail API ingestion. This is separate from Pub/Sub notification delivery.
- **Gmail Pub/Sub — not set up:** All four `GMAIL_PUBSUB_*` settings are blank in the local environment files and absent from Vercel Production. The configured database has one Gmail mailbox subscription with status `unconfigured`. Provision the topic, publisher permissions and authenticated push subscription, configure the callback, then verify watch registration, delivery and renewal. Immediate email-arrival processing is not active through Pub/Sub. The 15-minute recovery sync requires a working Inngest worker.
- **Outlook — setup not started:** Microsoft OAuth credentials remain placeholders in the local environment files, `OUTLOOK_WEBHOOK_URL` is blank, and these settings are absent from Vercel Production. App registration/credentials, consent, account connection and Graph webhook delivery/renewal remain pending. Outlook behavior is covered by fixtures, not a live mailbox acceptance test.
- **Jev:** The local API key is present; the earlier live import observed provider 429 cooldowns. The production file contains a placeholder key and Vercel Production has no AI configuration. The readiness audit did not make a paid inference request or verify production throughput.
- **Inngest:** Production signing/event keys exist in ignored `.env.local`, but local execution currently uses `INNGEST_DEV=1`. Vercel Production has neither key. An earlier dashboard observation showed a 5-concurrency tier and no active apps; the dashboard was not rechecked in this audit. Configure cloud mode, register/sync the deployed `/api/inngest` endpoint, and verify hosted processing, recovery and renewal.
- **Database:** A fresh read-only check confirmed all 11 committed migrations are applied, with none pending or failed, to the Supabase database referenced by both local environment files. Runtime configuration uses transaction pooling. Vercel Production has no database connection configured yet; recheck migrations if a different deployment database is selected.
- **Realtime:** The database's `evailbox_inbox_signals` policy exists. Browser testing of the local production build confirmed that `next.config.ts` blocks Supabase WebSockets because `connect-src` lacks `wss://*.supabase.co`. This code issue remains open. Private-only dashboard settings, cross-user authorization and end-to-end hosted updates still need verification.

## Maintenance verification

All four root env files have identical sets of 39 variable names. The name-only checker is part of CI and was verified against matching templates, missing keys, duplicate names and value redaction. This checks names, not whether credentials work or optional services are active. Local base environment validation passes in live mode; the local worker is configured for development mode.

Earlier maintenance consolidated superseded documentation and checked retained relative links. The historical cost calculator labels its output obsolete. The latest check counts are recorded above; older test counts are not current readiness evidence. The readiness audit made no deployment, service-configuration change, migration, payment or outbound-email request.

## Remaining operational work

1. Fix the Supabase WebSocket allowance in the browser security policy and verify the connection in a production build.
2. Set up Gmail Pub/Sub using [mailbox events](engineering/MAILBOX_EVENTS.md), populate all four settings, and verify an active watch plus authenticated notification delivery and renewal.
3. Start Outlook setup: register/configure the Microsoft app, add real credentials and the public webhook URL, obtain consent, and verify a connected test mailbox plus Graph subscription lifecycle.
4. Verify Stripe webhooks in development using the [local listener instructions](engineering/BILLING.md#local-setup-after-keys-are-available). Match the listener's signing secret, perform a test-mode flow, and confirm successful event delivery and database reconciliation independently of the browser return. Check duplicate delivery and payment-failure handling. Record the result before marking development billing verified.
5. Configure the intended live Vercel environment and final callback origins, deploy the intended revision, then register/sync the cloud Inngest app. Verify processing continues with the browser closed and that recovery/renewal schedules run.
6. Verify hosted sign-in, Gmail and Outlook arrival-to-classification flows, private realtime authorization and inbox updates. Keep production billing disabled until live Stripe configuration and the billing acceptance checks are complete.
7. Use 100 disposable staging users/mailboxes with `npm run load:burst -- staging-user-ids.json` for real first-tag/completion latency. Do not replace a hosted performance claim with synthetic timings.
8. Record the deployed revision, service environment, timestamps and actual outcomes after each live check. Distinguish implemented, configured and verified states.

Configuration details: [environment](engineering/ENVIRONMENT.md). Activation: [service setup](engineering/SERVICE_SETUP.md). Operations and staging load test: [runbook](engineering/RUNBOOK.md).
