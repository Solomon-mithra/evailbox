import { afterAll, afterEach, beforeEach, it, expect, vi } from 'vitest';
import { closeTestDb, resetTestDb, testDb } from './helpers/sqlite';
const mocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
  fetchText: vi.fn(),
  credentials: vi.fn(),
}));
vi.mock('@/lib/db', async () => ({ db: (await import('./helpers/sqlite')).testDb }));
vi.mock('@/lib/jev', () => ({ classifyEmailAgainstTags: mocks.evaluate }));
vi.mock('@/lib/providers/content', () => ({ fetchMessageText: mocks.fetchText }));
vi.mock('@/lib/providers/credentials', () => ({ withAccountCredentials: mocks.credentials }));
import { classifyEmails, classificationConcurrency } from '@/lib/classification';
import { emailContentHash } from '@/lib/classification-version';
import { currentModelVersion } from '@/lib/classification-version';
import { capturePendingTagHistory } from '@/lib/tag-scope';
import { getInboxCounts } from '@/lib/inbox';
const user = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const input = {
  subject: 'Email',
  sender: 'a@example.com',
  snippet: 'PRIVATE SNIPPET',
  body: 'PRIVATE BODY',
};
const decision = { matched: false, confidence: 10, reasoning: 'trace', decision: 'no_match' };
const tag = (
  id: string,
  userId: string,
  name: string,
  workspace: 'PERSONAL' | 'WORK' = 'PERSONAL',
) => ({
  id,
  userId,
  workspace,
  name,
  nameKey: name.toLowerCase(),
  prompt: 'Rule',
});
const account = (id: string, userId: string, workspace: 'PERSONAL' | 'WORK' = 'PERSONAL') => ({
  id,
  userId,
  workspace,
  provider: 'GMAIL' as const,
  email: `${id}@example.com`,
  accessToken: 'secret',
  expiresAt: new Date(),
});
afterAll(closeTestDb);
beforeEach(async () => {
  await resetTestDb();
  vi.stubEnv('JEV_API_KEY', 'test-key');
  for (const uid of [user, other]) {
    await testDb.user.create({ data: { id: uid, email: uid + '@example.com' } });
    await testDb.emailAccount.create({ data: account(uid, uid) });
  }
  await testDb.tag.createMany({ data: [tag('t1', user, 'A'), tag('t2', user, 'B')] });
  vi.clearAllMocks();
  mocks.evaluate
    .mockReset()
    .mockImplementation(async (_email, tags) =>
      Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision])),
    );
  mocks.fetchText.mockReset().mockResolvedValue('PRIVATE BODY');
  mocks.credentials
    .mockReset()
    .mockImplementation(async (_user, _workspace, _account, operation) =>
      operation({ provider: 'GMAIL' }, 'token'),
    );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const baseTime = Date.parse('2026-09-25T00:00:00Z');
