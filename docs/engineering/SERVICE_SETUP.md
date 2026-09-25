# Service activation and acceptance

**External setup is intentionally deferred.** The application code and local tests do not create an Inngest environment, Google Pub/Sub resources, Microsoft subscriptions, or a Supabase project. This is the checklist for connecting them later. Local verification is not evidence that a hosted service is active.

Use separate staging and production environments. Keep provider OAuth clients, database connections, Supabase keys, Inngest keys, and callback URLs aligned to the same environment. The final HTTPS application origin belongs in `NEXT_PUBLIC_APP_URL`.

## Activation order

1. Apply the committed database migrations to the intended database and verify private realtime authorization.
2. Configure Supabase sign-in and the provider OAuth clients, including the current mailbox scopes.
3. Deploy the app with core server secrets, then connect and sync its Inngest app.
4. Connect the Gmail Pub/Sub infrastructure and enable the Outlook webhook configuration.
5. Reconnect controlled test mailboxes, run the acceptance checks below, and record the actual results.

The [runbook](RUNBOOK.md) covers general deployment and operations. [Mailbox events](MAILBOX_EVENTS.md) documents the endpoint contracts, provider setup details, leases, renewal, shared-mailbox behavior, and recovery guarantees.

## Database and Supabase

Set `DATABASE_URL` to the runtime connection and `DIRECT_URL` to the migration connection. With Supabase transaction pooling, follow the pool settings in the runbook rather than using a transaction-pool URL for migrations. The CLI loads connection settings from the environment selected for the command; verify the destination before applying migrations.

The current migration series includes the base schema and workspaces, inbox read indexes, private realtime, mailbox subscriptions, classification freshness, preview plans/usage, and reply drafts. Apply all committed migrations in order during the coordinated rollout:

```sh
npm run db:migrate
npm run db:generate
```

These commands are for the later activation; they have not been run against a live service as part of this implementation. `db:migrate` uses Prisma's deploy mode. Do not replace reviewed production migrations with `db push`.

Verify these database properties after applying migrations:

- Application tables have RLS enabled. Credentials, mailbox subscription private state, processing state, usage, and reply-draft internals remain inaccessible directly to `anon` and `authenticated` roles.
- The mailbox subscription ownership foreign key covers account, user, and workspace and cascades on account deletion. Shared Outlook provider subscription IDs use a nonunique index; ownership still belongs to separate account records.
- The `evailbox_inbox_signals` policy exists on `realtime.messages`. It allows authenticated users to receive only `inbox:<their-user-id>:PERSONAL` and `inbox:<their-user-id>:WORK` broadcasts. There is no client publishing policy added by the app.

The private realtime migration intentionally skips policy creation on isolated PostgreSQL instances without the Supabase realtime schema. If a database was migrated before that schema existed, verify the policy after provisioning Supabase and apply the policy statement from `20260925010000_private_realtime/migration.sql` once the schema is present. Do not assume a successful historical migration means a skipped policy exists.

