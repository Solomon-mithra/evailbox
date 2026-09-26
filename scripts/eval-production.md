# Temporary production pipeline evidence

Purpose: collect evidence from the configured live database for an interview or case study. This is a read-only observer of real work. It does not generate emails, invoke inference, enqueue jobs, reset data, or substitute fixtures when records are absent.

## Audit existing records

From the repository root, with dependencies installed:

```sh
node --conditions=react-server --import tsx scripts/eval-production.ts --env-file .env.local
```

The env file is explicit: the script uses its database URL and model settings, not ambient shell values or Next.js env-file precedence. `APP_MODE` must be `live`; `.env.production` being named “production” does not prove it contains a live configuration. The React server condition permits reuse of the application's model-version helper outside Next.js. No build or deployment is needed for the observer.

## Observe the next real import

1. Ensure the intended live app and its Inngest worker are running, with actual Gmail/Outlook and Jev configuration. The observer does not deploy or activate them.
2. Start this command **before** connecting/importing the real mailbox:

   ```sh
   node --conditions=react-server --import tsx scripts/eval-production.ts --env-file .env.local --watch-seconds 600 --min-emails 1000
   ```

3. Wait for the first snapshot to print; it establishes the excluded baseline. Then connect/import through the app normally.
4. The script ends after the observation deadline, Ctrl+C, or after the minimum new cohort is fully current and the scoped queue flags are idle. It saves every observed arrival, including arrivals beyond the minimum. If fewer than 1,000 real messages arrive, that is insufficient evidence for the requested cohort size; it does not fill the gap.
5. Read the printed `report.md` path. Preserve the adjacent evidence files and caveats with any interview claim.

Use `--user-id UUID` to isolate a tenant. The default observes all tenants in the configured database and must be described that way. The default poll pause is 5 seconds; `--poll-ms` accepts 1–60 seconds. These are intervals **between** queries, not a guaranteed timing resolution. `--max-rows` defaults to 10,000 and rejects larger snapshots instead of silently sampling. Up to 1,000,000 cumulative row observations are allowed. Narrow scope or shorten the observation if necessary.

## What the evidence means

| Metric                             | Definition and boundary                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unique emails                      | Distinct stored email rows, including separately imported copies in different accounts. Not unique RFC Message-IDs across mailboxes.                                                                                                      |
| Fully current email                | In Inbox, nonempty content hash, at least one tag, and a decision for **every** current tag with matching user, workspace, tag version, content hash, and configured model version.                                                       |
| Decisions                          | Email/tag pairs. Match, no-match, and uncertain all count as decisions; this is not a count of correctly classified emails.                                                                                                               |
| Historical import → first decision | `firstClassifiedAt - createdAt`. DB transaction timestamp approximation. Never all-tag completion, inference runtime, or end-to-end latency. Negative values are exposed and excluded, not clamped.                                       |
| New cohort                         | Absent from baseline and with import timestamp at or after the baseline transaction start. Older transactions becoming visible later are separately counted and excluded.                                                                 |
| Import → all decisions interval    | From the import transaction timestamp to the last snapshot known incomplete (lower bound) and first snapshot seen complete (upper bound). Upper bounds include polling and query delay. First-seen-complete rows have a zero lower bound. |
| Changed/missing records            | Content or tag-set changes invalidate original timing. Records disappearing after observation remain in the cohort denominator.                                                                                                           |
| Observed completions/second        | Completed new records divided by the whole observation window, including idle time. Not sustained capacity or a rate extrapolation.                                                                                                       |
| Query latency                      | Local observer SQL round trip. Never email processing time.                                                                                                                                                                               |

The all-tag comparison is tied to the **selected file's configured model version**. Verify that it matches the worker; the collector cannot verify deployed settings. Completion intervals preserve the **first observed completion**. Later inbox/decision regressions do not rewrite that history; final-state completeness is checked separately before including a record in the completed count or percentiles. Content or rule changes invalidate timing for the original version. User/account error and pending flags describe the current snapshot, not historical retry counts or failure rates. Snapshot percentiles use nearest rank and include sample counts; percentiles from a small sample are not a production SLA.

This observer cannot support **“1,000 emails processed end-to-end in 100 ms.”** It does not collect the initiating request, provider fetch, queue, inference, commit, and browser-render spans. That claim requires correlated production tracing across those boundaries. Do not replace the missing trace with database query time, `firstClassifiedAt`, sum of parallel task durations, or the existing synthetic burst harness. Classification log fields named `classified` count tag decisions, so they also cannot establish a unique-email throughput claim by themselves.

Records created and deleted entirely between polls are not visible. Imported-cohort completion is not proof that the entire provider mailbox was imported. Accuracy requires labeled real examples; speedup requires comparable before/after runs; cost requires actual usage records. This script invents none of them.

## Evidence artifacts

Each run creates an ignored, private directory under `test-results/production-eval/`:

- `report.md` and `report.json`: results, status, conservative claim wording, and limitations.
- `observations.ndjson`: exact selected snapshot fields, with ephemeral HMAC pseudonyms replacing identities, content hashes, and tag-set identifiers.
- `cohort.json` in observation mode: per-email completion bounds and invalidation/missing flags.
- `manifest.json`: environment-file path, database target fingerprint, local Git revision/dirty state, source hashes, model version, runtime, scope, and options. It explicitly records the deployed revision and deployment environment as unverified.
- `SHA256SUMS`: verify from the evidence directory with `shasum -a 256 -c SHA256SUMS`.

Checksums detect later edits, not independent source authenticity. Keep the bundle private: timestamps and aggregates can still be sensitive. Subjects, senders, snippets, bodies, prompts, reasoning, provider IDs, and credentials are never selected. Identities cannot be linked across runs because the HMAC key is not exported. For an external audit requiring direct record reconciliation, collect that mapping separately under appropriate access controls.

Queries run in read-only, repeatable-read transactions with 15-second statement and 25-second transaction limits. No application code or remote data is modified. Collection failures preserve prior observations, mark the report failed, and suppress upstream error details which could contain credentials. Exit codes: `0` audited/observed data, `2` insufficient/incomplete evidence, `1` setup/collection failure, `130` interruption. An audit exit of `0` means records were audited, not that a performance target passed.

## Verification

```sh
npx vitest run tests/production-eval.test.ts tests/production-eval-db.test.ts
npx tsc --noEmit
```

Unit and SQL fixtures test accounting and freshness predicates only. They never populate evaluation artifacts or become reported performance results. Remove the three `eval-production*.ts` files, this runbook, and the two `production-eval*.test.ts` files when the temporary evaluator is no longer needed; retain evidence bundles separately if desired.
