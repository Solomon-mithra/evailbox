# Cost, pricing and architecture review

Reviewed **2026-09-25** against the current working tree. Currency: USD. The user's **$3.99 is treated as a monthly, per-user price before tax**. This is a planning decision, not an existing billing implementation. No provider plan was purchased, no limit was increased, and no production configuration was changed for this audit.

## Decision

**$3.99 can work for a limited entry plan; the current application does not enforce the controls needed to safely sell it as unlimited.** The stack is suitable for a small launch, but business quotas, cost metering, bounded imports and production scheduling are unfinished. A large bill is possible through repeated processing, large historical imports, long prompts, many accounts, or accumulation of retained data.

The existing **100 is a work-batch size**, not a user allowance. A **1,000-message import can be supported over multiple queued batches**. Increasing a single HTTP request to process 1,000 messages is not the right solution. Charge and limit total processing over a billing period independently of the size of each worker batch.

The baseline estimate uses TypeSafe's published **$0.042 per million input tokens** as a paid-price planning proxy. The application's actual integration is Vercel AI Gateway `typesafe-ai/jev`; its model page still shows a promotion ending **September 25, 2026**. Confirm the post-promotion Gateway route's price before accepting paying customers. Free promotional inference is not the basis for this report. [TypeSafe model pricing](https://docs.typesafe.ai/models), [Gateway Jev listing](https://vercel.com/ai-gateway/models/jev)

## Evidence and limitations

Reviewed the provider adapters, synchronization loop, classification cache, work queue, API authorization, workspace queries, OAuth connections, digest delivery, Prisma schema and deployment configuration. Source links below refer to implementation, not intended behavior in older documents.

An aggregate-only read of the connected development database found **1 user, 1 connected account, 100 emails, 2 tags and 117 classification rows**. Average stored body length was **3,964 bytes**, maximum **29,289 bytes**; average subject/sender/name/preview total was **319 bytes**. PostgreSQL reported approximately 508 KB for the email relation and 131 KB for classification data, including relation indexes/overhead. No message contents, addresses, IDs, tokens or credentials are included in this report.

This tiny sample is **not an average customer workload**, a monthly usage measurement, or a basis for extrapolating exact row/index size. The estimates below use explicit synthetic workloads. We did not make billable inference requests, run a load test, inspect provider invoices, or verify account-specific pricing, spending settings, deployment region, memory allocation or current cloud plan. A local live database does not prove production deployment readiness.

Files for reproducing the arithmetic:

- [Cost worksheet](COST_WORKSHEET.md): generated scenario, cohort, import and sensitivity tables.
- [Assumptions](cost-model.json): editable prices, workload sizes, payment fees and allowances.
- [Offline calculator](cost_model.py): Python standard library only; no network or credentials.

```bash
python3 docs/engineering/cost_model.py
python3 docs/engineering/cost_model.py --config /path/to/custom-assumptions.json
```

## What we currently selected and what remains a proposal

| Item                  | Current implementation / evidence                                                                             | Cost implication                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Customer subscription | No payment integration, paid-plan entitlement or monthly processing ledger found; $3.99 is the proposed price | Authentication alone currently allows expensive operations                                                                 |
| AI                    | Vercel Gateway `typesafe-ai/jev`, one shared email plus multiple tag questions                                | Paid input includes email, every question's instructions/criteria, and serialization; one request is not a flat-price unit |
| Web/backend           | Next.js on Vercel; root `vercel.json` has `crons: []` and a 60-second function limit                          | Default deployment does not automatically drain the backlog                                                                |
| Background schedule   | `vercel.live.json` defines daily sync, a minute worker and a 15-minute digest checker                         | This is a deployment option, not proof those schedules are active                                                          |
| Database/auth         | Supabase PostgreSQL/Auth with Prisma                                                                          | Baseline below budgets one Pro project with Micro compute; actual subscription unverified                                  |
| Digest delivery       | Resend, optional per user                                                                                     | Incoming mailbox messages are not Resend sends; daily digests are                                                          |
| Body retention        | Plain text and previews stored during sync; no age-based purge                                                | Previous conversation's minimal-retention recommendation is **not implemented**                                            |
| Full HTML reader      | Fetches full message on demand; does not persist HTML                                                         | Reading does not invoke Jev, but does consume provider/network/hosting resources                                           |
| Payments in model     | US domestic Stripe cards plus optional Stripe Billing                                                         | An assumption for estimating net revenue, not a selected or installed vendor                                               |

