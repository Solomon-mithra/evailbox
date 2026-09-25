# Additional monthly cost: all-heavy users

Planning calculation dated 2026-09-25. This estimates operating expenses for the proposed Jev + Inngest + Vercel + Supabase + provider webhook architecture. It is not an engineering labor estimate, vendor quote, measured bill, or proof of capacity.

Existing Vercel and Supabase base subscriptions are excluded as requested. Notifications and digests are excluded. No GPU or Redis is assumed. Additional metered usage, new Inngest subscription, and infrastructure growth still cost money.

## Workload assumptions

- 10,000 NEW emails per user per month, combined across that user's accounts.
- 8,000 input tokens per evaluation, including email and all tag questions together.
- 25% extra paid evaluations for retries/reclassification: 12,500 evaluations/user/month.
- One workflow per evaluation, with three steps (for example fetch, evaluate, persist). Inngest counts the function run too: four executions, or 50,000/user/month. Applying the full multiplier to all steps is conservative; actual retries may repeat only a failed step.
- This is a straightforward per-email workflow scenario. Batching or mailbox-level workflows changes the orchestration cost substantially.
- Six months of accumulated email data for the illustrative disk calculation below. This is NOT an implemented retention policy. Current code does not enforce a six-month purge.
- Existing shared subscription allowances are not credited again: remaining usage from the other applications is unknown.
- No attachments, mass historical import, repeated full-history relabeling beyond the 25% allowance, payment processing, tax, support labor, marketing, or optional premium observability/compliance add-ons.

## Prices and formulas

TypeSafe lists Jev at **$0.042 per million input tokens**, output free. Therefore:

```text
AI/user/month = 10,000 × 1.25 × 8,000 / 1,000,000 × $0.042 = $4.20
```

