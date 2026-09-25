## 2026-09-25 — Replies, drafts and mailbox actions implemented

Replies, drafts, duplicate-send protection, provider read/archive and the Drafts page are implemented and covered by fixtures; no live email was sent. Public copy was corrected for the wider mail scopes. Full suite: 297 tests, typecheck and lint pass.

## 2026-09-25 — Classification throughput and freshness implemented

Bounded concurrent recent-first classification, guarded batch saves, content/tag/model freshness and metadata-only metrics are implemented. Integration review fixed the remaining-work count overstating a wave with one stale email. The isolated task snapshot passes 265 tests, typecheck and lint.

## 2026-09-25 — Plans and account management implemented

Pricing page, Settings profile/plan/usage and the administrative grant script are implemented, with billing and limits off. The isolated task snapshot passes 250 tests, typecheck and lint. The owner Heavy grant is pending: `prisma migrate status` shows six Phase 7 migrations unapplied on the hosted Supabase database, and applying them requires owner approval.

## 2026-09-25 — Notifications and digests retired

Push, digest and unsubscribe delivery paths, settings, environment requirements and schedules are removed; retired settings are rejected. The isolated task snapshot passes 243 tests, typecheck and lint.

## 2026-09-25 — Provider event integration implemented

Authenticated Gmail Pub/Sub, shared Outlook subscriptions, hourly renewal with bounded continuation, OAuth renewal requests and locked disconnect cleanup are implemented. Setup instructions are in [SERVICE_SETUP](../engineering/SERVICE_SETUP.md); live activation is intentionally deferred. Provider webhook/renewal/credential/disconnect fixtures cover 45 cases without live email access.

## 2026-09-25 — Async processing implemented

Sync and classification requests now enqueue durable work. Inngest fetches and classifies in separate resumable steps; private Supabase broadcasts invalidate only the signed-in user/workspace. Partial configuration never claims the worker is active. 16 focused job, route and Realtime tests pass, including actual RLS isolation in PGlite. External Inngest activation is intentionally deferred by the user.

# Current Phase 7 work — 2026-09-25

The user approved fast cached inbox reads, asynchronous Inngest processing, provider subscriptions/recovery, versioned concurrent classification, removal of notifications/digests, manual replies, $14 Starter/$24 Heavy plan preview and full account management. Billing/limits remain unenforced. Every task updates the PRD/phase record and is committed independently. See [Phase 7](PHASE_7.md) and [the task plan](../superpowers/plans/2026-09-25-fast-inbox-plans.md).

Baseline checkpoint `ef7a40f`: 165 tests pass; typecheck and lint pass. The verified owner Supabase identity exists; Heavy grant is pending. User requested setup instructions and will connect Inngest, Gmail Pub/Sub and Outlook later. Those live checks must remain pending.

Task 1 is implemented: independent body-free inbox/metadata/count/settings reads, authenticated cursor pagination in inbox and tag views, server-verified shell hydration, no existing-user read writes, and safe bounded user/workspace IndexedDB summary persistence. Cache clearing covers logout, disconnect and deletion across tabs. Task verification: the isolated Task 1 tree passes all 195 tests (21 files), including 86 focused tests and actual SQL against PGlite; typecheck and lint pass. The read-index migration is local only. Warm-cache latency and complete browser journeys remain unmeasured pending Task 8.

The record below is historical Phase 0–6 evidence; its old delivery scope and credential statements are superseded by Phase 7.

---

# Validation and deployment status

Updated: 2026-09-21. Product: **evailbox**. This is a delivered implementation with an isolated demo. Live beta acceptance is **not yet complete**. This document is the current evidence summary; earlier counts and screenshots in the theme notes describe their individual review milestones.

## Delivered product refinements

- Public, indexable homepage at `/` for people managing busy personal and work inboxes; the application lives at `/inbox`. The primary action is **Open inbox**. An explicitly illustrative Personal/Work example explains how rules find relevant email.
- Consistent evailbox name and envelope mark across UI, metadata, icons, notifications and digests. Auth returns, navigation and delivery links use `/inbox`; legacy root email/workspace links preserve their parameters when redirected.
- Independent Personal and Work accounts, mail, tags, counts and classification; existing records remain Personal. Browser storage migrates to evailbox keys while preserving custom rules. See [workspaces and migration](../engineering/WORKSPACES.md).
- Local Inter typography, forest navigation, lime selection, accessible semantic states and cool off-white app backgrounds. Page-heading box gradients remain; the landing page retains its own green hero treatment. See [theme and scoped browser evidence](../engineering/THEME.md).
- Tag cards prioritize the rule and workspace-wide match count, with full-card email navigation, a separate **Edit rule** action, confirmed deletion and clearer empty states.
- Shared, locally served Gmail and Outlook SVG logos on the landing page, Accounts and embedded account controls in Settings. See [asset sources and usage](../engineering/PROVIDER_LOGOS.md).

- Professional sharing setup: canonical/Open Graph/Twitter metadata, a branded 1200 × 630 PNG, app icons/manifest, robots/sitemap, public product Markdown and `llms.txt`. Removed the landing page’s account-free claim. See [sharing implementation and checks](../engineering/SHARING.md).

