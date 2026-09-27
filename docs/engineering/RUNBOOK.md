# Deployment and operations

Phase 7 separates code readiness from connected services. Follow [Service setup](SERVICE_SETUP.md) to activate Inngest, Gmail Pub/Sub, Outlook and private Supabase Realtime. The user will connect those external services later. The application remains usable with saved results while work is queued.

## Install and verify

Use Node.js 22. Copy `.env.example` to `.env.local`; keep secrets outside Git. `APP_MODE=demo` never contacts mail providers or Jev. For live mode retain the existing Supabase, Google OAuth, database, encryption and Jev credentials. Outlook and Inngest are optional until activated; missing configuration must be shown as unavailable, never as a successful connection.

```sh
npm ci
npm run db:generate
npm test
npm run typecheck
npm run lint
npm run build
```

Apply migrations with `npm run db:migrate` against the intended Supabase database before deploying this code. Take the normal database backup first. Migrations add indexes, private subscription/draft/usage tables and classification freshness fields without dropping existing mail. PGlite tests verify migrations and tenant/workspace constraints; they are not a substitute for checking the target database.

All Vercel cron files now disable cron. Inngest owns scheduled recovery and renewal. Do not enable the historical digest or combined synchronous worker schedules. No Redis is needed for this release.

## Account plans

`/pricing` displays Starter at $4.99/month for 10,000 emails and Heavy at $7.99/month for 20,000. A three-day no-card trial starts explicitly and includes 10,000 emails total. Paid subscriptions are an explicit, immediately charged Checkout action. `BILLING_ENABLED=true` activates trial/subscription and allowance enforcement; missing keys then block checkout rather than grant access. Settings preferences cannot grant paid access. Usage counts first saved classifications, not opens, replies, retries or tag changes. Paid allowances follow Stripe billing periods; manual grants use calendar months. See [Stripe setup and verification](BILLING.md).

To grant access administratively with the existing Supabase secret key and database credentials:

```sh
node --env-file=.env.local --import tsx scripts/grant-plan.ts EMAIL HEAVY
```

The script requires a confirmed Supabase email, writes the application plan and trusted `app_metadata.evailbox`, preserves other applications' metadata and verifies both writes. It is idempotent. If only one write succeeds, rerun to reconcile. Never trust user-editable metadata as a grant. No checkout, invoice or subscription is created.

## Processing and recovery

Sync returns HTTP 202 after saving work markers. Inngest receives only a user ID. Each bounded import-and-classify turn runs in one step with transient bodies; sleeps and retry delays do not hold a server request open. Provider checkpoints and account leases prevent cursor loss and overlapping refresh-token rotation. Classification uses bounded concurrency, guarded batched writes and shared Jev cooldowns.

Inspect workRequested/workRevision/workNotBefore, syncRequested/cursor/syncError and subscription status/expiry/retry fields without logging email bodies or tokens. The one-minute outbox recovery retries event publication; the 15-minute incremental scan repairs missed provider events. Subscription renewal runs hourly and continues in bounded batches. If Inngest is offline, work remains queued until service recovery.

Private Realtime broadcasts carry invalidation signals only. Failure falls back to focus/interval refresh; database reads remain authoritative. Browser persistence includes at most eight summary queries per user/workspace for 24 hours, never bodies, drafts or tokens. Logout, disconnect and account deletion clear affected private caches across tabs. Model changes invalidate persisted summaries.

## Retired notifications

Browser notifications, in-app priority alerts, email digests, unsubscribe UI and delivery jobs are removed. Resend/VAPID configuration is no longer used. Returning browsers unregister the app's old notification worker and push subscription. Old database preference/history columns remain inert to avoid destructive migration; they cannot enable delivery through the API.

## Replies and account removal

Reply/reply-all are explicit user actions with fixed sending account and provider-derived recipients/thread headers. Drafts persist before Send. Provider acceptance is not a delivery receipt. A timeout after a provider write produces an unknown state; Check status is read-only and cannot automatically resend. Reconnect existing mailboxes for Gmail `gmail.modify` or Outlook `Mail.ReadWrite Mail.Send` permission. Attachments and AI-written replies are outside this release.

Disconnect clears the mailbox's local state; provider mail remains intact. Cleanup of watches/subscriptions is best effort and does not remove a subscription shared by another connected workspace. Account deletion removes the verified Supabase identity and cascades local data; a failed identity deletion must preserve the app account. Active provider operations should finish before disconnect/deletion.

## Rollback and targets

Roll back the deployment without dropping additive tables. Disable Inngest functions before reverting to code with incompatible worker contracts. Do not restore retired delivery schedules. Keep provider subscriptions secure; they can expire naturally if processing is paused.