async function seed(count: number, uid = user) {
  await testDb.email.createMany({
    data: Array.from({ length: count }, (_, k) => {
      const i = k + 1;
      return {
        id: `${uid}-${String(i).padStart(4, '0')}`,
        userId: uid,
        accountId: uid,
        providerMessageId: String(i),
        subject: 'Email',
        sender: 'a@example.com',
        senderName: 'A',
        snippet: 'PRIVATE SNIPPET',
        contentHash: emailContentHash(input),
        receivedAt: new Date(baseTime + i * 1000),
        webUrl: 'https://mail.google.com',
      };
    }),
  });
}
const count = () => testDb.emailClassification.count();
const transactions = () => vi.spyOn(testDb, '$transaction');
it('limits a new tag to 100 existing emails even when all historical mail is unprocessed', async () => {
  await seed(250);
  await testDb.tag.deleteMany();
  await testDb.tag.create({ data: tag('new', user, 'New') });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 100,
    errors: 0,
    remaining: 0,
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 0,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(100);
  expect(mocks.evaluate.mock.calls.at(-1)![0].id).toBe(user + '-0151');
});
async function requestMatches(tagId?: string) {
  await capturePendingTagHistory(testDb, user, 'PERSONAL', tagId);
}
it('checks only 100 pending emails per explicit request across tags and stops between requests', async () => {
  await seed(250);
  await requestMatches();
  for (let i = 0; i < 4; i++) {
    expect(await classifyEmails(user, { workspace: 'PERSONAL', limit: 25 })).toMatchObject({
      classified: 50,
      remaining: 75 - i * 25,
    });
  }
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 0,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(100);
  await requestMatches();
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 200,
    remaining: 0,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(200);
  expect(mocks.evaluate.mock.calls[100][0].id).toBe(user + '-0150');
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 0,
  });
});
it('does not report excluded historical mail as either pending or checked', async () => {
  await seed(250);
  await requestMatches();
  expect((await getInboxCounts({ id: user }, new URLSearchParams())).processing).toMatchObject({
    imported: 250,
    tagged: 0,
    remaining: 100,
  });
  await classifyEmails(user, { workspace: 'PERSONAL' });
  expect((await getInboxCounts({ id: user }, new URLSearchParams())).processing).toMatchObject({
    imported: 250,
    tagged: 100,
    remaining: 0,
  });
});
const incoming = (id: string, extra: object = {}) => ({
  id,
  userId: user,
  accountId: user,
  providerMessageId: id,
  subject: 'Email',
  sender: 'a@example.com',
  senderName: 'A',
  snippet: 'PRIVATE SNIPPET',
  contentHash: emailContentHash(input),
  receivedAt: new Date(),
  webUrl: 'https://mail.google.com',
  ...extra,
});
it('keeps new arrivals eligible after a bounded history check', async () => {
  await seed(250);
  await requestMatches();
  await classifyEmails(user, { workspace: 'PERSONAL' });
  await testDb.email.create({ data: incoming('incoming') });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 2,
    remaining: 0,
  });
  expect(mocks.evaluate.mock.calls.at(-1)![0].id).toBe('incoming');
});
it('stamps newly inserted mail after the scope even if its transaction supplied an older arrival time', async () => {
  await seed(150);
  await requestMatches();
  await classifyEmails(user, { workspace: 'PERSONAL' });
  await testDb.email.create({
    data: incoming('concurrent-arrival', { createdAt: new Date('2020-01-01') }),
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 2,
    remaining: 0,
  });
  expect(mocks.evaluate.mock.calls.at(-1)![0].id).toBe('concurrent-arrival');
});
it('filters each email tag list by scope even when another tag can check older mail', async () => {
  await seed(150);
  await requestMatches('t1');
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 200,
    remaining: 50,
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 50,
    remaining: 0,
  });
  expect(mocks.evaluate.mock.calls.at(-1)![1].map((tag: { id: string }) => tag.id)).toEqual(['t2']);
});
it('does not bypass the history cap for forced or explicit-email classification', async () => {
  await seed(150);
  await requestMatches();
  expect(
    await classifyEmails(user, { workspace: 'PERSONAL', force: true, emailIds: [user + '-0001'] }),
  ).toMatchObject({ classified: 0, remaining: 0 });
  expect(mocks.evaluate).not.toHaveBeenCalled();
});
it('does not replace archived history with older mail during a retry', async () => {
  await seed(150);
  await requestMatches();
  await testDb.email.update({ where: { id: user + '-0150' }, data: { inInbox: false } });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 198,
    remaining: 0,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(99);
  expect(mocks.evaluate.mock.calls.at(-1)![0].id).toBe(user + '-0051');
});
it('scopes manual snapshots to their tenant and workspace', async () => {
  await seed(150);
  await seed(150, other);
  await testDb.tag.create({ data: tag('other', other, 'Other') });
  const select = { matchFrom: true, historyEmailIds: true };
  const before = await testDb.tag.findUnique({ where: { id: 'other' }, select });
  await capturePendingTagHistory(testDb, user, 'WORK');
  const personal = await testDb.tag.findUnique({ where: { id: 't1' }, select });
  expect(personal?.historyEmailIds).toEqual([]);
  await requestMatches();
  const after = await testDb.tag.findUnique({ where: { id: 'other' }, select });
  expect(after).toEqual(before);
  expect((await getInboxCounts({ id: user }, new URLSearchParams())).processing?.remaining).toBe(
    100,
  );
});
it('drains 1000 emails in recent-first waves and counts each email once, including negative decisions', async () => {
  await seed(1000);
  const transaction = vi.spyOn(testDb, '$transaction');
  for (let i = 0; i < 10; i++)
    expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
      errors: 0,
      remaining: 1000 - (i + 1) * 100,
    });
  expect(await count()).toBe(2000);
  expect(mocks.evaluate.mock.calls[0][0].id).toBe(user + '-1000');
  expect(mocks.evaluate).toHaveBeenCalledTimes(1000);
  expect(transaction).toHaveBeenCalledTimes(250);
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(0);
  expect(mocks.evaluate).toHaveBeenCalledTimes(1000);
}, 60000);
it('bounds concurrency, batches writes and persists uncertain results', async () => {
  await seed(9);
  const transaction = vi.spyOn(testDb, '$transaction');
  let active = 0,
    peak = 0;
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return Object.fromEntries(
      tags.map((tag: { id: string }) => [
        tag.id,
        { ...decision, confidence: 50, decision: 'uncertain' },
      ]),
    );
  });
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(18);
  expect(peak).toBe(4);
  expect(transaction).toHaveBeenCalledTimes(3);
});
it.each([
  ['0', 1],
  ['100', 8],
  ['3', 3],
  ['bad', 4],
])('clamps configured concurrency %s to %i', (value, expected) => {
  vi.stubEnv('JEV_CONCURRENCY', value);
  expect(classificationConcurrency()).toBe(expected);
});
it('retries only a failed email and does not count reclassification or partial tag retries twice', async () => {
  await seed(3);
  mocks.evaluate.mockRejectedValueOnce(new Error('PRIVATE ERROR'));
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 4,
    errors: 1,
    remaining: 1,
  });
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(2);
  await testDb.tag.update({ where: { id: 't1' }, data: { version: 2 } });
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(3);
  expect(mocks.evaluate.mock.calls.at(-1)![1]).toHaveLength(1);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('PRIVATE');
});
it('evaluates each email with its body fetched live from the provider', async () => {
  await seed(1);
  mocks.fetchText.mockResolvedValue('LIVE PROVIDER BODY');
  await classifyEmails(user, { workspace: 'PERSONAL' });
  expect(mocks.fetchText).toHaveBeenCalledWith('GMAIL', 'token', '1');
  expect(mocks.evaluate.mock.calls[0][0]).toMatchObject({
    subject: 'Email',
    sender: 'a@example.com',
    snippet: 'PRIVATE SNIPPET',
    body: 'LIVE PROVIDER BODY',
  });
});
it('obtains credentials once per account per run rather than once per email', async () => {
  await seed(6);
  await classifyEmails(user, { workspace: 'PERSONAL' });
  expect(mocks.credentials).toHaveBeenCalledTimes(1);
  expect(mocks.credentials.mock.calls[0].slice(0, 3)).toEqual([user, 'PERSONAL', user]);
  expect(mocks.fetchText).toHaveBeenCalledTimes(6);
});
it('leaves an email pending without evaluating it when its body cannot be fetched', async () => {
  await seed(2);
  mocks.fetchText.mockRejectedValueOnce(new Error('PRIVATE provider failure'));
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 2,
    errors: 1,
    remaining: 1,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('PRIVATE');
});
it('skips emails that sync has not hashed yet', async () => {
  await seed(1);
  await testDb.email.updateMany({ data: { contentHash: '' } });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 0,
  });
  expect(mocks.fetchText).not.toHaveBeenCalled();
});
it('rejects results when sync changes the message during evaluation', async () => {
  await seed(1);
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    await testDb.email.updateMany({ data: { contentHash: 'changed-by-sync' } });
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 1,
  });
  expect(await count()).toBe(0);
});
it('locks current tag versions and saves unaffected tags while edited tags stay pending', async () => {
  await seed(1);
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    await testDb.tag.update({ where: { id: 't1' }, data: { version: 2 } });
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 1,
    remaining: 1,
  });
});
it('invalidates stored decisions for content and model changes without double usage', async () => {
  await seed(1);
  await classifyEmails(user, { workspace: 'PERSONAL' });
  const changed = { ...input, body: 'Changed' };
  await testDb.email.updateMany({ data: { contentHash: emailContentHash(changed) } });
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(2);
  vi.stubEnv('JEV_MODEL_VERSION', '2');
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(2);
  expect((await testDb.emailClassification.findFirstOrThrow()).modelVersion).toBe(
    currentModelVersion(),
  );
});
it('stops new dispatch after a429, finishes its in-flight wave and shares cooldown with another user', async () => {
  // Tag first: mail only matches tags that existed when it arrived (no history capture).
  await testDb.tag.create({ data: tag('other', other, 'C') });
  await seed(12);
  await seed(2, other);
  mocks.evaluate.mockRejectedValueOnce({
    statusCode: 429,
    cause: { responseHeaders: { 'retry-after': '120' }, responseBody: 'PRIVATE' },
  });
  const result = await classifyEmails(user, { workspace: 'PERSONAL' });
  expect(result).toMatchObject({
    classified: 6,
    errors: 1,
    remaining: 9,
    rateLimited: true,
    retryAfterSeconds: 120,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(4);
  expect(await classifyEmails(other, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 2,
    rateLimited: true,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('PRIVATE');
});
it('keeps the longest shared Retry-After from concurrent failures', async () => {
  await seed(4);
  mocks.evaluate
    .mockRejectedValueOnce({ statusCode: 429, responseHeaders: { 'retry-after': '300' } })
    .mockRejectedValueOnce({ statusCode: 429, responseHeaders: { 'retry-after': '60' } });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    retryAfterSeconds: 300,
  });
  const state = await testDb.processingState.findUniqueOrThrow({ where: { id: 'jev' } });
  expect((state.notBefore.getTime() - Date.now()) / 1000).toBeGreaterThanOrEqual(299);
});
it('does not dispatch after the deadline or classify retained draft-only mail', async () => {
  await seed(3);
  await testDb.email.update({ where: { id: user + '-0001' }, data: { inInbox: false } });
  expect(await classifyEmails(user, { workspace: 'PERSONAL', deadline: Date.now() })).toMatchObject(
    { classified: 0, remaining: 2 },
  );
  expect(mocks.evaluate).not.toHaveBeenCalled();
});
it('records only numeric batch/completion metadata, never message, rule or provider contents', async () => {
  await seed(1);
  await classifyEmails(user, { workspace: 'PERSONAL' });
  const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
  expect(logs).toContain('classification_completed');
  expect(logs).toContain('durationMs');
  expect(logs).not.toMatch(/PRIVATE|a@example|Rule|userId/);
});

it('counts first classification once when two workers finish the same email concurrently', async () => {
  await seed(1);
  let calls = 0;
  let release!: () => void;
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    if (++calls === 2) release();
    await both;
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  await Promise.all([
    classifyEmails(user, { workspace: 'PERSONAL' }),
    classifyEmails(user, { workspace: 'PERSONAL' }),
  ]);
  expect(await count()).toBe(2);
});
it('rolls back classification if a batch transaction fails', async () => {
  await seed(1);
  const real = testDb.$transaction.bind(testDb) as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(testDb, '$transaction').mockImplementationOnce(((
    fn: (tx: unknown) => Promise<unknown>,
    options: unknown,
  ) =>
    real(async (tx: unknown) => {
      await fn(tx);
      throw new Error('database interrupted');
    }, options)) as never);
  await expect(classifyEmails(user, { workspace: 'PERSONAL' })).rejects.toThrow(
    'database interrupted',
  );
  expect(await count()).toBe(0);
  await classifyEmails(user, { workspace: 'PERSONAL' });
  expect(await count()).toBe(2);
});
it('rejects model-version changes during inference and never opens a transaction after an exhausted deadline', async () => {
  await seed(1);
  const transaction = vi.spyOn(testDb, '$transaction');
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    vi.stubEnv('JEV_MODEL_VERSION', 'changed-in-flight');
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 1,
  });
  expect(transaction).not.toHaveBeenCalled();
});
it.each([
  [{ 'retry-after-ms': '90500' }, 91],
  [{ 'retry-after': 'invalid' }, 60],
  [{ 'retry-after': '-5' }, 60],
  [{ 'retry-after': 'Infinity' }, 60],
] as const)('uses safe global cooldown values for headers %j', async (headers, expected) => {
  await seed(1);
  mocks.evaluate.mockRejectedValueOnce({
    lastError: { statusCode: 429, cause: { responseHeaders: headers } },
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    retryAfterSeconds: expected,
  });
});

