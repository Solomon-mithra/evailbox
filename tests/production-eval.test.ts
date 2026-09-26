import { describe, expect, it } from 'vitest';
import {
  summarize,
  observe,
  finishObservation,
  type EmailEvidence,
  type Snapshot,
} from '../scripts/eval-production-core';

// These fixtures test the observer's accounting only. They are never benchmark results.
const row = (overrides: Partial<EmailEvidence> = {}): EmailEvidence => ({
  id: 'mail-1',
  userId: 'user-1',
  workspace: 'PERSONAL',
  createdAt: '2026-09-26T00:00:01.000Z',
  firstClassifiedAt: null,
  inInbox: true,
  contentHash: 'content-v1',
  rulesSignature: 'tags-v1',
  requiredTags: 2,
  currentDecisions: 0,
  ...overrides,
});
const snapshot = (second: number, emails: EmailEvidence[]): Snapshot => ({
  startedAt: `2026-09-26T00:00:${String(second).padStart(2, '0')}.000Z`,
  finishedAt: `2026-09-26T00:00:${String(second).padStart(2, '0')}.100Z`,
  queryWallMs: 100,
  emails,
  inventory: {
    users: 1,
    accounts: 1,
    pendingUsers: 0,
    usersWithFailures: 0,
    pendingAccounts: 0,
    accountsWithErrors: 0,
    decisions: 0,
    jevCooldown: false,
  },
});

describe('production evidence accounting (not a performance benchmark)', () => {
  it('reports missing data without a throughput or latency success', () => {
    expect(summarize(snapshot(0, []))).toMatchObject({
      uniqueEmails: 0,
      fullyCurrentEmails: 0,
      importToFirstDecisionMs: { samples: 0, p50: null, p95: null },
    });
    expect(finishObservation([snapshot(0, [])], 1000)).toMatchObject({
      status: 'insufficient_evidence',
      newEmails: 0,
      fullyCurrentNewEmails: 0,
      pipeline1000In100ms: 'not_measured',
    });
  });
  it('counts emails, not tag decisions, and requires all current tags', () => {
    expect(
      summarize(
        snapshot(3, [
          row({ currentDecisions: 2 }),
          row({ id: 'partial', currentDecisions: 1, firstClassifiedAt: '2026-09-26T00:00:02Z' }),
          row({ id: 'no-tags', requiredTags: 0 }),
          row({ id: 'blank-hash', contentHash: '', currentDecisions: 2 }),
          row({ id: 'archived', inInbox: false, currentDecisions: 2 }),
        ]),
      ),
    ).toMatchObject({ uniqueEmails: 5, fullyCurrentEmails: 1, eligibleEmails: 2 });
  });
  it('reports negative timestamp deltas instead of clamping them to fast results', () => {
    expect(
      summarize(snapshot(3, [row({ firstClassifiedAt: '2026-09-26T00:00:00Z' })])),
    ).toMatchObject({ invalidFirstDecisionTimestamps: 1, importToFirstDecisionMs: { samples: 0 } });
  });
  it('excludes the warm baseline and admits new imports only', () => {
    const baseline = snapshot(0, [row({ id: 'old', currentDecisions: 2 })]);
    const report = finishObservation(
      [
        baseline,
        snapshot(3, [row({ id: 'old', currentDecisions: 2 }), row({ currentDecisions: 2 })]),
      ],
      1,
    );
    expect(report).toMatchObject({ newEmails: 1, fullyCurrentNewEmails: 1, status: 'observed' });
  });
  it('keeps incomplete and disappeared messages in the denominator', () => {
    const report = finishObservation(
      [
        snapshot(0, []),
        snapshot(2, [row(), row({ id: 'deleted' })]),
        snapshot(4, [row({ currentDecisions: 2 })]),
      ],
      2,
    );
    expect(report).toMatchObject({
      newEmails: 2,
      fullyCurrentNewEmails: 1,
      missingEmails: 1,
      status: 'incomplete',
    });
  });
  it('records a conservative observation interval, not an exact completion time', () => {
    const state = observe([
      snapshot(0, []),
      snapshot(2, [row()]),
      snapshot(4, [row({ currentDecisions: 2 })]),
    ]);
    expect(state[0]).toMatchObject({ completionLowerMs: 1000, completionUpperMs: 3100 });
    expect(
      finishObservation([snapshot(0, []), snapshot(4, [row({ currentDecisions: 2 })])], 1),
    ).toMatchObject({ pipeline1000In100ms: 'not_measured' });
  });
  it('invalidates a completion if content or tag versions change during observation', () => {
    const report = finishObservation(
      [
        snapshot(0, []),
        snapshot(2, [row({ currentDecisions: 2 })]),
        snapshot(4, [row({ currentDecisions: 2, rulesSignature: 'tags-v2' })]),
      ],
      1,
    );
    expect(report).toMatchObject({
      changedEmails: 1,
      fullyCurrentNewEmails: 0,
      status: 'incomplete',
    });
  });
  it('does not attribute transactions begun before observation to the new run', () => {
    const report = finishObservation(
      [snapshot(2, []), snapshot(4, [row({ currentDecisions: 2 })])],
      1,
    );
    expect(report).toMatchObject({ newEmails: 0, lateVisiblePreexistingEmails: 1 });
  });
  it.each([{ inInbox: false }, { currentDecisions: 0 }])(
    'preserves first completion evidence across a later regression: %j',
    (regression) => {
      const snapshots = [
        snapshot(0, []),
        snapshot(2, [row({ currentDecisions: 2 })]),
        snapshot(4, [row({ currentDecisions: 2, ...regression })]),
        snapshot(6, [row({ currentDecisions: 2 })]),
      ];
      expect(observe(snapshots)[0]).toMatchObject({
        completionLowerMs: 0,
        completionUpperMs: 1100,
      });
      expect(finishObservation(snapshots.slice(0, 3), 1)).toMatchObject({
        fullyCurrentNewEmails: 0,
        status: 'incomplete',
      });
      expect(finishObservation(snapshots, 1)).toMatchObject({
        fullyCurrentNewEmails: 1,
        status: 'observed',
      });
    },
  );
});
