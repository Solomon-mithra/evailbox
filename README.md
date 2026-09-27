# evailbox

A personal/work inbox for Gmail and Outlook. Define tag rules, review Jev match probabilities, and explicitly reply, mark read or archive mail.

## Local development

Node.js 22 and npm are required. On a new checkout:

```sh
npm ci
test -f .env.local || cp .env.example .env.local
npm run db:generate
npm run env:check
npm run dev
```

Open `http://localhost:3000/inbox`. `APP_MODE=demo` uses fictional, browser-local data and does not call mail providers or Jev. `APP_MODE=live` requires the configured services; missing credentials never silently enable demo mode. Preserve an existing `.env.local` and its encryption key.

## Current behavior

- Google sign-in through Supabase; separate Gmail/Outlook mailbox OAuth connections.
- Personal and Work isolation for accounts, messages, tags, queries and cached summaries.
- New Gmail and Outlook connections initially import up to the **latest 100 Inbox emails**, then process new arrivals. Provider checkpoints persist the cap across worker turns and retries.
- Durable Inngest work: one provider page and up to 20 classification attempts per turn, followed by a continuation when work remains. Per-user serialization and configurable global concurrency defaulting to 5.
- Metadata is saved and signaled before inference. Inbox progress shows how many imported emails have current decisions; totals grow during import.
- Imported message bodies are transient. Fetch and classification share one Inngest step, so normal imports reuse the body without persisting it to Postgres or step results. Recovery/reclassification may fetch again.
- Current tag/content/model versions determine cache validity; no-match and uncertain decisions are cached too. Probabilities are not guarantees of correctness.
- Independent 50-message cursor reads, private browser summary caching, Supabase Realtime invalidation, and polling recovery.
- Explicit replies/reply-all, persisted user-written drafts, read/archive actions and account management. No automated sending.
- Starter ($4.99/month, 10,000 emails) and Heavy ($7.99/month, 20,000), with a three-day no-card trial. Stripe checkout, customer portal, signed webhooks and server-enforced allowances are implemented; billing stays in setup preview until explicitly enabled. See [billing setup](docs/engineering/BILLING.md). Notifications and digests are retired.

## Configuration and verification

`.env.local` is the local variable-name reference. Other `.env*` files use the same names with **their own values**. `npm run env:check` compares names and duplicates without exposing values. Tracked examples must never contain real keys. See [environment configuration](docs/engineering/ENVIRONMENT.md).

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:burst
# Larger synthetic fixture:
BURST_EMAILS=1234 npm run test:burst
```

The burst harness uses real classification SQL in PGlite, mocked providers/inference, and a local FIFO queue. It is not a hosted latency benchmark. `npm run load:burst -- staging-user-ids.json` runs against 100 fresh, connected staging users; see the [runbook](docs/engineering/RUNBOOK.md).

All Vercel cron configs leave schedules to Inngest. Saving keys does not register a hosted app: Inngest must be able to reach and sync the intended deployment's `/api/inngest`. No deployment or live activation is implied by local checks.

## Documentation

Start with [current status](docs/STATUS.md) and the [documentation index](docs/README.md).

- [Product requirements](docs/prd/PRD.md)
- [Architecture and data boundaries](docs/engineering/ENGINEERING.md)
- [Technology stack](docs/engineering/TECH_STACK.md)
- [Environment variables](docs/engineering/ENVIRONMENT.md)
- [Provider protocols and Jev](docs/engineering/PROVIDERS.md)
- [Mailbox events and renewal](docs/engineering/MAILBOX_EVENTS.md)
- [Deployment and operations](docs/engineering/RUNBOOK.md)
- [Service setup](docs/engineering/SERVICE_SETUP.md)

Superseded phase plans and duplicated historical architecture/cost reports have been removed. Git history preserves earlier implementation records; use current source and these maintained documents for future changes.