These are user-requested refinements within Phases 2, 4, 5 and 6, not a new phase.

## Verified locally

Latest local verification: the metadata/sharing update on 2026-09-21. Earlier theme and landing milestones retain their historical evidence in their respective documents.

- `npm test`: **121 tests across 14 files pass**.
- `npm run lint`: passes without warnings.
- `APP_MODE=demo npm run build`: passes, including Prisma generation, service-worker bundling and Next.js compilation/TypeScript checks.
- PGlite tests execute both migrations, including legacy-data preservation, RLS on all eight public tables, tenant isolation, blocked credential reads, workspace-consistent foreign keys and deletion cascades.
- Provider fixtures cover OAuth, workspace-bound state, token refresh, Gmail/Graph pagination and errors, cursor validation, MIME decoding and native Jev Gateway wire format.
- A 1,000-email fixture with two tags drains ten batches: 2,000 decisions, 1,000 mocked batched evaluations, and no further calls on a completed pass. This is correctness coverage, not a live load or cost benchmark.
- Queue, rescan and digest tests cover leases, revisions, retries, preserved triage, immutable payloads, pagination, cutoff boundaries, local scheduling, escaping and deadlines.
- Routing and storage regressions cover public homepage/provider assets, private app routes, refreshed auth cookies, legacy redirects, workspace isolation, legacy-key migration, blocked storage writes and preservation of user-written rules.

## Browser evidence and remaining review

Recorded demo browser checks cover inbox/detail, tags and forms, accounts/settings/sign-in, workspace switching, search, keyboard tabs, dialog Escape/focus restoration and mobile navigation. Theme, tag-card and landing layouts were checked at 320, 390, 768, 1024 and 1440 CSS pixels, with 200% text sizing and text-spacing overrides. The landing Personal/Work example was exercised by pointer and keyboard. Scoped axe checks reported no A/AA violations in the tested states; gradients were measured separately. See [theme notes](../engineering/THEME.md) for the boundaries of each pass.

Browser control returned to the user before the final landing-copy, background and provider-logo refinements. Those later changes received source, automated and HTTP checks as applicable, but **a final browser pass on the latest appearance is pending**. Manual screen-reader review, complete end-to-end acceptance and all live integration checks also remain pending. Historical screenshots are not current release screenshots.

## Phase acceptance

| Phase | Implemented                                                                    | Remaining acceptance                                         |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 0     | Repository, PRD, architecture, stack and task instructions                     | No external gate                                             |
| 1     | Auth, schema, RLS, configuration and workspace migration                       | Hosted Supabase migrations/RLS and real Google sign-in       |
| 2     | Theme, public landing, `/inbox`, navigation, auth UI and route gates           | Final appearance review, screen reader and live sessions     |
| 3     | OAuth connectors, encrypted storage and incremental sync                       | Real Gmail/Outlook consent, refresh and mailbox sync         |
| 4     | Workspace-scoped tag CRUD, improved cards and typed Jev classification         | Live persistence and authorized Gateway evaluation           |
| 5     | Separate workspaces, inbox/detail/filter views, accounts, settings and polling | Complete live-data journeys and observed refresh timing      |
| 6     | Branded push/digest links, cron worker, polish, CI and runbook                 | Live delivery, deployed cron and recorded 24-hour monitoring |

## Deployment boundary

Private repository: [Solomon-mithra/evailbox](https://github.com/Solomon-mithra/evailbox), renamed from `jevinbox` on 2026-09-21 with visibility verified as private. `main` is the default branch and contains all completed work; no other branches or open PRs required merging. The Vercel project `jevinbox` in `fnu-solomon-mithras-projects` and [demo URL](https://jevinbox.vercel.app) retain their existing names. The rename does not change Jev's model ID or `JEV_*` environment variables.

The following are the last recorded deployment observations, not a new deployment verification:

- The initial CLI deployment completed in **demo mode**. Health/public-page HTTP checks passed; live APIs returned `503 DEMO_MODE`, unauthenticated cron returned `401`, and authenticated demo cron skipped work.
- GitHub CI and deployed health monitoring passed for `b67fac1`. A completed 24-hour monitoring acceptance record is still absent; CI for the current metadata/sharing revision has not yet been verified.
- The connected Vercel Hobby account rejected sub-daily cron. The root `vercel.json` disables demo jobs; `vercel.live.json` preserves live schedules. No plan was upgraded.
- Vercel Git linking required a GitHub Login Connection. A subsequent deployment was blocked because the commit author lacked project deployment permission. An authorized operator must resolve those identity/project permissions; automatic Git deployment remains unverified.

The recent UI refinements are included in this `main` release, and all 121 tests were rechecked for this metadata/sharing update. GitHub publication is separate from deployment: the existing hosted demo has not been updated with these changes. Neither migration has been applied to a live Supabase project as part of this work.

No real email has been read, sent, modified or deleted during implementation, and no live Jev request has been made. Required live service credentials have not been supplied. Locally generated secrets remain in ignored environment files. Live launch depends on the [runbook](../engineering/RUNBOOK.md) and [Phase 6 acceptance matrix](PHASE_6.md); implementation scope remains Phases 0–6.
