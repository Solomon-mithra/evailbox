# Setup, deployment and operations runbook

This is an executable operator guide, not a record of actions already performed. All live-account, deployment and delivery checks remain **pending external validation** until an operator records dated evidence. Never place secrets, real inbox bodies or unredacted callback URLs into tickets or commits.

## Local demo

1. Install Node.js 22 and clone the private repository; enter `jevinbox`.
2. Run `npm ci`, then copy `.env.example` to `.env.local`. Keep `APP_MODE=demo` and `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
3. Run `npm run db:generate`, then `npm run dev`.
4. Open localhost and confirm the explicit demo indicator. Exercise tags, combined filters, email details, handled state, account/settings screens and narrow viewport navigation. Demo actions use local fictional data, not provider credentials.
5. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Record failures rather than editing evidence to appear green.

## Live environment and database

1. Create a dedicated Supabase project for the intended environment. Keep staging and production credentials separate.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from project settings. Store `SUPABASE_SERVICE_ROLE_KEY` only in server environment secrets.
3. Set `DATABASE_URL` to the appropriate Prisma runtime connection and `DIRECT_URL` to the direct/migration connection from Supabase. Percent-encode password special characters. Never expose either as public variables.
4. Back up existing data and review `prisma/migrations/20260921000000_init/migration.sql`. On a fresh authorized project run `npm run db:migrate` with environment variables loaded, then `npm run db:generate`. The migration expects Supabase roles and `auth.uid()`; plain PostgreSQL needs equivalent auth scaffolding for integration testing.
5. Verify every application table has RLS enabled. Test authenticated user A cannot select user B's allowed rows and cannot directly read credential/preference/subscription/digest tables. Test server APIs independently: Prisma's privileged role can bypass RLS, so RLS alone does not prove tenant isolation. [Supabase RLS roles](https://supabase.com/docs/guides/database/postgres/row-level-security)
6. Generate a 32-byte key with `openssl rand -hex 32` into a secure secret store; set `ENCRYPTION_SECRET_KEY`. Generate an independent long random `CRON_SECRET` (at least 32 characters). Preserve encryption-key backups securely.
7. Configure every live variable in `.env.example`, set the exact HTTPS `NEXT_PUBLIC_APP_URL`, and set `APP_MODE=live`. Startup validation rejects missing placeholders; do not suppress validation to deploy a partially configured live service.

## Google sign-in and Gmail connection

Sign-in and mailbox access are two separate OAuth flows.

1. In Google Cloud, create/select an authorized project, enable Gmail API, configure the OAuth consent screen and test users, and register a Web OAuth client.
2. For **Supabase Google sign-in**, enable Google in Supabase Auth and supply the Google client ID/secret there. Add the project's `https://<project-ref>.supabase.co/auth/v1/callback` to Google's authorized redirect URIs. Set the Supabase Site URL to the app origin and allow the app's `/api/auth/callback` URL. [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
3. For **Gmail mail connection**, set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the app; register the exact app URL `/api/accounts/gmail/callback` in the Google OAuth client. A separate client may be used if configured consistently.
4. Add localhost callback URIs only to the development client. Production uses the deployed HTTPS origin; provider URI matching is exact.
5. Verify app sign-in, then connect Gmail from Accounts. Confirm only `gmail.readonly` consent, correct mailbox identity and encrypted database token values. Test an expired token refresh and a reconnect when offline access is absent.
6. Before general availability, complete Google's applicable restricted-scope verification/security assessment. Test-user consent success does not establish production verification.

## Outlook connection

1. Register an app in Microsoft Entra ID with account types appropriate to the product (including personal accounts if required).
2. Add a Web redirect URI of `${NEXT_PUBLIC_APP_URL}/api/accounts/outlook/callback`; create a client secret and record its expiry in the secret manager.
3. Configure delegated `Mail.Read`, `User.Read` and `offline_access` permission/consent requirements; do not request write/send permissions.
4. Set `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT_ID` (`common` by default).
5. Connect an authorized test account, confirm its identity, then verify pagination, refresh rotation, read changes and Inbox moves/deletions. Tenant admin consent policies can require administrator action; report this separately from application defects.

## Jev and delivery providers

