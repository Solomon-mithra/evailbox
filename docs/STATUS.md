# Current implementation and activation status

Updated 2026-09-26. This is a dated evidence summary, not a guarantee that external configuration remains unchanged.

## Implemented and locally verified

- Durable signup-burst processing: default 5 global concurrent steps, configurable up to 100; one provider page and up to 20 classification attempts per user turn. Inngest keyed scheduling offers best-effort fairness, not strict round-robin guarantees.
- Same-step transient body reuse; no imported email bodies in Postgres or Inngest step results. Summaries, classifications, encrypted credentials and explicit reply drafts remain persisted.
- Metadata-first inbox rendering, current-decision progress counts, realtime signals and active-work polling.
- Full regular suite: 325 tests passed; typecheck and lint passed. Demo inbox and All mail navigation were checked without console errors during the burst implementation.
- Synthetic 100-user fixtures passed at 10,000 and 123,400 emails. A 10,000-email fixture also passed with worker concurrency 100. These use mocked providers/inference, PGlite and a local FIFO scheduler; they do not measure hosted Gmail/Jev/Inngest latency.

## Service/configuration observations

- Gmail and Jev are already implemented/configured according to the owner. Their existing local values were preserved; this maintenance task did not make a new paid inference or mailbox request.
- Inngest's existing Production signing and event keys were retrieved through the owner's authenticated Safari session and saved only to ignored `.env.local`. Keys were not regenerated, rotated, printed or copied into templates/other environments.
- The Inngest Production dashboard showed a 5-concurrency tier and **no active apps** on 2026-09-26. Key presence is not hosted activation. Register/sync the reachable deployed `/api/inngest` endpoint in the matching environment before expecting cloud processing.
- The local DB URL is already configured for Supabase transaction pooling. Production environment values were preserved; a production pooler change is not claimed.
- The previous committed record (`1b14889`) reports hosted migrations, removal of the imported body column and the owner's Heavy grant on 2026-09-26. This maintenance task did not rerun those database operations. Verify current migration status against the intended database before rollout.
- Gmail push infrastructure, Outlook consent/subscriptions, private Realtime deployment settings and end-to-end hosted recovery were not newly verified here. Existing Gmail OAuth functionality alone does not prove Pub/Sub activation.

## Maintenance verification

All four root env files have identical sets of 33 variable names; existing values were preserved per file. The name-only checker is part of CI and was verified against matching templates, missing keys, duplicate names and value redaction. Retrieved keys are absent from tracked files and other env files. Local environment validation passes in live/cloud mode.

Superseded documentation was consolidated, 17 Markdown files removed (including the completed local burst plan), and retained relative links checked. The full 325-test suite, lint and typecheck passed after maintenance. The historical cost calculator labels its output obsolete.

## Remaining operational work

1. Deploy the intended code and environment-specific keys, then register/sync the Inngest app. A localhost URL is not reachable by the hosted service without separately configured connectivity.
2. Verify callback origins, provider notification delivery, renewal and realtime authorization for that deployment.
3. Use 100 disposable staging users/mailboxes with `npm run load:burst -- staging-user-ids.json` for real first-tag/completion latency. Do not replace an interview performance claim with synthetic timings.
4. Record the deployed revision, service environment, timestamps and actual outcomes after each live check. No new deployment, paid plan change or outbound email was performed in this maintenance task.

Configuration details: [environment](engineering/ENVIRONMENT.md). Activation: [service setup](engineering/SERVICE_SETUP.md). Operations and staging load test: [runbook](engineering/RUNBOOK.md).
