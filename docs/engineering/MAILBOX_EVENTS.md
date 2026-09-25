# Provider mailbox events

This implementation is present but **not live until the external services below are connected**. No Google Cloud, Microsoft, or Inngest resources are provisioned by the code or tests. Missing provider-event configuration is recorded as `MailboxSubscription.status = unconfigured` with a safe `lastError`; it is never reported as an active watch.

## Processing contract

The webhook handlers authenticate and validate the notification, persist account-scoped sync work through `requestWork`, then acknowledge the provider. Next.js `after` publishes a user work event through `publishUserWork` after the response. Provider reads, mailbox sync, and AI classification run in the durable worker. A publication failure leaves database work markers intact for scheduled recovery.

Each account has a cascading `MailboxSubscription` record with its owning user/workspace, expiry, renewal revision and lease, retry time, and safe status/error. Its private Graph `clientState` uses the same server-only authenticated encryption as OAuth tokens. Account and subscription payloads must never expose this record's private state or credentials in an API response or log.

`renewMailboxSubscriptions({ userId?, accountId?, limit?, deadline? })` processes at most 20 accounts by default, clamped to 50. The deadline is at most 50 seconds. It excludes active account and renewal leases. Unconfigured and failed records move their retry time into the future, allowing later accounts to progress. The shared account credential lease serializes token refresh with sync and other provider operations. Renewal revisions preserve lifecycle requests received while a renewal is running.

`requestMailboxSubscriptionRenewal(userId, accountId?, workspace?)` persists renewal requests after an OAuth connection. The caller queues user work. Run renewal from that work flow and an hourly durable schedule. If a batch reports `pending`, continue with another bounded durable step or the next recovery tick so a large fleet does not wait a full hour per batch. `cleanupMailboxSubscription(userId, accountId, deadline?)` runs before disconnect/account deletion; it attempts provider cleanup and returns only safe metadata. Account deletion cascades the local subscription so later notifications cannot route to that account.

## Gmail: connect later

1. Enable Gmail and Pub/Sub APIs in the same Google Cloud project used by the Gmail OAuth client.
2. Create a Pub/Sub topic. Grant `roles/pubsub.publisher` on that topic to `gmail-api-push@system.gserviceaccount.com`.
3. Create a dedicated user-managed service account for authenticated Pub/Sub push. Configure the Pub/Sub service agent's token creation permission as described in Google's authenticated-push documentation.
4. Create a wrapped JSON push subscription delivering to the deployed HTTPS `/api/webhooks/gmail` URL. Enable OIDC authentication with that exact service account and explicitly set the audience.
5. Set the server environment variables below, redeploy, and let the durable renewal worker establish watches. Keep OAuth `gmail.readonly` or a broader compatible granted scope.

| Variable                             | Meaning                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `GMAIL_PUBSUB_TOPIC`                 | Exact `projects/PROJECT/topics/TOPIC` watched by Gmail                       |
| `GMAIL_PUBSUB_SUBSCRIPTION`          | Exact `projects/PROJECT/subscriptions/SUBSCRIPTION` accepted by the endpoint |
| `GMAIL_PUBSUB_AUDIENCE`              | Exact HTTPS OIDC audience configured for authenticated push                  |
| `GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL` | Exact push authentication service-account email                              |

The endpoint verifies an RS256 JWT against Google's fixed certificate endpoint, issuer, configured audience, expiry, required claims, `email_verified: true`, and exact configured email. It also checks the full Pub/Sub subscription path, a bounded JSON envelope, valid mailbox address, and a decimal history ID. The Gmail topic publisher identity above is separate from the push authentication service account.

Only known Gmail accounts with a saved watch history marker for the configured topic are woken. If one provider mailbox is connected to multiple users/workspaces, the event wakes each watched account. Disconnect skips `users.stop` while another app account still owns that Gmail identity.

The renewal request uses `users.watch`, `INBOX`, and `labelFilterBehavior: include`. Watches refresh daily and before expiry. **The watch's history ID is never written into the ingestion cursor.** New connections and expired history continue through the normal initial sync/rescan, preserving backlog. Duplicates and out-of-order push messages can safely request another sync; ingestion checkpoints determine what has actually been saved. Do not compare notification history IDs to decide whether to skip work.