it('does not overstate remaining mail when one email in a concurrent wave becomes stale', async () => {
  await seed(4);
  const evaluate = mocks.evaluate.getMockImplementation()!;
  mocks.evaluate.mockImplementationOnce(async (email, tags) => {
    await testDb.email.update({ where: { id: email.id }, data: { contentHash: 'changed' } });
    return evaluate(email, tags);
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 6,
    remaining: 1,
  });
});

it('limits a turn to 20 newest emails across both workspaces', async () => {
  await seed(25);
  const result = await classifyEmails(user, { limit: 20 });
  expect(mocks.evaluate).toHaveBeenCalledTimes(20);
  expect(mocks.evaluate.mock.calls[0][0].id).toBe(user + '-0025');
  expect(result.remaining).toBe(5);
});

it('reuses a matching body from this turn without fetching credentials or content again', async () => {
  await seed(1);
  const bodies = new Map([
    [
      JSON.stringify([user, '1']),
      {
        body: input.body,
        contentHash: emailContentHash(input),
      },
    ],
  ]);
  const result = await classifyEmails(user, { workspace: 'PERSONAL', bodies });
  expect(result.classified).toBe(2);
  expect(mocks.fetchText).not.toHaveBeenCalled();
  expect(mocks.credentials).not.toHaveBeenCalled();
  expect(mocks.evaluate.mock.calls[0][0].body).toBe(input.body);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it('refetches when a transient body belongs to a different content version', async () => {
  await seed(1);
  const bodies = new Map([
    [
      JSON.stringify([user, '1']),
      {
        body: 'OLD BODY',
        contentHash: 'old-hash',
      },
    ],
  ]);
  await classifyEmails(user, { workspace: 'PERSONAL', bodies });
  expect(mocks.fetchText).toHaveBeenCalledOnce();
  expect(mocks.evaluate.mock.calls[0][0].body).toBe(input.body);
});

it('reuses a null body without a second provider request', async () => {
  await seed(1);
  const bodies = new Map([
    [
      JSON.stringify([user, '1']),
      {
        body: null,
        contentHash: emailContentHash(input),
      },
    ],
  ]);
  await classifyEmails(user, { workspace: 'PERSONAL', bodies });
  expect(mocks.fetchText).not.toHaveBeenCalled();
  expect(mocks.evaluate.mock.calls[0][0].body).toBeNull();
});

it('returns an empty result without calling Jev when no AI key is configured', async () => {
  await seed(3);
  vi.stubEnv('JEV_API_KEY', '');
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toEqual({
    classified: 0,
    errors: 0,
    remaining: 0,
  });
  expect(mocks.evaluate).not.toHaveBeenCalled();
  expect(await count()).toBe(0);
});

it.skipIf(process.env.RUN_BURST_TEST !== '1')(
  'drains a synthetic 100-user signup burst through real classification SQL',
  async () => {
    const emails = Number(process.env.BURST_EMAILS ?? 100);
    if (!Number.isInteger(emails) || emails < 20 || emails > 2000)
      throw new Error('BURST_EMAILS must be 20–2000');
    const { WORK_BATCH_SIZE } = await import('@/lib/providers/sync-policy');
    const concurrency = 5;
    const users = Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    );
    for (const uid of users) {
      await testDb.user.create({ data: { id: uid, email: `${uid}@example.com` } });
      await testDb.emailAccount.create({ data: account(uid, uid) });
      await testDb.tag.create({ data: tag(uid, uid, 'A') });
      await seed(emails, uid);
    }
    const queue = users.map((id) => ({ id, remaining: emails }));
    const order: string[] = [],
      first = new Map<string, number>();
    let turns = 0;
    const start = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (queue.length) {
          const job = queue.shift()!;
          order.push(job.id);
          // Simulate a just-imported page. DB selection, evaluation waves, writes and
          // freshness checks are the production implementations.
          const bodies = new Map(
            Array.from({ length: Math.min(WORK_BATCH_SIZE, job.remaining) }, (_, i) => [
              JSON.stringify([job.id, String(job.remaining - i)]),
              { body: input.body, contentHash: emailContentHash(input) },
            ]),
          );
          const result = await classifyEmails(job.id, { limit: WORK_BATCH_SIZE, bodies });
          bodies.clear();
          turns++;
          expect(result.errors).toBe(0);
          if (result.classified && !first.has(job.id)) first.set(job.id, performance.now() - start);
          if (result.remaining) queue.push({ ...job, remaining: result.remaining });
        }
      }),
    );
    expect(new Set(order.slice(0, 100)).size).toBe(100);
    expect(first.size).toBe(100);
    expect(await count()).toBe(100 * emails);
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(turns).toBe(100 * Math.ceil(emails / WORK_BATCH_SIZE));
    process.stdout.write(
      JSON.stringify({
        benchmark: 'synthetic-local-classification',
        users: 100,
        emails: 100 * emails,
        concurrency,
        turns,
        allFirstTurnsMs: Math.round(Math.max(...first.values())),
        totalMs: Math.round(performance.now() - start),
        provider: 'mocked',
        inference: 'mocked',
        database: 'SQLite',
      }) + '\n',
    );
  },
  180_000,
);

it('shares the turn budget across personal and work inboxes', async () => {
  await seed(25);
  await testDb.emailAccount.create({ data: account('work-account', user, 'WORK') });
  await testDb.tag.create({ data: tag('work-tag', user, 'Work', 'WORK') });
  await testDb.email.updateMany({
    where: {
      userId: user,
      providerMessageId: { in: Array.from({ length: 10 }, (_, i) => String(i + 1)) },
    },
    data: { workspace: 'WORK', accountId: 'work-account', createdAt: new Date() },
  });
  const result = await classifyEmails(user, { limit: 20 });
  expect(mocks.evaluate).toHaveBeenCalledTimes(20);
  expect(result.remaining).toBe(5);
  expect(mocks.evaluate.mock.calls.filter(([, tags]) => tags[0].id === 'work-tag')).toHaveLength(5);
});
