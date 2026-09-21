# Phase 0 — Repository and specifications

These task IDs preserve the original work breakdown. Instructions are reusable for a new implementation or a review of this one. Acceptance criteria are checks to execute, not claims that they already passed. External validation: not applicable to document-only work; repository hosting/privacy remains pending until verified.

## 0.1 Initialize Repository Structure

Steps:

1. Initialize the application directory as a Git repository; use a private remote when creating the hosted repository.
2. Create `docs/prd`, `docs/engineering`, `docs/phases`, `src/app`, `src/components`, `src/lib`, `src/hooks`, `src/types`, `prisma` and `tests`.
3. Ignore environment secrets, build output, dependencies and local tool state. Commit a placeholder-only `.env.example` and dependency lockfile.
4. Separate documentation, migration, application, fixture and operational artifacts. Confirm the Git diff contains no credentials or real mail before committing.

Acceptance criteria:

- Every required documentation folder exists and phase files 0–6 are discoverable.
- `.env.local`, real keys and inbox dumps are absent from tracked files.
- Hosted remote privacy is inspected directly; it is not inferred from local Git settings.

## 0.2 Product Requirements Document

Steps:

1. Write `docs/prd/PRD.md` with the user problem, audience and complete sign-in/connect/tag/sync/review/notification/deletion journeys.
2. Define functional acceptance, accessibility, privacy, data scope and explicit exclusions.
3. Explain uncertainty, third-party model processing, read-only provider behavior and local handled state.
4. Separate release gates requiring external accounts from local demo/fixture evidence; identify quality and operating metrics without invented targets.

Acceptance criteria:

- Every Phase 1–6 capability maps to a product journey or operational gate.
- PRD explicitly distinguishes Gmail initial window, Outlook Inbox scope, local demo and live service.
- No zero-error classification guarantee, fabricated validation or fixed-cost promise appears.

## 0.3 Engineering Document

Steps:

1. Read the actual Prisma schema, migration, API dispatcher and service code before writing the architecture.
2. Write `docs/engineering/ENGINEERING.md` with architecture and OAuth/sync diagrams, module responsibilities and all API methods/paths.
3. Generate or review a complete model/field dictionary against `prisma/schema.prisma`; include defaults, nullability, relationships and tenant constraints.
4. Document session/CSRF boundaries, encryption, RLS privilege caveat, transaction/cursor ownership, classification invalidation and delivery failure cases.
5. Cross-check each documented endpoint with the dispatch implementation and each schema field with the source.

Acceptance criteria:

- All eight Prisma models and every scalar/relation field are described.
- API documentation covers health, authentication, accounts, tags, mail, sync/classification, settings, push, unsubscribe, user deletion and cron.
- Documentation states that privileged Prisma access may bypass RLS and requires explicit user scoping.
- Operational limits and pending integration checks remain visible.

## 0.4 Tech Stack Document

Steps:

1. Read `package.json`, lockfile and runtime/CI configuration.
2. Write `docs/engineering/TECH_STACK.md` with the chosen framework, UI, auth, database, provider, inference, crypto, notification, deployment and test tooling.
3. Record deliberate deviations: Next.js 16.3.5 versus task reference 15, and native AES-256-GCM versus crypto-js.
4. Explain pinned Jev experimental SDK versions, lockfile reproducibility and variable external pricing/plan requirements.

Acceptance criteria:

- Version statements match the manifest/lockfile; `latest` ranges are not portrayed as immutable pins.
- Both deviations have technical reasons and migration/maintenance implications.
- The every-minute work cron and 15-minute digest cron's paid-plan or alternate-scheduler requirement is explicit.

Exit evidence: inspectable documents and repository structure. Do not mark GitHub privacy, CI or deployment passed merely because setup instructions exist.
