# Email providers and Jev

## Contract and secrets

Server-only entry points are `src/lib/providers/index.ts` and `src/lib/jev.ts`. Token expiry is Unix epoch **milliseconds**. Refresh responses can omit `refreshToken`; retain the existing encrypted refresh token in that case. A rotated refresh token replaces the old one.

Gmail requires `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Outlook requires `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optionally `MICROSOFT_TENANT_ID` (default `common`, supporting personal and organizational Microsoft accounts when the registration allows both). Configure the exact callback URI from the application in each provider's app registration. Google Gmail access may require restricted-scope verification and a security assessment before broad production availability; development consent/test users are distinct from a verified production application.

OAuth uses authorization code + S256 PKCE. The caller owns a cryptographically random, single-use state, verifier storage and expiry, authenticated-user binding, callback origin validation, token encryption, and prevention of connecting one account to another user's mailbox. Provider scopes are only `gmail.readonly` and `offline_access Mail.Read User.Read`; neither adapter can send or modify remote mail. Identity is fetched from the authorized provider, never accepted from callback query fields.

## Synchronization

Persist `cursor` as an opaque string and only advance it in the same database transaction as all message upserts/deletions from its `SyncPage`. Namespace provider message IDs by mailbox. Keep requesting pages while `hasMore` is true, subject to the service's time/page budget; resume the saved cursor on the next run. A thrown error means do not advance the cursor. A sync page may contain zero messages and still have more work.

- **Gmail:** initial Inbox import covers the preceding 30 days, in pages of 25 IDs. The initial time boundary is fixed for the round. Capture the mailbox history ID before listing; after the final initial page, run history catch-up from that captured ID to avoid missing changes during pagination. History tracks every event type, including read-label updates, Inbox additions/removals, and deletions. Preserve the original history ID while following `nextPageToken`; advance only when history pagination ends. Fetch current message content in concurrency batches of four, deduplicate references, and treat message-level 404 / no longer in Inbox / spam / trash as local tombstones. Older messages subsequently moved into Inbox can enter the local cache through history. A history-level 404 triggers a full current-Inbox rescan (`after:0`), including older Inbox messages, and `reset: true`.
- **Outlook:** synchronize the **Inbox folder**, using `/me/mailFolders/inbox/messages/delta`, pages of 25, immutable IDs, and exact returned next/delta URLs. It initially traverses the entire Inbox; no date filter is applied because Graph's filtered message delta has a 5,000-result limit. This is not all-folder mail synchronization. Delta tracks updates and `@removed` tombstones. A delta-level 410 triggers initial synchronization and `reset: true`.

On `reset: true`, start/persist `EmailAccount.rescanStartedAt`. Upsert observed messages in place and refresh `Email.lastSeenAt`; retain their local IDs, handled state and completed classifications. Continue across durable cursor pages, then only on the terminal page delete mailbox rows whose lastSeenAt predates the rescan start. Explicit provider tombstones still apply as observed. Never clear the whole cache at rescan start: that discards useful state and causes needless evaluation. Interrupted rescans preserve cached rows until completion. See [LARGE_INBOXES.md](LARGE_INBOXES.md) for durable scheduling and restart semantics.

Graph cursors require HTTPS, exact `graph.microsoft.com` hostname, no alternate port/credentials/hash, and a v1.0 `me/mailFolders/.../messages/delta` path. Validation occurs both before fetching and before persisting a returned link. Provider requests disallow redirects to prevent bearer-token forwarding. Network calls have at most 12-second timeouts, shortened to the shared worker deadline, and at most two retries for 429/5xx; `Retry-After` is honored up to five seconds, otherwise the request fails for the job scheduler to retry later. Authentication errors are not retried here. Provider failure messages contain status only, never response bodies or tokens.

