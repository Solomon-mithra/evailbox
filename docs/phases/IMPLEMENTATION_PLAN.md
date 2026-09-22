# evailbox implementation plan

**Goal:** Deliver an email triage application with verified local behavior and a deployable production configuration.
**Architecture:** Next.js App Router on Vercel; Supabase Auth and PostgreSQL accessed through tenant-scoped Prisma queries; independent Gmail and Graph OAuth connectors; typed Jev evaluation through Vercel Gateway. A clearly labeled, isolated demo allows UI evaluation without credentials.
**Design:** Forest navigation and lime selection, local Inter typography, a cool off-white app canvas, white email surfaces and retained page-heading gradients. A public evailbox landing page explains personal/work email matching; the inbox application lives at `/inbox`.
**Decisions:** Use pinned Next.js 16.3.5 instead of the older Next.js 15 task reference. Use authenticated AES-256-GCM via Node crypto instead of crypto-js's unauthenticated default cipher. Jev returns decisions, not prose; explanations are deterministic descriptions of the rule and decision, never invented rationale. Production never silently falls back to demo data. No feedback gate before deployment, as explicitly requested.

## 1. Foundation and specification

- [x] Write PRD, architecture, stack, setup instructions and per-task acceptance criteria.
- [x] Configure strict TypeScript, Next.js, ESLint, Vitest, Husky, CI, validated environment and Prisma schema.
- [x] Generate initial SQL migration with RLS and tenant-consistent foreign keys.
      Acceptance: dependency installation, schema validation and generated client succeed; secrets are ignored.

## 2. Secure server and integrations

- [x] Test encryption tamper rejection, validation, classification decisions and OAuth state before implementation.
- [x] Implement server-only Supabase sessions, protected routes, CSRF origin checks and consistent API errors.
- [x] Implement tenant-scoped tags/accounts/emails/settings CRUD and account deletion.
- [x] Implement independent provider OAuth with PKCE/state, encrypted refresh tokens, paginated incremental sync and bounded retries.
- [x] Implement typed Jev evaluation and versioned classification, with errors left retryable.
      Acceptance: invalid/unauthorized input fails closed; all provider credentials remain server-side; requests cannot access another tenant.

## 3. Complete product interface

- [x] Build inbox, tag editor/detail, accounts, settings, sign-in and email details.
- [x] Connect real queries and mutations, filtering, handled state, notification preferences and errors.
- [x] Add explicit demo workspace, accessible controls, mobile navigation and loading states.
- [x] Separate Personal/Work accounts, mail, tags and matching; preserve existing data as Personal with tested database/browser-storage migrations.
- [x] Refine tag cards with full-card email links, workspace-wide counts, visible editing and confirmed deletion.
- [x] Launch the public evailbox landing page, move the dashboard to `/inbox`, preserve legacy links and update product identity.
- [x] Apply the forest/lime theme, local Inter, cool off-white app backgrounds and shared Gmail/Outlook SVGs; retain box gradients and the distinct landing background.
- [x] Add complete sharing metadata, a branded PNG preview, app icons/manifest, public crawler files and account-aware landing copy. Keep private routes protected and out of the sitemap.
      Acceptance: all navigation and actions work in demo; live mode requires authentication; compound filters operate together.

## 4. Notifications and deployment

- [x] Implement Web Push subscriptions/service worker, high-priority delivery and digest cron with unsubscribe and deduplication.
- [x] Run unit tests, type checking, lint and production build.
- [x] Record scoped theme, tag-card and landing browser checks for responsive layout, keyboard interaction, text enlargement and automated accessibility.
- [ ] Complete the final browser appearance pass after the latest copy/background/logo changes, manual screen-reader review and live end-to-end acceptance. See [current evidence](STATUS.md).
- [x] Create the private GitHub repository, deploy the initial demo to Vercel and document required live credentials.
- [ ] Resolve the recorded Vercel identity/deployment blocker and publish the latest approved revision; recent UI refinements are on `main` but remain undeployed.
- [x] Record actual validation evidence, remaining external gates, rollback and 24-hour monitoring procedure.
      Acceptance: no unverified OAuth, delivery, cron execution or production database checks are reported as passing; no work proceeds beyond Phase 6.
