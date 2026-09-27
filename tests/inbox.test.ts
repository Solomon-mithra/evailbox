import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $queryRaw: mocks.query } }));
import { getInbox, getInboxCounts } from '@/lib/inbox';
import { currentModelVersion } from '@/lib/classification-version';
const database = new PGlite();
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' };
const other = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' };
beforeAll(async () => {
  process.env.ENCRYPTION_SECRET_KEY = 'a'.repeat(64);
  await database.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA public,auth TO authenticated;`,
  );
  for (const path of [
    '20260921000000_init',
    '20260922000000_workspaces',
    '20260925030000_classification_freshness',
    '20260925040000_plan_preview',
    '20260927000000_stripe_billing',
    '20260928000000_tag_history_limit',
  ])
    await database.exec(await readFile(`prisma/migrations/${path}/migration.sql`, 'utf8'));
  await database.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [user.id, other.id]);
  await database.query('INSERT INTO users(id,email) VALUES ($1,$2),($3,$4)', [
    user.id,
    user.email,
    other.id,
    other.email,
  ]);
  for (const [id, uid, workspace] of [
    ['a', user.id, 'PERSONAL'],
    ['w', user.id, 'WORK'],
    ['b', other.id, 'PERSONAL'],
  ]) {
    await database.query(
      'INSERT INTO email_accounts(id,"userId",workspace,provider,email,"accessToken","expiresAt") VALUES ($1,$2,$3,\'GMAIL\',$4,\'secret\',now())',
      [id, uid, workspace, `${id}@example.com`],
    );
    await database.query(
      'INSERT INTO tags(id,"userId",workspace,name,"nameKey",prompt,priority,version,"updatedAt") VALUES ($1,$2,$3,$1,$1,\'private rule\',\'HIGH\',2,now())',
      [id, uid, workspace],
    );
    for (let i = 0; i < (id === 'a' ? 55 : 1); i++) {
      const eid = `${id}-${String(i).padStart(3, '0')}`;
      await database.query(
        "INSERT INTO emails(id,\"userId\",workspace,\"accountId\",\"providerMessageId\",subject,sender,\"senderName\",snippet,body,\"receivedAt\",\"webUrl\") VALUES ($1,$2,$3,$4,$1,'Meeting','sender@example.com','Sender','Summary','SECRET FULL BODY','2026-09-25T10:00:00Z','https://mail.google.com')",
        [eid, uid, workspace, id],
      );
      await database.query(
        'INSERT INTO email_classifications(id,"userId",workspace,"emailId","tagId","tagVersion",matched,confidence,decision,reasoning) VALUES ($1,$2,$3,$1,$4,$5,true,90,\'match\',\'trace\')',
        [eid, uid, workspace, id, i === 0 ? 1 : 2],
      );
    }
  }
  await database.query(`UPDATE emails SET "contentHash"='current-hash'`);
  await database.query(
    `UPDATE email_classifications SET "contentHash"='current-hash',"modelVersion"=$1`,
    [currentModelVersion()],
  );
}, 30000);
afterAll(() => database.close());
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockImplementation(
    async (sql: Prisma.Sql) => (await database.query(sql.text, sql.values)).rows,
  );
});
it('projects body-free summaries and paginates equal timestamps without duplicates or offset scans', async () => {
  const first = await getInbox(user, new URLSearchParams());
  expect(first.emails).toHaveLength(50);
  expect(first.emails[0].id).toBe('a-054');
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(mocks.query).toHaveBeenCalledOnce();
  const sql = mocks.query.mock.calls[0][0] as Prisma.Sql;
  expect(sql.text).not.toMatch(/\bbody\b|\boffset\b|e\.\*/i);
  expect(first.emails[0]).not.toHaveProperty('body');
  expect(first.emails[0]).not.toHaveProperty('userId');
  expect(first.emails[0].classifications[0].tag.version).toBe(2);
  const second = await getInbox(user, new URLSearchParams({ cursor: first.nextCursor! }));
  expect(second.emails.map((e) => e.id)).toEqual(['a-004', 'a-003', 'a-002', 'a-001', 'a-000']);
  expect(second.emails.at(-1)?.classifications).toEqual([]);
  expect(second.nextCursor).toBeNull();
});
it('applies user/workspace/account/search/date and current tag filters inside the database', async () => {
  expect(
    (await getInbox(user, new URLSearchParams({ workspace: 'WORK' }))).emails.map((e) => e.id),
  ).toEqual(['w-000']);
  expect((await getInbox(user, new URLSearchParams({ account: 'b' }))).emails).toEqual([]);
  expect((await getInbox(user, new URLSearchParams({ search: "%' OR true --" }))).emails).toEqual(
    [],
  );
  expect(
    (await getInbox(user, new URLSearchParams({ search: 'sender', tag: 'a' }))).emails,
  ).toHaveLength(50);
  expect((await getInbox(user, new URLSearchParams({ tag: 'b' }))).emails).toEqual([]);
  const needs = await getInbox(user, new URLSearchParams({ needs: '1' }));
  expect(needs.emails.every((e) => e.classifications.some((c) => c.tagVersion === 2))).toBe(true);
});
it('rejects malformed, tampered and cross-scope cursors before database reads', async () => {
  const first = await getInbox(user, new URLSearchParams());
  mocks.query.mockClear();
  for (const [who, params] of [
    [user, { cursor: 'invalid' }],
    [user, { cursor: first.nextCursor! + 'x' }],
    [other, { cursor: first.nextCursor! }],
    [user, { cursor: first.nextCursor!, workspace: 'WORK' }],
    [user, { cursor: first.nextCursor!, search: 'new' }],
  ] as const)
    await expect(getInbox(who, new URLSearchParams(params))).rejects.toMatchObject({ status: 400 });
  expect(mocks.query).not.toHaveBeenCalled();
});
it('counts only current matching classifications with the same tenant and workspace filters', async () => {
  const counts = await getInboxCounts(user, new URLSearchParams());
  expect(counts).toMatchObject({ total: 55, needsTotal: 54, tagCounts: { a: 54 } });
  expect(await getInboxCounts(user, new URLSearchParams({ tag: 'a' }))).toMatchObject({
    total: 54,
  });
});

it('keeps a cursor usable when its anchor is deleted and newer mail arrives', async () => {
  await database.exec('BEGIN');
  try {
    const first = await getInbox(user, new URLSearchParams());
    await database.query('DELETE FROM emails WHERE id=$1', ['a-005']);
    await database.query(
      "INSERT INTO emails(id,\"userId\",\"accountId\",\"providerMessageId\",subject,sender,\"senderName\",snippet,\"receivedAt\",\"webUrl\") VALUES ('a-new',$1,'a','new','New','a@example.com','A','New','2026-09-26T00:00:00Z','https://mail.google.com')",
      [user.id],
    );
    const next = await getInbox(user, new URLSearchParams({ cursor: first.nextCursor! }));
    expect(next.emails.map((e) => e.id)).toEqual(['a-004', 'a-003', 'a-002', 'a-001', 'a-000']);
  } finally {
    await database.exec('ROLLBACK');
  }
});
it('applies date windows and treats wildcard characters as literal search input', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T00:00:00Z'));
  try {
    expect((await getInbox(user, new URLSearchParams({ range: 'month' }))).emails).toEqual([]);
    expect((await getInbox(user, new URLSearchParams({ search: '%' }))).emails).toEqual([]);
  } finally {
    now.mockRestore();
  }
});

it('hides retained non-inbox rows and stale content/model/legacy decisions from rows, filters and counts', async () => {
  await database.exec('BEGIN');
  try {
    await database.exec(
      `UPDATE email_classifications SET "contentHash"='old' WHERE "emailId"='a-054'; UPDATE email_classifications SET "modelVersion"='old' WHERE "emailId"='a-053'; UPDATE emails SET "inInbox"=false WHERE id='a-052'; UPDATE emails SET "contentHash"='' WHERE id='a-051';`,
    );
    const page = await getInbox(user, new URLSearchParams());
    expect(page.emails.find((e) => e.id === 'a-054')?.classifications).toEqual([]);
    expect(page.emails.find((e) => e.id === 'a-053')?.classifications).toEqual([]);
    expect(page.emails.find((e) => e.id === 'a-052')).toBeUndefined();
    expect(page.emails.find((e) => e.id === 'a-051')?.classifications).toEqual([]);
    expect(await getInboxCounts(user, new URLSearchParams())).toMatchObject({
      total: 54,
      needsTotal: 50,
      tagCounts: { a: 50 },
    });
    expect((await getInbox(user, new URLSearchParams({ tag: 'a' }))).emails).toHaveLength(50);
  } finally {
    await database.exec('ROLLBACK');
  }
});
it('invalidates current classifications when configured model revision changes', async () => {
  vi.stubEnv('JEV_MODEL_VERSION', 'new-model');
  try {
    expect(
      (await getInbox(user, new URLSearchParams())).emails.every(
        (e) => e.classifications.length === 0,
      ),
    ).toBe(true);
    expect(await getInboxCounts(user, new URLSearchParams())).toMatchObject({
      total: 55,
      needsTotal: 0,
      tagCounts: {},
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

it('reports email progress independently of filters, using all current tag decisions', async () => {
  const counts = await getInboxCounts(user, new URLSearchParams({ tag: 'a', search: 'no-match' }));
  expect(counts.total).toBe(0);
  expect(counts.processing).toMatchObject({
    imported: 55,
    tagged: 54,
    remaining: 1,
    importing: true,
    accounts: [
      { id: 'a', email: 'a@example.com', imported: 55, tagged: 54, remaining: 1, importing: true },
    ],
  });
  const work = await getInboxCounts(user, new URLSearchParams({ workspace: 'WORK' }));
  expect(work.processing).toMatchObject({ imported: 1, tagged: 0, remaining: 1 });
  expect(work.processing?.accounts?.map((account) => account.id)).toEqual(['w']);
});

it('reports separate account progress including an empty newly connected mailbox', async () => {
  await database.exec('BEGIN');
  try {
    await database.query(
      `INSERT INTO email_accounts(id,"userId",workspace,provider,email,"accessToken","expiresAt") VALUES ('new',$1,'PERSONAL','GMAIL','new@example.com','secret',now())`,
      [user.id],
    );
    await database.exec(`UPDATE email_accounts SET "syncRequested"=false WHERE id='a'`);
    const counts = await getInboxCounts(
      user,
      new URLSearchParams({ account: 'new', search: 'no-match' }),
    );
    expect(counts.total).toBe(0);
    expect(counts.processing).toMatchObject({
      imported: 55,
      tagged: 54,
      remaining: 1,
      importing: true,
    });
    expect(counts.processing?.accounts).toEqual([
      {
        id: 'a',
        email: 'a@example.com',
        imported: 55,
        tagged: 54,
        remaining: 1,
        importing: false,
        initialSync: false,
        syncing: false,
      },
      {
        id: 'new',
        email: 'new@example.com',
        initialSync: true,
        syncing: false,
        imported: 0,
        tagged: 0,
        remaining: 0,
        importing: true,
      },
    ]);
  } finally {
    await database.exec('ROLLBACK');
  }
});

it('reports a billing pause without changing saved inbox access', async () => {
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('BILLING_ENABLED', 'true');
  expect(await getInboxCounts(user, new URLSearchParams())).toMatchObject({
    processing: { paused: true, billingBlocked: true },
  });
  expect((await getInbox(user, new URLSearchParams())).emails.length).toBeGreaterThan(0);
});

it('separates initial import, active mailbox sync and pending AI work across both providers', async () => {
  await database.exec('BEGIN');
  try {
    await database.query(
      `UPDATE users SET "workRequested"=true,"workNotBefore"=CURRENT_TIMESTAMP+interval '1 hour' WHERE id=$1`,
      [user.id],
    );
    const cases = [
      { cursor: null, synced: false, initialSync: true },
      {
        cursor: { v: 1, provider: 'GMAIL', phase: 'initial', remaining: 60 },
        synced: true,
        initialSync: true,
      },
      { cursor: { v: 1, provider: 'GMAIL', phase: 'history' }, synced: true, initialSync: false },
      {
        cursor: { v: 1, provider: 'GMAIL', phase: 'initial', rescan: true },
        synced: true,
        initialSync: false,
      },
      {
        cursor: { v: 2, provider: 'OUTLOOK', phase: 'initial', remaining: 60 },
        synced: true,
        initialSync: true,
      },
      {
        cursor: { v: 2, provider: 'OUTLOOK', phase: 'initial', remaining: 0 },
        synced: true,
        initialSync: false,
      },
      {
        cursor: { v: 2, provider: 'OUTLOOK', phase: 'delta', remaining: 0 },
        synced: true,
        initialSync: false,
      },
      {
        cursor: { v: 2, provider: 'OUTLOOK', phase: 'rescan', remaining: 0 },
        synced: true,
        initialSync: false,
      },
      { cursor: null, synced: true, initialSync: false },
      { cursor: 'legacy-invalid', synced: true, initialSync: false },
    ];
    for (const item of cases) {
      const cursor =
        typeof item.cursor === 'string'
          ? item.cursor
          : item.cursor && JSON.stringify({ ...item.cursor, pageToken: 'PRIVATE-CURSOR-TOKEN' });
      await database.query(
        `UPDATE email_accounts SET cursor=$1,"lastSync"=$2,"syncRequested"=true,"syncLeaseUntil"=null,"syncLeaseId"=null WHERE id='a'`,
        [cursor, item.synced ? new Date().toISOString() : null],
      );
      const counts = await getInboxCounts(user, new URLSearchParams());
      expect(counts.processing?.accounts?.[0]).toMatchObject({
        initialSync: item.initialSync,
        syncing: false,
      });
      expect(JSON.stringify(counts)).not.toMatch(/PRIVATE-CURSOR-TOKEN|pageToken|cursor|hasSynced/);
    }
    await database.exec(
      `UPDATE email_accounts SET "syncLeaseId"='active',"syncLeaseUntil"=CURRENT_TIMESTAMP+interval '1 minute' WHERE id='a'`,
    );
    expect(
      (await getInboxCounts(user, new URLSearchParams())).processing?.accounts?.[0].syncing,
    ).toBe(true);
    await database.exec(
      `UPDATE email_accounts SET "syncLeaseUntil"=CURRENT_TIMESTAMP-interval '1 minute' WHERE id='a'`,
    );
    expect(
      (await getInboxCounts(user, new URLSearchParams())).processing?.accounts?.[0].syncing,
    ).toBe(false);
  } finally {
    await database.exec('ROLLBACK');
  }
});
