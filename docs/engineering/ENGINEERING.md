# Engineering design

Source of truth: `prisma/schema.prisma`, `prisma/migrations/20260921000000_init/migration.sql`, `src/app/api/[...path]/route.ts` and service modules. Reviewed 2026-09-21. A source implementation is not external validation; deployment, live OAuth, mailbox, model and delivery checks require separate evidence.

## Architecture

```mermaid
flowchart LR
  B[Browser: React Query workspace] -->|same-origin HTTPS| N[Next.js App Router / Node API]
  B -->|explicit demo only| D[Local fictional workspace]
  N --> A[Supabase Auth: verified session]
  N --> P[Prisma: tenant-scoped queries]
  P --> DB[(Supabase PostgreSQL + RLS)]
  N --> O[Independent PKCE mail OAuth]
  O --> G[Gmail API]
  O --> M[Microsoft Graph]
  N --> S[Bounded sync and classification]
  S --> G
  S --> M
  S --> J[AI Gateway native Jev evaluation]
  C[Vercel authenticated cron] --> N
  N --> W[VAPID Web Push]
  N --> R[Resend digest]
```

UI queries and mutations use JSON APIs; live server-side sessions are verified with Supabase `getUser()`. `proxy.ts` refreshes auth cookies and protects private page navigation, while APIs enforce authentication independently. Demo mode is explicit (`APP_MODE=demo`); it does not connect to the database/providers and live operations fail with `DEMO_MODE` rather than pretending to succeed.

```mermaid
sequenceDiagram
  participant UI as Signed-in browser
  participant API as Mail OAuth endpoints
  participant P as Google or Microsoft
  participant DB as Database
  UI->>API: GET accounts/provider/auth
  API->>API: Generate verifier; encrypted user/provider/state; 10-minute cookie
  API-->>UI: Redirect with PKCE S256
  UI->>P: Consent to read-only mail
  P-->>API: Code + state callback
  API->>API: Match cookie; validate state age, provider and user
  API->>P: Exchange code + verifier
  API->>P: Get authorized mailbox identity
  API->>DB: Upsert account with AES-GCM encrypted tokens
  API-->>UI: Redirect to Accounts
```

```mermaid
flowchart TD
  A[Manual request / daily trigger / minute worker] --> B[Claim user work lease then mailbox lease]
  B --> C[Refresh expiring token if needed]
  C --> D[Fetch one provider page]
  D --> E[Transaction: upsert observed mail, terminal rescan cleanup, persist cursor]
  E --> F{More pages and budget?}
  F -->|yes| D
  F -->|no| G[Release owned lease]
  G --> H[Find missing or stale email/tag evaluations]
  H --> I[One email call with independent missing-tag questions]
  I --> J[Persist match / no_match / uncertain with tag version]
  J --> K[Eligible high-priority push]
  D -->|error| L[Safe error; retain cursor for retry]
```

## Module ownership

- `env.ts` and instrumentation validate configuration; demo/live behavior must be intentional.
- `auth.ts`, `proxy.ts`, `oauth.ts`, `crypto.ts`: sessions, protected pages, provider connection, encrypted credentials and state.
- `providers/`: bounded external OAuth/mail protocols. See [PROVIDERS.md](PROVIDERS.md) for cursor and HTTP rules.
- `workspace.ts`, `validation.ts`, API dispatch: public projections, tenant-scoped reads/mutations and request contracts.
- `work-queue.ts`: durable requests/revisions, user leases, backoff and oldest-attempt scheduling.
- `sync.ts`: account lease ownership, refresh, transactional pages, terminal rescan reconciliation, deadline/page limits and classification handoff.
- `classification.ts`, `jev.ts`: versioned evaluation, retryable errors and deterministic probability traces.
- `notifications.ts`, `digest.ts`, `notification-utils.ts`: push eligibility, timezone scheduling, delivery claims and escaping.
- Client hooks/components: React Query cache, local demo operations, forms, navigation and display. Server secrets never cross the boundary.

## API contract

