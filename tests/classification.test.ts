import { afterEach, beforeEach, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  saved: new Map<string, { tagId: string; tagVersion: number }>(),
  total: 1000,
  stale: false,
  evaluate: vi.fn(),
  defer: vi.fn(),
  workTags: false,
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
      user: { updateMany: state.defer },
      tag: {
        findMany: async ({ where }: { where: { workspace: string } }) => {
          expect(['PERSONAL', 'WORK']).toContain(where.workspace);
          return where.workspace === 'PERSONAL' || state.workTags ? tags : [];
        },
      },
      email: {
        findMany: async ({ take, where }: { take: number; where: { workspace: string } }) => {
          expect(['PERSONAL', 'WORK']).toContain(where.workspace);
          return Array.from({ length: state.total }, (_, i) => ({
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
            .slice(0, take);
        },
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
  state.workTags = false;
  state.defer.mockReset().mockResolvedValue({ count: 1 });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
afterEach(() => vi.restoreAllMocks());
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

it('does not run Personal rules when only Work is requested', async () => {
  expect(await classifyEmails('user', { workspace: 'WORK' })).toEqual({
    classified: 0,
    errors: 0,
    remaining: 0,
  });
  expect(state.evaluate).not.toHaveBeenCalled();
});

it('stops after a 429, retains completed decisions and defers the unprocessed backlog', async () => {
  state.total = 30;
  const normal = state.evaluate.getMockImplementation()!;
  state.evaluate.mockImplementationOnce(normal).mockRejectedValueOnce({
    statusCode: 429,
    generationId: 'gen_fixture',
    cause: { responseHeaders: { 'retry-after': '120' }, responseBody: 'private email' },
  });
  const start = Date.now();
  const result = await classifyEmails('user', { workspace: 'PERSONAL' });
  expect(state.evaluate).toHaveBeenCalledTimes(2);
  expect(state.saved.size).toBe(2);
  expect(result).toMatchObject({
    classified: 2,
    errors: 1,
    remaining: 29,
    rateLimited: true,
    retryAfterSeconds: 120,
  });
  const deferred = state.defer.mock.calls[0][0];
  expect(deferred.where.id).toBe('user');
  expect(deferred.data.workRequested).toBe(true);
  expect(deferred.data.workNotBefore.getTime()).toBeGreaterThanOrEqual(start + 120000);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private email');
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain('gen_fixture');

  await classifyEmails('user', { workspace: 'PERSONAL' });
  expect(state.saved.size).toBe(60);
  expect(state.evaluate).toHaveBeenCalledTimes(31);
});

it('does not start another workspace after the shared model is rate limited', async () => {
  state.total = 3;
  state.workTags = true;
  state.evaluate.mockRejectedValueOnce({ lastError: { statusCode: 429 } });
  const result = await classifyEmails('user');
  expect(state.evaluate).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    errors: 1,
    remaining: 6,
    rateLimited: true,
    retryAfterSeconds: 60,
  });
});

it.each([
  [{ 'retry-after': 'Fri, 25 Sep 2026 09:03:00 GMT' }, 180],
  [{ 'retry-after-ms': '90500' }, 91],
  [{ 'retry-after': 'invalid' }, 60],
  [{ 'retry-after': '-5' }, 60],
  [{ 'retry-after': 'Infinity' }, 60],
] as const)('uses a safe retry delay for headers %j', async (headers, expected) => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-25T09:00:00Z'));
  state.total = 3;
  state.evaluate.mockRejectedValueOnce({
    lastError: { statusCode: 429, cause: { responseHeaders: headers } },
  });
  expect(await classifyEmails('user')).toMatchObject({ retryAfterSeconds: expected });
  expect(state.evaluate).toHaveBeenCalledTimes(1);
});

it('does not treat other failures or rate-limit words as a 429', async () => {
  state.total = 2;
  state.evaluate.mockRejectedValueOnce(
    Object.assign(new Error('private body: rate limited'), { statusCode: 401 }),
  );
  const result = await classifyEmails('user');
  expect(result).toMatchObject({ classified: 2, errors: 1, remaining: 1 });
  expect(result).not.toHaveProperty('rateLimited');
  expect(state.defer).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private body');
});
