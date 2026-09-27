# Jev plain-language evaluation — 2026-09-26

Jev interprets ordinary-language rules in this experiment. With keyword and sender hints empty, it made the expected confident decision on **182/192 (94.8%)** core cases in grouped native evaluation. A simple keyword matcher got **54/192 (28.1%)**. This is evidence of semantic matching, not a guarantee of production accuracy.

The separate **exact application adapter** sample scored **30/32 (93.8%)** with plain rules. Its sample is smaller and deliberately chosen; do not present the grouped score as a 192-case exact-adapter measurement.

## What ran

- 224 distinct synthetic emails and 16 independently written rubrics. Core set: 192 cases, balanced at six matches and six nonmatches per rubric. Additional diagnostics: 12 injection attempts, 12 missing-evidence cases, eight input-limit cases.
- Four variants per email: original plain rule with empty hints; rephrased plain rule with empty hints; original rule with supporting keywords; original rule with misleading keyword/sender hints. No expected labels or rationales were sent to Jev.
- 896 main decisions, 128 decisions on 32 exact-adapter sample cases, 36 repeated plain-rule decisions in three separate requests, and 120 decisions in four exact-adapter 30-tag batches: **1,180 decisions** in the completed run.
- Synthetic examples and expected labels were written by Codex before the first live request. Labels were not changed after observing outputs. Scoring is deterministic local code; no second model was used as a judge.
- Only `typesafe-ai/jev`, using `JEV_API_KEY` from `.env.local`, processed test data. The fetch guard allowed only the configured Gateway `/evaluation-model` endpoint and Jev model header, forbade redirects, and verified both retention/training flags. No inbox, database, queue, billing, or other model service was called by the experiment.
- No product behavior or thresholds were changed.

## Rubric and protocol

The fixed decision policy matches the application: probability ≥0.80 is a match; probability ≤0.20 is no match; otherwise uncertain. A clear binary case only passes if the final decision equals its expected label. Abstentions count as misses, and confident wrong answers are counted separately. The predeclared core target was at least 90% correct decisions with no more than 5% confident errors. Missing-evidence cases measure compliance with the request to return a probability near 0.5; they are not binary truth labels.

A preliminary exact-adapter run encountered a live limit of five requests per minute. The protocol was amended for request efficiency, before completing the full live run, without changing the corpus: up to seven independent emails share a native state, and every question explicitly selects its own email. Instructions and tag criteria otherwise come from the existing adapter. The corpus retains its original design notes; the run manifest records this protocol amendment. Calls are spaced at least 13 seconds apart and honor `Retry-After`; SDK retries remain disabled. The 32-case exact-adapter sample was fixed as cases 02 and 08 from every rule, covering a positive and a negative for each rubric. Repeats are separate requests; batch-order probes reverse the same 30 tags. Preliminary results are retained but excluded from headline accuracy.

Corpus SHA-256: `6977d6e71e05bffa241e2a42b955059d090816aca77e3bceab3104b7c6ea84f9`. Adapter source revision: `f5cfcccdbf659fa3fbc95e7f8be87a438141a40f`. The run started at `2026-09-27T02:04:50.662Z` and completed at `2026-09-27T02:21:02.780Z` (UTC). `JEV_MODEL_VERSION=1` is an application cache marker, not independent attestation of Jev's underlying weights.

## Core results

| Variant          | Correct / 192 | Accuracy | Uncertain | Confident wrong | Match precision | Match recall |
| ---------------- | ------------- | -------- | --------- | --------------- | --------------- | ------------ |
| plain            | 182           | 94.8%    | 10        | 0               | 100.0%          | 92.7%        |
| rephrased        | 178           | 92.7%    | 14        | 0               | 100.0%          | 90.6%        |
| hints            | 181           | 94.3%    | 11        | 0               | 100.0%          | 92.7%        |
| misleading_hints | 184           | 95.8%    | 8         | 0               | 100.0%          | 94.8%        |

Predeclared plain-rule core target: met (≥90% correct, ≤5% confident errors).

Plain-rule Brier score: 0.0107 (lower is better; this synthetic dataset alone does not establish probability calibration). Simple keyword baseline: 54/192 correct. That baseline is substring OR matching on supplied rule keywords, not an optimized deterministic parser. Always-no-match would score 96/192 on the balanced core set. The corpus deliberately includes keyword traps and matches without the supplied keywords; the 28.1% baseline score is not an estimate for keyword systems on typical inbox traffic.

