# Fast inbox and paid-plan preview: approved design

Date: 2026-09-25. Approved by the user's quoted implementation request; follow-up requires PRD/phase updates and a commit for every task.

Keep Next.js, Supabase/Postgres, Prisma and Jev. Separate the interactive read path from durable email ingestion/classification. Serve 50 summaries through a tenant/workspace-scoped cursor endpoint; fetch metadata, counts and bodies independently. Persist only safe summary/query data in IndexedDB under authenticated user/workspace keys, clear it on logout/disconnect, and signal background changes through authenticated Supabase Realtime.

Inngest orchestrates short resumable fetch/classification jobs. Database work flags, revisions, account/user leases, checkpoints and provider cooldowns remain the source of truth and recover lost event publication. Gmail Watch/PubSub and Graph subscription notifications request work without inline processing. Verify webhook authenticity, renew expiring subscriptions, and run periodic recovery. Use bounded model concurrency, batched guarded writes, and content/tag/model version checks. Do not log email content, tokens or raw SDK errors.

Remove push/digest UI and delivery paths. Existing historical delivery tables may remain inert to avoid unrelated destructive data migration. Add provider-backed manual reply/reply-all, draft persistence, correct sender/thread handling and explicit send-state reconciliation. Read/archive actions apply through provider APIs; local handled remains independent. No automated outbound sends or live test email.

Price Starter at $14/month (5,000 newly processed messages advertised allowance) and Heavy at $24/month (10,000). Billing and usage enforcement are OFF; display preview/access status honestly with no payment collection or blocking. Store trusted entitlements server-side, display them in account management, and grant Heavy to the existing verified Supabase identity solomonmithra99@gmail.com through admin metadata plus app data. User-editable metadata cannot confer access.

Measure browser cache restoration/rendering, server inbox read duration and new-mail processing separately. Sub-100-ms is a target only for a warm cached inbox; no such promise for first visit or inference. Do not add Redis without evidence.

Local acceptance: isolated-user tests, cursor ordering, cache privacy, queue retry/revision behavior, webhook verification/replay, subscription renewal, classification race protection, draft/send idempotency, plan access and notification retirement; typecheck, lint, production build and browser journeys. Live service activation is documented separately from fixture success and depends on available credentials and deployed callback URLs.