In Supabase Realtime settings, enable Realtime and disable **Allow public access** to enforce private channels. The browser already uses `private: true`; it obtains a short-lived access token through the authenticated `/api/realtime/session` endpoint. This token stays in memory, outside the persisted query cache. The server sends only an invalidation event and workspace identifier. The browser reads the updated inbox through authenticated application APIs. No email-table publication or raw message-content broadcast is needed. See [Supabase realtime authorization](https://supabase.com/docs/guides/realtime/authorization) and [realtime settings](https://supabase.com/docs/guides/realtime/settings).

The Supabase secret key is server-only. Only the project's publishable key and the signed-in user's temporary access token are used by the realtime client. Validate isolation with two independent test sessions: user B must not receive user A's topic even if B guesses its name. Personal/Work query keys and persisted browser caches must remain scoped to the authenticated user. Sign-out/account changes must remove the previous user's cached data.

## Inngest

### Hosted activation

The app serves Inngest at `/api/inngest` with a Node.js runtime and a 60-second route budget. Set both server-side keys:

| Variable              | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `INNGEST_EVENT_KEY`   | App publication of reference-only work events                          |
| `INNGEST_SIGNING_KEY` | Verification of Inngest requests to the served function endpoint       |
| `INNGEST_DEV`         | `1` only for an intentional local development server; never production |

A partial production configuration is unavailable: an event key by itself does not make the worker active. With missing keys, the app retains durable database work requests, and `/api/inngest` returns `503` rather than claiming connected processing.

Create the intended Inngest environment and either install its Vercel integration or configure the keys manually. After deployment, sync the app using its deployed `/api/inngest` URL. For Vercel deployments protected by an access gate, configure the supported automation bypass in the Inngest integration so signed requests reach the endpoint. Keep the SDK's request signing enabled. The integration can manage environment keys and app syncing; manual deployments need an explicit sync. See [Inngest on Vercel](https://www.inngest.com/docs/deploy/vercel).

Confirm the dashboard shows the `evailbox` app, its event-triggered inbox processing function, backlog recovery schedule, missed-mailbox-change recovery schedule, and provider-subscription renewal function. Sync again after deploying function-definition changes. Check that the deployment budget actually supports the configured 60-second route.

### Execution and recovery

Work events contain only the owning user ID, never message bodies, OAuth credentials, or Graph private state. The durable database flags/revisions are the work outbox. A failed send is recoverable after the event service returns. Fetching, paid inference, and completion/signaling are separate durable steps; SDK checkpointing is disabled so two long batches do not share one route invocation.

The processing function serializes work per user and limits concurrent processing globally. Mailbox ingestion runs before any durable inference cooldown. A continuation event resumes remaining backlog. Recovery republishes durable work every minute, and a periodic incremental sync repairs provider notifications that were delayed or dropped. Provider renewal also runs hourly in bounded batches and is requested after connection or a lifecycle event. Large batches must continue through the worker's bounded continuation/recovery path.

Classification cooldowns must not suppress newly requested mailbox ingestion. The recovery selector includes users with `syncRequested` accounts even if their paid-inference cooldown has not elapsed; classification still waits. Avoid clearing saved cursors or resetting cooldowns to force progress.

### Local development later

Local unit tests require no Inngest server. For an intentional local integration test, use a local test database and test configuration, start the app with `INNGEST_DEV=1`, and run the Inngest CLI dev server:

```sh
INNGEST_DEV=1 npm run dev
inngest dev -u http://localhost:3000/api/inngest
```

The dev-server UI is at `http://localhost:8288`. The app must be in live/test mode to process real work; demo mode intentionally bypasses live services. Do not point this exercise at production mailbox credentials. See [Inngest local development](https://www.inngest.com/docs/local-development).

## Provider OAuth and new scopes

Supabase application sign-in and mailbox-provider connection are separate OAuth flows. Configure the Supabase sign-in callback as described in the runbook. Register these exact mailbox callbacks on the corresponding provider client:

- Gmail: `${NEXT_PUBLIC_APP_URL}/api/accounts/gmail/callback`
- Outlook: `${NEXT_PUBLIC_APP_URL}/api/accounts/outlook/callback`

The current app requests Gmail `https://www.googleapis.com/auth/gmail.modify` and Microsoft delegated `offline_access Mail.ReadWrite Mail.Send User.Read`. These permissions support the explicit read/archive/trash/reply actions as well as ingestion. Configure the relevant consent screens and tenant permissions before testing these actions. Do not substitute application-wide Microsoft mail permissions for this delegated mailbox flow.

Existing read-only connections need to reconnect and grant the new scopes. Merely deploying the new scope string does not upgrade an existing provider grant. Use the application's connect/reconnect flow for the intended workspace; preserve existing message checkpoints. Test that offline refresh access is granted and that a refreshed/rotated token remains usable. Provider refusal or tenant consent policy requires correcting the provider grant, not repeatedly retrying an unauthorized action.

After reconnecting, the app persists sync and renewal work. Confirm it is processed by the newly connected worker. Keep the encryption key stable across deployments; replacing it without a token re-encryption strategy makes stored credentials and subscription state unreadable.

## Gmail push and Outlook notifications

Follow [MAILBOX_EVENTS.md](MAILBOX_EVENTS.md) for the exact provider console steps and protocol details.

For Gmail, provision the Pub/Sub topic and authenticated push subscription in the OAuth client's Google Cloud project. Grant the Gmail publisher access to the topic. Configure a separate push authentication service account and an explicit audience. Set all four variables together:

```text
GMAIL_PUBSUB_TOPIC=projects/PROJECT/topics/TOPIC
GMAIL_PUBSUB_SUBSCRIPTION=projects/PROJECT/subscriptions/SUBSCRIPTION
GMAIL_PUBSUB_AUDIENCE=https://APP/api/webhooks/gmail
GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL=PUSH_ACCOUNT@PROJECT.iam.gserviceaccount.com
```

For Outlook, set the explicitly activated public HTTPS callback:

```text
OUTLOOK_WEBHOOK_URL=https://APP/api/webhooks/outlook
```

The renewal worker creates the Graph subscription with the same notification and lifecycle URL. It generates private client state; do not invent a shared global client-state secret or create subscriptions manually. Shared copies of a verified Outlook mailbox reuse the provider subscription while keeping per-account ownership and routing.

The app's watch history is separate from its ingestion cursor. A successful watch creation must not be interpreted as initial sync completion. Missing provider configuration produces `unconfigured`; only a successful provider result and saved ownership record produce `active`.

## Acceptance tests when services are connected

Run these first with designated test mailboxes and record the deployment revision, service environment, time, and observed outcome. Do not use private production email content as test fixtures.

1. **Database and authentication:** Sign in, switch Personal/Work, reload an inbox, sign out, and sign in as a second user. Confirm expected tenant/workspace isolation and cache cleanup. Confirm realtime topics deny the other user.
2. **Worker activation:** Request a sync through the app. The HTTP response should queue work quickly; provider fetch/classification should appear in separate Inngest steps. Close the browser and confirm the run completes. Dashboard payloads should contain IDs and counts only.
3. **Publication recovery:** In a staging environment, temporarily make event publication unavailable, request work, and restore the configuration. Confirm the saved work is processed after recovery without another browser request. Never clear the outbox merely to hide a pending status.
4. **Provider arrival:** Deliver a harmless message to the test inbox using the provider's own client. Confirm authenticated provider notification receipt, durable work, incremental sync, classification, and a refreshed inbox view. Duplicate delivery must not duplicate stored messages or advance an unsaved checkpoint.
5. **Backlog and renewal:** Connect a mailbox with existing mail and confirm its backlog is ingested. Inspect a successful watch/subscription expiry and safe active status. Exercise renewal using the worker's staging controls, then verify the provider still delivers changes.
6. **Outlook validation/lifecycle:** Confirm a validation challenge returns the once-decoded token as plain text. Exercise lifecycle cases in the automated test suite; when using actual provider events, verify missed/removed/reauthorization signals request recovery. A guessed ID or wrong state must not queue work.
7. **Shared mailbox disconnect:** Connect the same controlled mailbox in two workspaces, disconnect one, and confirm the remaining workspace continues receiving events. Disconnect the final copy and verify local subscription removal plus successful provider cleanup or natural expiry if cleanup could not finish.
8. **Mail actions:** With newly consented scopes, verify read/archive/trash against a disposable test message. Send a reply only after deliberately reviewing the test recipient and content. Simulate ambiguous send outcomes with the isolated tests; never automatically retry an unknown live send simply to see whether it worked.
9. **Outages:** Verify provider or AI throttling preserves progress and displays safe errors. Confirm mailbox fetching remains possible during AI cooldown. Disable realtime in staging and confirm authenticated reads/focus refresh still reveal completed work.

Local verification without external calls:

```sh
npm test -- tests/jobs.test.ts tests/mailbox-webhooks.test.ts tests/mailbox-subscriptions.test.ts tests/provider-credentials.test.ts
npm run test:db
npm run typecheck
```

`test:db` uses the repository's isolated database harness. Inspect its configuration before substituting another database. The live acceptance checklist remains outstanding until it is actually performed after activation.

## Troubleshooting

| Symptom                                               | Check and recovery                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/inngest` returns `503`                          | Confirm live mode and both valid production keys, then redeploy. Local mode requires an intentional `INNGEST_DEV=1` outside production.                                                                     |
| Inngest cannot sync/call the app                      | Verify the deployed endpoint, environment-specific signing key, deployment protection bypass, and the synced function version.                                                                              |
| Sync is queued but no run appears                     | Inspect safe work flags/revisions, event-service availability, and the recovery function. Event publication failure leaves the database marker intact.                                                      |
| Gmail webhook returns `401`/`403`                     | Verify OIDC audience, authenticated push service-account email, verified email claim, Google signer, and exact subscription path. The Gmail topic publisher is a different identity.                        |
| Gmail watch fails                                     | Check the topic project matches the OAuth project, publisher IAM, topic name, consent, and refresh credentials. Read the safe subscription error; do not log provider tokens.                               |
| Outlook creation fails                                | Verify public HTTPS challenge reachability, delegated read permission, callback configuration, and consent. Duplicate creation is recovered only from known same-mailbox private state.                     |
| Outlook webhook accepts a request but nothing changes | Unknown IDs, wrong private state, and mismatched resource ownership are deliberately ignored. Verify the stored active ownership record and worker progress without printing state.                         |
| Provider endpoint returns `503`                       | Confirm provider-event configuration and database reachability. Do not force a success acknowledgment before durable work can be saved.                                                                     |
| Renewal is `pending`, `error`, or `unconfigured`      | Inspect `retryAt`, expiry, safe error, and lease expiry. Configure the missing service or restore credentials; let bounded recovery continue. Never overwrite the ingestion cursor with a watch history ID. |
| Realtime does not refresh the view                    | Verify the private-only setting, receive policy, session endpoint, matching user/workspace topic, server secret key, and current token. Reconnect a session after policy changes.                           |
| Archive/read/send is unauthorized                     | Reconnect with the new provider scopes; check tenant consent. Do not assume a token refresh adds permissions that were never granted.                                                                       |
| Inference is paused                                   | Respect stored cooldowns and gateway limits. Watch ingestion independently. Recovery and continuation resume paid work after the cooldown.                                                                  |
| Reply send outcome is unknown                         | Inspect the provider Sent/Drafts state through the app's reconciliation path. Do not resend blindly.                                                                                                        |

Use safe metadata such as status, counts, expiry, retry time, provider name, and HTTP status. Do not place secrets, full JWTs, provider responses, email bodies, or private client state in logs, screenshots, issue reports, or Inngest event payloads.