| Rule                            | Plain correct / 12 | Uncertain | Confident wrong |
| ------------------------------- | ------------------ | --------- | --------------- |
| Money I still need to pay       | 11                 | 1         | 0               |
| Needs me today                  | 12                 | 0         | 0               |
| Interview arrangements          | 11                 | 1         | 0               |
| Customer wants their money back | 12                 | 0         | 0               |
| Suspicious access to my account | 11                 | 1         | 0               |
| Promotional sales emails        | 12                 | 0         | 0               |
| Someone is changing my meeting  | 12                 | 0         | 0               |
| Confirmed trip bookings         | 9                  | 3         | 0               |
| Work expenses needing approval  | 12                 | 0         | 0               |
| Orders between two amounts      | 12                 | 0         | 0               |
| October appointments            | 12                 | 0         | 0               |
| Requests from my team domain    | 10                 | 2         | 0               |
| Outages unless they are drills  | 12                 | 0         | 0               |
| Exact project code in subject   | 10                 | 2         | 0               |
| Parcel delivery trouble         | 12                 | 0         | 0               |
| Someone is waiting for my reply | 12                 | 0         | 0               |

## Exact application adapter

| Variant          | Correct / 32 | Accuracy | Uncertain | Confident wrong |
| ---------------- | ------------ | -------- | --------- | --------------- |
| plain            | 30           | 93.8%    | 2         | 0               |
| rephrased        | 30           | 93.8%    | 2         | 0               |
| hints            | 30           | 93.8%    | 2         | 0               |
| misleading_hints | 30           | 93.8%    | 2         | 0               |

| Variant          | Same decision / 32 | Grouped vs adapter disagreements   |
| ---------------- | ------------------ | ---------------------------------- |
| plain            | 29                 | literal-08, sender-02, sender-08   |
| rephrased        | 29                 | literal-08, hiring-08, security-02 |
| hints            | 30                 | literal-08, sender-08              |
| misleading_hints | 29                 | literal-08, sender-02, sender-08   |

## Edge cases

The following scores are kept separate from core accuracy.

| Diagnostic   | Plain | Rephrased | Helpful hints | Misleading hints |
| ------------ | ----- | --------- | ------------- | ---------------- |
| adversarial  | 12/12 | 12/12     | 12/12         | 12/12            |
| ambiguity    | 6/12  | 7/12      | 5/12          | 6/12             |
| input_limits | 4/8   | 4/8       | 4/8           | 4/8              |

For missing evidence, the plain rule produced the requested uncertain decision on 6/12 cases. A firm no-match on missing evidence is a failure of this abstention rubric, not proof that the unseen message was a match.

The app clips body text at 24,000 characters, subject/snippet at 2,000 each, and sender at 1,000. Four probes place relevant evidence inside these limits; four put it beyond them. Input-limit scores use the visible content as ground truth. All four inside-limit probes returned uncertain; all four after-limit probes returned no match. The expected full-message label for all eight is a match because a payment request is present. The repeated filler also says that nothing actionable is stated, so this is a combined length/distractor stress test, not an isolated test of length. Thus after-limit no-match decisions still represent missed matches from the user’s full-message perspective. Sender-length probes deliberately use malformed field contents and are diagnostic only.

| Variation        | Core decisions unchanged / 192 |
| ---------------- | ------------------------------ |
| rephrased        | 184                            |
| hints            | 189                            |
| misleading_hints | 190                            |

Repeated-case consistency: 12/12 selected cases kept the same decision across available main, repeat, and exact-adapter observations. This mixes input contexts and therefore does not isolate intrinsic model randomness. Only three additional repeated requests were made; this is a small stability probe.

| 30-tag request             | Correct / 30 |
| -------------------------- | ------------ |
| payment-02-batch30-forward | 30           |
| payment-08-batch30-reverse | 30           |
| payment-02-batch30-reverse | 30           |
| payment-08-batch30-forward | 30           |

The 30-tag probe contains 15 copies of each of two opposing payment rules. It checks independent decisions and ordering in this narrow setting, not performance on 30 unrelated complex rules.

## Exploratory checks through the exact adapter

After observing the grouped input-limit failures, six selected cases were re-run through the unchanged application adapter: four with evidence inside the limits, a body-truncation control, and one missing-attachment case. This adds **24 decisions** and is excluded from the headline scores because selection happened after the main run.

| Case       | Expected  | Exact adapter, plain rule | P(match) |
| ---------- | --------- | ------------------------- | -------- |
| limit-01   | match     | uncertain                 | 75%      |
| limit-02   | no_match  | no_match                  | 2%       |
| limit-03   | match     | uncertain                 | 55%      |
| limit-05   | match     | uncertain                 | 53%      |
| limit-07   | match     | uncertain                 | 65%      |
| unknown-01 | uncertain | uncertain                 | 30%      |

All four long/distracting inside-limit inputs again returned uncertain in all four rule variants. This confirms that these specific failures also occur with the exact adapter; it does not establish that all long emails fail. The body evidence outside the limit remained unavailable, and the missing-attachment case correctly abstained. The follow-up source and raw responses are retained in the machine-readable evidence under `exploratoryFollowup`.

