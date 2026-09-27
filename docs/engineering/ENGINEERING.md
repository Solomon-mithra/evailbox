# Current architecture

Updated 2026-09-26. The authoritative implementation is in `src/`, `prisma/schema.prisma` and `prisma/migrations/`. This document intentionally avoids duplicating every schema field or API implementation.

## Interactive path

Next.js App Router serves the public homepage, pricing and sign-in, with authenticated inbox, tags, accounts, drafts and settings. `src/proxy.ts` refreshes/verifies session routing; server APIs verify the user independently and scope reads/writes to user and workspace. Supabase sign-in and provider mailbox OAuth are separate flows.

Inbox summaries, metadata, counts, settings and full message content have separate read paths. The inbox query uses stable receivedAt/id cursor pagination with 50 summaries, filtering inside Postgres and version-current classifications. The cursor is encrypted and bound to the user, workspace and filters.

TanStack Query/IndexedDB persist bounded summary queries only, partitioned by verified user and workspace. Bodies, tokens and auth sessions are excluded. Logout, disconnect and deletion clear the relevant private cache. Supabase private broadcasts contain invalidation metadata, not message data. Focus refresh and polling recover missed signals; active work polls every two seconds.

A one-second row hover or keyboard focus preloads message detail and sanitized HTML. Clicks reuse pending/completed requests. Browser memory holds at most three speculative bodies plus an open reader, evicting inactive bodies after two minutes; the summary persister excludes these queries. Up to 32 unique HTTPS images per message warm without referrers, and the reader opens with images enabled. Background tag/usage invalidations do not reload an open body. Failed requests and provider-preview fallbacks retry on open. The sandboxed iframe and document CSP remain in force; hover never marks mail read or uses AI quota.

## Background path

1. OAuth completion, sync/tag changes or authenticated mailbox notifications persist requested-work flags and increment revisions.
2. Inngest receives a user reference. Failed publication leaves a recoverable database outbox.
3. The worker reads work state and renews due mailbox subscriptions.
4. One `import-and-tag-page` step imports one provider page, commits summaries/cursor, signals readers and classifies up to 20 emails across workspaces. The 40-second deadline is shared.
5. A caller-owned in-memory map carries body/hash pairs by account/message identity. Only a matching content hash can reuse the body; the map is cleared before return, including failures. Counts, never bodies, cross step boundaries.
6. A completion step preserves newer work revisions, signals readers and schedules a continuation if work remains. Cooldowns pause inference while import can continue; failed ingestion observes backoff.

Per-user concurrency is 1. `INBOX_WORK_CONCURRENCY` defaults to 5 and is bounded to 100; available plan capacity still applies. Each user's `JEV_CONCURRENCY` defaults to 4 (maximum 8). Inngest fairness across keys is best-effort, not a guaranteed strict round-robin sequence. Least-recently-synced accounts are imported first within a user.

Initial provider pages request 20 messages. Gmail history pages count history records, which may reference more than 20 changed messages. New connections import at most 100 existing Inbox messages. Gmail then catches up from its captured history ID. Outlook downloads only lightweight delta references for the older tail to obtain a valid checkpoint; only the first 100 existing messages are hydrated and saved. New arrivals continue after that, while updates to older unknown messages cannot create local rows. [Provider contracts](PROVIDERS.md) describe cursor recovery.

Inngest schedules recovery every minute, missed-mailbox sync every 15 minutes, and subscription renewal hourly. Vercel cron configs are empty. Legacy synchronous helper functions are not the active hosted scheduling path.

## Durability and freshness

Provider cursors advance in the same transaction as saved message changes. Account leases protect sync/token rotation; user leases guard classification. Revisions prevent a worker from clearing newer requests. Expired cursors trigger resumable rescans that preserve existing triage and reconcile disappeared rows only at completion. Messages needed by reply drafts can remain hidden instead of being deleted immediately.

Classification identity includes tag version, bounded-input content hash and model/policy version. One Jev call evaluates an email against its missing tag questions. Negative and uncertain decisions are cached. Guarded batch transactions reject stale content/tag/model results and increment monthly first-classification usage without counting the same email twice.

A shared `processing_state` Jev cooldown stops further dispatch after rate limiting; in-flight waves may finish. Retries preserve completed results. A crash after provider inference but before commit may incur another paid call: exactly-once billing is not guaranteed. A retry after import committed may need to refetch a body.

## Data and privacy boundaries

- Stored: message summaries/flags/hash, classifications, tags, account identity/encrypted OAuth tokens, cursors/work state, plan/usage data and explicit user-written reply drafts.
- Not stored: imported full email bodies in Postgres, Inngest step results, the persistent browser summary cache or application logs.
- Bodies are fetched transiently for import/classification or reading; a bounded sample and tag criteria are sent to Jev. Provider retention controls are requested by the adapter; external processing still occurs.
- Provider/SDK error payloads may include private mail. Only sanitized error metadata may leave workers or enter logs.
- RLS protects direct client access. Prisma uses privileged server credentials, so application-level tenant/workspace filters and relational constraints remain essential.
- Disconnect/user deletion cleanup is explicit; provider subscription cleanup is best effort. Preserve the encryption key for existing tokens.

## Product boundaries

Manual replies, read/archive/trash actions require explicit user actions and granted provider scopes. Ambiguous sends are reconciled rather than automatically retried. Personal/Work rules never mix. Notifications/digests are retired; legacy database delivery tables are inert. Stripe billing and usage enforcement activate only with `BILLING_ENABLED=true`. Trials and paid periods gate AI processing; reading and replies remain available. Billing writes and classification saves lock the owning user so first-classification allowances are consumed atomically. Webhooks fetch current Stripe state under that lock and require an active subscription with a paid latest invoice. See [billing](BILLING.md).

Use [status](../STATUS.md) for evidence, [environment](ENVIRONMENT.md) for variable names, [service setup](SERVICE_SETUP.md) for activation and [runbook](RUNBOOK.md) for operations. Tests and local key configuration do not establish production readiness.