All JSON success responses use `{ "data": ... }`; failures use `{ "error": { "code", "message", "details"? } }`. Success responses use `Cache-Control: no-store`. Standard errors include 400 invalid input/JSON, 401 unauthenticated, 403 invalid origin, 404 tenant-scoped not found, 409 conflict, 413 oversized body, 500 safe internal error and 503 live action in demo mode. Every mutation requires an Origin exactly matching `NEXT_PUBLIC_APP_URL`; JSON bodies are bounded to 20,000 characters. Redirect endpoints return redirects rather than the JSON envelope.

| Method and endpoint                  | Authentication            | Input / behavior                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                    | Public                    | `{status, mode}`; does not prove DB/provider health.                                                                                                                                                                 |
| `POST /api/auth/signin`              | Public, live, same-origin | Starts Supabase Google OAuth; returns redirect URL.                                                                                                                                                                  |
| `GET /api/auth/callback`             | OAuth code                | Exchanges sign-in code; redirects to callback page or error sign-in.                                                                                                                                                 |
| `GET /api/auth/me`                   | User                      | Verified application user.                                                                                                                                                                                           |
| `POST /api/auth/signout`             | User                      | Clears Supabase session.                                                                                                                                                                                             |
| `GET /api/workspace`                 | User                      | Combined workspace and paged email query described below.                                                                                                                                                            |
| `GET /api/tags`                      | User                      | Own tags ordered by creation.                                                                                                                                                                                        |
| `POST /api/tags`                     | User                      | Full tag input; maximum 30 tags; returns 201.                                                                                                                                                                        |
| `GET /api/tags/:id`                  | User                      | Own tag or 404.                                                                                                                                                                                                      |
| `PATCH /api/tags/:id`                | User                      | Partial tag input; increments version, removes existing tag classifications transactionally.                                                                                                                         |
| `DELETE /api/tags/:id`               | User                      | Deletes own tag; classification cascade.                                                                                                                                                                             |
| `GET /api/accounts`                  | User                      | Public account fields only: id, provider, email, lastSync, syncError.                                                                                                                                                |
| `GET /api/accounts/gmail/auth`       | User                      | Starts independent Gmail PKCE consent redirect.                                                                                                                                                                      |
| `GET /api/accounts/gmail/callback`   | User + OAuth state        | Validates state and connects Gmail.                                                                                                                                                                                  |
| `GET /api/accounts/outlook/auth`     | User                      | Starts Microsoft PKCE consent redirect.                                                                                                                                                                              |
| `GET /api/accounts/outlook/callback` | User + OAuth state        | Validates state and connects Outlook.                                                                                                                                                                                |
| `DELETE /api/accounts/:id`           | User                      | Removes own mailbox and cached mail/classifications; does not revoke remote consent.                                                                                                                                 |
| `POST /api/sync`                     | User                      | `{accountId?}`; durably requests provider sync and attempts a bounded user-worker pass; busy users return queued/pending.                                                                                            |
| `POST /api/classify`                 | User                      | `{emailId, tagId?}`; explicit email required; force requested evaluation.                                                                                                                                            |
| `POST /api/classify/batch`           | User                      | `{emailId?, emailIds?, tagId?}`; max 20 explicit IDs; without IDs process up to 100 pending candidate emails. User work lease prevents ordinary concurrent evaluation; durable pending work continues automatically. |
| `GET /api/emails`                    | User                      | Same aggregate workspace response/filter query as `/api/workspace`, not a bare array.                                                                                                                                |
| `GET /api/emails/:id`                | User                      | Own email with current-version tag classifications.                                                                                                                                                                  |
| `PATCH /api/emails/:id`              | User                      | `{handled: boolean}`; local state only.                                                                                                                                                                              |
| `GET /api/settings`                  | User                      | Creates defaults if absent; returns safe preferences projection.                                                                                                                                                     |
| `PATCH /api/settings`                | User                      | Partial preference input; no server secret fields.                                                                                                                                                                   |
| `GET /api/push/key`                  | User                      | Public VAPID key.                                                                                                                                                                                                    |
| `POST /api/push/subscriptions`       | User                      | `{endpoint, keys:{p256dh,auth}}`; allowed push-provider host, user-bound upsert; 201.                                                                                                                                |
| `DELETE /api/push/subscriptions`     | User                      | `{endpoint}`; deletes only own subscription.                                                                                                                                                                         |
| `POST /api/unsubscribe`              | Public token, same-origin | `{token: UUID}`; disables daily digest; web landing page posts it.                                                                                                                                                   |
| `DELETE /api/user`                   | User                      | `{confirm:"DELETE"}`; deletes Supabase identity, application user/cascades, session.                                                                                                                                 |
| `GET /api/cron/sync`                 | Cron bearer secret        | Daily marks accounts/users requested, then starts a bounded worker pass; demo returns skipped.                                                                                                                       |
| `GET /api/cron/work`                 | Cron bearer secret        | Every-minute worker drains due durable requested work, oldest attempt first.                                                                                                                                         |
| `GET /api/cron/digest`               | Cron bearer secret        | Sends due digests; demo returns skipped.                                                                                                                                                                             |

