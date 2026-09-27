# Cost measurement

Updated 2026-09-26. No current hosted cost-per-inbox or burst-latency figure has been established by this maintenance task. The old $3.99 pricing/digest spreadsheets and narrative cost reports are superseded; the product now displays a Starter/Heavy preview with billing disabled.

Use the actual service dashboards and an explicitly scoped staging run to measure:

- Imported emails, tag questions and provider requests. One native Jev call can contain several tag questions; request count alone does not establish billing.
- Provider/Gateway usage, billed units, current route/model prices, failed calls and retries.
- Inngest executions/steps, queue wait, concurrency, and the subscribed tier.
- Database storage/pool pressure, runtime duration and hosting charges.
- First-tag and full-completion latency separately, at the 100-email initial-import limit.

`npm run test:burst` uses mocked inference/providers and cannot measure bills or hosted latency. `npm run load:burst -- staging-user-ids.json` reports observed hosted progress for provisioned test mailboxes; inspect the corresponding provider invoices/dashboard usage for cost.

The remaining `cost_model.py` and `cost-model.json` are explicitly **historical calculator examples**, not a supported forecast for the current product. They retain old rates, $3.99 pricing and a retired digest model. Their generated output is labeled obsolete. Do not use them for pricing, launch capacity or customer claims without replacing and validating the assumptions and model structure.

For rollout and reproducible test prerequisites, see [the runbook](RUNBOOK.md). Record new measured evidence with its date, revision, environment, volume and limitations in [status](../STATUS.md).