Measure cached browser rendering, authenticated server reads, and fresh-mail processing separately. The sub-100-ms target is for a warm cached inbox after identity/cache availability. It is not a promise for cold navigation, importing 1,000 messages, network round trips or fresh Jev inference. Add a shared server cache only if measured indexed reads miss their separate budget.

## Local demo

1. Install Node.js 22 and clone the private repository; enter `evailbox`.
2. Run `npm ci`, then copy `.env.example` to `.env.local`. Keep `APP_MODE=demo` and `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
3. Run `npm run db:generate`, then `npm run dev`.
4. Open `http://localhost:3000/` and confirm the public evailbox landing page. Choose **Open inbox** to reach `/inbox` and confirm the explicit demo indicator. Switch Personal/Work and verify independent state. Exercise tags, combined filters, email details, handled state, replies/drafts (simulated), `/pricing`, account/settings screens and narrow viewport navigation. Demo actions use local fictional data, not provider credentials.
5. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Record failures rather than editing evidence to appear green.

## Live environment and database

For Supavisor, use transaction mode (port `6543`) for the app’s `DATABASE_URL`, with `pgbouncer=true&connection_limit=3&pool_timeout=20` as a small local starting pool. Use session mode (port `5432`, `connection_limit=1`) or a reachable direct connection for `DIRECT_URL` and migrations. For serverless deployments, start with `connection_limit=1` per instance and tune against total concurrency. Restart the app after changing connection URLs: the development Prisma singleton can retain its old pool across hot reloads.

Outlook and Inngest are optional in live mode. Missing, blank, masked, or placeholder Microsoft credentials disable Outlook OAuth with HTTP 503 `OUTLOOK_NOT_CONFIGURED`. Core live-mode credentials remain required, and missing credentials never enable demo mode.

The Next.js app uses `@supabase/ssr` for cookie sessions and `@supabase/supabase-js` for admin operations. The current app does not require a separate JWKS URL. Use the full secret key, never the masked dashboard preview. Configure the same variable names in the deployment environment as well as `.env.local`; environment-specific values remain separate.