Workspace query: `search` ≤200 characters; `tag` and `account` IDs ≤100; `range=week|month|all`; zero-based `page` 0–10000. Filters compose. Page size is 50; order is receivedAt descending then id descending. Search covers subject, sender and senderName. The response includes `user` (including workRequested), `tags`, safe `accounts`, `emails`, `preferences`, `total`, `page`, `pageSize`, `needsYou`, `needsTotal` and `tagCounts`. Workspace email bodies are returned as null; full detail is fetched separately. Stale classifications are filtered out of returned email details. UI-only grouping controls must not be mistaken for undocumented query parameters.

Tag input: trimmed name 1–60, description ≤500, prompt 10–2000, priority HIGH/MEDIUM/LOW, ≤30 keywords of 1–80 chars, ≤30 valid email sender hints. Unknown fields rejected. Preferences: browserPush/dailyDigest booleans, digestTime `HH:mm`, valid IANA timezone, integer minConfidence 0–100, refreshMinutes 1–60. The notification minimum is separate from the classification decision threshold (default 80): lowering notification minimum does not turn a stored uncertain result into a match.

## Relational model and field dictionary

`User.id` is the Supabase Auth UUID. Other model IDs are application-generated CUID strings. All application relations cascade on delete; the SQL migration also links users.id to auth.users.id with ON DELETE CASCADE. `Priority` values are HIGH/MEDIUM/LOW; `Provider` values are GMAIL/OUTLOOK. `?` means nullable, `[]` means a PostgreSQL array, and relation fields are Prisma navigation properties rather than extra SQL columns.

### User