Google documents watch expiry, Pub/Sub configuration, and the possibility of dropped notifications in [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push). Authentication setup is covered by [authenticated Pub/Sub push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

## Outlook: connect later

1. Configure the Microsoft OAuth application and delegated mail-read permission used by the app. Existing connections must have a compatible granted permission.
2. Set `OUTLOOK_WEBHOOK_URL` to the deployed public HTTPS `/api/webhooks/outlook` URL. Use the same URL for basic notifications and lifecycle notifications; the worker does this automatically.
3. Confirm the endpoint is reachable without interactive login and that any deployment proxy permits Graph validation POSTs.
4. Connect/reconnect an Outlook account or request renewal, then run the durable worker. No manual Graph subscription creation or shared client-state secret is necessary.

The handler answers a bounded `validationToken` POST with the once-decoded token as `text/plain`. This challenge does not access mailbox data. Normal notifications require an exact stored subscription ID and constant-time verification of that subscription's decrypted private state. The stored subscription must cover `/me/mailFolders('inbox')/messages`. Message resources must be in that inbox path or the exact stored Graph mailbox's `Users/{id}/Messages/{messageId}` path. Graph's basic notification resource omits folder information; the authenticated inbox subscription establishes that scope.

Multiple app accounts can share one Outlook provider subscription. Sibling discovery requires both the Graph mailbox ID obtained through authenticated `/me` and the verified account email; an email match alone is insufficient. Each ownership record retains the shared encrypted private state and provider subscription ID. The webhook authenticates each matching ownership record and fans work out to its own user/workspace. Disconnect deletes the provider subscription only for the last connected ownership record.

Subscriptions request `created,updated,deleted` with a six-day lifetime. A single `PATCH /subscriptions/{id}` renews and reauthorizes before expiry; 404/410 or expired subscriptions trigger recreation. Before a create, the worker saves a random encrypted private state. A retry first searches the app's Graph subscriptions for the exact state, callback URLs, and inbox resource; this recovers a provider success whose response or local save was lost. Pagination is bounded and only accepts the fixed Graph host and subscription path. Graph rejects duplicate resource/change-type subscriptions. If another workspace wins a concurrent create and Graph returns 409, recovery re-reads private states stored for that exact verified mailbox and adopts only a matching subscription. A callback URL/resource match alone never authorizes adoption. Provider mutation calls are not automatically replayed after timeouts.

Authenticated `subscriptionRemoved`, `missed`, and `reauthorizationRequired` lifecycle events request both sync recovery and renewal. Lifecycle notifications may omit `resource`. A removal marks the stored expiry as past so renewal recreates it. Incremented revisions preserve a concurrent lifecycle wake.

Microsoft documents this behavior in [webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks) and [subscription lifecycle events](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events).

## Recovery and local verification

- Both routes return a retryable `503` when the durable database operation fails. Untrusted Graph notifications are acknowledged without mutations; malformed bounded input is rejected. Gmail authentication or configured-subscription mismatch is rejected before mailbox lookup.
- Neither webhook stores email bodies, logs event payloads, nor performs inline mailbox fetches or classification. The normal ingestion cursor remains the source of truth.
- The existing scheduled sync recovery remains necessary for provider drops and delivery outages. Event delivery supplements that repair path.
- Provider cleanup is best effort. If provider access is unavailable, the provider watch/subscription expires naturally while its local account ownership is removed.
- After setup, use the provider consoles and `MailboxSubscription.status`, `lastError`, `expiresAt`, `retryAt`, and renewal leases to verify delivery and renewal. Do not print access tokens, refresh tokens, private client state, or email content while troubleshooting.

The isolated tests run without provider credentials or network calls:

```sh
npm test -- tests/mailbox-webhooks.test.ts tests/mailbox-subscriptions.test.ts
```

They cover real JWT signature verification with local test keys, malformed/oversized requests, forged state and cross-mailbox resources, after-response dispatch, duplicate delivery, persistence failure, watch checkpoint separation, renewal leases, missing setup, lifecycle recovery, Graph renewal/recreation/orphan recovery, shared Graph fanout and concurrent creation, and shared mailbox disconnect safety. A separate live smoke test is required after external services are connected.