Sources: [Jev adapter](../../src/lib/jev.ts), [schema](../../prisma/schema.prisma), [root deployment](../../vercel.json), [live deployment option](../../vercel.live.json), [message reader service](../../src/lib/email-content.ts).

## What the limits actually mean

| Limit                            | Enforced location               | Meaning and exceptions                                                                                                            |
| -------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 25                               | Gmail/Outlook adapters          | Requested provider page size; not total mailbox size                                                                              |
| 4 pages                          | `syncUser`                      | Per account, per invocation, with a shared time deadline; roughly 100 initial messages/account when pages are full                |
| 4 parallel Gmail detail requests | Gmail `hydrate`                 | Local concurrency control, not a quota-unit-per-minute limiter                                                                    |
| 100 email candidates             | `classifyEmails`                | Per workspace classification pass; actual completed count depends on time; both workspaces can be visited under the same deadline |
| 100 users selected               | `processPendingWork`            | Maximum candidates, processed sequentially under one shared 45-second deadline; not 100 parallel workers                          |
| 50                               | Workspace query                 | UI pagination, not a processing or subscription allowance                                                                         |
| 20 explicit IDs                  | Classification API schema       | Maximum selected messages in one explicit request; that request forces evaluation                                                 |
| 30 tags/workspace                | Tag creation/API                | Up to 60 across Personal and Work; no price-tier distinction                                                                      |
| 64,000 characters                | Provider normalization          | Maximum retained plain body; character count is not a token limit                                                                 |
| 24,000 characters                | Jev input construction          | Body excerpt cap, plus subject/sender/snippet and all tag instructions                                                            |
| 20 seconds / 1 retry             | Jev adapter                     | Per-evaluation timeout and SDK retry policy; not a monthly budget                                                                 |
| 45 seconds                       | Work queue/sync                 | Cooperative processing deadline; DB work and cleanup still require headroom                                                       |
| 60 seconds                       | Vercel deployment configuration | Function execution ceiling selected by this application                                                                           |

**No enforced monthly email allowance, token allowance, monetary budget, connected-mailbox cap or paid-plan check exists.** User/account leases reduce overlapping work for the same user; they do not limit spending across users or repeated sequential actions.

Gmail starts with 30 days of Inbox messages, but those records do not expire after 30 days. Expired Gmail history triggers a rescan from `after:0`, potentially covering the entire current Inbox. Outlook's initial delta sync traverses the entire Inbox. A Gmail history page can describe many changed message IDs: 25 history records does not guarantee only 25 hydrated emails. Multiple accounts also make 100 an inaccurate overall cap. [Gmail adapter](../../src/lib/providers/gmail.ts), [Outlook adapter](../../src/lib/providers/outlook.ts), [sync](../../src/lib/sync.ts), [classification](../../src/lib/classification.ts), [work queue](../../src/lib/work-queue.ts), [validation](../../src/lib/validation.ts)

Follow-up diagnosis against the user's `http://localhost:3000/inbox` reproduced a `P2028` rollback when saving the next provider page exceeded Prisma's default five-second transaction timeout. Page saves now have an explicit, deadline-bounded timeout, and mailbox-only recovery successfully advanced beyond 100. During recovery Gmail separately returned `403 rateLimitExceeded`, so continuation also needs provider pacing/backoff. No scheduler is enabled in the root config; subsequent automatic work still needs a running worker. These observations concern the local app's configured database, not the older linked Vercel deployment.