| Field                  | Type                    | Meaning                                                                                                  |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`                   | `String`                | Supabase Auth user UUID and primary key                                                                  |
| `email`                | `String`                | Unique sign-in email / digest recipient                                                                  |
| `lastBackgroundSyncAt` | `DateTime?`             | Last worker attempt; oldest/null requested users are selected first for fairness                         |
| `workRequested`        | `Boolean`               | Durable outstanding-work flag; defaults false                                                            |
| `workRevision`         | `Int`                   | Request generation counter; increments on new work and guards completion against clearing newer requests |
| `workLeaseId`          | `String?`               | Current random user-worker owner ID                                                                      |
| `workLeaseUntil`       | `DateTime?`             | User-worker lease expiry, allowing crash recovery                                                        |
| `workNotBefore`        | `DateTime`              | Earliest automatic retry time; defaults now                                                              |
| `workFailures`         | `Int`                   | Consecutive failed-pass counter used for backoff; defaults zero                                          |
| `createdAt`            | `DateTime`              | Application user creation time                                                                           |
| `tags`                 | `Tag[]`                 | Owned tags                                                                                               |
| `accounts`             | `EmailAccount[]`        | Connected mailboxes                                                                                      |
| `emails`               | `Email[]`               | Cached messages                                                                                          |
| `classifications`      | `EmailClassification[]` | Owned evaluation records                                                                                 |
| `notificationPref`     | `NotificationPref?`     | Optional one-to-one delivery settings                                                                    |
| `subscriptions`        | `PushSubscription[]`    | Browser/device push subscriptions                                                                        |
| `digestHistory`        | `DigestHistory[]`       | Per-local-date delivery records                                                                          |

### Tag

| Field             | Type                    | Meaning                                                             |
| ----------------- | ----------------------- | ------------------------------------------------------------------- |
| `id`              | `String`                | Tag primary key                                                     |
| `userId`          | `String`                | Owning user UUID                                                    |
| `name`            | `String`                | Displayed tag name                                                  |
| `nameKey`         | `String`                | Lowercase name used for per-user uniqueness                         |
| `description`     | `String`                | Optional user-facing description; defaults empty                    |
| `prompt`          | `String`                | User-defined semantic classification criteria                       |
| `priority`        | `Priority`              | HIGH/MEDIUM/LOW; default MEDIUM                                     |
| `keywords`        | `String[]`              | Supporting keyword hints; default empty array                       |
| `senders`         | `String[]`              | Supporting sender-address hints; default empty array                |
| `version`         | `Int`                   | Evaluation invalidation version; starts at 1 and increments on edit |
| `createdAt`       | `DateTime`              | Creation time                                                       |
| `updatedAt`       | `DateTime`              | Automatically updated modification time                             |
| `user`            | `User`                  | Owning user relation                                                |
| `classifications` | `EmailClassification[]` | Evaluations for this tag                                            |

### EmailAccount

| Field             | Type        | Meaning                                                                                                                                |
| ----------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `String`    | Mailbox primary key                                                                                                                    |
| `userId`          | `String`    | Owning user UUID                                                                                                                       |
| `provider`        | `Provider`  | GMAIL or OUTLOOK                                                                                                                       |
| `email`           | `String`    | Provider-verified mailbox address                                                                                                      |
| `accessToken`     | `String`    | Versioned AES-256-GCM ciphertext, never public API data                                                                                |
| `refreshToken`    | `String?`   | Optional encrypted offline/rotated refresh token                                                                                       |
| `expiresAt`       | `DateTime`  | Access-token expiry instant                                                                                                            |
| `cursor`          | `String?`   | Opaque adapter-controlled JSON sync checkpoint                                                                                         |
| `rescanStartedAt` | `DateTime?` | Persisted reconciliation start; unseen rows are removed only at terminal rescan completion                                             |
| `syncRequested`   | `Boolean`   | Account has requested/unfinished provider synchronization; defaults true                                                               |
| `syncRevision`    | `Int`       | Account request generation; increments on sync requests and guards terminal flag clearing against losing newer requests; defaults zero |
| `lastSync`        | `DateTime?` | Last successfully persisted page time, not necessarily full round completion                                                           |
| `syncError`       | `String?`   | Safe user-facing last failure summary                                                                                                  |
| `syncLeaseUntil`  | `DateTime?` | Expiry of claimed sync lock                                                                                                            |
| `syncLeaseId`     | `String?`   | Random current sync-owner identifier                                                                                                   |
| `createdAt`       | `DateTime`  | Connection record creation time                                                                                                        |
| `user`            | `User`      | Owning user relation                                                                                                                   |
| `emails`          | `Email[]`   | Mailbox message cache                                                                                                                  |

### Email

| Field               | Type                    | Meaning                                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `id`                | `String`                | Local email primary key                                                               |
| `userId`            | `String`                | Owning user UUID                                                                      |
| `accountId`         | `String`                | Mailbox ID paired with userId in tenant-consistent foreign key                        |
| `providerMessageId` | `String`                | Remote message ID; unique within account                                              |
| `lastSeenAt`        | `DateTime`              | Last provider-page observation, used for terminal rescan reconciliation; defaults now |
| `subject`           | `String`                | Bounded plain-text subject                                                            |
| `sender`            | `String`                | Normalized sender email string                                                        |
| `senderName`        | `String`                | Displayed sender name                                                                 |
| `snippet`           | `String`                | Bounded plain-text preview                                                            |
| `body`              | `String?`               | Optional bounded plain-text body; never HTML                                          |
| `receivedAt`        | `DateTime`              | Provider receipt timestamp                                                            |
| `isRead`            | `Boolean`               | Observed remote read status                                                           |
| `handled`           | `Boolean`               | Local triage flag; default false; no remote write                                     |
| `webUrl`            | `String`                | Safe link back to provider mailbox/message                                            |
| `createdAt`         | `DateTime`              | Local insertion time                                                                  |
| `user`              | `User`                  | Owning user relation                                                                  |
| `account`           | `EmailAccount`          | Mailbox relation with composite tenant foreign key                                    |
| `classifications`   | `EmailClassification[]` | Per-tag evaluations                                                                   |

### EmailClassification

| Field        | Type        | Meaning                                                              |
| ------------ | ----------- | -------------------------------------------------------------------- |
| `id`         | `String`    | Evaluation record primary key                                        |
| `userId`     | `String`    | Owning user UUID                                                     |
| `emailId`    | `String`    | Local email ID with tenant-consistent relation                       |
| `tagId`      | `String`    | Tag ID with tenant-consistent relation                               |
| `tagVersion` | `Int`       | Tag version evaluated; stale versions hidden                         |
| `matched`    | `Boolean`   | True only for policy-approved match                                  |
| `confidence` | `Float`     | P(match) times 100; SQL range 0–100                                  |
| `decision`   | `String`    | match, no_match or uncertain from application policy                 |
| `reasoning`  | `String`    | Deterministic probability/threshold trace, not generated explanation |
| `notifiedAt` | `DateTime?` | Push claim/delivery marker; null when eligible for retry             |
| `createdAt`  | `DateTime`  | Initial evaluation record insertion time; used by digest window      |
| `user`       | `User`      | Owning user relation                                                 |
| `email`      | `Email`     | Evaluated email relation                                             |
| `tag`        | `Tag`       | Evaluated tag relation                                               |

### NotificationPref

| Field              | Type      | Meaning                                            |
| ------------------ | --------- | -------------------------------------------------- |
| `id`               | `String`  | Preference primary key                             |
| `userId`           | `String`  | Unique owner UUID; one settings row per user       |
| `browserPush`      | `Boolean` | Opt-in push flag; default false                    |
| `dailyDigest`      | `Boolean` | Opt-in daily digest flag; default false            |
| `digestTime`       | `String`  | Local HH:mm schedule; default 09:00                |
| `timezone`         | `String`  | IANA timezone; default UTC                         |
| `minConfidence`    | `Int`     | Delivery confidence floor 0–100; default 80        |
| `refreshMinutes`   | `Int`     | Workspace query refresh interval 1–60; default 5   |
| `unsubscribeToken` | `String`  | Unique random UUID bearer token for digest opt-out |
| `user`             | `User`    | Owning user relation                               |

### PushSubscription

| Field       | Type       | Meaning                              |
| ----------- | ---------- | ------------------------------------ |
| `id`        | `String`   | Subscription primary key             |
| `userId`    | `String`   | Owning user UUID                     |
| `endpoint`  | `String`   | Unique browser push-service endpoint |
| `p256dh`    | `String`   | Browser public encryption key        |
| `auth`      | `String`   | Browser push auth secret             |
| `createdAt` | `DateTime` | Subscription insertion time          |
| `user`      | `User`     | Owning user relation                 |

### DigestHistory

| Field        | Type        | Meaning                                                                                         |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------- |
| `id`         | `String`    | Delivery primary key; incorporated into provider idempotency key                                |
| `userId`     | `String`    | Owning user UUID                                                                                |
| `localDate`  | `String`    | Scheduled local calendar date; unique per user                                                  |
| `status`     | `String`    | pending, sent or failed application status; default pending                                     |
| `leaseUntil` | `DateTime`  | Concurrent delivery claim expiry                                                                |
| `sentAt`     | `DateTime?` | Successful provider acceptance timestamp, if any                                                |
| `providerId` | `String?`   | Optional Resend message identifier                                                              |
| `windowEnd`  | `DateTime`  | Immutable exclusive classification cutoff captured when this digest date is queued; default now |
| `payload`    | `Json?`     | Complete persisted Resend request body; null until assembled, reused unchanged for retries      |
| `user`       | `User`      | Owning user relation                                                                            |

Constraints: unique user email; `(userId,nameKey)` tag name; `(userId,provider,email)` mailbox identity; `(accountId,providerMessageId)` message identity; `(emailId,tagId)` classification identity; unique settings user/unsubscribe token; unique push endpoint; `(userId,localDate)` digest identity. Compound `(id,userId)` unique keys support tenant-consistent account/email/tag foreign keys. Indexes support user/date inbox reads, user/matched/confidence evaluation reads and user subscriptions. The SQL migration additionally enforces confidence and refresh ranges.

## Security and consistency

RLS is enabled on every application table. Authenticated direct clients have owner-only SELECT policies for users, tags, emails and classifications; writes are revoked. Direct anon/authenticated access to account credentials, preferences, subscriptions and delivery history is revoked. **Prisma uses a privileged connection, which can bypass RLS.** Every server read/write must scope by verified userId; composite foreign keys and RLS are defense layers, not substitutes. Test both direct database policies and all server endpoints with two independent users. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

Provider tokens and OAuth state use AES-256-GCM with random nonces and an authentication tag. Secrets are server-only. PKCE state is user/provider-bound, cookie-bound and expires after ten minutes. Mutations check same-origin; email content is treated as text; provider redirects are blocked; Graph cursor host/path validation prevents bearer-token leakage. Existing CSP permits inline scripts/styles and unsafe-eval for the current runtime configuration, so it is defense-in-depth rather than a strict nonce-based policy. Future hardening must remain compatible with Next assets.

Sync takes a two-minute account lease with an owner ID, processes up to four pages per account within an overall 45-second budget, and commits pages transactionally with cursor checkpoints. Provider requests inherit the shared sync deadline and stop new requests/retries when it expires; database work and final cleanup still need headroom within the deployment's function duration. Classification selects up to 100 candidate emails, collecting only missing pairs for each email. One native Jev call shares that email across up to 30 independent tag questions; all completed current-version decisions, including no-match and uncertain, are reused. Each result write locks/checks the tag version so edits cannot make an old in-flight decision current. User workRequested/revision fields, two-minute worker leases and workNotBefore/backoff persist continuation across invocations. The every-minute worker selects up to 100 due users by oldest/null lastBackgroundSyncAt; daily sync marks provider work rather than restarting imports. A crash after inference but before persistence may still cause another call. See [LARGE_INBOXES.md](LARGE_INBOXES.md) for queue fields, reconciliation, fairness, retention and exactly-once limits.

## Notifications and reliability boundaries

Push requires browserPush opt-in, a stored subscription, HIGH-priority current-version matched classification, configured minimum confidence, unread/unhandled email and null notifiedAt. A conditional marker claims work; dead 404/410 subscriptions are removed; if no delivery succeeds the owned marker is cleared, including cooperative deadline exits. Push defaults to a ten-second budget and accepts the caller's shared deadline; sends use the remaining budget. A process crash after claiming but before delivery can leave a marker without delivery; this is not an exactly-once guarantee.

Digest queues due opted-in users in their IANA timezone and retries previously queued failed/pending work outside the scheduling window. A unique local-date record is claimed with an expiring lease. It paginates every matching current-version classification in the half-open interval from the previous successful windowEnd (24 hours before the current cutoff initially) to this record's immutable windowEnd. It never sends a partially assembled page on deadline expiry. Complete escaped HTML and the exact Resend request body are persisted before sending; retries reuse that payload and a stable history-derived idempotency key. Classifications created during delivery remain beyond the cutoff for the next digest. Successful API acceptance is recorded separately in sentAt; inbox receipt is a separate external observation. Current `createdAt` tracks insertion, not every forced reclassification update. See [RUNBOOK.md](RUNBOOK.md) for timezone/DST, missed-run and delivery failure limits.

## Verification policy

Fixture tests cover crypto/state boundaries, validation, provider normalization/pagination/security, native Jev wire format and digest date logic. They do not establish consent approval, token refresh behavior on real accounts, semantic accuracy, provider delivery or deployed cron operation. CI runs in explicit demo mode. The connected Vercel Hobby account rejected the configured live minute/15-minute schedules; the explicit demo deployment route uses vercel.demo.json with no crons and does not enable scheduled live processing. Local PGlite tests execute the migration/RLS with a Supabase auth scaffold; this does not prove hosted Supabase configuration. Browser QA was interrupted by user control, and unexecuted checks remain pending. Live configuration has not yet been supplied. Record local checks and externally observed checks separately; never mark unrun checks passing.