1. Create a dedicated Supabase project for the intended environment. Keep staging and production credentials separate.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from project settings. Store `SUPABASE_SECRET_KEY` only in server environment secrets.
3. Set `DATABASE_URL` to the appropriate Prisma runtime connection and `DIRECT_URL` to the direct/migration connection from Supabase. Percent-encode password special characters. Never expose either as public variables.
4. Back up existing data and review every migration in `prisma/migrations/`, including the read-index, Realtime, subscription, classification-freshness, plan and reply-draft migrations. Run `npm run db:migrate` with the intended environment loaded, then `npm run db:generate`. The workspace upgrade preserves existing rows as Personal and changes mailbox/name uniqueness and composite foreign keys; coordinate it with application rollout. The previous committed record reports a hosted migration; verify the current target against [status](../STATUS.md) and the migration table. Supabase roles and `auth.uid()` are required; plain PostgreSQL needs equivalent auth scaffolding for integration testing. See [workspace rollout](WORKSPACES.md).
5. Verify every application table has RLS enabled. Test authenticated user A cannot select user B's allowed rows and cannot directly read credential, preference, subscription, draft, usage or processing tables, or update their own plan. Test server APIs independently: Prisma's privileged role can bypass RLS, so RLS alone does not prove tenant isolation. [Supabase RLS roles](https://supabase.com/docs/guides/database/postgres/row-level-security)
6. Generate a 32-byte key with `openssl rand -hex 32` into a secure secret store; set `ENCRYPTION_SECRET_KEY`. Generate an independent long random `CRON_SECRET` (at least 32 characters). Preserve encryption-key backups securely.
7. Configure every live variable in `.env.example`, set the exact HTTPS `NEXT_PUBLIC_APP_URL`, and set `APP_MODE=live`. Startup validation rejects missing placeholders; do not suppress validation to deploy a partially configured live service.

## Google sign-in and Gmail connection

Sign-in and mailbox access are two separate OAuth flows.

1. In Google Cloud, create/select an authorized project, enable Gmail API, configure the OAuth consent screen and test users, and register a Web OAuth client.
2. For **Supabase Google sign-in**, enable Google in Supabase Auth and supply the Google client ID/secret there. Add the project's `https://<project-ref>.supabase.co/auth/v1/callback` to Google's authorized redirect URIs. Set the Supabase Site URL to the app origin and allow the app's `/api/auth/callback` URL. [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
3. For **Gmail mail connection**, set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the app; register the exact app URL `/api/accounts/gmail/callback` in the Google OAuth client. A separate client may be used if configured consistently.
4. Add localhost callback URIs only to the development client. Production uses the deployed HTTPS origin; provider URI matching is exact.
5. Verify app sign-in, then connect Gmail from Accounts. Confirm only `gmail.modify` consent (drafts, explicit sends and read/archive), correct mailbox identity and encrypted database token values. Test an expired token refresh and a reconnect when offline access is absent.
6. Before general availability, complete Google's applicable restricted-scope verification/security assessment. Test-user consent success does not establish production verification.

## Outlook connection

1. Register an app in Microsoft Entra ID with account types appropriate to the product (including personal accounts if required).
2. Add a Web redirect URI of `${NEXT_PUBLIC_APP_URL}/api/accounts/outlook/callback`; create a client secret and record its expiry in the secret manager.
3. Configure delegated `Mail.ReadWrite`, `Mail.Send`, `User.Read` and `offline_access` permission/consent requirements. Writes happen only after an explicit user action.
4. Set `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT_ID` (`common` by default).
5. Connect an authorized test account, confirm its identity, then verify pagination, refresh rotation, read changes and Inbox moves/deletions. Tenant admin consent policies can require administrator action; report this separately from application defects.

## Jev

1. Obtain an authorized Vercel AI Gateway key and set `JEV_API_KEY`. Set `JEV_GATEWAY_URL=https://ai-gateway.vercel.sh/v4/ai`; this is the Gateway base URL, not a chat endpoint.
2. Run fixture tests first. With explicit authority for the live request, classify synthetic, non-sensitive email examples and verify native boolean output, thresholds and failure propagation. Inspect actual routing/retention controls. Never treat a fixture as a successful live evaluation.

## Production release gate

1. Run all local quality checks and complete the current product journeys and service acceptance checks. Review the actual deployable diff, dependency lockfile, migration, environment names, domain/callbacks and Inngest/provider-event activation.
2. Confirm the repository is private and contains no `.env.local`, keys or email dumps. Connect it to the intended Vercel project; set Node/runtime and environment variables separately for preview and production.
3. Prepare a concrete release candidate and migration/rollback plan. Obtain the task's final deployment approval before publishing; this runbook does not grant deployment authorization.
4. Apply approved migrations against the correct backed-up database, deploy the approved commit, and verify `/api/health` reports the expected mode.
5. Verify sign-in, one authorized mailbox sync, one synthetic classification, settings persistence and deletion isolation. Verify Inngest runs and provider events separately using [SERVICE_SETUP](SERVICE_SETUP.md). Send any reply test only to an operator-owned recipient.
6. Record commit SHA, deployment URL, migration status, environment mode, checked flows, remaining external gates and timestamps. Do not equate a successful Vercel build with working provider integrations.

## 24-hour monitoring and recovery

Monitor durable workRequested/workNotBefore/workFailures, syncRequested/cursor/rescan age, pending classification pairs, inference errors/latency, subscription expiry/renewal failures, reply drafts left in `unknown`, Inngest failures, function timeouts, API error rate and DB connection limits. Never log raw provider bodies or access tokens. Use application-safe error codes and redacted metadata.

| Incident                     | Operator action                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth redirect mismatch      | Compare deployed app origin and exact callback with provider registration and Supabase redirect allowlist; redeploy only if environment changed.                                                                                                                                                                                                                                                                                                                     |
| Invalid/revoked token        | Ask affected user to reconnect; verify refresh credentials/scopes; do not substitute another user's token.                                                                                                                                                                                                                                                                                                                                                           |
| Stuck work/sync lease        | Wait for the two-minute user/account lease to expire; inspect workRequested, workNotBefore and repeated timeouts. Preserve cursors and completed classifications. Inngest recovery can reclaim expired work.                                                                                                                                                                                                                                                         |
| Expired history/delta        | Adapter requests a reconciliation rescan; bounded cursors admit new arrivals and update retained messages without backfilling older unknown mail. Preserve existing rows; monitor rescanStartedAt/lastSeenAt and cursor progress. Delete unseen rows only at terminal reconciliation, never by clearing the cache at rescan start.                                                                                                                                                                                                                                               |
| Jev unavailable              | Preserve missing/failed classification as retryable; do not store a no-match fallback. Check Gateway credentials and native model route.                                                                                                                                                                                                                                                                                                                             |
| Jev / Gateway 429            | Classification pauses with completed progress saved. Wait for the displayed cooldown before retrying. Inspect `classification_failed` status/generation ID and the corresponding AI Gateway log; check Gateway/provider limits. Repeated clicks and rule edits preserve the cooldown. Automatic continuation requires active Inngest functions.                                                                                                                      |
| Import stays at 100 messages | Inspect `mailbox_sync_failed` stage/status/databaseCode and the pending account cursor. `save_page` / `P2028` indicates a database transaction timeout; page saves now use an explicit timeout within the worker deadline. Resume the preserved cursor through a worker. For mailbox-only recovery, call `syncMailboxes` under `withUserWorkLease` to avoid AI calls. Local development needs a worker invocation; cache refresh alone does not import another page. |
| Encryption key changed       | Restore the correct prior key or perform an authorized re-encryption migration; new keys cannot decrypt old tokens.                                                                                                                                                                                                                                                                                                                                                  |
| Bad application deploy       | Roll back to the last known good compatible Vercel deployment; verify schema compatibility before rollback.                                                                                                                                                                                                                                                                                                                                                          |
| Destructive migration issue  | Restore from verified backup using a documented recovery procedure; do not automatically reverse a production migration.                                                                                                                                                                                                                                                                                                                                             |

Disconnecting a mailbox removes local records, not provider-side consent. For revoked application access, remove the grant in Google/Microsoft account settings too. User deletion removes the Supabase identity and application data; independently verify storage/backups/third-party retention policies when responding to deletion requests.

## Deployment identity

Historical Git/Vercel blockers do not establish current account permissions. Verify the intended repository, project and deployment identity before publishing; record current evidence in [status](../STATUS.md).

## Signup bursts (20-message turns)

`INBOX_WORK_CONCURRENCY` controls the inbox function's global **step** concurrency,
defaulting to 5 and bounded to 1–100. Set it to a value supported by the deployed
Inngest plan, then increase gradually against Gmail project quotas, Jev 429s and
DB pool wait times. `JEV_CONCURRENCY` remains 4 by default (1–8 per user); at a
global setting of 100 there can be up to 400 inference calls in flight.
This does not change the service plan or account-level limits.

Each turn imports one provider page (initial page size 20), saves metadata and
broadcasts a refresh before classifying at most 20 emails across workspaces.
Remaining work gets a new continuation event. A per-user concurrency key keeps
turns serial; Inngest supplies best-effort fairness across keys, **not strict
round-robin ordering**. Small turns prevent one large initial import from consuming
a full 100-email turn. Account import order is least-recently-synced first.
Gmail history pages count history records, so incremental pages can contain more
than 20 changed messages; classification remains capped at 20.

Import and inference now share **one** `import-and-tag-page` step. A local map
carries bodies by account/message identity and content hash, then is cleared in
`finally`. Step results and continuation events contain only counts/IDs. Bodies
are never placed in Inngest results or Postgres. Retries after a committed cursor,
content changes, inference cooldowns, and later reclassification can still require
a provider fetch. Import continues while inference is cooling down; failures and
finished imports observe the durable retry time.

Inbox progress is workspace-wide, independent of search/tag/account filters.
“Tagged” counts emails with decisions for **all current tags**, including negative
decisions, and checks content/tag/model versions. During import the denominator is
the number imported so far, not a claimed mailbox total. Realtime remains the fast
path; active work uses a two-second polling fallback.

Use the transaction-pooler `DATABASE_URL` example in `.env.production.example`
(port 6543, `pgbouncer=true`, `connection_limit=1`). Copy the actual endpoint from
Supabase; do not guess the region/index. Keep `DIRECT_URL` on a session/direct
connection for migrations. Updating the example does not change a deployed
project's environment. Redeploy after setting runtime credentials.

References: [Inngest concurrency](https://www.inngest.com/docs/guides/concurrency),
[tenant fairness](https://www.inngest.com/docs/guides/multi-tenancy),
[Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Burst validation

- `npm run test:burst`: 100 users × 100 emails, real classification queries/writes
  in PGlite with mocked providers/inference and a local FIFO queue. Verifies 10k
  decisions, exactly-once usage, bounded turns and no second body fetch on the
  normal path. Its timings measure this local harness only.
- `BURST_EMAILS=1234 npm run test:burst`: the 123,400-email case. Increase
  `INBOX_WORK_CONCURRENCY` to exercise larger settings locally.
- `npm run load:burst -- staging-user-ids.json`: hosted measurements. Supply a JSON
  array of 100 distinct, fresh **staging** user UUIDs, connected test mailboxes and
  at least one tag in every connected workspace. Pause background dispatch during
  provisioning; all fixture users must be idle, with null cursors and no imported
  emails. Set `DATABASE_URL` and `INNGEST_EVENT_KEY` for that staging environment.
  The script marks work and publishes all events together, using actual mailbox
  contents (new connections retain at most 100 initial Inbox messages). It does not create accounts,
  send mail, delete records, or reset existing imports.
- The hosted script reports first-tag p50/p95/max from DB timestamps, observed
  completion p50/p95/max (one-second polling), and actual imported/tagged counts.
  Empty test inboxes cannot provide a first-tag measurement. It times out after
  30 minutes (`BURST_TIMEOUT_MS` overrides); pending work remains durable. It does
  not measure OAuth/signup latency. Use the same mailbox fixtures with fresh
  users in separate staging environments for before/after comparisons.

Do not quote synthetic timings as hosted performance or put an unmeasured value
in the interview claim. A successful local test proves queue/budget/data behavior;
a staging run is needed to establish latency and quota headroom.