Only plain-text email bodies are retained. Gmail recursively decodes base64url `text/plain` MIME with charset support, skips attachments/HTML, and limits recursion and stored text. Graph requests plain text and discards a body if the response is nevertheless HTML. Bodies are capped at 64,000 characters and snippets at 2,000. HTML-only Gmail messages retain their snippet. The application must render these values as text, never insert message strings with `dangerouslySetInnerHTML`. Gmail web links use the provider message ID; Outlook links use an HTTPS allowlist of Outlook hosts.

## Native Jev evaluation

Pinned dependencies checked against installed types/source: `ai@7.0.108`, `@ai-sdk/gateway@4.0.88`.

`JEV_API_KEY` is required. `JEV_GATEWAY_URL` is the AI SDK Gateway **base URL**, default `https://ai-gateway.vercel.sh/v4/ai`; it is not a chat-completions URL or a direct TypeSafe API endpoint. The SDK appends `/evaluation-model`. A custom gateway must implement that evaluation protocol. HTTPS is mandatory. Do not put the key in any `NEXT_PUBLIC_*` environment variable.

The adapter calls `experimental_evaluate` using `createGateway(...).evaluation('typesafe-ai/jev')`. `classifyEmailAgainstTags` sends one shared email and up to 30 independent native boolean tag questions per call; each returns `P(tag match)`. Only missing tag/version pairs are requested by ordinary workers, including reuse of completed no-match and uncertain results. Generated q0/q1 question IDs map safely to unique caller tag IDs; incomplete/invalid answer sets throw. Zero tags make no call. The single-tag wrapper remains available. There is no chat request, generated JSON, or generated reasoning. The prompt identifies email content as untrusted evidence. Keywords/senders are supporting hints unless the user's tag prompt makes them mandatory. Evaluate at most 24,000 body characters plus the bounded subject/sender/snippet. This truncation can omit relevant evidence from unusually long messages.

`confidence` means `P(match) × 100`, not confidence in whichever decision won. At the default threshold 80, classify match at ≥80, no-match at ≤20, and uncertain in between. Threshold must be >50 and ≤100. `matched` is true only for a match. The returned `reasoning` is a deterministic probability/threshold trace, explicitly labeled as such. Do not market that trace as a model explanation or infer accuracy calibration from a probability. Invalid probabilities and upstream failures throw; they never become fabricated matches or no-matches. Timeout is the smaller of 20 seconds and the caller's remaining budget, with one SDK retry. Gateway request options require Zero Data Retention and disallow prompt training; unsupported provider routing should fail rather than silently weaken those requested controls.

## Validation and remaining external checks

`tests/providers.test.ts` uses HTTP protocol fixtures for OAuth, identity, MIME decoding, history/delta pagination, expired cursors, deletion, hostile URLs, and error/retry handling. `tests/jev.test.ts` covers threshold decisions, malformed answers, inference failures, and a fixture request through the **real installed SDK** to assert the `/evaluation-model` URL, model headers, native question body and absence of chat messages. The Jev fixture also verifies three tag decisions use one actual SDK HTTP request with correctly mapped results. These tests make no live inbox or paid-model requests.

Before describing the service as externally validated, exercise consent and refresh-token rotation with authorized Gmail/Outlook test accounts, multi-page initial and incremental sync, read/unread changes, moved/deleted mail, expired cursor recovery, and the deployed callback URLs. Validate real Jev availability, account permissions, controls, latency and classification quality with an explicitly authorized synthetic evaluation. Run service-level concurrent-sync, transaction, tenant isolation, and expired-token tests as well; those responsibilities sit outside the provider adapters.

Official references checked 2026-09-21:

- [Gmail full and partial synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Graph message delta and folder scope](https://learn.microsoft.com/en-us/graph/delta-query-messages)
- [Graph message delta API](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [Jev native evaluation launch / AI SDK 7](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway)
- [Gateway retention/training controls](https://vercel.com/changelog/zero-data-retention-no-prompt-training-on-ai-gateway)
