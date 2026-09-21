# Phase 3 — Mail accounts and synchronization

Prerequisite: verified session boundary and schema. Protocol fixtures are local evidence only. Live OAuth consent, refresh rotation, mailbox changes and permission revocation remain **pending external validation** until exercised with authorized test accounts.

## 3.1 Accounts UI

Steps:

1. Display connected account identity, Gmail/Outlook provider, last persisted sync time and safe sync error.
2. Add connect-provider, synchronize and disconnect controls with pending/error feedback.
3. Explain Inbox import scope and distinguish local disconnect from provider grant revocation.
4. Review empty, multiple-account, expired-connection, sync-pending and demo states on desktop/mobile.

Acceptance criteria:

- Each action targets the selected account and duplicate clicks are controlled while pending.
- Public account rendering never exposes token ciphertext/plaintext or internal cursor/lease fields.
- Disconnect clearly communicates removal of that mailbox's cached messages.

## 3.2 OAuth Connections

Steps:

1. Configure exact Gmail/Outlook callback URIs and least-privilege scopes using the runbook.
2. Generate S256 PKCE verifier/challenge and encrypted random state tied to the current user/provider; store a ten-minute HTTP-only callback cookie.
3. Validate callback state against cookie, timestamp, provider and session user before code exchange.
4. Fetch the provider-authorized mailbox identity; encrypt tokens using AES-GCM; require usable offline access.
5. Test malformed/replayed/expired/wrong-user/wrong-provider state with fixtures, then run authorized provider consent and refresh tests.

Acceptance criteria:

- Invalid state fails before credentials are exchanged or account data written.
- Provider identity, not callback input, determines connected address.
- Gmail requests only gmail.readonly; Microsoft only Mail.Read/User.Read/offline_access.
- Tokens are never returned to the browser and tampered ciphertext fails decryption.
- Live provider success is recorded separately from fixture success.

## 3.3 Accounts API

Steps:

1. Implement authenticated account listing with the explicit safe projection.
2. Implement provider-specific auth/callback endpoints and idempotent account upsert by owner/provider/email.
3. Preserve an existing refresh token if a reconnect/refresh response omits a replacement; replace it on rotation.
4. Implement tenant-scoped disconnect and cascade cached emails/classifications.
5. Test another user's account ID, repeated connection, missing account and deletion isolation.

Acceptance criteria:

- Duplicate connection does not create duplicate mailbox rows for the same user/provider/address.
- Listing contains only id/email/provider/lastSync/syncError.
- Disconnect cannot delete another tenant's data and does not claim provider-side token revocation.

## 3.4 Sync Endpoints

Steps:

1. Implement `POST /api/sync` to persist requests for all own accounts or a selected owned account. Daily cron marks incremental sync requested; minute cron drains durable pending work.
2. Claim expiring user and account leases, retain request revisions, refresh credentials close to expiry and perform bounded provider requests.
3. Gmail: capture history before a fixed 30-day Inbox initial list, paginate, then catch up through full history event types. Outlook: paginate Inbox delta using exact validated next/delta links.
4. Transactionally apply upserts/tombstones and cursor updates; expired history/delta begins a full Inbox rescan with rescanStartedAt/lastSeenAt. Retain existing IDs/handled/classifications until terminal unseen-row reconciliation. Preserve cursor on failure; clear requested state only for the observed revision; release only owned leases.
5. Test paging, tombstones, read changes, 404/410 resets, Graph hostile URLs, retry bounds, concurrent calls and deadline continuation.

Acceptance criteria:

- Messages are deduplicated by account/providerMessageId and cursor advances only with committed changes.
- Rescan preserves existing mail/handled/classifications and deletes only that mailbox's unseen rows after the terminal page; a newer sync request cannot be erased by an older worker.
- No bearer token is sent to an untrusted Graph cursor host or redirected endpoint.
- A partially completed round remains durably requested and resumes automatically through the minute worker after backoff/lease expiry; repeated user clicks are unnecessary.
- Read-only remote permissions remain sufficient for the entire operation.

## 3.5 Accounts with Real Data

Steps:

1. Bind Accounts UI to the workspace/accounts APIs and connect mutation results to React Query invalidation.
2. Run authorized Gmail and Outlook account connections separately from fictional demo review.
3. Add, read/unread, move and delete test messages; synchronize and compare the local cache against provider state.
4. Verify disconnect cascades and token refresh after expiry; inspect logs for accidental content/token leakage.
5. Record account type, test actions, timestamps and redacted results without storing sensitive mailbox dumps.

Acceptance criteria:

- Live mode displays actual authorized provider data and never falls back to demo fixtures.
- Initial scope and subsequent provider changes match documented behavior.
- Multi-account operations remain isolated and error recovery is understandable.
- Without configured test accounts, mark this task's external validation pending, not passed.
