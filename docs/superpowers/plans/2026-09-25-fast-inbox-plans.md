# Fast Inbox and Plan Preview Implementation Plan

> **For agentic workers:** Use executing-plans for integration and focused review agents for independent scopes. Steps use checkbox tracking below. The approved design is in ../specs/2026-09-25-fast-inbox-design.md. Update PRD/phase evidence and commit EACH task after validation; do not stage unrelated files.

**Goal:** Deliver a responsive cached inbox with durable background processing, provider change events, manual replies, account management and unenforced $14/$24 plans.

**Architecture:** Postgres remains authoritative; IndexedDB restores safe per-user/workspace summaries. Inngest runs bounded resumable jobs driven by authenticated provider events and recovery schedules. Supabase Realtime invalidates cached queries. Provider actions and trusted plan management remain server-only.

**Tech Stack:** Next.js 16.3.5 (read installed docs), Prisma 6, Supabase Auth/Postgres/Realtime, TanStack Query v5 persistence, IndexedDB, Inngest, Gmail/Graph, Jev.

## Tasks

- [x] 0. Review and checkpoint existing changes. Baseline: 165 tests pass, typecheck/lint pass; commit ef7a40f.
- [x] 1. Lightweight reads and persistent cache. Verified: 195 full-suite tests (86 focused), typecheck and lint on the isolated task tree; cursor SQL/index migrations exercised in PGlite. Browser/latency validation stays in Task 8.
  - Files: src/lib/workspace.ts, src/lib/inbox.ts, src/hooks/useFetch.ts, src/hooks/useAuth.ts, src/components/providers.tsx, inbox.tsx, workspace-shell.tsx, src/lib/auth.ts, src/proxy.ts, Prisma read indexes and focused tests.
  - Add /api/inbox, /api/workspace/metadata, /api/workspace/counts. Cursor is validated receivedAt/id with tenant/workspace filtering; take 51, return 50 plus nextCursor, no body fetch.
  - Restore safe cached summaries only after identifying the authenticated user; keep user/workspace in every private query key. Never persist bodies, credentials or auth session. Clear affected caches across tabs on logout/disconnect/deletion.
  - Verify unchanged authenticated reads do not write users; every private API still verifies session. Test cursor tie ordering and tampering, summary projection, separate metadata/count queries and storage failure fallback.
- [x] 2. Async jobs and Realtime. Committed 0f25fc6: 16 job/route/Realtime tests, typecheck and targeted lint; Inngest activation pending user setup.
  - Files: src/lib/inngest/*, src/lib/work-queue.ts, src/lib/sync.ts, src/app/api/inngest/route.ts, src/app/api/[...path]/route.ts, src/lib/realtime.ts, client subscriber, tests/jobs.test.ts.
  - Sync durably marks work and returns 202. Inngest dispatch failure leaves recoverable work, not lost requests. Fetch and classify run separate checkpointed steps, continue backlog automatically, respect cooldowns and lease revisions.
  - Private Realtime signals contain only workspace/revision, with own-user authorization. A missed signal is repaired by refocus/polling.
- [x] 3. Provider triggers and renewal. Committed 11b9559: 45 webhook/renewal/credential/disconnect fixtures; SERVICE_SETUP published; live activation pending.
  - Files: src/lib/mailbox-subscriptions.ts, src/lib/providers/webhooks.ts, src/app/api/webhooks/{gmail,outlook}/route.ts, Prisma subscription state, renewal/recovery jobs, tests/mailbox-subscriptions.test.ts.
  - Verify Google's Pub/Sub JWT issuer/audience/service-account identity and exact subscription; validate Graph clientState and subscription identity before requesting scoped work. Handle challenge/lifecycle events and duplicates. Renew watches/subscriptions ahead of expiry and periodically recover incremental deltas.
  - Publish setup documentation for absent live credentials; no fabricated live acceptance.
- [x] 4. Classification throughput, freshness and measurements. Verified on the isolated task snapshot: 265 tests, typecheck and lint pass. Fixed a remaining-count overstatement when one email in a concurrent wave went stale.
  - Files: src/lib/classification.ts, src/lib/classification-version.ts, src/lib/sync.ts, Prisma migration, src/lib/metrics.ts, focused tests.
  - Bounded concurrency prioritizes recent mail; do not start extra requests after 429. Save decisions in batches with locked tag/content/model version checks. Model changes must invalidate old decisions even without new mail.
  - Test stale tag/content races, failures/retries, negative-decision caching, latest model predicate, budgets and concurrency cap. Record metadata-only durations.
- [x] 5. Retire notifications/digests. Verified on the isolated task snapshot: 243 tests, typecheck and lint pass. Historical delivery tables stay inert.
  - Remove service worker push delivery, notification UI/hooks, cron routes/schedules, delivery dependencies and env requirements. Preserve general refresh settings. Tests prove retired endpoints cannot deliver.
- [x] 6. Plans, pricing and account management. Verified on the isolated task snapshot: 250 tests, typecheck and lint pass. Owner Heavy grant NOT yet executed: hosted Supabase lacks the Phase 7 migrations (see STATUS).
  - Files: src/lib/plans.ts, src/lib/account-management.ts, src/app/pricing/page.tsx, src/components/settings-view.tsx, accounts-view.tsx, navigation, server account endpoints, admin grant script and tests.
  - Starter $14/5k; Heavy $24/10k. Limits and charging remain off. No fake checkout/portal. Display actual trusted access, usage period and profile. Reconnect/disconnect/signout/delete remain safe; clean provider subscriptions and caches.
  - Grant existing verified owner's Heavy access through Supabase admin metadata, preserving unrelated metadata, then verify DB/auth result. No client-supplied plan escalation.
- [ ] 7. In-app replies and drafts.
  - Files: src/lib/providers/actions.ts, src/lib/mail-actions.ts, src/components/reply-composer.tsx, email-detail.tsx, Prisma draft/action state, routes and tests.
  - Reply/reply-all with draft autosave, correct sender/recipients/thread, plaintext composing and explicit user send. Store provider draft/sent identifiers and prevent automatic duplicate sends after ambiguous failures. Expose actionable reconnect permission errors. Add provider read/archive controls.
  - Fixture tests only for sends; no email sent during implementation.
- [ ] 8. Integration review and release evidence.
  - Run npm test, npm run typecheck, npm run lint, APP_MODE=demo npm run build.
  - Exercise demo browser flows, public pricing, settings/accounts, replies, workspace switching and responsive layouts.
  - Verify migrations in PGlite and available hosted Supabase; record actual owner grant and live integration gaps. Update docs/prd/PRD.md, docs/phases/PHASE_7.md and STATUS.md, engineering setup/runbook and commit final evidence.

## Verification commands

```sh
npm test
npm run typecheck
npm run lint
APP_MODE=demo npm run build
```

Targeted tests run before each commit. The pre-commit hook also runs typecheck. Tests use mock providers and isolated Postgres fixtures; production email sending, external billing, and public deployment are not part of test execution.