## Published prices used in planning

Checked September 25, 2026. Prices exclude tax; regional/account terms and future changes matter.

| Service                        | Reference price / allowance                                                       | Model treatment                                                         |
| ------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Jev direct API                 | $0.042/M input tokens; output free                                                | Baseline proxy; also test $0.10/M and $0.25/M                           |
| Jev on Gateway                 | Free promotion ends September 25, 2026                                            | Do not use $0 as sustainable cost; verify paid route                    |
| Vercel Pro                     | $20/month with $20 included usage credit                                          | One base subscription; additional developers/resources may add cost     |
| Vercel Functions, `iad1`       | $0.128/active CPU-hour; $0.0106/GB-hour memory; $0.60/M invocations               | Meter actual usage; I/O waits still consume allocated memory time       |
| Supabase Pro                   | $25/month; $10 compute credit covers one Micro; 8 GB disk; 250 GB uncached egress | One production project; larger compute/additional projects cost more    |
| Supabase extra gp3 disk        | $0.125/provisioned GB-month beyond included disk                                  | Growth and provisioned capacity must be measured                        |
| Supabase extra uncached egress | $0.09/GB beyond allowance                                                         | Pooler traffic counts; do not also count it as separate database egress |
| Resend Free                    | 3,000 sends/month and 100/day                                                     | At most 100 users getting one digest/day, with no room for other sends  |
| Resend Pro                     | $20/month for 50,000 sends; $0.90/1,000 extra                                     | Step-up once the free daily/monthly allowance is exceeded               |
| Stripe assumed US cards        | 2.9% + $0.30/successful charge                                                    | International/FX/dispute fees excluded                                  |
| Stripe Billing assumed         | 0.7% of billing volume                                                            | Separate from payment processing; remove if not used                    |