1. Obtain an authorized Vercel AI Gateway key and set `JEV_API_KEY`. Set `JEV_GATEWAY_URL=https://ai-gateway.vercel.sh/v4/ai`; this is the Gateway base URL, not a chat endpoint.
2. Run fixture tests first. With explicit authority for the live request, classify synthetic, non-sensitive email examples and verify native boolean output, thresholds and failure propagation. Inspect actual routing/retention controls. Never treat a fixture as a successful live evaluation.
3. Generate a VAPID key pair using the installed Web Push CLI (`npx web-push generate-vapid-keys`); store `VAPID_PRIVATE_KEY` secretly and configure `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT=mailto:<operator-address>`.
4. Verify a sending domain in Resend; configure `RESEND_API_KEY` and an authorized `DIGEST_FROM`. Use an operator-owned recipient for delivery tests.
5. In a supported HTTPS browser, explicitly enable push and test a high-priority unread/unhandled match, revoked permission and expired subscription. Test digest delivery, links, HTML escaping and unsubscribe with the authorized test recipient.

## Cron, timezone and idempotency

Committed schedules in `vercel.live.json`: `/api/cron/sync` at `0 3 * * *` marks all mail accounts for daily incremental sync; `/api/cron/work` at `* * * * *` drains durable requested work every minute; `/api/cron/digest` at `*/15 * * * *` processes digests every 15 minutes. The minute worker and digest schedules require Vercel Pro or an equivalent authorized scheduler; Hobby allows daily jobs only. Cron handlers require `Authorization: Bearer <CRON_SECRET>`. Do not expose the secret in browser code or public curl examples. [Vercel cron restrictions](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

The digest stores the user's IANA timezone and local `HH:mm`. `digestWindow` considers a run due during the 15 minutes after that time; a window crossing midnight belongs to the previous scheduled local date. `DigestHistory` has a unique `(userId, localDate)` key and a two-minute lease. Immutable `windowEnd` cutoffs partition classification selection, while the complete `payload` is saved before sending and reused unchanged. Resend receives `Idempotency-Key: digest-<history-id>`. Previously queued pending/failed work is retried even outside the scheduling window, while digest opt-in remains enabled. This reduces duplicate sends but does not establish exactly-once delivery under all provider failure conditions.

Current edge cases require explicit release review: a late/missing cron invocation outside the 15-minute window cannot create a new missed schedule record; a nonexistent daylight-saving local time can be skipped. Midnight-crossing windows map to the prior scheduled date, and a repeated DST hour uses the same local-date uniqueness record. Already queued failed/pending deliveries remain retryable. Resend retains idempotency keys for 24 hours; ambiguous delivery failures retried after that retention can duplicate an earlier accepted send and require operator reconciliation. Very large digests must finish full payload assembly within a worker budget; they remain pending instead of silently truncating on a deadline. [Resend idempotency contract](https://resend.com/changelog/idempotency-keys) Test local midnight, DST forward/backward transitions and concurrent invocations. Record actual observations; do not claim a passing daily scheduling guarantee without them.

Workspace `refreshMinutes` re-fetches cached data; it does not change provider schedules. Account connections, manual Sync and tag creation/edits persist requested work. The minute worker resumes provider cursors and missing classification pairs without requiring repeated clicks or an open browser. Completed match, no-match and uncertain decisions are cached by email/tag/version. User/account revision checks retain newer requests made during a running pass. User/account leases expire after two minutes; failed passes defer retries through workNotBefore and workFailures. Cross-user scheduling prioritizes oldest/null lastBackgroundSyncAt with a 100-user candidate limit and 45-second shared deadline. Monitor requested users, requested accounts, oldest attempt, deferred failures and unclassified emails; see [LARGE_INBOXES.md](LARGE_INBOXES.md).

## Confirmed hosting-plan blocker and demo deployment route

The production configuration was attempted on the connected Vercel **Hobby** account and rejected because it contains every-minute work and 15-minute digest schedules. This is an observed deployment-plan blocker, not a hypothetical limitation. No plan upgrade or scheduled background processing has been enabled, and live provider/database credentials have not been supplied.

For the explicit demo candidate, `vercel.demo.json` contains `crons: []` and preserves the normal build/function settings. After the applicable deployment approval, use the demo-specific command:

```sh
npx vercel deploy --prod --local-config vercel.demo.json
```

Set `APP_MODE=demo` and the correct demo app URL in that target environment. Verify the resulting deployment URL separately before reporting success. The full live `vercel.live.json` remains unchanged with all three schedules. This demo route does not run sync workers, classify real inboxes, send digests or establish live integration success. A future live deployment requires Vercel Pro or an explicitly configured external scheduler invoking the bearer-protected endpoints; switching the file alone is insufficient.

## Production release gate

1. Run all local quality checks and complete the Phase 6 browser matrix. Review the actual deployable diff, dependency lockfile, migration, environment names, domain/callbacks and cron plan.
2. Confirm the repository is private and contains no `.env.local`, keys or email dumps. Connect it to the intended Vercel project; set Node/runtime and environment variables separately for preview and production.
3. Prepare a concrete release candidate and migration/rollback plan. Obtain the task's final deployment approval before publishing; this runbook does not grant deployment authorization.
4. Apply approved migrations against the correct backed-up database, deploy the approved commit, and verify `/api/health` reports the expected mode.
5. Verify sign-in, one authorized mailbox sync, one synthetic classification, settings persistence and deletion isolation. Check cron configuration and authorized test delivery separately.
6. Record commit SHA, deployment URL, migration status, environment mode, checked flows, remaining external gates and timestamps. Do not equate a successful Vercel build with working provider integrations.

## 24-hour monitoring and recovery

Monitor durable workRequested/workNotBefore/workFailures, syncRequested/cursor/rescan age, pending classification pairs, inference errors/latency, failed/pending digest records, push errors, function timeouts, API error rate and DB connection limits. Check several cron invocations and one complete local digest day. Never log raw provider bodies or access tokens. Use application-safe error codes and redacted metadata.

| Incident                    | Operator action                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth redirect mismatch     | Compare deployed app origin and exact callback with provider registration and Supabase redirect allowlist; redeploy only if environment changed.                                                                       |
| Invalid/revoked token       | Ask affected user to reconnect; verify refresh credentials/scopes; do not substitute another user's token.                                                                                                             |
| Stuck work/sync lease       | Wait for the two-minute user/account lease to expire; inspect workRequested, workNotBefore and repeated timeouts. Preserve cursors and completed classifications. The next minute worker can reclaim expired work.     |
| Expired history/delta       | Adapter requests a full Inbox rescan. Preserve existing rows; monitor rescanStartedAt/lastSeenAt and cursor progress. Delete unseen rows only at terminal reconciliation, never by clearing the cache at rescan start. |
| Jev unavailable             | Preserve missing/failed classification as retryable; do not store a no-match fallback. Check Gateway credentials and native model route.                                                                               |
| Digest missing              | Check opt-in, timezone/window, cron execution, lease/status, sender domain and provider rejection. Avoid blind duplicate sends.                                                                                        |
| Encryption key changed      | Restore the correct prior key or perform an authorized re-encryption migration; new keys cannot decrypt old tokens.                                                                                                    |
| Bad application deploy      | Roll back to the last known good compatible Vercel deployment; verify schema compatibility before rollback.                                                                                                            |
| Destructive migration issue | Restore from verified backup using a documented recovery procedure; do not automatically reverse a production migration.                                                                                               |

Disconnecting a mailbox removes local records, not provider-side consent. For revoked application access, remove the grant in Google/Microsoft account settings too. User deletion removes the Supabase identity and application data; independently verify storage/backups/third-party retention policies when responding to deletion requests.

## Current validation boundary

The local PGlite suite exercises the committed migration, RLS policies, credential-table denial and tenant foreign keys using a Supabase auth scaffold. The thousand-message classification fixture drains ten batches of 100 emails with two tags each: 2,000 pair results, 1,000 mocked batched Jev invocations, and no further calls on a subsequent completed pass. This is correctness evidence, not live latency/throughput or cost measurement. Queue/rescan regression tests cover durable continuation and reconciliation separately. Browser QA was interrupted by user control; unexecuted browser checks remain pending. No live configuration has yet been supplied, so hosted Supabase, real OAuth/inbox/JeV, deployed cron and real notification delivery cannot be marked passed.

### Confirmed Hobby deployment configuration

Use the checked-in root `vercel.json` for the demo; it contains no cron schedules. `vercel.live.json` contains the daily sync, every-minute worker, and quarter-hour digest schedules. Before enabling live cron on a compatible plan, copy `vercel.live.json` to `vercel.json`, commit, and deploy. A CLI-only `--local-config` override did not prevent the remote Next.js build from reading the root cron configuration in the observed deployment. Environment files are excluded by `.vercelignore`; set live variables in Vercel.
