import { beforeEach, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  saved: new Map<string, { tagId: string; tagVersion: number }>(),
  total: 1000,
  stale: false,
  evaluate: vi.fn(),
}));
const tags = [
  { id: 't1', version: 1 },
  { id: 't2', version: 1 },
];
vi.mock('@/lib/db', () => {
  const tx = {
    $queryRaw: vi.fn(async () => (state.stale ? [] : [{ id: 'valid' }])),
    emailClassification: {
      upsert: vi.fn(
        async ({ create }: { create: { emailId: string; tagId: string; tagVersion: number } }) => {
          state.saved.set(create.emailId + ':' + create.tagId, {
            tagId: create.tagId,
            tagVersion: create.tagVersion,
          });
        },
      ),
    },
  };
  return {
    db: {
      tag: { findMany: async () => tags },
      email: {
        findMany: async ({ take }: { take: number }) =>
          Array.from({ length: state.total }, (_, i) => ({
            id: 'e' + i,
            subject: 'Email',
            sender: 'sender@example.com',
            snippet: 'Test',
            body: null,
            classifications: tags.flatMap((t) => {
              const existing = state.saved.get('e' + i + ':' + t.id);
              return existing ? [existing] : [];
            }),
          }))
            .filter((e) => e.classifications.length < tags.length)
            .slice(0, take),
        count: async () =>
          Array.from({ length: state.total }, (_, i) =>
            tags.some((t) => !state.saved.has('e' + i + ':' + t.id)),
          ).filter(Boolean).length,
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock('@/lib/jev', () => ({
  classifyEmailAgainstTags: state.evaluate,
  classifyEmailAgainstTag: vi.fn(),
}));
import { classifyEmails } from '../src/lib/classification';
beforeEach(() => {
  state.saved.clear();
  state.total = 1000;
  state.stale = false;
  state.evaluate
    .mockReset()
    .mockImplementation(async (_email: unknown, missing: { id: string }[]) =>
      Object.fromEntries(
        missing.map((t) => [
          t.id,
          { matched: false, confidence: 10, decision: 'no_match', reasoning: 'test' },
        ]),
      ),
    );
});
it('drains 1000 emails in resumable batches, with one call per email and no repeated completed decisions', async () => {
  for (let i = 0; i < 10; i++) {
    const result = await classifyEmails('user');
    expect(result.errors).toBe(0);
    expect(result.remaining).toBe(1000 - (i + 1) * 100);
  }
  expect(state.saved.size).toBe(2000);
  expect(state.evaluate).toHaveBeenCalledTimes(1000);
  expect((await classifyEmails('user')).classified).toBe(0);
  expect(state.evaluate).toHaveBeenCalledTimes(1000);
});
it('evaluates only the missing tag even when the previous result was no match', async () => {
  state.total = 1;
  state.saved.set('e0:t1', { tagId: 't1', tagVersion: 1 });
  await classifyEmails('user');
  expect(state.evaluate.mock.calls[0][1]).toEqual([{ id: 't2', version: 1 }]);
});
it('does not persist results for an edited tag version', async () => {
  state.total = 1;
  state.stale = true;
  const result = await classifyEmails('user');
  expect(state.saved.size).toBe(0);
  expect(result.remaining).toBeGreaterThan(0);
});
it('leaves failed calls pending for the next worker', async () => {
  state.total = 1;
  state.evaluate.mockRejectedValueOnce(new Error('rate limited'));
  const result = await classifyEmails('user');
  expect(result.errors).toBeGreaterThan(0);
  expect(result.remaining).toBe(1);
  expect(state.saved.size).toBe(0);
});
