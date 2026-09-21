# Validation and deployment status

Updated: 2026-09-21. This is a delivered implementation with an isolated demo. Live beta acceptance is **not yet complete**.

## Verified locally

- Strict TypeScript: `npm run typecheck` passes.
- ESLint: `npm run lint` passes without warnings.
- Tests: `npm test` passes 74 tests across 12 files.
- Dependency audit after the pinned deepmerge-ts security override: no reported vulnerabilities at installation.
- The complete migration executes in isolated PGlite PostgreSQL. Tests verify RLS on all eight public tables, authenticated tenant isolation, blocked credential reads, tenant-consistent classification foreign keys, and account deletion cascades.
- Provider fixtures cover OAuth, token refresh, Gmail/Graph pagination and errors, cursor validation, MIME decoding, and native Jev Gateway wire format.
- A 1,000-email fixture with two tags drains across ten batches; 2,000 decisions persist, only 1,000 batched evaluations occur, and a subsequent pass makes no further calls. This is mocked correctness coverage, not a live load or cost benchmark.
- Queue tests cover user leases, saved work revisions, retry scheduling and lease release. Rescan tests cover preserving existing triage and revision-aware account completion.
- Digest tests cover immutable retries, pagination beyond 200 matches, cutoff boundaries, timezone/midnight scheduling, HTML escaping and deadlines.
- Browser visual checks completed for desktop inbox and email details. Browser automation then stopped on an explicit user-control signal. Remaining interaction, keyboard, screen-reader and mobile checks are pending. See [desktop capture](../engineering/desktop.png).

## Phase acceptance

| Phase | Implementation                                                                          | External acceptance                                                         |
| ----- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0     | Repository, PRD, architecture, stack and task instructions exist                        | No external gate                                                            |
| 1     | Auth, schema, RLS, configuration and project scaffold implemented                       | Supabase project, production migration, real Google sign-in pending         |
| 2     | Dashboard, navigation, auth UI, client utilities and session gates implemented          | Remaining browser/accessibility checks pending                              |
| 3     | OAuth connectors, encrypted storage and incremental sync implemented and fixture-tested | Gmail/Outlook consent and real mailbox sync pending                         |
| 4     | Tag CRUD and typed Jev classification implemented and tested                            | Real Gateway key and live result evaluation pending                         |
| 5     | Inbox, details, filtering, tag views, settings and query polling implemented            | Full live-data and mobile acceptance pending                                |
| 6     | Push, digest, cron worker, CI and runbook implemented                                   | Live delivery, real cron workload and 24-hour monitoring completion pending |

## Deployment boundary

Private repository: https://github.com/Solomon-mithra/jevinbox

The account is on Vercel Hobby, which rejected sub-daily cron schedules. The default `vercel.json` now disables scheduled jobs for the demo; `vercel.live.json` preserves the full live configuration. No plan was upgraded.

The Vercel project is `jevinbox` in `fnu-solomon-mithras-projects`. It is configured for **demo mode**. Demo URL: https://jevinbox.vercel.app. The Vercel build completed successfully and the deployment is ready. HTTP checks verify the public pages and health endpoint; live APIs deliberately return `503 DEMO_MODE`, and unauthenticated cron requests return `401`. Authenticated demo cron requests return a skipped result. The latest code will also be pushed through Git integration.

No real email has been read, sent, modified or deleted as part of implementation. No live Jev request has been made. Service credentials were requested during deployment; they have not yet been supplied. Locally generated encryption, cron and VAPID secrets are in ignored environment files and must not be committed.

The live launch remains gated on the runbook’s configuration and acceptance checks. Work stops at Phase 6.
