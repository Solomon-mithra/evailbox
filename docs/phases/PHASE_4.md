# Phase 4 — Tags and native Jev classification

Prerequisite: tenant-safe persistence and email synchronization. Native protocol fixtures verify integration shape, not semantic accuracy, provider availability or cost. Live Jev validation remains pending until an authorized synthetic evaluation is run.

## 4.1 Tags UI

Steps:

1. Display the user's tag names, descriptions, priority and available match counts.
2. Provide create, edit, delete and detail navigation with accessible controls and visible loading/empty/error states.
3. Keep priority readable without color alone; isolate demo mutations.
4. Test zero tags, maximum tags, long names/descriptions and narrow layouts.

Acceptance criteria:

- All tag actions are reachable and operate on the intended tag.
- Counts are derived from available data and are not presented as global totals when only a paged subset is loaded.
- Empty state directs the user to create meaningful criteria.

## 4.2 Tag Form

Steps:

1. Provide name, description, semantic prompt, priority, keyword hints and sender hints.
2. Enforce name 1–60, description ≤500, prompt 10–2000, ≤30 keywords ≤80 chars and ≤30 valid sender emails.
3. Explain prompt-first behavior and that hints are supporting context unless explicitly required by the prompt.
4. Surface field errors, prevent duplicate submission, preserve input on failure and close/reset only after success.
5. Test invalid sender, empty/short prompt, duplicate name and maximum lengths.

Acceptance criteria:

- Server-side Zod validation is authoritative and unknown fields are rejected.
- Users can submit valid create/edit forms by keyboard and recover from errors without losing work.
- Form wording does not promise perfect classification or generated model explanations.

## 4.3 Tags CRUD

Steps:

1. Implement own-tag list/get/create/patch/delete with userId scoping.
2. Normalize nameKey to lowercase and enforce per-user uniqueness plus the 30-tag limit.
3. On edit, increment tag version and invalidate its existing classification rows transactionally.
4. Delete with cascades and preserve other users' tags.
5. Test concurrent duplicate names, wrong-owner IDs, patch validation and version invalidation.

Acceptance criteria:

- Same-user case-insensitive name collision produces conflict; another user may reuse the name.
- Edits cannot leave old results appearing current.
- Cross-tenant reads/mutations fail safely and deletes affect only the selected tag's results.

## 4.4 Jev Engine

Steps:

1. Configure server-only Gateway base URL/key and pinned AI SDK 7 evaluation dependencies.
2. Call `experimental_evaluate` with `gateway.evaluation('typesafe-ai/jev')`, bounded shared email state and up to 30 independent native boolean questions for only that email's missing tags.
3. Mark email content untrusted; apply the user's tag criteria without obeying instructions embedded in the message.
4. Validate probability 0–1 and map it to match/no_match/uncertain using explicit thresholds; produce only a deterministic probability/policy trace.
5. Set timeout/retry and retention/training request controls; propagate inference errors instead of storing invented results.
6. Run native wire-protocol, multi-question mapping, threshold/malformed-output and complete-answer fixtures; prove three tag decisions use one HTTP call. Separately evaluate authorized labeled synthetic examples through the real gateway.

Acceptance criteria:

- Request uses `/evaluation-model` and native typed questions, not chat completions or generated JSON.
- Default policy is ≥80% match, ≤20% no-match, otherwise uncertain; confidence is P(match) ×100.
- Invalid/error responses remain errors; no fake classification or rationale is produced.
- Quality, latency and cost claims require measured evidence; fixture pass alone is insufficient.

## 4.5 Classification Endpoints

Steps:

1. Implement single `/api/classify` and bounded `/api/classify/batch` with optional tag selection.
2. Validate up to 20 explicit email IDs and verify all requested resources belong to the caller before inference.
3. Persist one classification per email/tag with tagVersion, decision, probability, trace and notification marker.
4. Skip every existing current-version result, including no-match and uncertain, unless a force evaluation was explicitly requested; process up to 100 candidate emails per pass.
5. Return classified/errors/remaining counters and persist requested work for automatic continuation; test invalid IDs, wrong owners, current/stale versions, partial errors, concurrent tag edits and deadline exhaustion.

Acceptance criteria:

- A caller cannot classify another user's mail or tag.
- Stale results are hidden; current results are reused during ordinary batches.
- Failed evaluations do not create fabricated no-match rows and remain retryable.
- Endpoint responses distinguish successful work from errors and deferred work.

## 4.6 Automatic Classification After Sync

Steps:

1. Invoke pending classification after requested provider pages within the user-worker budget; persist remaining work for the minute worker.
2. Scan up to 100 candidate emails; evaluate only missing tag/version pairs in one multi-question call per email, reusing all completed decisions.
3. Trigger eligible push notification checks only after persisted classifications exist.
4. Verify new mail, new/edited tags, transient Jev failure and 1,000 messages across automatic worker passes. Assert 1,000 mocked email calls for two tags each and zero calls on a subsequent completed pass.
5. Monitor backlog and deadline behavior; do not assume one request completes every email/tag pair.

Acceptance criteria:

- Successfully synced mail becomes eligible for evaluation without a separate manual per-email action.
- New/changed criteria are eventually retried through the pending-work path.
- Deadline exhaustion leaves durable requested work for automatic resume, preserves committed sync/classification data, and does not force re-evaluation of completed negative results.
- No success statement conceals unresolved inference failures or a backlog.
