# Technology stack

Reviewed 2026-09-26. `package.json` and `package-lock.json` are authoritative for versions; install with `npm ci`. Read the installed Next.js guides before changing framework code, as required by `AGENTS.md`.

| Layer                 | Current implementation                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Runtime/framework     | Node.js 22, Next.js 16.3.5 App Router, `src/proxy.ts`, Node API routes                              |
| Interface             | React 19, strict TypeScript, Tailwind CSS 4, Radix primitives, Lucide, local Inter font             |
| Client data           | TanStack Query 5 with bounded private IndexedDB summary persistence                                 |
| Authentication        | Supabase Auth and SSR cookies; mailbox OAuth is separate                                            |
| Database              | Supabase PostgreSQL, Prisma 6, SQL migrations/RLS and tenant/workspace foreign keys                 |
| Mail providers        | Direct Gmail REST and Microsoft Graph requests with deadlines and protocol fixtures                 |
| Inference             | AI SDK 7 native `experimental_evaluate`, Gateway evaluation model `typesafe-ai/jev` by default      |
| Background processing | Inngest bounded import/classify turns, continuations and recovery/renewal schedules                 |
| Live updates          | Supabase private Realtime invalidation plus authenticated refetch/polling                           |
| Provider events       | Gmail authenticated Pub/Sub, Microsoft Graph notifications and renewal                              |
| Encryption            | Node crypto AES-256-GCM; stable server-only key for stored OAuth/private state                      |
| Hosting               | Vercel Node functions; Vercel cron configs empty                                                    |
| Validation            | Zod, Vitest/PGlite, TypeScript, ESLint, Prettier and scoped browser checks                          |
| CI                    | GitHub Actions: install, environment-name parity, Prisma generation, tests, lint, types, demo build |

Jev's evaluation interface is experimental; upgrades need protocol fixtures against the installed SDK. No chat generation is used for classification. Imported bodies stay transient; user-written drafts are stored. No Redis, push-notification delivery or digest service is required.

RLS does not replace application scoping when Prisma uses a privileged database connection. Service quotas, rates, retention controls and availability must be checked against the actual account; this repository does not promise free capacity or fixed infrastructure cost.

[Architecture](ENGINEERING.md), [environment](ENVIRONMENT.md), [status](../STATUS.md), [provider assets](PROVIDER_LOGOS.md).
