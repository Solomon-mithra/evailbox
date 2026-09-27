# Inbox tag pills implementation plan

**Goal:** Replace the inbox overview's expandable tag groups with pills showing each tag's name and total matching email count. Clicking anywhere on a pill opens the existing `/tags/[id]` page.

**Architecture:** Keep the existing inbox query and tag detail pages. Render a semantic list of Next.js links in `src/components/inbox.tsx`, using the existing priority colors. Read counts from `tagCounts`, including zero; show a dash while counts are unavailable rather than a partial page count. Replace obsolete accordion styles in `src/app/globals.css` with wrapping pills, visible keyboard focus, and touch targets at least 48px tall. Preserve the create-tag empty state.

**Tech stack:** Next.js App Router, React, CSS, Vitest, T3 browser preview.

- [x] Inspect the inbox, existing tag route, count query, and installed Next.js Link documentation.
- [x] Replace tag dropdowns with linked pills and remove unused accordion styles.
- [x] Run existing inbox/tag tests, lint, typecheck, and formatting checks.
- [x] Verify desktop/mobile layout, counts, keyboard navigation, empty tags, and existing tag-page navigation in a temporary demo instance.
- [x] Review the focused diff with an independent reviewer.

**Validation:** All 23 tests in `inbox-view.test.ts`, `inbox.test.ts`, and `tags-view.test.ts` passed, along with ESLint, TypeScript, Prettier, and `git diff --check`. T3 computer use verified the pills at 1280px and 390px, navigation to Finance and Opportunities (including Tab/Enter), a 121-match count beyond the 50-email page size, a long name with zero matches, and the no-tags empty state. Temporary demo data was restored afterward. Review found no issues.

**Delivery:** Commit the focused changes on `main` and push to `origin/main`.
