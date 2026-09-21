# Phase 6 — Notifications, polish and release

Scope stops after Phase 6. Local implementation/fixtures, browser review and external production checks must be reported separately. **Live push, Resend delivery, real OAuth/model behavior, deployed cron and 24-hour monitoring are pending until actually exercised.** Do not create passing evidence from the checklist itself.

## 6.1 Browser Push Notifications

Steps:

1. Configure VAPID public/private keys and contact subject as server environment values; register the service worker on supported HTTPS browsers.
2. Ask permission through an explicit user action and store the subscription only for the verified user with an allowed push-service endpoint.
3. Select HIGH-priority current-version matched emails above the notification minimum that are unread, unhandled and not already claimed.
4. Conditionally claim the classification, send a minimal notification with a local email link, prune 404/410 subscriptions, and clear the claim if no send succeeds.
5. Exercise authorized test delivery, permission denial/revocation, expired endpoint, multiple tabs/devices, deep-link navigation and repeat invocation.

Acceptance criteria:

- Subscription ownership prevents another user from taking over an endpoint.
- Noneligible or already-delivered items do not intentionally trigger duplicate notification work.
- Body includes only the intended minimal sender/tag information and links stay within the app.
- Actual push receipt is recorded per tested browser; fixture/code inspection is not delivery evidence.
- Crash-after-claim limitations are documented; exactly-once delivery is not promised.

## 6.2 Daily Digest

Steps:

1. Configure Resend key and verified sender, plus opt-in, local HH:mm time and IANA timezone.
2. Evaluate due windows in local time and map midnight-adjacent windows to the scheduled local date.
3. Claim the unique `(userId,localDate)` delivery record with a lease; paginate all current matches in the immutable windowEnd interval, group by tag and escape HTML. Persist the exact request payload before sending and reuse it unchanged on retries.
4. Include working app links and unsubscribe page/token; send with the stable history-derived idempotency key.
5. Record sent/failed status and provider ID; retry failures safely within the scheduling policy.
6. Test concurrent runs, repeat date, empty digest, HTML injection, local midnight, DST transitions, unsubscribe, provider rejection and actual authorized recipient delivery.

Acceptance criteria:

- A successful normal run has one sent history row per user/scheduled local date.
- Duplicate attempts reuse the same provider idempotency key; no guarantee beyond the provider's semantics is invented.
- Unsubscribe disables future digest selection and does not expose unrelated user data.
- Every-minute requested-work and 15-minute digest cadences are configured on a supporting Vercel plan/scheduler.
- Missed windows and nonexistent DST times are documented; live delivery/cron validation remains pending until observed.

## 6.3 UX Polish

Steps:

1. Review every route and action for consistent spacing, typography, semantic labels and useful hierarchy.
2. Add/verify loading, empty, success and error feedback, including failed sync/classification and absent credentials in live mode.
3. Check mobile navigation, long-content wrapping, scroll containment, dialogs and focus return.
4. Test keyboard-only navigation, reduced-motion preference where motion exists and readable priority/probability states without color.
5. Verify demo labels and production copy accurately state sync scope, uncertainty and notification limitations.

Acceptance criteria:

- No dead action, permanent placeholder or silent error remains in the in-scope journeys.
- Key screens work at desktop and narrow mobile widths without clipped controls or unintended horizontal scrolling.
- Form errors and pending operations are understandable and accessible.
- Visual polish does not hide failures or imply live integrations were verified.

## 6.4 Manual Testing Checklist

Steps:

1. Execute the matrix below in a fresh browser/session and record date, commit, mode, viewport/browser, action and observed result.
2. Use demo for local UI review and separate authorized accounts for live integration/security cases.
3. For failures, record reproduction, fix, and rerun only the affected flow plus relevant regression checks.
4. Preserve screenshots/log excerpts only when they do not expose personal email or secrets.

