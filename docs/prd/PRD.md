# evailbox product requirements

Revision: 2026-09-25. Scope includes the approved Phase 7 fast-inbox and plan-preview work. This document defines intended behavior and acceptance; it is not proof of live validation. See the phase documents and runbook for executable checks.

## Problem and audience

People managing busy personal and work inboxes across several email accounts need a focused view of messages that meet their own criteria: urgent customer issues, invoices, hiring conversations, or project updates. Existing folder rules struggle with semantic criteria. evailbox lets an individual define a tag in ordinary language and evaluate incoming email against it while retaining a clear route back to the provider.

## Product outcome

A signed-in user connects Gmail or Outlook, creates up to 30 tags per workspace, synchronizes messages, and reviews matches with a probability and policy trace. The product supports uncertain results and visible failures; it must never claim zero semantic errors or imply that a probability is calibrated accuracy. Phase 7 removes notifications and digests. Users can explicitly reply/reply-all, save drafts, archive and mark mail read through the provider. “Handled” remains an independent local triage flag. No automated outbound sending is included.

## User journeys and acceptance

| Journey                         | Requirement                                            | Acceptance                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover the product            | Public homepage at `/`                                 | Explain email matching in plain language with labeled Personal/Work examples; **Open inbox** opens `/inbox`.                                                                                                                                                          |
| Separate work and personal mail | Two built-in workspaces                                | Selection persists in this browser; accounts, tags, email and matching remain separate; existing data stays Personal.                                                                                                                                                 |
| Explore safely                  | Explicit demo with isolated fictional data             | Demo is labeled; demo edits cannot access production mail; missing live credentials never enable demo implicitly.                                                                                                                                                     |
| Sign in                         | Google authentication via Supabase                     | Session is verified server-side; unsigned private navigation redirects; private APIs reject unauthenticated calls.                                                                                                                                                    |
| Connect mail                    | Independent Gmail/Outlook OAuth                        | PKCE and expiring state bind to the signed-in user; provider identity determines mailbox address; encrypted tokens never appear in public API responses.                                                                                                              |
| Define a tag                    | Name, description, prompt, priority, keywords, senders | Validated create/edit/delete; names unique ignoring case within a user and workspace; edits invalidate prior classification versions; 30-tag limit enforced per workspace; cards expose the rule, accurate workspace-wide count and independent edit/delete controls. |
| Synchronize                     | Paginated Inbox import and incremental changes         | Cursor persists with message changes; deletion/read changes applied; errors are visible and retryable; another tenant's account cannot be synchronized.                                                                                                               |
| Review Inbox                    | Search and combined account/tag/date filters           | Results reflect combined filters and stable pagination; email opens in a detail view; local handled state persists.                                                                                                                                                   |
| Understand classification       | Native Jev evaluation                                  | Typed probability converted by explicit policy: ≥80% match, ≤20% no-match, otherwise uncertain; trace identifies threshold policy, not invented model rationale.                                                                                                      |
| Return to mail                  | Provider link                                          | Gmail/Outlook link opens safely; provider HTML is sanitized in a sandboxed reader with external images disabled by default.                                                                                                                                           |
| Manage account                  | Disconnect mailbox or delete user                      | Disconnect removes cached mailbox data; user deletion clears application records through cascades and deletes Supabase identity.                                                                                                                                      |

## Scope and boundaries

The Gmail initial Inbox window is 30 days, with later history changes tracked. Outlook initial synchronization traverses the Inbox folder, not every folder. Messages may have a snippet but no body when only HTML is available. Attachment uploads, AI-written replies, team sharing, payment collection, usage blocking, and training on user feedback are not included. Manual replies and provider read/archive actions are added in Phase 7.

Phase 7 separates interactive loading from processing. `/api/sync` durably queues work and returns 202 without fetching mail or running Jev inline. Inngest runs separate resumable mailbox-fetch and classification steps, retaining checkpoints, duplicate protection, leases, revision guards and cooldowns. Provider events use Gmail Watch + authenticated Google Pub/Sub and Outlook Graph subscriptions, with automatic renewal and periodic incremental recovery. These external services will be connected later by the user; setup instructions and tests must be delivered now.

The inbox loads 50 body-free summaries and current classifications with stable receivedAt/id cursor pagination. Metadata, counts, settings and message content have independent requests. Safe IndexedDB/TanStack Query persistence is partitioned by authenticated user and workspace, restored without blocking on background refresh, and cleared across tabs on logout, disconnect or deletion. Authenticated Supabase Realtime signals trigger affected-query refresh; focus/poll recovery covers missed signals.

Task 1 implementation evidence (2026-09-25): `/api/inbox` selects summary columns only, returns at most 50 messages with a tamper-resistant cursor bound to the user, workspace and filters, and excludes stale tag-version decisions. Metadata, counts and settings use separate read endpoints. Server-verified shell identity gates restoration of at most eight recent summary queries per user/workspace for 24 hours; bodies, credentials, auth sessions, metadata and mutations are excluded. Logout/deletion clear user data and disconnect clears workspace data through IndexedDB and cross-tab signals. Cached summaries remain usable when secondary requests or refresh fail. PGlite pagination/isolation/index fixtures and cache/auth/UI regressions pass; live latency and browser acceptance remain part of the final integration task. Content/model freshness and Realtime are completed by their later tasks.

