# Phase 1 — Foundation, database and authentication

Prerequisite: Phase 0 documents. Keep independent staging/production secrets. External status: Supabase provisioning, migration execution, live sign-in and Vercel skeleton deployment require separately recorded evidence; unrun checks remain pending.

## 1.1 Initialize Next.js and Dependencies

Steps:

1. Install the committed Next.js 16.3.5 / React 19 / TypeScript strict stack with `npm ci` using Node 22.
2. Configure App Router, Tailwind 4, ESLint, Vitest, Prisma generation and the pre-commit typecheck hook.
3. Add CI stages for install, Prisma generation, tests, lint, typecheck and production build in explicit demo mode.
4. Configure environment validation in instrumentation; confirm demo requires intentional APP_MODE and live placeholders fail startup.
5. Run `npm run db:generate`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`; preserve actual results.

Acceptance criteria:

- A clean checkout installs reproducibly using the lockfile.
- Strict types and production build pass without disabling validation or treating tests as optional.
- Missing live secrets fail closed; demo does not activate automatically.
- Node/Next versions and the task's Next 15 deviation are documented.

## 1.2 Supabase Database

Steps:

1. Provision the authorized Supabase environment; set runtime `DATABASE_URL` and migration `DIRECT_URL` secrets.
2. Review all eight schema models, durable user/account work revisions and leases, rescan observation fields, cascade behavior, indexes and composite tenant foreign keys.
3. Apply the committed migration with `npm run db:migrate` against a backed-up test project; generate Prisma client.
4. Inspect RLS and grants for each table. Use two independent test identities to attempt cross-tenant reads/writes through direct client access and through APIs.
5. Insert/delete fixture users, accounts, tags and mail to verify uniqueness, range constraints and cascades; remove test records afterward.

Acceptance criteria:

- Local migration/RLS logic passes the PGlite scaffold; hosted migration success is recorded separately after applying to the intended Supabase project.
- Each protected table has RLS; credential/preference/subscription/delivery tables deny direct client access.
- Cross-tenant account/email/tag relationships fail at the database level and server requests remain user-scoped.
- Privileged Prisma bypass risk is documented; a passing RLS test alone is not accepted as complete isolation evidence.

## 1.3 Gmail / Supabase Authentication

Steps:

1. Configure Google as a Supabase Auth provider with the Supabase callback URI in Google Cloud.
2. Configure Supabase Site URL and app `/api/auth/callback` redirect allowlist for development/staging/production separately.
3. Implement sign-in URL creation, code exchange, server `getUser()` verification, user upsert and sign-out.
4. Use HTTP-only, secure-in-production, same-site session cookies and refresh them through Next proxy.
5. Exercise successful sign-in, denied consent, expired session, protected-page navigation, unauthenticated API access and sign-out using an authorized account.

Acceptance criteria:

- Sign-in identifies the correct user and private APIs return 401 without a verified session.
- Protected pages redirect appropriately; session cookies use the intended flags.
- Google sign-in and Gmail mail-access consent are documented as independent flows.
- Live auth result remains pending until an actual authorized account completes the round trip.

## 1.4 Deploy Skeleton to Vercel

Steps:

1. Prepare the complete deployable skeleton and inspect its build, environment requirements, domain and private repository settings.
2. Configure a Vercel project and review preview/production environment separation without exposing secret values.
3. Respect the task's final deployment approval gate; prepare the candidate now and publish only under the applicable authorization.
4. After authorized deployment, verify the actual URL, health mode, sign-in route, asset loading and function logs.
5. Record commit SHA, URL, environment mode and unresolved live integration gates.

Acceptance criteria:

- Production build succeeds locally and the candidate is concrete/reviewable before approval.
- Actual deployment is verified by URL and response, not inferred from CLI intent.
- Demo deployment is labeled as demo and never presented as working live mail integration.
- A pending deployment approval or missing external credentials is recorded as pending, not passed.
