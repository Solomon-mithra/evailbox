# Email conversation reader

**Goal:** Replace the email modal with a Gmail-style reading view in the main workspace, leaving navigation visible. Show the actual conversation, including sent replies, without adding unrelated features.

**Design:** Opening a message replaces the inbox or tag list in place. A compact toolbar provides Back and the existing mail actions. The subject appears once, followed by chronological message headers and readable bodies. Back restores the list's filters, scroll position, and keyboard focus. Reply drafts retain save-before-close behavior. Email HTML stays isolated in sandboxed frames that grow with their content for one reading scroll.

**Data:** Fetch Gmail threads and Outlook conversations on demand through an authenticated, account/workspace-scoped endpoint. Sanitize each body, include sent messages, exclude drafts, and return an explicit partial indication if a bounded conversation cannot be loaded completely. Continue showing the selected cached message while loading or when the thread cannot load. Conversation bodies remain in memory only.

- [x] Add provider and authorization regression tests, then implement thread retrieval.
- [x] Add reader/cache regression tests and replace modal rendering in inbox and tag views.
- [x] Implement safe natural-height message frames and verify isolation.
- [x] Use computer use to verify desktop/mobile reading, thread text, reply drafts, Back, and sidebar access.
- [x] Run relevant tests, lint, typecheck, build, and independent review.

**Delivery:** Commit the focused change on the current `main` branch and push to `origin/main` after verification.

**Provider references:** [Gmail threads.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get), [Microsoft Graph list messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0).

## Verification

- `npm test`: 56 files passed, 541 tests passed, one skipped.
- `npm run lint`, `npm run typecheck`, and `npm run build`: passed.
- Focused formatting and diff checks: passed. Independent review found no remaining blockers.
- Computer-use checks at 1280px desktop and 390px mobile: sidebar stays accessible, no reader modal or horizontal overflow, received/sent/quoted reply bodies are visible in isolated frames.
- Back restores list position and focus; sidebar navigation and workspace switching preserve drafts and dismiss mobile navigation.
- A delayed thread response and image toggle both preserve the exact textarea instance and unsaved text. Background inbox invalidation does not reload conversation frames.
- Browser checks used an isolated demo/fixture workspace; Gmail and Outlook retrieval, authorization, fallback, and pagination were verified with provider fixtures. No real email was sent.
