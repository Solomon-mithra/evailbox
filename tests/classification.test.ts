import { afterAll, afterEach, beforeAll, beforeEach, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  tags: vi.fn(),
  transaction: vi.fn(),
  evaluate: vi.fn(),
  fetchText: vi.fn(),
  credentials: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: mocks.query,
    $executeRaw: mocks.execute,
    tag: { findMany: mocks.tags },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/jev', () => ({ classifyEmailAgainstTags: mocks.evaluate }));
vi.mock('@/lib/providers/content', () => ({ fetchMessageText: mocks.fetchText }));
vi.mock('@/lib/providers/credentials', () => ({ withAccountCredentials: mocks.credentials }));
import { classifyEmails, classificationConcurrency } from '@/lib/classification';
import { currentModelVersion, emailContentHash } from '@/lib/classification-version';
const database = new PGlite();
const user = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const input = {
  subject: 'Email',
  sender: 'a@example.com',
  snippet: 'PRIVATE SNIPPET',
  body: 'PRIVATE BODY',
};
const decision = { matched: false, confidence: 10, reasoning: 'trace', decision: 'no_match' };
beforeAll(async () => {
  await database.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA public,auth TO authenticated;`,
  );
  for (const path of [
    '20260921000000_init',
    '20260922000000_workspaces',
    '20260925030000_classification_freshness',
    '20260925040000_plan_preview',
    '20260926000000_drop_email_body',
  ])
    await database.exec(await readFile(`prisma/migrations/${path}/migration.sql`, 'utf8'));
  for (const uid of [user, other]) {
    await database.query('INSERT INTO auth.users(id) VALUES($1)', [uid]);
    await database.query('INSERT INTO users(id,email) VALUES($1,$2)', [uid, uid + '@example.com']);
    await database.query(
      'INSERT INTO email_accounts(id,"userId",provider,email,"accessToken","expiresAt") VALUES($1::text,$1::uuid,\'GMAIL\',$2,\'secret\',now())',
      [uid, uid + '@example.com'],
    );
  }
}, 30000);
afterAll(() => database.close());
beforeEach(async () => {
  await database.exec(
    'TRUNCATE emails CASCADE; TRUNCATE tags CASCADE; TRUNCATE monthly_usage; TRUNCATE processing_state;',
  );
  await database.query(
    "INSERT INTO tags(id,\"userId\",name,\"nameKey\",prompt,\"updatedAt\") VALUES('t1',$1,'A','a','Rule',now()),('t2',$1,'B','b','Rule',now())",
    [user],
  );
  vi.clearAllMocks();
  mocks.query.mockImplementation(
    async (q: Prisma.Sql) => (await database.query(q.text, q.values)).rows,
  );
  mocks.execute.mockImplementation(
    async (q: Prisma.Sql) => (await database.query(q.text, q.values)).affectedRows,
  );
  mocks.tags.mockImplementation(
    async ({ where }) =>
      (
        await database.query(
          'SELECT * FROM tags WHERE "userId"=$1 AND workspace=$2 AND ($3::text IS NULL OR id=$3)',
          [where.userId, where.workspace, where.id ?? null],
        )
      ).rows,
  );
  mocks.transaction.mockImplementation(async (fn) =>
    database.transaction(async (tx) =>
      fn({
        $queryRaw: async (q: Prisma.Sql) => (await tx.query(q.text, q.values)).rows,
        $executeRaw: async (q: Prisma.Sql) => (await tx.query(q.text, q.values)).affectedRows,
      }),
    ),
  );
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
async function seed(count: number, uid = user) {
  await database.query(
    `INSERT INTO emails(id,"userId","accountId","providerMessageId",subject,sender,"senderName",snippet,"contentHash","receivedAt","webUrl") SELECT $1::text || '-' || lpad(i::text,4,'0'),$1::uuid,$1::text,i::text,'Email','a@example.com','A','PRIVATE SNIPPET',$3,'2026-09-25T00:00:00'::timestamp + i * interval '1 second','https://mail.google.com' FROM generate_series(1,$2::int) i`,
    [uid, count, emailContentHash(input)],
  );
}
async function count(table: string) {
  return (await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
}
async function usage() {
  return (
    await database.query<{ n: number }>('SELECT coalesce(sum(emails),0)::int n FROM monthly_usage')
  ).rows[0].n;
}
it('drains 1000 emails in recent-first waves and counts each email once, including negative decisions', async () => {
  await seed(1000);
  for (let i = 0; i < 10; i++)
    expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
      errors: 0,
      remaining: 1000 - (i + 1) * 100,
    });
  expect(await count('email_classifications')).toBe(2000);
  expect(await usage()).toBe(1000);
  expect(mocks.evaluate.mock.calls[0][0].id).toBe(user + '-1000');
  expect(mocks.evaluate).toHaveBeenCalledTimes(1000);
  expect(mocks.transaction).toHaveBeenCalledTimes(250);
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(0);
  expect(mocks.evaluate).toHaveBeenCalledTimes(1000);
}, 30000);
it('bounds concurrency, batches writes and persists uncertain results', async () => {
  await seed(9);
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
  expect(mocks.transaction).toHaveBeenCalledTimes(3);
  expect(await usage()).toBe(9);
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
  expect(await usage()).toBe(2);
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(2);
  await database.query("UPDATE tags SET version=2 WHERE id='t1'");
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(3);
  expect(mocks.evaluate.mock.calls.at(-1)![1]).toHaveLength(1);
  expect(await usage()).toBe(3);
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
  await database.query(`UPDATE emails SET "contentHash"=''`);
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 0,
  });
  expect(mocks.fetchText).not.toHaveBeenCalled();
});
it('rejects results when sync changes the message during evaluation', async () => {
  await seed(1);
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    await database.query(`UPDATE emails SET "contentHash"='changed-by-sync'`);
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 1,
  });
  expect(await count('email_classifications')).toBe(0);
  expect(await usage()).toBe(0);
});
it('locks current tag versions and saves unaffected tags while edited tags stay pending', async () => {
  await seed(1);
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    await database.query("UPDATE tags SET version=2 WHERE id='t1'");
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 1,
    remaining: 1,
  });
  expect(await usage()).toBe(1);
});
it('invalidates stored decisions for content and model changes without double usage', async () => {
  await seed(1);
  await classifyEmails(user, { workspace: 'PERSONAL' });
  const changed = { ...input, body: 'Changed' };
  await database.query('UPDATE emails SET "contentHash"=$1', [emailContentHash(changed)]);
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(2);
  vi.stubEnv('JEV_MODEL_VERSION', '2');
  expect((await classifyEmails(user, { workspace: 'PERSONAL' })).classified).toBe(2);
  expect(
    (
      await database.query<{ modelVersion: string }>(
        'SELECT "modelVersion" FROM email_classifications LIMIT 1',
      )
    ).rows[0].modelVersion,
  ).toBe(currentModelVersion());
  expect(await usage()).toBe(1);
});
it('stops new dispatch after a429, finishes its in-flight wave and shares cooldown with another user', async () => {
  await seed(12);
  await seed(2, other);
  await database.query(
    "INSERT INTO tags(id,\"userId\",name,\"nameKey\",prompt,\"updatedAt\") VALUES('other',$1,'C','c','Rule',now())",
    [other],
  );
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
  const { rows } = await database.query<{ seconds: number }>(
    'SELECT extract(epoch from ("notBefore" - CURRENT_TIMESTAMP))::int seconds FROM processing_state',
  );
  expect(rows[0].seconds).toBeGreaterThanOrEqual(299);
});
it('does not dispatch after the deadline or classify retained draft-only mail', async () => {
  await seed(3);
  await database.query('UPDATE emails SET "inInbox"=false WHERE id=$1', [user + '-0001']);
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
  expect(await count('email_classifications')).toBe(2);
  expect(await usage()).toBe(1);
});
it('rolls back classification and usage together if a batch transaction fails', async () => {
  await seed(1);
  const transact = mocks.transaction.getMockImplementation()!;
  mocks.transaction.mockImplementationOnce((fn) =>
    transact(async (tx: unknown) => {
      await fn(tx);
      throw new Error('database interrupted');
    }),
  );
  await expect(classifyEmails(user, { workspace: 'PERSONAL' })).rejects.toThrow(
    'database interrupted',
  );
  expect(await count('email_classifications')).toBe(0);
  expect(await usage()).toBe(0);
  await classifyEmails(user, { workspace: 'PERSONAL' });
  expect(await usage()).toBe(1);
});
it('rejects model-version changes during inference and never opens a transaction after an exhausted deadline', async () => {
  await seed(1);
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    vi.stubEnv('JEV_MODEL_VERSION', 'changed-in-flight');
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 0,
    remaining: 1,
  });
  expect(await usage()).toBe(0);
  expect(mocks.transaction).not.toHaveBeenCalled();
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
    await database.query(`UPDATE emails SET "contentHash"='changed' WHERE id=$1`, [email.id]);
    return evaluate(email, tags);
  });
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 6,
    remaining: 1,
  });
});
