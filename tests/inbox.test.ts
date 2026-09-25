import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $queryRaw: mocks.query } }));
import { getInbox, getInboxCounts } from '@/lib/inbox';
const database = new PGlite();
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' };
const other = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' };
beforeAll(async () => {
  process.env.ENCRYPTION_SECRET_KEY = 'a'.repeat(64);
  await database.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA public,auth TO authenticated;`,
  );
  for (const path of ['20260921000000_init', '20260922000000_workspaces'])
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
}, 30000);
afterAll(() => database.close());
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
  expect(counts).toEqual({ total: 55, needsTotal: 54, tagCounts: { a: 54 } });
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
