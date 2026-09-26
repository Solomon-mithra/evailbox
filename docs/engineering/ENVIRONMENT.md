# Environment configuration

Updated 2026-09-26. `.env.local` is the local variable-name reference; `.env.example` is the tracked reference in a clean checkout. All root `.env*` files share 33 names. Their values remain environment-specific.

Run `npm run env:check` to detect missing, extra or duplicate names. The check never compares or prints values. Existing values were preserved during alignment; only the retrieved Inngest keys and missing settings were added locally. Real `.env.local` and `.env.production` files are ignored by Git. Example files contain placeholders/defaults only.

| Group            | Names                                                                                                            | Meaning                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| App              | `APP_MODE`, `NEXT_PUBLIC_APP_URL`                                                                                | Explicit demo/live mode and exact application origin                                                   |
| Supabase         | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`                                                | Session/auth/admin/realtime configuration; secret key stays server-side                                |
| Database         | `DATABASE_URL`, `DIRECT_URL`                                                                                     | Runtime transaction pooler versus direct/session migration connection                                  |
| Gmail            | `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                           | Gmail mailbox OAuth credentials                                                                        |
| Outlook          | `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`                              | Optional Microsoft OAuth; blank credentials disable it                                                 |
| Jev              | `JEV_GATEWAY_URL`, `JEV_API_KEY`, `JEV_MODEL_ID`, `JEV_MODEL_VERSION`, `JEV_CONCURRENCY`                         | Native Gateway evaluation, freshness version and per-user concurrency                                  |
| Server secrets   | `ENCRYPTION_SECRET_KEY`, `CRON_SECRET`                                                                           | Stable encryption secret and authenticated legacy cron route protection                                |
| Inngest          | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV`, `INBOX_WORK_CONCURRENCY`                              | Event publication, signed invocation, intentional dev-server mode and global step limit                |
| Gmail push       | `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`, `GMAIL_PUBSUB_AUDIENCE`, `GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL` | Optional authenticated Pub/Sub setup; configure together                                               |
| Outlook push     | `OUTLOOK_WEBHOOK_URL`                                                                                            | Optional public HTTPS notification/lifecycle callback                                                  |
| Retired delivery | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `RESEND_API_KEY`, `DIGEST_FROM`                        | Unused; retained only to preserve existing values/name parity. Not required and cannot enable delivery |

## Inngest

The existing **Production** event and signing keys were saved only to `.env.local` through Safari. Other environment files have their own values or blank key slots. Do not copy local keys into tracked examples or assume a production key belongs in a staging deployment.

`INNGEST_DEV=0` selects cloud mode when both real keys are present. This enables publication but does not register a callable worker. The cloud dashboard must sync the intended reachable `/api/inngest` endpoint. On 2026-09-26 the observed environment had no active apps and a 5-concurrency tier; default `INBOX_WORK_CONCURRENCY=5` matches that observation.

For isolated local worker testing, intentionally override `INNGEST_DEV=1` and run the Inngest dev server; use a disposable test database/mailbox setup. Do not confuse a successful localhost response or saved keys with cloud execution.

## Database and loading rules

Use the exact Supabase transaction pooler endpoint for runtime (`6543`, `pgbouncer=true`, a small `connection_limit`); use direct/session access for `DIRECT_URL` and migrations. Local pooling already exists. This cleanup did not alter deployed or production database values.

Next.js loads `.env.local` ahead of `.env.production` during normal production-mode local builds. Editing `.env.production` does not guarantee it wins locally. Deployment environment variables must be configured separately. Prisma CLI and standalone scripts may have different loading rules: explicitly load the intended environment before migration or load testing, and verify the destination without printing credentials.

`NODE_ENV`, `NEXT_RUNTIME` and `VERCEL_ENV` are runtime/platform-owned and are not copied into these templates. `BURST_TIMEOUT_MS`, `BURST_EMAILS` and monitoring variables are script/CI overrides documented with those tools.

References: [Next.js environment loading](https://nextjs.org/docs/app/guides/environment-variables), [Inngest signing keys](https://www.inngest.com/docs/platform/signing-keys), [event keys](https://www.inngest.com/docs/events/creating-an-event-key).
