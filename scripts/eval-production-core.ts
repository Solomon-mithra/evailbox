/** Accounting only. No service calls, fixtures, inference, or workload generation. */
export type EmailEvidence = {
  id: string;
  userId: string;
  workspace: string;
  createdAt: string;
  firstClassifiedAt: string | null;
  inInbox: boolean;
  contentHash: string;
  rulesSignature: string;
  requiredTags: number;
  currentDecisions: number;
};
export type Snapshot = {
  startedAt: string;
  finishedAt: string;
  queryWallMs: number;
  inventory: {
    users: number;
    accounts: number;
    pendingUsers: number;
    usersWithFailures: number;
    pendingAccounts: number;
    accountsWithErrors: number;
    decisions: number;
    jevCooldown: boolean;
  };
  emails: EmailEvidence[];
};

export function distribution(values: number[]) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const at = (p: number) => (sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null);
  return {
    samples: sorted.length,
    min: sorted[0] ?? null,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1) ?? null,
  };
}
function eligible(email: EmailEvidence) {
  return email.inInbox && email.contentHash !== '' && email.requiredTags > 0;
}
function complete(email: EmailEvidence) {
  return eligible(email) && email.currentDecisions === email.requiredTags;
}
export function summarize(snapshot: Snapshot) {
  const deltas = snapshot.emails
    .filter((e) => e.firstClassifiedAt !== null)
    .map((e) => Date.parse(e.firstClassifiedAt!) - Date.parse(e.createdAt));
  return {
    uniqueEmails: snapshot.emails.length,
    inboxEmails: snapshot.emails.filter((e) => e.inInbox).length,
    eligibleEmails: snapshot.emails.filter(eligible).length,
    fullyCurrentEmails: snapshot.emails.filter(complete).length,
    emailsWithFirstDecision: deltas.length,
    invalidFirstDecisionTimestamps: deltas.filter((d) => !Number.isFinite(d) || d < 0).length,
    importToFirstDecisionMs: distribution(deltas.filter((d) => d >= 0)),
  };
}

type ObservedEmail = {
  id: string;
  createdAt: string;
  firstSeenAt: string;
  latest: EmailEvidence;
  initialContentHash: string;
  initialRulesSignature: string;
  changed: boolean;
  missing: boolean;
  lastIncompleteAt: string;
  completionLowerMs: number | null;
  completionUpperMs: number | null;
};
export function observe(snapshots: Snapshot[]): ObservedEmail[] {
  if (!snapshots.length) return [];
  const baseline = new Set(snapshots[0].emails.map((e) => e.id));
  const start = Date.parse(snapshots[0].startedAt);
  const cohort = new Map<string, ObservedEmail>();
  for (const snapshot of snapshots.slice(1)) {
    for (const entry of cohort.values()) entry.missing = true;
    for (const email of snapshot.emails) {
      if (baseline.has(email.id) || Date.parse(email.createdAt) < start) continue;
      let entry = cohort.get(email.id);
      if (!entry) {
        entry = {
          id: email.id,
          createdAt: email.createdAt,
          firstSeenAt: snapshot.finishedAt,
          latest: email,
          initialContentHash: email.contentHash,
          initialRulesSignature: email.rulesSignature,
          changed: false,
          missing: false,
          lastIncompleteAt: email.createdAt,
          completionLowerMs: null,
          completionUpperMs: null,
        };
        cohort.set(email.id, entry);
      }
      entry.missing = false;
      entry.latest = email;
      entry.changed ||=
        email.contentHash !== entry.initialContentHash ||
        email.rulesSignature !== entry.initialRulesSignature ||
        email.createdAt !== entry.createdAt;
      if (complete(email) && !entry.changed) {
        if (entry.completionUpperMs === null) {
          entry.completionLowerMs =
            Date.parse(entry.lastIncompleteAt) - Date.parse(entry.createdAt);
          entry.completionUpperMs = Date.parse(snapshot.finishedAt) - Date.parse(entry.createdAt);
        }
      } else if (entry.changed) {
        entry.completionLowerMs = null;
        entry.completionUpperMs = null;
      } else if (entry.completionUpperMs === null) {
        // Preserve a valid FIRST completion even if inbox membership/decisions later regress.
        // The report separately checks final-state completeness before counting the email.
        // A DB transaction can start before this row's insert transaction, then acquire its
        // repeatable-read snapshot after the insert commits. The lower bound is never before import.
        entry.lastIncompleteAt =
          Date.parse(snapshot.startedAt) < Date.parse(email.createdAt)
            ? email.createdAt
            : snapshot.startedAt;
      }
    }
  }
  return [...cohort.values()];
}

export function finishObservation(snapshots: Snapshot[], minimumEmails: number) {
  const cohort = observe(snapshots);
  const baseline = snapshots[0];
  const final = snapshots.at(-1);
  const baselineIds = new Set(baseline?.emails.map((e) => e.id));
  const late = new Set(
    snapshots
      .slice(1)
      .flatMap((s) => s.emails)
      .filter(
        (e) => !baselineIds.has(e.id) && Date.parse(e.createdAt) < Date.parse(baseline.startedAt),
      )
      .map((e) => e.id),
  );
  const invalidClock = snapshots.some(
    (s, i) =>
      Date.parse(s.finishedAt) < Date.parse(s.startedAt) ||
      (i > 0 && Date.parse(s.startedAt) < Date.parse(snapshots[i - 1].finishedAt)),
  );
  const completed = cohort.filter(
    (e) =>
      !e.missing &&
      !e.changed &&
      complete(e.latest) &&
      e.completionUpperMs !== null &&
      e.completionUpperMs >= 0,
  );
  const windowMs =
    baseline && final ? Date.parse(final.finishedAt) - Date.parse(baseline.startedAt) : null;
  return {
    status: invalidClock
      ? 'invalid_clock'
      : cohort.length < minimumEmails
        ? 'insufficient_evidence'
        : completed.length !== cohort.length
          ? 'incomplete'
          : 'observed',
    minimumEmails,
    baselineEmailsExcluded: baselineIds.size,
    newEmails: cohort.length,
    fullyCurrentNewEmails: completed.length,
    missingEmails: cohort.filter((e) => e.missing).length,
    changedEmails: cohort.filter((e) => e.changed).length,
    lateVisiblePreexistingEmails: late.size,
    observationWindowMs: windowMs,
    observedCompletionsPerSecond:
      !invalidClock && windowMs && windowMs > 0 && completed.length
        ? completed.length / (windowMs / 1000)
        : null,
    importToAllCurrentDecisionsLowerBoundMs: distribution(
      invalidClock ? [] : completed.map((e) => e.completionLowerMs!),
    ),
    importToAllCurrentDecisionsUpperBoundMs: distribution(
      invalidClock ? [] : completed.map((e) => e.completionUpperMs!),
    ),
    pipeline1000In100ms: 'not_measured',
  };
}
