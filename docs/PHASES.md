# Open-source, self-hosted evailbox — phases

Branch: `open-source` (from `main` at `71c7b7f`). Each subtask is one commit in the repo's
conventional style (`feat: …`, `refactor: …`, `docs: …`). Tick the box and record the commit when it
lands.

## Goal

Anyone can clone the repo, run `npm install && npm run dev`, and get a working Gmail + Outlook triage
inbox. No Supabase, Inngest, Stripe or Vercel account is needed. Everything runs inside the single
Next.js process against a local SQLite file. Users paste their own Google and Microsoft OAuth client
credentials (and, optionally, an AI Gateway key for Jev tagging) into **Settings**. Nothing in `.env`
is required. Done means `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` all pass,
and a browser QA round shows Settings → connect → inbox working with the existing visual theme.

## Decisions

- **SQLite via Prisma** (`file:./data/evailbox.db`). Rejected: keeping Postgres, which costs
  self-hosters setup. Postgres raw SQL is ported to the SQLite dialect. Prisma stores SQLite
  `DateTime` as integer ms; raw JSON aggregates return ms and 0/1 booleans, which are converted in JS.
  String arrays become `Json` columns.
- **Single user, no login.** One fixed local user owns everything. An optional `APP_PASSWORD` env
  gates a hosted instance with a signed cookie. Rejected: multi-user OAuth login (Supabase
  replacement), which isn't needed for self-hosting.
- **Credentials live in the database**, encrypted with AES-256-GCM. `ENCRYPTION_SECRET_KEY` is
  optional; if it's unset, a key is generated once into `data/secret.key`.
- **In-process background worker** (`src/lib/background.ts`) replaces Inngest. It ticks every 30 s,
  runs mailbox sync every 2 min, and is kicked immediately after user actions. Push webhooks (Gmail
  Pub/Sub, Graph subscriptions) are removed: they need public HTTPS and cloud setup, and polling
  covers the self-hosted case.
- **Removed:** Stripe billing, plans/usage limits, pricing page, marketing landing page, Supabase
  Realtime (client polling remains), Vercel analytics/configs, production eval/load/monitor scripts,
  ad media.
- **Kept:** Personal/Work workspaces, tags, Jev classification, replies/drafts, read/archive, demo
  mode (`APP_MODE=demo`), and the existing theme in `globals.css`.
- License: MIT.

## Delegation

- Worker: Sonnet, low effort, for mechanical removal, running checks, test pruning and browser QA.
  The orchestrator keeps the schema, SQL port, auth, crypto and credential code, plus all reviews
  and the final verdict.
- QA cases and rubric: see "Rounds" (written before round 1).

## Phase 0 — plan

- [ ] **0.1** This document. — pending

## Phase 1 — strip hosted-only services

- [ ] **1.1** In-process background worker (`src/lib/background.ts`) started from
      `instrumentation.ts`. — pending
- [ ] **1.2** Remove Stripe billing, plans, pricing, landing page, Vercel analytics/configs and
      their deps. — pending
- [ ] **1.3** Remove Inngest, Supabase Realtime and push webhooks/mailbox subscriptions; routes call
      `kickWork()`. — pending
- [ ] **1.4** Remove production-only scripts, docs and media. — pending

## Phase 2 — SQLite

- [ ] **2.1** SQLite schema, fresh init migration, `Json` arrays. — pending
- [ ] **2.2** Port raw SQL (inbox, classification, tag scope, sync, tag checks). — pending

## Phase 3 — local single-user auth

- [ ] **3.1** Fixed local user, optional `APP_PASSWORD` cookie gate in proxy, password sign-in page.
      — pending
- [ ] **3.2** Auto-generated encryption key; env validation no longer requires hosted services.
      — pending

## Phase 4 — Settings: bring your own keys

- [ ] **4.1** Encrypted `AppSettings` storage and API (secrets are write-only and never returned).
      — pending
- [ ] **4.2** Provider OAuth and Jev read credentials from settings. — pending
- [ ] **4.3** Settings UI: Google, Microsoft and AI key cards with copyable redirect URIs, matching
      the theme. — pending

## Phase 5 — tests and docs

- [ ] **5.1** Drop tests for removed features; port DB tests to SQLite; full suite green. — pending
- [ ] **5.2** README (self-hosting, Google/Azure app registration), LICENSE, `.env.example`.
      — pending

## Phase 6 — QA

- [ ] **6.1** Browser QA round; fix findings. — pending

## Rounds

| Round | Change under test | Pass | Notes |
|---|---|---|---|

## Open issues

- (none yet)