| Check                                | Required observation                             | Evidence status before execution         |
| ------------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| Sign-in / sign-out / expired session | Correct navigation and private API rejection     | Pending live auth                        |
| Gmail and Outlook connection         | Identity, scopes, encrypted tokens, refresh      | Pending external                         |
| Multi-page sync and updates          | No duplicate IDs; read/move/delete reflected     | Pending external                         |
| Tag create/edit/delete               | Validation, uniqueness, invalidation, cascades   | Pending local browser + live persistence |
| Jev classification                   | Native typed result, uncertainty/error handling  | Fixtures separate; live pending          |
| Inbox views and filters              | Combined search/tag/account/date, pagination     | Pending browser review                   |
| Email detail and handled             | Escaped text, persistence, provider link         | Pending browser review                   |
| Settings and refresh                 | Saved defaults/timezone/ranges, query polling    | Pending browser review                   |
| Push                                 | Permission, receipt, deep link, invalid endpoint | Pending external browser delivery        |
| Digest/unsubscribe                   | Correct grouping/local date/idempotency/opt-out  | Pending external delivery                |
| Tenant isolation                     | A cannot read/mutate/classify/sync B resources   | Pending two-user integration             |
| Mobile/keyboard                      | Reachable controls, focus, no clipped layout     | Pending browser review                   |
| Delete account                       | Auth identity and owned records removed          | Pending authorized destructive test      |
| Cron and 24-hour observation         | Actual scheduled runs and delivery/error review  | Pending deployment + elapsed observation |

Acceptance criteria:

- Every row has actual pass/fail/blocked/pending evidence; no blanket “all tested” statement substitutes for it.
- External checks without credentials remain pending and are listed in release handoff.
- Demonstrated failures are resolved or clearly treated as release blockers/limitations.

## 6.5 Production Configuration

Steps:

1. Review `.env.example`, schema/migration, provider callbacks, domain, security headers and secret handling for the intended environment.
2. Configure Supabase auth/database, both mail OAuth clients, Jev Gateway, encryption key, cron secret, VAPID, Resend and sender domain.
3. Confirm the Vercel plan supports the every-minute worker and 15-minute digest schedule; separate preview and production secrets and protect the private repository.
4. Back up existing data; review migration and rollback compatibility before applying changes under deployment authority.
5. Verify runtime validation rejects incomplete live configuration and health identifies demo/live accurately.

Acceptance criteria:

- Every required live variable has a real environment-specific value without leaking it into source or browser bundles.
- Exact deployed OAuth callback URIs are registered and provider verification/consent restrictions are documented.
- Migration, schedule, function duration and recovery plan are reviewable before production publishing.
- A configured dashboard alone does not count as successful external integration.

## 6.6 Final Testing and Deployment

Steps:

1. On the final candidate run `npm ci`, `npm run db:generate`, `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`.
2. Complete the browser matrix and inspect the final Git diff for secrets, unintended scope and missing docs.
3. Prepare the concrete release candidate, migration plan, Vercel target and known pending integrations; obtain the required final deployment approval before publishing.
4. Deploy only the approved candidate, verify actual URL/health/assets/logs and record SHA/mode/time.
5. Run authorized production smoke checks and observe actual cron/delivery operation for 24 hours; keep uncompleted checks pending.

Acceptance criteria:

- Final candidate checks pass with recorded output, or specific blockers are disclosed without fabricated success.
- Deployment URL resolves to the intended commit and expected demo/live mode.
- Production provider/delivery claims are supported by actual authorized tests.
- Work ends at Phase 6; no unrequested Phase 7 feature expansion is introduced.

## 6.7 Runbook

Steps:

1. Maintain `docs/engineering/RUNBOOK.md` with exact local setup, environment names, migrations, separate sign-in/mail OAuth setup and provider/delivery validation.
2. Include cron plan constraints, local-time scheduling/idempotency, monitoring, backlog, token/key recovery and rollback instructions.
3. Describe irreversible operations and how to perform authorized test cleanup without touching other users.
4. Cross-check every command/path against repository scripts and every assumption against current code/provider docs.
5. Hand off actual evidence and unresolved external gates to the operator; do not label the runbook itself as completed operational testing.

Acceptance criteria:

- Another engineer can reproduce demo setup and configure live integration without guessing callback URLs or secret names.
- Incident guidance addresses OAuth, expired tokens/cursors, Jev failures, stuck leases, missing digests, key changes and bad deployments.
- The 24-hour monitoring procedure, rollback limits and pending external checks are explicit.

Current release constraint: the connected Vercel Hobby plan rejected the live minute/15-minute cron schedules. The explicit demo deployment uses `vercel.demo.json` with `crons: []`; the complete live `vercel.live.json` is preserved. No plan upgrade, live credentials or scheduled background processing is enabled. Verify a resulting demo URL separately; live Phase 6 gates remain pending. See the [deployment route](../engineering/RUNBOOK.md).
