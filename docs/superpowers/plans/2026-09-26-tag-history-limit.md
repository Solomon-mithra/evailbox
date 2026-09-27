# Tag history limit implementation plan

**Goal:** New tags consider at most the latest 100 existing Inbox emails in the selected workspace. Check for matches selects at most the latest 100 emails still needing decisions, while new arrivals remain eligible.

**Architecture:** Persist a timestamp and a snapshot of historical email IDs per tag. Capture the latest 100 overall on creation and rule edits. Explicit checks snapshot the latest 100 emails missing a current decision for any selected tag, shared across all selected tags rather than 100 per tag. Workers, retries, forced checks and progress counts respect the same eligibility rule. The migration bounds existing tags and preserves saved classifications. Another explicit click can select the next 100 pending emails; automatic continuations cannot. Imports and snapshots share a transaction advisory lock, with microsecond arrival times stamped after acquiring it. Description/priority-only edits retain saved decisions; changed AI inputs invalidate old decisions and start a bounded recheck.

**Tech stack:** Next.js Route Handlers and React, Prisma/PostgreSQL, Vitest/PGlite.

- [x] Add a real-SQL regression proving a new tag with 250 stored emails stops after the latest 100, including when all are unprocessed; observe the existing implementation fail.
- [x] Add tag scope columns and atomic database triggers for insert/rule edit and arrival stamping. Initialize existing tags from the latest 100 in their user/workspace. Add a shared SQL eligibility predicate.
- [x] Apply eligibility to worker selection, per-email tag lists, save-time validation, forced calls and remaining counts. Keep skipped mail out of both remaining and completed progress.
- [x] Make explicit match requests refresh the selected tags' history and queue work atomically. Keep explicit message reruns within scope rather than deleting excluded classifications.
- [x] Explain the scope in the create/edit dialog and next to Check for matches; mirror bounded selection in demo mode.
- [x] Test repeated checks, partial worker batches, future arrivals, mixed tag scopes, force paths, migrations, workspaces, progress counts and route authorization.
- [x] Run focused tests, full tests, lint and typecheck. User explicitly requested code-only work, so do not use computer/browser tools.

The user subsequently requested a commit of all uncommitted changes and removal of the About evailbox navigation link. Include both in the completed commit. The database migration is included in code and must be applied before running the updated application against a live database.
