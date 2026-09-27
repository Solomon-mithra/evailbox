# Initial Mail Limit Implementation Plan

**Goal:** Import at most the latest 100 existing Inbox messages per new connection, then continue with new arrivals and updates to retained messages.

**Architecture:** Persist the initial allowance in provider cursors so retries and worker turns cannot reset it. Gmail switches to its captured history checkpoint after the allowance is exhausted. Outlook drains lightweight delta references to obtain the real delta token, hydrating only the first 100 existing messages. Incremental updates to older, unimported messages cannot create new local rows. Existing legacy cursors remain readable.

**Tech Stack:** Next.js, Prisma, Gmail history, Microsoft Graph delta, Vitest.

- [x] Add failing provider tests for a multi-page 100-message limit, incremental arrivals, legacy cursors, and expired checkpoint recovery.
- [x] Implement bounded provider cursors in `src/lib/providers/gmail.ts` and `outlook.ts`; extend `SyncPage` with optional `createIds` and enforce update-only messages in `src/lib/sync.ts`.
- [x] Run provider/sync tests, the full suite, lint and typecheck. Update provider and setup documentation.
- [x] With workers stopped, atomically delete the selected user's imported emails (cascading classifications and drafts), reset mailbox checkpoints and queue a fresh sync. Preserve login, tags, connections, billing, usage and provider cooldowns.
- [x] Restart local app and worker; verify that the initial import stops at 100 and changes to the same mailbox do not restart historical pagination.

**Reset authorization:** User selected “Clear mail data and restart sync” on 2026-09-26. Only that user's application-side mail cache and drafts are reset; provider mail is never deleted.

**Verification:** 430 tests passed, 1 opt-in fixture skipped; lint, typecheck, build and diff whitespace check passed. Authorized reset verified 740 emails / 20 classifications -> 0, with 4 tags and 1 connection retained. Live Gmail import then reached exactly 100 saved emails, history cursor, syncRequested=false and no sync error. AI tagging remains subject to the existing 429 cooldown. Outlook and subsequent-arrival/recovery behavior were checked with HTTP fixtures.
