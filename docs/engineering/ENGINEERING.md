# Architecture

The source in `src/`, `prisma/schema.prisma` and `prisma/migrations/` is authoritative. This document explains the boundaries that the code relies on.

## Stack

| Layer          | Implementation                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- |
| Framework      | Next.js 16 App Router, Node.js 22, `src/proxy.ts`, Node API routes                          |
| Interface      | React 19, strict TypeScript, Tailwind CSS 4, Radix primitives, Lucide, local Inter font     |
| Client data    | TanStack Query 5 with bounded private IndexedDB summary persistence and polling             |
| Database       | SQLite through Prisma 6 (`data/evailbox.db` by default)                                     |
| Mail providers | Direct Gmail REST and Microsoft Graph requests with deadlines                               |
| Inference      | AI SDK 7 `experimental_evaluate`, AI Gateway evaluation model `typesafe-ai/jev`             |
| Background     | In-process loop in `src/lib/background.ts`, started from `src/instrumentation.ts`           |
| Encryption     | Node AES-256-GCM; key from `ENCRYPTION_SECRET_KEY` or generated once into `data/secret.key` |
| Validation     | Zod, Vitest against real SQLite, TypeScript, ESLint, Prettier                               |

## Identity and access

One instance has one owner (`LOCAL_USER` in `src/lib/auth.ts`). With no `APP_PASSWORD`, anyone who can reach the server is the owner. With a password set, `src/proxy.ts` redirects pages to `/signin` and API handlers return 401 without a valid session cookie. The cookie MAC is keyed by the server secret and the password, so changing either signs everyone out. Failed sign-ins back off globally, capped at one minute per attempt.

`allowedHost` in `src/lib/env.ts` admits only the configured `NEXT_PUBLIC_APP_URL` host, or loopback on the same port. The proxy refuses other `Host` headers for every route, and mutating requests must also send an allowed `Origin`. Together these block DNS-rebinding pages and cross-site requests against an unlocked local instance.

## Keys and settings

`app_settings` holds one row: Google and Microsoft client IDs, encrypted client secrets, the Microsoft tenant, and the encrypted AI Gateway key. `GET /api/app-settings` returns only client IDs, the tenant, `hasSecret` flags and the redirect URIs to register. Secrets are write-only. `src/lib/app-settings.ts` resolves credentials from the row first and environment variables second. A missing provider client turns a connect attempt into a redirect to the matching Settings row.

## Interactive path

Inbox summaries, metadata, counts, settings and message content have separate read paths. The inbox query uses stable `receivedAt`/`id` cursor pagination with 50 summaries, filtering inside SQLite against version-current classifications. The cursor is encrypted and bound to the filters. Focus refresh and polling keep views current; active work polls every two seconds.

Message bodies are fetched live for reading, sanitized, and rendered in a sandboxed iframe with its own CSP. Bodies are never written to the database or the persistent browser cache.

## Background path

1. Connecting an account, syncing, or editing tags sets durable work flags on the user and accounts, increments revisions, and calls `kickWork()`.
2. The worker also ticks every 30 seconds and marks all accounts for sync every two minutes.
3. Each turn (`processInboxBatch` in `src/lib/work-batch.ts`) imports one provider page, saves summaries and the cursor in one transaction, then classifies up to 20 emails within a shared 40-second deadline. Bodies fetched during import are reused from memory and discarded.
4. `finishWorkBatch` preserves newer revisions and failure backoff. The loop continues while pages remain, up to 10 turns per user per tick.

Without an AI key, classification is skipped and the inbox says so. Saving a key requests work for the existing backlog. An AI Gateway 429 stores a shared cooldown in `processing_state`; imports continue during the cooldown.

## Durability and freshness

Provider cursors advance in the same transaction as message changes. Account leases serialize sync, token refresh, replies and disconnect. Expired cursors trigger resumable rescans that keep existing triage and remove disappeared rows only when the rescan completes. A classification counts as current only while its tag version, content hash and model version all match. Negative and uncertain decisions are cached too. SQLite runs in WAL mode so reads proceed during worker writes; run a single server process.

## Data and privacy boundaries

- Stored: message summaries, flags and content hashes; classifications; tags; account identity and encrypted OAuth tokens; cursors and work state; encrypted keys; user-written reply drafts.
- Not stored: email bodies, in the database, logs or the persistent browser cache.
- Sent to the AI Gateway: a bounded body sample, subject, sender, snippet and tag criteria, only when a key is configured.
- Provider and SDK errors can contain private mail, so only sanitized metadata is logged.

See [providers](PROVIDERS.md) for OAuth, sync and Jev details, and [workspaces](WORKSPACES.md) for Personal/Work isolation.
