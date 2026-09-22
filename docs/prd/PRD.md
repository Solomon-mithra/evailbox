# evailbox product requirements

Revision: 2026-09-21. Scope ends at Phase 6. This document defines intended behavior and acceptance; it is not proof of live validation. See the phase documents and runbook for executable checks.

## Problem and audience

People managing busy personal and work inboxes across several email accounts need a focused view of messages that meet their own criteria: urgent customer issues, invoices, hiring conversations, or project updates. Existing folder rules struggle with semantic criteria. evailbox lets an individual define a tag in ordinary language and evaluate incoming email against it while retaining a clear route back to the provider.

## Product outcome

A signed-in user connects Gmail or Outlook, creates up to 30 tags per workspace, synchronizes messages, and reviews matches with a probability and policy trace. The product supports uncertain results and visible failures; it must never claim zero semantic errors or imply that a probability is calibrated accuracy. Notifications require explicit opt-in. Mail is read-only at the provider. “Handled” is a local triage flag, not remote archive/delete/read status.

## User journeys and acceptance

| Journey                         | Requirement                                            | Acceptance                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover the product            | Public homepage at `/`                                 | Explain email matching in plain language with labeled Personal/Work examples; **Open inbox** opens `/inbox`.                                                                                                                                                          |
| Separate work and personal mail | Two built-in workspaces                                | Selection persists in this browser; accounts, tags, email and matching remain separate; existing data stays Personal.                                                                                                                                                 |
| Explore safely                  | Explicit demo with isolated fictional data             | Demo is labeled; demo edits cannot access production mail; missing live credentials never enable demo implicitly.                                                                                                                                                     |
| Sign in                         | Google authentication via Supabase                     | Session is verified server-side; unsigned private navigation redirects; private APIs reject unauthenticated calls.                                                                                                                                                    |
| Connect mail                    | Independent Gmail/Outlook OAuth                        | PKCE and expiring state bind to the signed-in user; provider identity determines mailbox address; encrypted tokens never appear in public API responses.                                                                                                              |
| Define a tag                    | Name, description, prompt, priority, keywords, senders | Validated create/edit/delete; names unique ignoring case within a user and workspace; edits invalidate prior classification versions; 30-tag limit enforced per workspace; cards expose the rule, accurate workspace-wide count and independent edit/delete controls. |
| Synchronize                     | Paginated Inbox import and incremental changes         | Cursor persists with message changes; deletion/read changes applied; errors are visible and retryable; another tenant's account cannot be synchronized.                                                                                                               |
| Review Inbox                    | Search and combined account/tag/date filters           | Results reflect combined filters and stable pagination; email opens in a detail view; local handled state persists.                                                                                                                                                   |
| Understand classification       | Native Jev evaluation                                  | Typed probability converted by explicit policy: ≥80% match, ≤20% no-match, otherwise uncertain; trace identifies threshold policy, not invented model rationale.                                                                                                      |
| Return to mail                  | Provider link                                          | Gmail/Outlook link opens safely; email HTML is never rendered.                                                                                                                                                                                                        |
| Receive push                    | Opt-in browser notification                            | Permission requested through user action; only eligible high-priority, unread, unhandled matches; invalid subscriptions pruned.                                                                                                                                       |
| Receive digest                  | Daily local time and timezone                          | Opt-in, grouped matching emails, unsubscribe link, unique user/date record and delivery idempotency; live scheduling/delivery validated separately.                                                                                                                   |
| Manage account                  | Disconnect mailbox or delete user                      | Disconnect removes cached mailbox data; user deletion clears application records through cascades and deletes Supabase identity.                                                                                                                                      |

## Scope and boundaries

The Gmail initial Inbox window is 30 days, with later history changes tracked. Outlook initial synchronization traverses the Inbox folder, not every folder. Messages may have a snippet but no body when only HTML is available. No attachments, outbound sending, remote modifications, team sharing, billing, or training on user feedback are included.

The current implementation polls cached workspace data according to the refresh preference; provider synchronization is a separate action and a scheduled job. The live sync cron requests work at 03:00 UTC daily, and an every-minute worker resumes pending sync and classification. Demo cron is disabled. The digest cron is every 15 minutes and requires Vercel Pro or an equivalent authorized scheduler. Full mail ingestion is resumable and bounded by request deadlines; a single click may not finish a large mailbox or all classifications.

## Data and privacy requirements

Store only the email fields needed for the workspace and a bounded plain-text body. Provider tokens use authenticated AES-256-GCM encryption. Never send provider tokens to Jev. Jev receives a bounded email sample and the user's tag criteria through the configured server-side Gateway; the request sets Zero Data Retention and disallows prompt training. These controls and actual provider routing require external verification. Users must understand that semantic classification sends email content to a third-party model service.

All server data operations enforce the authenticated user's ID. PostgreSQL RLS adds protection for direct client access, but the privileged server connection can bypass it. Composite foreign keys prevent cross-tenant and cross-workspace email/account/tag associations. Notification preferences and user deletion remain account-wide. Logs exclude bodies, token values and raw upstream errors. Account deletion is destructive and requires the literal confirmation `DELETE`.

## Experience and accessibility

Use local Inter typography, forest navigation, lime selection and semantic priority accents. App pages share a cool off-white canvas while page-heading boxes retain their gradients; the landing page has its own green hero backdrop. White reading surfaces, readable type sizes and compact message rows support frequent use. Shared local Gmail/Outlook SVGs identify providers alongside text. See the [theme specification and measured contrast](../engineering/THEME.md). Desktop and mobile navigation should expose the same destinations. Loading, empty, disconnected, permission-denied and failed-sync states are first-class. Dialogs need labels, keyboard focus, Escape handling and visible focus states. Probability and priority must remain understandable without color alone. Browser checks are evidence only when recorded after execution.

## Success measurement

Track successful OAuth connection rate, completed sync rounds, sync errors and backlog, classification latency/failures/uncertain share, user-reviewed classification quality, notification delivery errors, digest timeliness, and successful deletion. Define accuracy targets only after an authorized labeled-email evaluation. Do not treat fixture test success as measured model accuracy. Cost depends on mail volume, tag count, reclassification, retries and external pricing; no fixed operating-cost promise is made.

## Release gates

Local: tests, typecheck, lint, production build and browser journeys pass with recorded commands/results. External: real two-tenant isolation, provider consent/refresh/deltas, Jev evaluation, push delivery, digest idempotency/unsubscribe, migration/RLS, deployment configuration and 24-hour monitoring remain pending until explicitly exercised. A deployable demo is not a verified live email service. Production publishing is a separate final approval step in the runbook.
