# Current product requirements

Updated 2026-09-26. Requirements describe intended behavior; [status](../STATUS.md) records actual evidence and remaining activation work.

## Outcome and scope

An individual connects Gmail or Outlook, chooses Personal or Work, defines up to 30 tag rules per workspace and reviews matching mail with explicit probabilities. The product helps prioritize messages; it does not promise semantic accuracy. It supports user-directed replies, drafts, read/archive actions and local handled state. Automated sending, AI-written replies, attachments, team workspaces and billing enforcement are out of scope. Notifications and digests are retired.

## Required journeys

| Journey       | Required behavior                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explore       | Public homepage and pricing; clearly labeled fictional demo. Missing credentials never silently activate demo mode.                                                  |
| Sign in       | Server-verified Supabase session; authenticated private routes/APIs; origin-checked mutations.                                                                       |
| Connect mail  | Independent provider OAuth with PKCE/state and verified mailbox identity; encrypted tokens; correct workspace binding.                                               |
| Import        | Gmail's initial 30-day Inbox window; Outlook Inbox traversal; durable pagination, deduplication, incremental changes and rescan recovery. No fixed 100-email cutoff. |
| Handle bursts | Small per-user turns and configurable bounded concurrency; continuations preserve progress and best-effort fairness across users. No unmeasured latency promise.     |
| Open inbox    | Render saved summaries before classification; show current tagged/imported counts, a growing denominator during import and saved progress during cooldowns.          |
| Define rules  | Workspace-unique names, validated prompts/priority/hints; edits invalidate stale decisions.                                                                          |
| Evaluate      | Native Jev boolean questions; match at ≥80%, no-match at ≤20%, otherwise uncertain; deterministic threshold trace, not generated reasoning.                          |
| Browse        | Stable cursor pagination, combined filters, priority views, independent content loading and safe cached summaries.                                                   |
| Act           | Explicit reply/reply-all, persisted drafts, read/archive/trash as granted by provider scopes; reconcile ambiguous sends instead of blindly retrying.                 |
| Manage        | Disconnect only the intended mailbox/workspace; clear private caches; verified user deletion cascades application data and deletes the Supabase identity.            |
| Plans         | Display Starter/Heavy preview and actual usage; billing/allowance blocking remain off.                                                                               |

## Privacy and reliability

Imported full message bodies must not be persisted to Postgres or Inngest step results. Fetch, metadata save and initial classification share one durable step so the body can be reused only in memory. On-demand reads and later classification can refetch it. Summaries, classifications, encrypted tokens and explicitly composed reply drafts are stored. A bounded sample and tag criteria leave the provider for AI evaluation.

Tag/content/model versions control freshness. Cache negative and uncertain decisions as well as matches. Never log raw provider/SDK payloads. Scoping must survive retries, concurrent requests, disconnect and workspace changes. Preserve cursors and newer work revisions; respect shared inference cooldowns without suppressing ingestion. Do not claim exactly-once paid inference across crash boundaries.

## Acceptance

Run unit/protocol/database tests, lint and typecheck; verify usable inbox summaries and progress states in the UI. Synthetic burst fixtures establish correctness, not hosted latency. Separately verify real provider consent, token refresh, cloud worker invocation, private realtime, callbacks, renewal, recovery and staging burst latency. Record dated results in [status](../STATUS.md), never infer them from configured secrets or historical test counts.
