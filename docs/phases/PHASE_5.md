# Phase 5 — Inbox, detail views and preferences

Prerequisite: workspace API, account data and versioned classifications. Perform the browser checks with both explicit demo data and, when authorized, live test data. No browser or live-data acceptance is implied by this document.

Personal/Work boundaries, rollout and evailbox browser-key compatibility are documented in [WORKSPACES.md](../engineering/WORKSPACES.md). See [STATUS.md](STATUS.md) for completed local checks and remaining acceptance.

## 5.1 Inbox — Needs You, By Tag, This Week

Steps:

1. Implement `/inbox` in the selected Personal/Work workspace with meaningful Inbox tabs/grouping and consistent message rows.
2. Display sender, subject, snippet, date, provider/account, current tags, priority and available decision/probability.
3. Define Needs You eligibility from unhandled matched mail and ensure This Week uses the intended seven-day boundary.
4. Add empty, loading and failed-query states plus pagination for the 50-row workspace contract.
5. Test handled/unhandled, no-match/uncertain, multi-tag and boundary-date fixtures.

Acceptance criteria:

- View names correspond to actual filters/grouping, not decorative tabs.
- Stale tag-version results never appear as current matches.
- Pagination exposes remaining results and counts do not masquerade as unfiltered totals.
- Empty and uncertain states are understandable without implying lost mail.

## 5.2 Email Detail

Steps:

1. Open the selected message using its local ID; load/check detail owned by the user and selected workspace. Delivery links include `workspace`; legacy email links without it target Personal.
2. Display sender/address, received time, subject, plain-text body or snippet fallback and current classifications.
3. Label classification trace as probability/threshold policy, not generated semantic explanation.
4. Add local handled toggle and safe provider link; maintain focus behavior on open/close.
5. Test long text, HTML-like strings, missing body, invalid ID, multi-tag matches and mobile scrolling.

Acceptance criteria:

- Email content renders as escaped text and cannot execute HTML/script.
- Handled persists locally and never claims to archive/read/delete remotely.
- Provider links stay within allowed provider behavior and details do not leak another user's mail.
- Keyboard users can enter/leave the detail view predictably.

## 5.3 Search and Filters

Steps:

1. Connect search, tag, account and date-range controls to the documented workspace query.
2. Compose all selected filters and reset page to zero when the result set changes.
3. Search subject, sender and senderName with the server's case-insensitive behavior.
4. Preserve visible filter values and add an obvious reset path.
5. Test combinations, special characters, no results, page boundaries and rapid filter changes.

Acceptance criteria:

- Multiple filters apply together rather than one replacing another.
- Result count and pagination correspond to the current filter set.
- Input is bounded and query errors are recoverable; no raw SQL or unsafe HTML is constructed.

## 5.4 Tag Cards and Detail

Steps:

1. Provide a dedicated selected-tag view with name, description, prompt/priority context and matching mail.
2. Bind the tag ID to the workspace filter and paginate matching messages.
3. Use workspace-wide aggregate counts on cards, full-card navigation and a separate **Edit rule** action. Keep deletion in a secondary menu with confirmation and focus restoration.
4. Label manual evaluation **Check for matches**, invalidate queries after edits and distinguish zero matches from unavailable counts.
5. Review empty matches, stale results during re-evaluation, deleted tag, wrong-owner/workspace IDs and long rules.

Acceptance criteria:

- The view identifies the selected rule and shows only its current relevant matches.
- Edits invalidate prior classification state and errors leave a usable page.
- Deleted/non-owned tags produce a safe empty/not-found state rather than data leakage.

## 5.5 Settings

Steps:

1. Bind browser push, daily digest, local digest time, IANA timezone, minimum notification confidence and refresh minutes to preferences APIs.
2. Validate time/timezone/ranges server-side; persist defaults when a user has no preferences row.
3. Request browser permission only on explicit action and explain unsupported/denied states.
4. Provide sign-out and destructive account deletion with literal `DELETE` confirmation; distinguish disconnect from deletion.
5. Test save/reload, invalid timezone, midnight time, confidence bounds, disabled notification permission and deletion isolation.

Acceptance criteria:

- Preferences remain account-wide across Personal/Work; values persist in live mode and demo changes remain local/fictional.
- The notification confidence floor is not represented as changing the Jev classification threshold.
- Refresh setting explains cached query refresh versus actual provider synchronization.
- Destructive user deletion requires explicit confirmation, covers both workspaces and cannot affect another tenant.

## 5.6 Real Time — Five-Minute Query Refresh

Steps:

1. Set React Query workspace refetch interval from saved `refreshMinutes` (default five minutes, range 1–60).
2. Invalidate workspace queries after successful mutations and show sync status while operations run.
3. Test a preference change affects subsequent query timing and that mutation results appear without a full reload.
4. Verify background-tab/reconnect behavior in the chosen browser; document that timer throttling can delay refresh.
5. Distinguish cache polling from provider sync: daily 03:00 UTC cron marks incremental account work, minute cron drains requested work, and manual Sync durably requests an immediate worker pass.

Acceptance criteria:

- Default workspace polling is configured for five minutes and respects a valid changed preference.
- Mutation invalidation refreshes displayed state and does not repeatedly create provider connections.
- Product copy does not claim websocket/live push mail delivery or five-minute provider polling when only cached-query polling is implemented.
- Live observed refresh timing remains pending until browser/network evidence is captured.