Primary references: [Vercel plans](https://vercel.com/pricing), [Fluid compute meters](https://vercel.com/docs/functions/usage-and-pricing), [Supabase plans](https://supabase.com/pricing), [database disk](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size), [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [Resend](https://resend.com/pricing), [Stripe payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing). Jev references are above.

Use Vercel Pro or another plan suitable for a commercial service; Hobby is designated for personal/non-commercial use. Do not copy Hobby's included compute allowances into a Pro calculation: the current compute documentation describes Pro usage charges offset by its usage credit. AI Gateway credits are separate from the hosting credit. [Hobby plan](https://vercel.com/docs/plans/hobby)

Gateway also has optional charges: team-wide ZDR and team-wide provider allowlisting each list $0.10/1,000 requests; request-level ZDR has no surcharge on supported Pro/Enterprise plans. The code requests ZDR per evaluation. Enabled dashboard add-ons, custom reporting, trace exports and credit-purchase fees require separate review; this calculator defaults their surcharge to zero. At 1,650 attempts/month, a $0.10/1,000 add-on would add $0.165/user. Do not disable privacy protections to improve margin. [Gateway pricing and add-ons](https://vercel.com/docs/ai-gateway/pricing)

## Economics of $3.99

Assuming one successful monthly domestic-card charge:

```text
Gross revenue                       $3.99000
Payment fee: 3.99 × 2.9% + 0.30    -$0.41571
Billing fee: 3.99 × 0.7%           -$0.02793
Available before delivery/AI/etc.   $3.54636
```

The workload model counts **newly evaluated messages and repeat work**, not every email already present in Gmail. Reading an email adds zero inference requests. Ordinary completed tag results are reused, including negative and uncertain results. Rule changes, forced classification and retries can create new paid work.

```text
Monthly billable input tokens
  ≈ evaluated messages × input tokens per attempt × repeat/retry multiplier
AI cost
  = input tokens / 1,000,000 × input rate + applicable add-on charges
```

Tokens per attempt include shared message content, metadata, all requested questions and protocol overhead. A short body does not imply a cheap call if the user has many long tag prompts. Characters/4 is only a rough English-text estimate, not a valid hard billing limit. Actual provider usage must replace these estimates.

| Scenario (assumed, not observed average) | Emails/month | Input tokens/attempt | Repeat factor | AI at $0.042/M | Net after fees and AI, before everything else |
| ---------------------------------------- | -----------: | -------------------: | ------------: | -------------: | --------------------------------------------: |
| Light                                    |          300 |                2,000 |          1.05 |        $0.0265 |                                       $3.5199 |
| Planning typical                         |        1,500 |                4,000 |          1.10 |        $0.2772 |                                       $3.2692 |
| Busy                                     |        3,000 |                6,000 |          1.15 |        $0.8694 |                                       $2.6770 |
| Heavy                                    |       10,000 |                8,000 |          1.25 |        $4.2000 |                                  **-$0.6536** |
| Stress                                   |       30,000 |               12,000 |          1.50 |       $22.6800 |                                 **-$19.1336** |

At $0.10/M, the planning-typical AI cost becomes $0.66; at $0.25/M it becomes $1.65. A busy workload becomes $2.07 or $5.175 respectively. The heavy scenario already loses money on AI plus payment fees at the baseline rate. An unlimited promise exposes the business to those users, even if the median user is profitable.

### Company-level illustration

The [generated worksheet](COST_WORKSHEET.md) models every customer using the planning-typical workload, a $45/month base for Vercel/Supabase, daily digests for everyone, and **an additional $0.25/user variable infrastructure reserve**. The reserve is an assumption, not a measured bill; it must cover usage beyond included credits, larger DB compute, egress and other infrastructure. It is not credited against the $20 hosting credit again.

| Paying users | Monthly revenue | Modeled contribution after fees, AI, base plans, digests and reserve |
| ------------ | --------------: | -------------------------------------------------------------------: |
| 5            |          $19.95 |                                                              -$29.90 |
| 10           |          $39.90 |                                                              -$14.81 |
| 100          |         $399.00 |                                                              $256.92 |
| 1,000        |       $3,990.00 |                                                            $2,954.16 |
| 10,000       |      $39,900.00 |                                                           $29,901.60 |

**These are unit-economics illustrations, not profit forecasts or a claim that one Micro database/current worker can serve 10,000 customers.** They exclude salaries, support, acquisition, tax, refunds, disputes, provider verification/security reviews and infrastructure beyond the reserve. At scale, actual compute may exceed it. Under these assumptions the simple contribution break-even is 15 paying users; adding real business expenses raises it.

For the explicit goal of profitability with five customers, $3.99 yields only $19.95 gross. Dedicated $20 Vercel Pro plus $25 Supabase Pro subscriptions already exceed this before payment fees or AI. Reduce the total fixed-cost allocation or change pricing; treating existing shared subscriptions as sunk costs gives an incremental contribution figure, not full business profitability. The actual Supabase subscription and post-promotion Gateway rate remain unverified.

Sensitivity matters: one five-minute support interaction valued at $30/hour costs $2.50. At 1,000 users, a $0.2772-to-$4.20 AI workload shift across everyone adds $3,922.80/month, overwhelming this plan's margin. Track mean, median, p95 and highest user costs, not only average mail counts.

A 70% contribution target on $3.99 leaves $0.50336 for **AI plus digest** after the assumed payment fees and $0.25 reserve, **before allocating base costs**. At 4,000 tokens and a 1.10 repeat factor, that covers roughly 2,723 evaluations at $0.042/M, 1,144 at $0.10/M, or 457 at $0.25/M. This is a planning threshold, not an implemented allowance.

Annual billing can reduce payment overhead: charging $47.88 once, with these same percentage fees and one $0.30 fixed fee, yields about $3.82136/month before service costs, versus $3.54636 with monthly charges. That saves $3.30/year per subscriber before any annual discount. It does not repair unbounded inference usage.

### What frequent Vercel calls would cost

Frequent API calls are normal usage; they do not inherently cause Vercel to reject the application. Paid usage, function duration, concurrency, provider rate limits and configured spending controls still apply. AI Gateway limits are separate from hosting limits. A request can time out or receive `429` even when the monthly dollar total is small. [Function limits](https://vercel.com/docs/functions/limitations), [Gateway usage](https://vercel.com/docs/ai-gateway/pricing)

For illustration only, using the `iad1` rates above and **1 GB allocated memory**, with no concurrent requests sharing an instance:

| Assumed monthly workload                                                                          | CPU charge | Memory charge | Invocation charge | Total metered compute |
| ------------------------------------------------------------------------------------------------- | ---------: | ------------: | ----------------: | --------------------: |
| One worker/minute for 30 days: 43,200 calls, 45 seconds elapsed and 1 second active CPU each      |     $1.536 |        $5.724 |            $0.026 |                $7.286 |
| 1,000 users × 2,000 list calls: 2 million calls, 1 second elapsed and 0.2 seconds active CPU each |    $14.222 |        $5.889 |            $1.200 |               $21.311 |

Formula: `CPU seconds / 3600 × $0.128 + allocated GB-seconds / 3600 × $0.0106 + invocations / 1,000,000 × $0.60`. These are **invented duration/memory inputs to explain the meters**, not observed request performance. Allocated memory is not configured in this repo and must be confirmed. Shared Fluid instances can reduce memory charges relative to this independent-request calculation; greater allocated memory or longer requests raises them. If the worker uses 45 active CPU seconds instead of one, its compute example rises to approximately $74.87/month.

Together the first two examples consume about $28.60 of eligible compute usage. If they were the only eligible usage, a $20 Pro base with its $20 credit would total about $28.60, **not $48.60**. Bandwidth, other routes, builds, observability and AI are excluded. This is a separate sensitivity example, not another charge added to the cohort table's $0.25/user reserve. Reconcile actual meters to replace that reserve; optimizing query frequency and database work matters more than invocation count alone.

## Is 1,000 emails per sync acceptable?

**As a queued import target: yes, subject to a monthly/onboarding budget. As one synchronous request: no.**

At 4,000 input tokens and a 1.10 repeat factor, initial classification of 100, 1,000 and 10,000 emails costs approximately **$0.0185, $0.1848 and $1.848** respectively at the baseline rate. This is AI only; prompt size, actual rates, provider reads, database writes and rework change the total. At the heavier 8,000-token/1.25-factor workload, 1,000 evaluations cost $0.42.

One-time classification of 1,000 messages is very different from **1,000 new messages every day**: the latter is 30,000/month, or $5.544 in AI even at the smaller 4,000-token/1.10-factor assumption. Repeated synchronization of unchanged IDs should reuse decisions, but still incurs provider and infrastructure work. Resetting cursors or forcing evaluation destroys that economic advantage.

Recommended execution:

1. Accept a job and return its ID/progress immediately.
2. Process provider pages of 25–100 and bounded classification chunks, starting conservatively with 25–50 or a measured time budget.
3. Persist cursor, progress and completed decisions after each small unit.
4. Respect per-mailbox and shared provider limits; pause and resume instead of restarting.
5. Enforce user-level monthly budgets across all jobs, accounts and workspaces.

The current 100-candidate batch can remain as a maximum selection count while time/cost budgets determine completed work. Raising it to 1,000 does not give a 60-second function ten times as much time. At an illustrative one second of total sequential work per email, 1,000 emails takes about 17 minutes; at two seconds, about 33 minutes. These include no guarantee about real latency.

### Provider quotas constrain bursts

Google's current new-project quota table lists 6,000 units/user/minute, 1,200,000/project/minute, 20 units for `messages.get`, and 5 for `messages.list`. With this adapter's 25-ID pages, 1,000 initial messages require at least **20,200 units**, excluding profile/history, retries and body-attachment fetches. That represents over three minutes of a user's quota budget; practical scheduling needs extra headroom. Earlier projects can retain older quotas, so verify our Cloud project's actual allocation. The docs also list an 80-million-unit daily billing threshold with future billing details still to be announced; no future dollar rate is invented here. [Gmail quotas](https://developers.google.com/workspace/gmail/api/reference/quota)

For Outlook, Microsoft documents 10,000 requests/10 minutes and four concurrent requests per app/mailbox. The adapter receives multiple messages in a delta response, so its request count differs from Gmail's detail-fetch pattern. These are API limits, not the application's subscription allowances. [Outlook throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits)

TypeSafe's published direct-API limit is not our Gateway entitlement. Use Gateway's actual model/account limits and `429` responses for pacing; do not assume paying for hosting removes inference limits.

## Architecture findings, ordered by financial impact

### 1. No spending enforcement — launch blocker for paid unlimited use

There is no subscription check before expensive work and no atomic user/month usage reservation. Multiple legitimate accounts, repeated sync requests, and repeated forced classification are unrestricted over time. Add a ledger for reserved/completed input tokens, estimated/actual USD, processing units and attempts. Reserve a bounded amount before external work, settle actual usage afterward, and fail closed when a budget is exhausted. Apply the same check to manual API calls, cron, imports, reclassification and both workspaces. Avoid accumulating raw message text in the ledger.

Platform-level spend alerts are not a replacement for user quotas. Set finite Gateway/project spending limits and credit-top-up policy as a second defense. Confirm which limits reject requests and which only notify; keep mailbox reading available if AI pauses.

### 2. Tag edits can cause broad, unnecessary reprocessing

Every successful tag PATCH increments `version` and deletes that tag's classifications, including name, description or priority-only edits. An empty/no-op patch can do the same. For a retained 100,000-email inbox, one change can enqueue roughly 100,000 evaluations: **$18.48** at the 4,000-token/1.10-factor baseline assumption. A one-tag recheck may actually use fewer tokens, but the repeated message input remains. [Tag PATCH implementation](../../src/app/api/[...path]/route.ts)

Use a separate classification-rule revision/hash; only fields actually used in Jev's question should invalidate inference. Decide whether tag name belongs in that rule. Update display/delivery fields without invalidation. Show the estimated reprocessing scope before expensive semantic changes, debounce successive edits, limit the history window and count reprocessing against an explicit allowance.

### 3. Imports, accounts and retries are not bounded by a product plan

Outlook initial sync and expired Gmail recovery can traverse a large Inbox. The same mailbox can be connected separately to Personal and Work, duplicating storage and processing; there is no account-count cap. The queue uses backoff, but no permanent-failure/dead-letter attempt limit. Explicit requests reset backoff. An oversized/invalid prompt or unsupported model route can remain pending indefinitely.

Separate recoverable rate limits from permanent validation/auth/configuration errors. Bound attempts and total cost, add a circuit breaker, and require a corrected rule/account before resuming permanently invalid work. Define how retained-history limits interact with provider cursors: silently stopping delta traversal is not a correct way to impose a billing cap. Keep index synchronization and AI eligibility separate.

### 4. Token usage is neither measured nor capped

`src/lib/jev.ts` validates answers but does not persist returned usage or actual cost. The body character cap does not bound the combined request. Thirty tags can each carry a 2,000-character prompt, 30 keywords and 30 sender addresses, plus repeated task instructions and criteria. Legal API inputs can therefore create very large requests or exceed model context.

Estimate tokens conservatively before enqueueing, impose per-request and monthly limits, and record provider-reported usage afterward. Split question batches only when needed: each split repeats the email input and can cost more. Do not claim one shared call eliminates tag-dependent costs. Keep logs content-free.

### 5. Workspace polling retrieves bodies it later discards

The main email query in `getWorkspace` uses `include`, retrieving all scalar fields including `body`, and only sets `body: null` when serializing the response. It therefore still transfers bodies from Supabase to the server. Each workspace request starts eight main query operations, plus authentication/user work and Prisma's relation queries. Two mounted workspace queries can amplify this. [Workspace service](../../src/lib/workspace.ts), [query hook](../../src/hooks/useFetch.ts)

At an assumed 2,000 list requests/month, 50 emails/page and 4 KB/body, this wastes approximately **400 MB/user/month** in raw body transfer alone. At 10,000 users that is 4,000 GB before other traffic; on a dedicated Pro allowance, $0.09 × (4,000 − 250) would be **$337.50/month** of excess egress if all these assumptions hold. Use explicit `select`/`omit` at the database boundary. Split frequently refreshed summaries from relatively static account/tag/settings data; coalesce queries, avoid unnecessary writes on reads, and tune indexes/query plans before increasing DB compute.

### 6. Retention grows with emails × tags

Every email/tag pair stores a result, including non-matches. At 1,500 new messages/month, 1,000 users and five tags, one year without removals produces **18 million email rows and 90 million classification rows**. At 30 tags, the classification count becomes 540 million. Indexes, maintenance, scans and backups matter more than just cheap disk GB.

Body text alone at 4 KB/message would be about 72 GB after that year; at the approximate 64 KB ASCII body cap, about 1.152 TB. These are logical payload examples, not disk forecasts: encoding, compression, tuple/index overhead, dead tuples and provisioned headroom change disk use. An illustrative extra 100 GB of gp3 disk is only $12.50/month; adequate database CPU/RAM and operational costs may be much larger.

Adopt an explicit retention period for the index/results, stop persisting bodies if the privacy design is accepted, and expire digest payloads too. Removing bodies does not remove costs from retained metadata/classifications. User or mailbox deletion must account for derived content and backup retention; never delete provider mail to save our costs.

### 7. The worker is durable, but not a scalable queue service yet

The checkpointing, user/account leases, result reuse, negative-result cache and revision checks are sound foundations. However, one scheduled worker processes users and messages sequentially under a shared 45-second deadline. Selecting 100 users does not ensure any fixed throughput. Sync may consume the entire deadline before classification.

An idealized minute worker spending 45 seconds entirely on classification could process about 64,800 emails/day at one second/email or 32,400 at two seconds/email, before sync, DB overhead, failures and idle gaps. At 1,000 users receiving 50 messages/day, demand is 50,000/day. The slower case cannot keep up. Increasing the selection limit does not fix this.

Use separate resumable sync and classification jobs, global rate limiting, per-user fairness, controlled concurrency and retry scheduling. Queue messages should contain IDs, rule revisions and cost reservations, not bodies. Monitor queue age, backlog, latency and spend before increasing concurrency; the Supabase pool must remain within capacity. A managed queue/workflow is an option after measurement, not a reason to rewrite the whole stack immediately.

Vercel Queues is currently beta and bills API operations in 4 KiB message units, with separate function compute charges. As an illustration, five users × 1,500 emails/month × six billed operation units/email × $0.60/million units in `iad1` is **$0.027/month** before retries, compute and applicable credits. The six-unit lifecycle is an assumption, not a fixed per-email tariff. Idempotent sends and push deliveries with concurrency control have operation-specific multipliers. A queue preserves deferred work; it does not increase Gmail or AI-provider quotas or guarantee no 429s. [Queue billing](https://vercel.com/docs/queues/pricing), [iad1 rates](https://vercel.com/docs/pricing/regional-pricing/iad1).

The root configuration currently enables no cron. `vercel.live.json` contains the intended schedule. Deploying scheduling is a separate action; this review did not enable it. Even that daily sync schedule does not provide near-real-time mail discovery. A shorter bounded polling schedule or provider change notifications would need separate capacity/cost design.

### 8. Reading and delivery have independent costs

Reading an email correctly avoids Jev. Currently it still requests database detail plus a separate provider-backed HTML document; toggling external images refetches the document. There is no temporary body cache across opens. A short-lived, per-user in-memory browser cache can reduce duplicate reads without persistent body storage, with clearing on logout/account changes. Do not put private email HTML in a public CDN or persistent shared cache.

External newsletter images load directly from the sender after opt-in, not through an image proxy we pay to operate. If image proxying, attachment downloads, OCR or embeddings are added, recalculate costs: none is included in this model. Jev input is text-only, and the current classifier often sees just a preview for HTML-only messages; low cost does not establish adequate classification quality.

Daily digests consume approximately 30 sends/user/month. Free Resend capacity has daily limits as well as monthly limits. Digest payload snapshots persist content and grow independently of mailbox disconnect. Include their retention, delivery retries and any other transactional messages in budgeting.

## Recommended initial packaging — proposal, not enforced settings

Treat $3.99 as an entry-level or founding-user experiment, not a forever-unlimited commitment. Validate willingness to pay separately from this cost floor.

| Proposed entry-plan rule                                  | Reason                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| One mailbox per paid user                                 | Avoid multiplication across accounts/workspaces                                                 |
| Five active AI rules in total                             | Predictable question count and classification storage                                           |
| 1,500 newly classified emails/month                       | Approximately 50/day; test against real customer distribution                                   |
| Optional one-time import of up to 1,000 existing messages | Delivered as multiple jobs; budget separately as onboarding acquisition cost                    |
| Semantic rule rechecks use the processing allowance       | Prevent unlimited archive-wide reevaluation; cosmetic edits should be free                      |
| 30-day index/result retention initially                   | Bound history, storage and reclassification scope; clearly disclose the search/history tradeoff |
| Per-request token ceiling and internal AI spend ceiling   | A message allowance alone does not protect against long input                                   |
| Pause AI at budget exhaustion; retain reading             | Predictable costs without locking users out of provider mail                                    |

At the baseline rate, the typical recurring AI estimate is $0.2772/user/month. A 1,000-message onboarding import at the same assumptions adds $0.1848 once. Start with an internal AI reservation ceiling around **$0.50 recurring plus $0.25 onboarding** per user, adjustable after actual telemetry. This ceiling includes retries/add-ons and can require earlier pauses for unusually large messages. It is not a promise that every allowed email size fits that budget. Do not advertise a quota that the configured spend ceiling routinely prevents users from reaching.

At higher provider rates or larger observed token sizes, lower included volume or raise price. A heavier tier must have its own measured allowances; changing the price to $6.99/$9.99 without limits simply moves the point at which abuse becomes unprofitable. Avoid a new free tier with unlimited AI: use a finite, once-per-user trial processing grant and anti-abuse controls.

## Required work before calling this commercially safe

1. Confirm paid Gateway rate, model route and ZDR eligibility; verify actual Vercel/Supabase/Resend plans, region, memory and enabled add-ons. Set platform spending controls without weakening privacy.
2. Implement paid entitlements and an atomic usage/cost ledger shared by every processing entry point. Add account/rule/import quotas and bounded trials.
3. Fix tag invalidation, forced-processing limits, total-token validation, permanent-failure handling and redundant body reads.
4. Implement the accepted retention policy and temporary body processing. Do not silently purge existing data as part of a cost audit.
5. Enable and verify the chosen production scheduler/queue only after bounded jobs, global pacing and quotas exist. Keep Gmail/Outlook cursors correct while limiting AI work.
6. Measure a bounded synthetic workload, then a consenting pilot: input tokens per email and tag count, billed attempts, failed requests, p50/p95 processing time, DB query time/pool pressure, provider quota use, queue age, storage growth, egress, digest sends and support time. Record numeric metadata, not mail contents.
7. Reconcile measurements to invoices. Review p95/top-user cost and onboarding cost, including retries and free users. Raise limits only with demonstrated margin and backlog headroom.

**Conclusion:** keep the stack and its incremental/result-cache design; add commercial controls and remove unnecessary retention. Support 1,000-message jobs through bounded continuation. Keep $3.99 provisional and limited until the post-promotion price and measured user costs confirm the margin.
