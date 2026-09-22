# Personal and Work workspaces

Each user has two built-in spaces: Personal and Work. The sidebar switcher selects the space on desktop and inside the mobile navigation drawer. Selection persists in this browser. Work starts empty; existing records remain Personal. Legacy browser keys migrate to evailbox keys without discarding demo edits.

Accounts, messages, tags, match counts, searches, manual classification and account sync requests use the selected workspace. Tag names are unique per user and workspace, with up to 30 tags in each space. API selection uses `workspace=PERSONAL|WORK`, defaults to `PERSONAL` when omitted and rejects invalid values. The same mailbox can be connected independently in each space. OAuth carries the originating workspace in authenticated state, so switching while consent is open cannot attach an account to the wrong space.

Notification preferences and account deletion remain account-wide. Background processing covers both spaces, but classification never mixes their mail and rules. New notification and digest links use `/inbox?email=…&workspace=…`; digest sections identify the workspace. Old email links without a workspace target Personal. Root links containing `email` or `workspace` redirect to `/inbox` with their parameters preserved.

## Data migration

The migration in `prisma/migrations/20260922000000_workspaces/migration.sql`, following the initial migration, adds a PERSONAL-defaulted enum to accounts, messages, tags and classifications. It preserves all existing rows. Composite foreign keys enforce matching user and workspace for account/email/tag associations, including privileged writes.

Apply with `npm run db:migrate` against the intended live database before serving the updated application. Coordinate migration and application rollout because the mailbox unique key changes. This change has not been applied to any external database or deployed by the workspace feature task.

## Browser-storage compatibility

| Value               | Current key                   | Legacy key                    |
| ------------------- | ----------------------------- | ----------------------------- |
| Personal demo state | `evailbox-demo-v1`            | `jevinbox-demo-v1`            |
| Work demo state     | `evailbox-demo-v1-work`       | `jevinbox-demo-v1-work`       |
| Selected workspace  | `evailbox-selected-workspace` | `jevinbox-selected-workspace` |

`src/lib/browser-storage.ts` reads a legacy value only when the current key is absent. It writes the new value before removing the old key; a blocked write still permits reading the legacy value. The workspace-change event is `evailbox-workspace-change`.

Demo data is parsed before copy migration. Only known generated email sentences and classification explanations receive the evailbox name; custom rules, names, keywords and sender hints remain verbatim. Demo reset removes both generations of demo-state keys and returns to `/inbox`. These browser keys contain fictional demo state, not live provider tokens.

## Validation

- Migration runs against PGlite after inserting legacy user, account, tag and email rows.
- Tests verify existing emails remain Personal, names can repeat across workspaces, and cross-workspace account/email/tag associations fail.
- API tests cover workspace-scoped reads and writes and invalid workspace rejection.
- Demo tests cover separate persistence and protection against changes to another space.
- OAuth tests verify workspace is preserved in encrypted, user-bound state.
- Browser checks cover switching, reload persistence, separate tag creation, existing Personal data, email links, and the mobile selector.

No team memberships, custom workspace names, or moving existing mailboxes between spaces are included.
