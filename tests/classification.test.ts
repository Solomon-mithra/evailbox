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
import { capturePendingTagHistory } from '@/lib/tag-scope';
import { getInboxCounts } from '@/lib/inbox';
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
    '20260927000000_stripe_billing',
    '20260928000000_tag_history_limit',
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
    'TRUNCATE emails CASCADE; TRUNCATE tags CASCADE; TRUNCATE monthly_usage; TRUNCATE processing_state; TRUNCATE billing_accounts; TRUNCATE billing_usage;',
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
it('limits a new tag to 100 existing emails even when all historical mail is unprocessed', async () => {
  await seed(250);
  await database.exec('DELETE FROM tags');
  await database.query(
    `INSERT INTO tags(id,"userId",name,"nameKey",prompt,"updatedAt") VALUES('new',$1,'New','new','Rule',now())`,
    [user],
  );
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
  expect(await usage()).toBe(100);
});
async function requestMatches(tagId?: string) {
  await capturePendingTagHistory({ $executeRaw: mocks.execute }, user, 'PERSONAL', tagId);
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
it('keeps new arrivals eligible after a bounded history check', async () => {
  await seed(250);
  await requestMatches();
  await classifyEmails(user, { workspace: 'PERSONAL' });
  await database.query(
    `INSERT INTO emails(id,"userId","accountId","providerMessageId",subject,sender,"senderName",snippet,"contentHash","receivedAt","webUrl")
    VALUES('incoming',$1::uuid,$1::text,'incoming','Email','a@example.com','A','PRIVATE SNIPPET',$2,now(),'https://mail.google.com')`,
    [user, emailContentHash(input)],
  );
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
  await database.query(
    `INSERT INTO emails(id,"userId","accountId","providerMessageId",subject,sender,"senderName",snippet,"contentHash","receivedAt","webUrl","createdAt")
    VALUES('concurrent-arrival',$1::uuid,$1::text,'concurrent-arrival','Email','a@example.com','A','PRIVATE SNIPPET',$2,now(),'https://mail.google.com','2020-01-01')`,
    [user, emailContentHash(input)],
  );
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
  await database.query('UPDATE emails SET "inInbox"=false WHERE id=$1', [user + '-0150']);
  expect(await classifyEmails(user, { workspace: 'PERSONAL' })).toMatchObject({
    classified: 198,
    remaining: 0,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(99);
  expect(mocks.evaluate.mock.calls.at(-1)![0].id).toBe(user + '-0051');
});
it('bounds preexisting tags during migration without erasing saved decisions', async () => {
  await seed(250);
  await classifyEmails(user, { workspace: 'PERSONAL', limit: 3 });
  await database.exec('BEGIN');
  try {
    await database.exec(`DROP TRIGGER tags_capture_history ON tags;
      DROP FUNCTION capture_tag_history();
      DROP TRIGGER emails_stamp_arrival ON emails;
      DROP FUNCTION stamp_email_arrival();
      ALTER TABLE tags DROP COLUMN "matchFrom", DROP COLUMN "historyEmailIds";`);
    await database.exec(
      await readFile('prisma/migrations/20260928000000_tag_history_limit/migration.sql', 'utf8'),
    );
    expect(await count('email_classifications')).toBe(6);
    expect((await getInboxCounts({ id: user }, new URLSearchParams())).processing).toMatchObject({
      imported: 250,
      tagged: 3,
      remaining: 97,
    });
  } finally {
    await database.exec('ROLLBACK');
  }
});
it('scopes manual snapshots to their tenant and workspace', async () => {
  await seed(150);
  await seed(150, other);
  await database.query(
    `INSERT INTO tags(id,"userId",name,"nameKey",prompt,"updatedAt")
    VALUES('other',$1,'Other','other','Rule',now())`,
    [other],
  );
  const before = await database.query(
    'SELECT "matchFrom","historyEmailIds" FROM tags WHERE id=\'other\'',
  );
  await capturePendingTagHistory({ $executeRaw: mocks.execute }, user, 'WORK');
  const personal = await database.query<{ ids: string[] }>(
    'SELECT "historyEmailIds" AS ids FROM tags WHERE id=\'t1\'',
  );
  expect(personal.rows[0].ids).toEqual([]);
  await requestMatches();
  const after = await database.query(
    'SELECT "matchFrom","historyEmailIds" FROM tags WHERE id=\'other\'',
  );
  expect(after.rows).toEqual(before.rows);
  expect((await getInboxCounts({ id: user }, new URLSearchParams())).processing?.remaining).toBe(
    100,
  );
});
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

it('limits a turn to 20 newest emails across both workspaces', async () => {
  await seed(25);
  const result = await classifyEmails(user, { limit: 20 });
  expect(mocks.evaluate).toHaveBeenCalledTimes(20);
  expect(mocks.evaluate.mock.calls[0][0].id).toBe(user + '-0025');
  expect(result.remaining).toBe(5);
  expect(await usage()).toBe(20);
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

it.skipIf(process.env.RUN_BURST_TEST !== '1')(
  'drains a synthetic 100-user signup burst through real classification SQL',
  async () => {
    const emails = Number(process.env.BURST_EMAILS ?? 100);
    if (!Number.isInteger(emails) || emails < 20 || emails > 2000)
      throw new Error('BURST_EMAILS must be 20–2000');
    const { inboxConcurrency, WORK_BATCH_SIZE } = await import('@/lib/inngest/config');
    const users = Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    );
    for (const uid of users) {
      await database.query('INSERT INTO auth.users(id) VALUES($1)', [uid]);
      await database.query('INSERT INTO users(id,email) VALUES($1,$2)', [
        uid,
        `${uid}@example.com`,
      ]);
      await database.query(
        `INSERT INTO email_accounts(id,"userId",provider,email,"accessToken","expiresAt") VALUES($1::text,$1::uuid,'GMAIL',$2,'fixture',now())`,
        [uid, `${uid}@example.com`],
      );
      await database.query(
        `INSERT INTO tags(id,"userId",name,"nameKey",prompt,"updatedAt") VALUES($1::text,$1::uuid,'A','a','Rule',now())`,
        [uid],
      );
      await seed(emails, uid);
    }
    const queue = users.map((id) => ({ id, remaining: emails }));
    const order: string[] = [],
      first = new Map<string, number>();
    let turns = 0;
    const start = performance.now();
    await Promise.all(
      Array.from({ length: inboxConcurrency() }, async () => {
        while (queue.length) {
          const job = queue.shift()!;
          order.push(job.id);
          // Simulate a just-imported page. DB selection, evaluation waves, writes,
          // freshness checks and usage accounting are the production implementations.
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
    expect(await count('email_classifications')).toBe(100 * emails);
    expect(await usage()).toBe(100 * emails);
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(turns).toBe(100 * Math.ceil(emails / WORK_BATCH_SIZE));
    process.stdout.write(
      JSON.stringify({
        benchmark: 'synthetic-local-classification',
        users: 100,
        emails: 100 * emails,
        concurrency: inboxConcurrency(),
        turns,
        allFirstTurnsMs: Math.round(Math.max(...first.values())),
        totalMs: Math.round(performance.now() - start),
        provider: 'mocked',
        inference: 'mocked',
        database: 'PGlite',
        scheduler: 'local FIFO; not hosted Inngest',
      }) + '\n',
    );
  },
  180_000,
);

it('shares the turn budget across personal and work inboxes', async () => {
  await seed(25);
  await database.query(
    `INSERT INTO email_accounts(id,"userId",workspace,provider,email,"accessToken","expiresAt") VALUES('work-account',$1,'WORK','GMAIL','work@example.com','fixture',now())`,
    [user],
  );
  await database.query(
    `INSERT INTO tags(id,"userId",workspace,name,"nameKey",prompt,"updatedAt") VALUES('work-tag',$1,'WORK','Work','work','Rule',now())`,
    [user],
  );
  await database.query(
    `UPDATE emails SET workspace='WORK',"accountId"='work-account',"createdAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "providerMessageId"::int<=10`,
    [user],
  );
  const result = await classifyEmails(user, { limit: 20 });
  expect(mocks.evaluate).toHaveBeenCalledTimes(20);
  expect(result.remaining).toBe(5);
  expect(mocks.evaluate.mock.calls.filter(([, tags]) => tags[0].id === 'work-tag')).toHaveLength(5);
});

async function billingTrial(used = 0, expired = false) {
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('BILLING_ENABLED', 'true');
  const start = new Date(Date.now() - (expired ? 4 : 1) * 86400000).toISOString();
  const end = new Date(Date.now() + (expired ? -1 : 2) * 86400000).toISOString();
  await database.query(
    'INSERT INTO billing_accounts("userId","trialStartedAt","trialEndsAt") VALUES($1,$2::timestamp,$3::timestamp)',
    [user, start, end],
  );
  await database.query(
    'INSERT INTO billing_usage("userId","periodStart",emails) VALUES($1,$2::timestamp,$3)',
    [user, start, used],
  );
}
it('stops exactly at the trial email cap and settles blocked work without calling inference again', async () => {
  await seed(8);
  await billingTrial(9998);
  expect(await classifyEmails(user)).toMatchObject({
    classified: 4,
    remaining: 0,
    billingBlocked: true,
  });
  expect(mocks.evaluate).toHaveBeenCalledTimes(2);
  expect(
    (await database.query<{ emails: number }>('SELECT emails FROM billing_usage')).rows[0].emails,
  ).toBe(10000);
  mocks.evaluate.mockClear();
  expect(await classifyEmails(user)).toMatchObject({
    classified: 0,
    remaining: 0,
    billingBlocked: true,
  });
  expect(mocks.evaluate).not.toHaveBeenCalled();
});
it('expired trials and users who have not started one never invoke paid classification', async () => {
  await seed(2);
  await billingTrial(0, true);
  expect(await classifyEmails(user)).toMatchObject({ classified: 0, billingBlocked: true });
  await database.exec('TRUNCATE billing_accounts;');
  expect(await classifyEmails(user)).toMatchObject({ classified: 0, billingBlocked: true });
  expect(mocks.evaluate).not.toHaveBeenCalled();
});
it('enforces a cancellation that happens while inference is in flight before saving results', async () => {
  await seed(2);
  await billingTrial();
  mocks.evaluate.mockImplementation(async (_email, tags) => {
    await database.query(
      'UPDATE billing_accounts SET "subscriptionStatus"=\'canceled\' WHERE "userId"=$1',
      [user],
    );
    return Object.fromEntries(tags.map((tag: { id: string }) => [tag.id, decision]));
  });
  expect(await classifyEmails(user)).toMatchObject({
    classified: 0,
    remaining: 0,
    billingBlocked: true,
  });
  expect(await count('email_classifications')).toBe(0);
  expect(
    (await database.query<{ emails: number }>('SELECT emails FROM billing_usage')).rows[0].emails,
  ).toBe(0);
});
it('does not count reclassification a second time during a trial', async () => {
  await seed(1);
  await billingTrial();
  await classifyEmails(user);
  await database.query('UPDATE tags SET version=version+1 WHERE "userId"=$1', [user]);
  await classifyEmails(user);
  expect(
    (await database.query<{ emails: number }>('SELECT emails FROM billing_usage')).rows[0].emails,
  ).toBe(1);
  expect(mocks.evaluate).toHaveBeenCalledTimes(2);
});
it('shares one trial allowance across Personal and Work rather than granting each a separate cap', async () => {
  await seed(4);
  await billingTrial(9997);
  await database.query(
    `INSERT INTO email_accounts(id,"userId",workspace,provider,email,"accessToken","expiresAt") VALUES('billing-work-account',$1,'WORK','GMAIL','billing-work@example.com','fixture',now())`,
    [user],
  );
  await database.query(
    `INSERT INTO tags(id,"userId",workspace,name,"nameKey",prompt,"updatedAt") VALUES('billing-work-tag',$1,'WORK','Work','work','Rule',now())`,
    [user],
  );
  await database.query(
    `UPDATE emails SET workspace='WORK',"accountId"='billing-work-account',"createdAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "providerMessageId"::int<=2`,
    [user],
  );
  expect(await classifyEmails(user)).toMatchObject({ remaining: 0, billingBlocked: true });
  expect(mocks.evaluate).toHaveBeenCalledTimes(3);
  expect(
    (await database.query<{ emails: number }>('SELECT emails FROM billing_usage')).rows[0].emails,
  ).toBe(10000);
  expect(
    (
      await database.query(
        'SELECT workspace,count(DISTINCT "emailId")::int AS emails FROM email_classifications GROUP BY workspace ORDER BY workspace',
      )
    ).rows,
  ).toEqual([
    { workspace: 'PERSONAL', emails: 2 },
    { workspace: 'WORK', emails: 1 },
  ]);
});
it('atomically consumes the last slot when independent workers evaluate different emails concurrently', async () => {
  await seed(2);
  await billingTrial(9999);
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
    classifyEmails(user, { emailIds: [user + '-0001'], workspace: 'PERSONAL' }),
    classifyEmails(user, { emailIds: [user + '-0002'], workspace: 'PERSONAL' }),
  ]);
  expect(await count('email_classifications')).toBe(2);
  expect(
    (await database.query<{ emails: number }>('SELECT emails FROM billing_usage')).rows[0].emails,
  ).toBe(10000);
  expect(await usage()).toBe(1);
});