## Concrete examples

| Case       | Email                                                                                                      | Expected | Plain Jev | P(match) | Keyword baseline |
| ---------- | ---------------------------------------------------------------------------------------------------------- | -------- | --------- | -------- | ---------------- |
| payment-02 | The amount you owe for last month is still outstanding. Please settle it.                                  | match    | match     | 96%      | no_match         |
| refund-03  | Your checkout charged me twice. Please reverse the second charge.                                          | match    | match     | 96%      | no_match         |
| hiring-02  | The team lead wants to meet you to discuss your application for our engineering opening. Which time works? | match    | match     | 91%      | no_match         |
| urgent-07  | URGENT SALE TODAY: shop our shoes before midnight!                                                         | no_match | no_match  | 14%      | match            |
| payment-08 | You do not owe us anything. No payment is due.                                                             | no_match | no_match  | 3%       | match            |
| expense-07 | Please approve this pending work expense of exactly $100 USD.                                              | no_match | no_match  | 7%       | match            |
| amount-08  | Order confirmed. Final total after tax and discounts: $500.01 USD.                                         | no_match | no_match  | 5%       | match            |
| literal-10 | AZX-47B update                                                                                             | no_match | no_match  | 7%       | match            |

## All plain-rule misses in the core set

| Case        | Expected | Observed  | P(match) | Rule                            |
| ----------- | -------- | --------- | -------- | ------------------------------- |
| travel-01   | match    | uncertain | 79.0%    | Confirmed trip bookings         |
| security-06 | match    | uncertain | 78.0%    | Suspicious access to my account |
| travel-02   | match    | uncertain | 67.0%    | Confirmed trip bookings         |
| hiring-03   | match    | uncertain | 73.0%    | Interview arrangements          |
| sender-02   | match    | uncertain | 77.0%    | Requests from my team domain    |
| travel-06   | match    | uncertain | 74.0%    | Confirmed trip bookings         |
| literal-08  | no_match | uncertain | 63.0%    | Exact project code in subject   |
| sender-01   | match    | uncertain | 75.0%    | Requests from my team domain    |
| payment-07  | no_match | uncertain | 34.0%    | Money I still need to pay       |
| literal-07  | no_match | uncertain | 57.0%    | Exact project code in subject   |

Full variant-level failures, diagnostic failures, raw returned probabilities, request hashes, costs, and rate-limit observations are in [the machine-readable evidence](jev-evaluation-results.json). The [dataset](../../scripts/fixtures/jev-semantics.json) contains every email, rule, expected decision, and rationale.

## Runtime and limits

The completed run made 72 HTTP requests for 71 logical calls. Across the primary run, preliminary probes, and exploratory follow-up: 94 HTTP requests, 11 HTTP errors, and **$0.014456 USD in Gateway-reported cost**. This is response metadata, not a reconciled invoice. The 24 successful preliminary decisions and 24 exploratory follow-up decisions are additional to the 1,180 primary decisions. No rate-limit response was counted as a classification answer.

Primary-run HTTP latency including provider error attempts, excluding pacing: median 483 ms; p95 613 ms; maximum 766 ms. These mix native grouped requests and exact-adapter requests and are not end-to-end inbox timings.

This is a single synthetic, English-dominant run with Spanish cases. Examples are mostly short. Labels are author judgments, not independently human-reviewed; no held-out real inbox or representative production distribution was sampled. Variant decisions share inputs and are correlated, so 1,180 decisions should not be described as 1,180 independent test emails. Grouped state changes the input structure; use exact-adapter results for claims about the current app. Evidence beyond truncation, ambiguous intent, and thresholds can still change whether a message receives a tag.

## Reproduce

Validate the corpus without calling any service:

```sh
node --conditions=react-server --import tsx scripts/eval-jev-semantics.mjs
```

Run the live synthetic evaluation using only the configured Jev key:

```sh
node --conditions=react-server --import tsx scripts/eval-jev-semantics.mjs \
  --run --grouped --env-file .env.local
```

The script is opt-in and is not part of normal tests or application startup. Results go to ignored `test-results/jev-semantics/<timestamp>/`. Omitting `--grouped` uses the exact adapter for all cases and takes substantially longer at the observed five-request-per-minute limit. Never commit environment files or the key.

## Source references

- [Application adapter](../../src/lib/jev.ts): natural-language prompt is primary; hints are supporting context unless made mandatory.
- [Input bounds](../../src/lib/classification-version.ts): limits applied before requests.
- [TypeSafe model documentation](https://docs.typesafe.ai/models): natural-language inputs, shared state, multi-question evaluation, and language limitations (checked September 26, 2026).
- [Vercel Jev announcement](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway): native Boolean probabilities through AI SDK evaluation.
