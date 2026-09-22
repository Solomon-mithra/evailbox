# Phase 2 — Theme, navigation, sessions and contracts

Prerequisite: framework and session foundation. UI acceptance requires actual browser review; this document is not that evidence. Complete functional screens supersede the original temporary dashboard placeholders.

Implemented refinements and evidence: [theme and landing page](../engineering/THEME.md), [provider logos](../engineering/PROVIDER_LOGOS.md), [workspaces](../engineering/WORKSPACES.md) and [current status](STATUS.md).

## 2.1 shadcn Theme

Steps:

1. Establish forest/lime semantic colors, local Inter typography, spacing, border, radius and focus tokens. Use a cool off-white app canvas, retain page-heading box gradients and keep the landing background separately scoped.
2. Build shadcn-style composable controls from Radix primitives and Tailwind: button, input, card, badge, dialog, dropdown, tabs and loading feedback.
3. Apply semantic priority accents and consistent disabled/error/focus behavior.
4. Review controls in keyboard navigation and narrow/high-zoom layouts; verify labels and contrast.

Acceptance criteria:

- Shared controls are reused across screens and have visible focus and disabled states.
- Dialogs expose accessible names and usable keyboard interaction.
- Priority and state remain understandable without color alone.
- Documentation describes the actual Radix/shadcn-style implementation; a generator invocation is not required evidence of accessibility.

## 2.2 Auth Pages

Steps:

1. Implement sign-in, callback/error feedback and sign-out transitions using the session API.
2. Show clear provider failure/loading states and prevent repeated submissions while a transition is pending.
3. Make demo access and live authentication visibly distinct; never fabricate an authenticated user in live mode.
4. Test public sign-in, redirected private route, callback failure and successful return to `/inbox`.

Acceptance criteria:

- Sign-in initiates the real live OAuth flow and the explicit demo remains isolated.
- Callback failure offers a usable retry path without exposing provider secrets.
- Browser navigation and keyboard activation work on all auth controls.

## 2.3 Dashboard Navigation

Steps:

1. Build the desktop sidebar/header and responsive mobile navigation.
2. Link Inbox (`/inbox`), Tags, Accounts and Settings, with an identifiable active destination and a Personal/Work switcher. Keep `/` as the public landing page with an **Open inbox** action.
3. Preserve meaningful page titles and browser navigation behavior.
4. Test every navigation entry at desktop and mobile widths using keyboard and pointer.

Acceptance criteria:

- Every destination resolves and displays the correct active state.
- Navigation remains reachable without horizontal overflow on a narrow viewport.
- Focus stays visible and mobile menu controls have accessible labels.

## 2.4 Dashboard Placeholders — Superseded by Complete Screens

Steps:

1. Use loading skeletons only while real data is pending; replace original static placeholder pages with the functional views in Phases 3–5.
2. Add distinct empty, error, disconnected and demo states.
3. Ensure buttons either perform their intended action or clearly explain unavailable live configuration.
4. Review all destinations for dead links, fabricated statistics and permanent loading indicators.

Acceptance criteria:

- No user-facing page is merely a “coming soon” placeholder for an in-scope feature.
- Demo fixtures are labeled and production never substitutes them for a failed API.
- Loading, empty and failed states have usable recovery/action paths.

## 2.5 Session and Protected Routes

Steps:

1. Refresh Supabase session cookies in `src/proxy.ts` and redirect unsigned private-page requests to sign-in.
2. Independently call `requireUser()` on protected APIs; never trust page protection as API authorization.
3. Enforce same-origin mutation checks and server-side user scoping.
4. Test stale cookies, signed-out access, public homepage/provider SVGs, callback/unsubscribe exceptions, legacy deep-link redirects and user A requesting user B's resource IDs.

Acceptance criteria:

- Private APIs reject unauthenticated requests even when called directly.
- Untrusted mutation Origin is rejected and cross-tenant resource IDs yield safe not-found behavior.
- The homepage, exact provider SVG asset paths, callback and unsubscribe routes remain public without opening unrelated private routes. Homepage metadata is indexable; app metadata remains noindex.
- Legacy root email/workspace links redirect to `/inbox` with parameters preserved.
- Browser session verification and real two-user tests remain pending until executed externally.

## 2.6 TypeScript Types and API Helpers

Steps:

1. Define shared user, account, tag, email, classification, workspace, filter and preference types from actual public projections.
2. Use a consistent `{data}` success / `{error}` failure client helper and safe status handling.
3. Use React Query hooks for fetching, mutations and workspace invalidation; separate demo mutation storage.
4. Validate inputs with Zod on the server, including unknown-field rejection and bounded bodies.
5. Run strict typecheck and tests for malformed JSON, validation limits and safe error messages.

Acceptance criteria:

- Client types exclude encrypted/provider token fields and unsubscribe secrets from ordinary workspace responses.
- Call sites handle errors and pending state without swallowing failures as success.
- Types match actual endpoints, including the aggregate response from `/api/emails`.
