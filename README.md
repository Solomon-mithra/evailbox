# evailbox

A focused inbox for Gmail and Outlook. Define custom tags, let AI evaluate each email against your criteria, and review important messages with explicit match probabilities.

Built with Next.js 16.3.5, React 19, strict TypeScript, Tailwind CSS 4, shadcn-style Radix components, Supabase Auth/PostgreSQL, Prisma, and Vercel AI Gateway.

## Run locally

Requires Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local
npm run db:generate
npm run dev
```

Open http://localhost:3000 for the homepage, or http://localhost:3000/inbox for the dashboard. `APP_MODE=demo` provides a clearly labeled workspace with sample emails and browser-local state. Demo actions do not call email providers, Jev, or delivery services. Missing credentials never silently enable demo mode.

## What is implemented

- Server-owned Supabase Google sign-in, httpOnly session cookies, protected pages, and origin-checked mutations.
- Independent Gmail and Outlook OAuth connections with PKCE/state checks and AES-256-GCM token encryption.
- Incremental, paginated sync with durable provider cursors, account leases, deduplication, and recovery scans that preserve existing triage.
- Tag creation, editing and deletion; typed Jev decisions; persisted email–tag/version results, including negative and uncertain decisions.
- A durable backlog worker with leases, revision checks, backoff, and one native Jev evaluation per email for its unfinished tags. Completed pairs are not automatically re-evaluated.
- Responsive inbox, priority section, expandable tag groups, search/compound filters, detail dialogs, handled state, account controls and settings.
- Web Push delivery and timezone-aware digests with immutable retry payloads, unsubscribe and delivery history.
- PostgreSQL migrations, RLS, tenant-consistent foreign keys, CI, security tests and operational runbooks.

Jev returns structured probabilities, not generated reasoning. The UI displays a deterministic decision trace. Structure can be validated; semantic correctness is not guaranteed.

## Connect live services

Read [the runbook](docs/engineering/RUNBOOK.md) before switching `APP_MODE` to `live`. Fill the variables in [.env.example](.env.example) using your own Supabase project, provider OAuth applications, Vercel AI Gateway key and verified digest sender. Generate encryption, cron and VAPID secrets once and keep them private. Startup validates required configuration.

```bash
npm run db:migrate
npm test
npm run lint
npm run typecheck
npm run build
```

The migration targets Supabase: it references `auth.users`, `auth.uid()`, `anon`, and `authenticated`. Do not apply it to an unrelated production database. Tests execute this migration in isolated PGlite PostgreSQL with Supabase-style auth fixtures; they do not provision or verify a live Supabase project.

Vercel cron configuration requires a plan supporting every-minute workers. Daily sync schedules at 03:00 UTC, the worker resumes pending work every minute, and digest scheduling checks every 15 minutes. The UI’s refresh setting controls query polling, not provider polling.

## Verification and readiness

See [current validation status](docs/phases/STATUS.md). Real OAuth consent, production Supabase migration, live Jev results, browser push delivery, digest delivery, provider quotas, and 24-hour operational monitoring must be verified using configured live services before calling the system beta-ready. The deployed demo is a review surface.

## Documentation

- [PRD](docs/prd/PRD.md)
- [Architecture, schema and API](docs/engineering/ENGINEERING.md)
- [Tech stack](docs/engineering/TECH_STACK.md)
- [Provider contracts](docs/engineering/PROVIDERS.md)
- [Large inboxes and checkpoints](docs/engineering/LARGE_INBOXES.md)
- [Deployment, troubleshooting and rollback](docs/engineering/RUNBOOK.md)
- [Implementation plan](docs/phases/IMPLEMENTATION_PLAN.md)
- [Phase 0](docs/phases/PHASE_0.md), [Phase 1](docs/phases/PHASE_1.md), [Phase 2](docs/phases/PHASE_2.md), [Phase 3](docs/phases/PHASE_3.md), [Phase 4](docs/phases/PHASE_4.md), [Phase 5](docs/phases/PHASE_5.md), [Phase 6](docs/phases/PHASE_6.md)

All 38 original task IDs include step-by-step instructions and acceptance criteria. No work beyond Phase 6 is authorized.

## Deployment configurations

The default `vercel.json` and `vercel.demo.json` disable cron for the current Hobby-plan demo. `vercel.live.json` preserves the full live schedule. After configuring services and a compatible plan, copy `vercel.live.json` to `vercel.json`, commit that change, then deploy. The Vercel remote build reads the root configuration even when a different local config was supplied; the first alternate-config attempt was rejected for that reason. `.vercelignore` explicitly excludes every environment file from uploads.