Source: [TypeSafe model pricing](https://docs.typesafe.ai/models).

The app currently routes through Vercel AI Gateway. Its Jev page still shows a free promotion ending September 25, 2026. The direct list price above is a planning proxy, NOT a confirmed post-promotion Gateway rate. Source: [Gateway Jev page](https://vercel.com/ai-gateway/models/jev).

Inngest Free includes 50,000 executions; Pro starts at $99 with 1 million included. Its FAQ publishes Pro overage rates ranging from $0.000015 to $0.000050 per execution. Business starts at $499 with 10 million executions. Source: [Inngest pricing](https://www.inngest.com/pricing).

The table uses a **Pro overage sensitivity envelope**, not the exact blended tier bill: $99 + excess above 1 million × either endpoint of the published rate range. In particular, the low endpoint is NOT a claim that a small customer can buy all excess executions at the deepest discount. Business or a negotiated plan may be cheaper; concurrency and observability may cost more. Inngest orchestrates work; Vercel execution hosting is counted separately.

Other infrastructure is a **$1–$2/user/month planning allowance**, not a measured charge. It includes Vercel hosting/network usage, Supabase disk/egress/Realtime and allowance for compute upgrades, Google Pub/Sub and routine operational overhead. Its adequacy must be verified with a load test and current account usage. It is not a hard lower or upper bound.

## Calculated monthly amounts, USD

| Heavy users | New emails/month | Jev | Inngest sensitivity | Other infrastructure allowance | Total planning estimate |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 50,000 | $21.00 | $99.00–$99.00 | $5.00–$10.00 | $125.00–$130.00 |
| 10 | 100,000 | $42.00 | $99.00–$99.00 | $10.00–$20.00 | $151.00–$161.00 |
| 25 | 250,000 | $105.00 | $102.75–$111.50 | $25.00–$50.00 | $232.75–$266.50 |
| 50 | 500,000 | $210.00 | $121.50–$174.00 | $50.00–$100.00 | $381.50–$484.00 |
| 100 | 1,000,000 | $420.00 | $159.00–$299.00 | $100.00–$200.00 | $679.00–$919.00 |
| 500 | 5,000,000 | $2,100.00 | $459.00–$1,299.00 | $500.00–$1,000.00 | $3,059.00–$4,399.00 |
| 1,000 | 10,000,000 | $4,200.00 | $834.00–$2,549.00 | $1,000.00–$2,000.00 | $6,034.00–$8,749.00 |
| 5,000 | 50,000,000 | $21,000.00 | $3,834.00–$12,549.00 | $5,000.00–$10,000.00 | $29,834.00–$43,549.00 |
| 10,000 | 100,000,000 | $42,000.00 | $7,584.00–$25,049.00 | $10,000.00–$20,000.00 | $59,584.00–$87,049.00 |

## What supports the infrastructure allowance

Illustrative per-user resource assumptions, not performance measurements:

| Resource | Assumption | Approximate marginal monthly cost |
| --- | --- | ---: |
| Worker active CPU | 12,500 evaluations × 0.1 CPU second | $0.044 |
| Worker allocated memory | 12,500 × 2–10 aggregate GB-seconds, after concurrency sharing | $0.074–$0.368 |
| Function invocations | 62,500 total | $0.038 |
| CDN requests | 62,500 total | $0.125 |
| CDN visitor transfer | 1 GB | $0.150 |
| Function origin transfer | 1 GB | $0.060 |
| Database egress | 1 GB | $0.090 |
| Database disk | 60,000 stored emails × 50 KiB including classification rows/indexes = 2.86 GiB | $0.358 |
| Realtime messages | 20,000 billed message units | $0.050 |
| Subtotal | Before remaining account allowances | $0.99–$1.28 |

These assumptions leave approximately $0.01–$0.72/user within the corresponding $1–$2 budget endpoints for DB compute growth, Pub/Sub, peak connections and other overhead. The lower end is optimistic where a database upgrade is needed; the higher end is a budget, not a cap. A larger allowance is needed if measured CPU/memory, payloads, queries, DB size, or logs exceed these assumptions. Send references rather than full email bodies through the workflow orchestrator.

Vercel US iad1 Fluid rates are $0.128/CPU-hour and $0.0106/GB-hour; invocations are $0.60/million. Memory remains billed while waiting on I/O. Sources: [Fluid pricing](https://vercel.com/docs/functions/usage-and-pricing), [CDN pricing](https://vercel.com/docs/manage-cdn-usage). CDN here assumes usage-based pricing, not an unverified flat-rate contract.

Supabase disk overage is $0.125/GB-month; uncached egress is $0.09/GB. Compute upgrades are additional: for example a paid Micro-to-Large change adds roughly $100/month, Micro-to-2XL $400, and Micro-to-4XL $950. Those are price examples, not validated sizing recommendations. A separate new project also has compute cost even on an existing organization subscription. Sources: [Supabase pricing](https://supabase.com/pricing), [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing).

Google Pub/Sub basic throughput is $40/TiB after 10 GiB/month, with network transfer billed separately where applicable. Source: [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing).

At 10,000 users, the illustrative six-month database contains 600 million emails and about 28,610 GiB of data. Compute and query performance at that scale are unverified. Each additional stored month adds about $596/month in disk charges across those users at the assumed bytes/email. Keeping every email indefinitely does not have a flat storage bill.

## Sensitivity and decisions

- At 2,000 instead of 8,000 tokens/evaluation, Jev falls from $4.20 to $1.05/user/month. Validate classification quality before truncating inputs.
- At 1,000 instead of 10,000 new emails/month, AI falls to $0.42/user/month at the original token assumption. Inngest minimums do not shrink proportionally.
- Removing notification/digest features does not remove inbox classification cost.
- Browser persistence and precomputation reduce waiting on app open; they do not eliminate the first classification of each new email.
- A 10,000-email historical import adds roughly $4.20/user in AI alone under the same token/repeat assumptions, beyond that month's new mail.
- At 10,000 heavy users, mean load is about 2,894 Jev requests/minute and 385,802 input tokens/second, above the published default limits of 1,200 requests/minute and 250,000 tokens/second. Higher quotas and headroom for bursts must be arranged; pricing may change.
- A $3.99 subscription does not cover $4.20 of AI alone in this heavy scenario.
- To reduce orchestration costs, use mailbox-level work and bounded batches where latency permits. Do not assume every live email arrives in a full batch.
- The proposed sub-100 ms experience concerns an already-cached inbox. None of these prices imply newly receiving and classifying 1,000 emails within 100 ms.

Before making a pricing commitment, record real input tokens/evaluation, workflow executions/email, worker CPU and aggregate GB-seconds, bytes/email including indexes, reads/active user, and the existing organizations' remaining allowances.