Classification uses bounded concurrency, recent-first selection, guarded batch saves and content/tag/model versions. Unchanged mail is not repeatedly evaluated. Track cached rendering, server reads and new-mail processing separately. Sub-100-ms is a warm-cache rendering target, not a promise for first visits or fresh inference. Redis is deferred until indexed reads are measured.

## Pricing and account management

Starter is displayed at **$14/month**, with an advertised allowance of **5,000 newly processed emails/month** across connected accounts. Heavy is **$24/month**, with **10,000**. Prices and allowances are a preview: checkout, charging and usage enforcement are OFF. Reading, replying and syncing must not be blocked by a paywall. The pricing page and account screen must state current access and preview status honestly; do not show a functioning billing portal or collected subscription where none exists.

Plans are trusted server-side records, never user-editable metadata. Grant the existing verified Supabase identity `solomonmithra99@gmail.com` Heavy access using admin metadata and application data, preserving unrelated metadata and recording verification. Account management includes profile/session information, plan/usage visibility, mailbox connect/reconnect/disconnect, preferences, logout and confirmed account deletion. Provider subscription cleanup and private-cache removal are part of disconnection/deletion.

## Reply acceptance

Users can write a manual reply or reply-all, save/reopen a draft, see the sending account and recipients, and explicitly send within the conversation. Preserve provider threading and Sent state, show recoverable permission/reconnect failures, and avoid duplicate sends after ambiguous network failures. Drafts and actions are tenant/workspace scoped. Provider sending is tested with fixtures, not real outgoing email during implementation.

## Data and privacy requirements

Store only the email fields needed for the workspace and a bounded plain-text body. Provider tokens use authenticated AES-256-GCM encryption. Never send provider tokens to Jev. Jev receives a bounded email sample and the user's tag criteria through the configured server-side Gateway; the request sets Zero Data Retention and disallows prompt training. These controls and actual provider routing require external verification. Users must understand that semantic classification sends email content to a third-party model service.

All server data operations enforce the authenticated user's ID. PostgreSQL RLS adds protection for direct client access, but the privileged server connection can bypass it. Composite foreign keys prevent cross-tenant and cross-workspace email/account/tag associations. General preferences, plan access and user deletion remain account-wide. Browser persistence never contains provider credentials, auth sessions or full message bodies. Logs exclude bodies, token values and raw upstream errors. Account deletion is destructive and requires the literal confirmation `DELETE`.

## Experience and accessibility

Use local Inter typography, forest navigation, lime selection and semantic priority accents. App pages share a cool off-white canvas while page-heading boxes retain their gradients; the landing page has its own green hero backdrop. White reading surfaces, readable type sizes and compact message rows support frequent use. Shared local Gmail/Outlook SVGs identify providers alongside text. See the [theme specification and measured contrast](../engineering/THEME.md). Desktop and mobile navigation should expose the same destinations. Loading, empty, disconnected, permission-denied and failed-sync states are first-class. Dialogs need labels, keyboard focus, Escape handling and visible focus states. Probability and priority must remain understandable without color alone. Browser checks are evidence only when recorded after execution.

## Success measurement

Track successful OAuth connection rate, completed sync rounds, sync errors and backlog, classification latency/failures/uncertain share, user-reviewed classification quality, warm-cache render time, server read time, arrival-to-classification latency, processing backlog, draft/send failures, plan usage, and successful deletion. Define accuracy targets only after an authorized labeled-email evaluation. Do not treat fixture test success as measured model accuracy. Cost depends on mail volume, tag count, reclassification, retries and external pricing; no fixed operating-cost promise is made.

## Release gates

Local: tests, typecheck, lint, production build and browser journeys pass with recorded commands/results. External: real two-tenant isolation, provider consent/refresh/deltas, Jev evaluation, Inngest delivery, authenticated provider webhooks, renewal/recovery, Realtime isolation, safe reply reconciliation, migration/RLS, deployment configuration and 24-hour monitoring remain pending until explicitly exercised. A deployable demo is not a verified live email service. Production publishing is a separate final approval step in the runbook.

### Phase 7 implementation evidence — asynchronous work

The enqueue-only Sync contract and private Realtime invalidations are implemented. Fetching can proceed during an inference cooldown; classification remains resumable and revision guarded. Live activation is pending user-supplied Inngest keys and endpoint registration.

### Phase 7 implementation evidence — provider events

Gmail push and Outlook subscription lifecycle recovery are implemented with encrypted private state, account ownership checks, shared-mailbox fanout and lease-protected disconnect cleanup. Provider setup and acceptance remain separate from fixture verification.

### Phase 7 implementation evidence — notifications retired

Browser push, in-app priority toasts, daily digests, unsubscribe and their delivery routes, environment variables, `web-push` dependency and Vercel cron schedules are removed. Settings keep only the inbox refresh preference; retired fields are rejected by validation. Returning browsers unsubscribe and unregister the old `/sw.js` worker. Historical preference/delivery tables remain inert rather than being dropped.

### Phase 7 implementation evidence — plans and account management

`/pricing` is public and indexable, lists Starter ($14, 5,000 emails) and Heavy ($24, 10,000) and states that billing and allowances are off. Settings shows profile, trusted plan and source, and UTC-month first-classification usage; users can save a display name and a non-billing plan preference only. `plan`/`planSource` are not writable through the API and are denied to authenticated database clients. `scripts/grant-plan.ts` grants access through application data plus Supabase `app_metadata`, preserving other metadata, and verifies both writes. The owner grant has not run because the hosted database does not yet have the Phase 7 migrations.
