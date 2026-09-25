import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const database = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111',
  bob = '22222222-2222-4222-8222-222222222222';
beforeAll(async () => {
  await database.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA public,auth TO authenticated;`,
  );
  await database.exec(
    await readFile('prisma/migrations/20260921000000_init/migration.sql', 'utf8'),
  );
  await database.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [alice, bob]);
  await database.query('INSERT INTO users(id,email) VALUES ($1,$2),($3,$4)', [
    alice,
    'alice@example.com',
    bob,
    'bob@example.com',
  ]);
  for (const [id, user] of [
    ['a', alice],
    ['b', bob],
  ]) {
    await database.query(
      'INSERT INTO tags(id,"userId",name,"nameKey",prompt,priority,"updatedAt") VALUES ($1,$2,$3,$3,$4,$5,now())',
      [id, user, 'private-' + id, 'Match only my private messages', 'HIGH'],
    );
    await database.query(
      'INSERT INTO email_accounts(id,"userId",provider,email,"accessToken","expiresAt") VALUES ($1,$2,$3,$4,$5,now())',
      [id, user, 'GMAIL', id + '@example.com', 'encrypted'],
    );
  }
  await database.query(
    'INSERT INTO emails(id,"userId","accountId","providerMessageId",subject,sender,"senderName",snippet,"receivedAt","webUrl") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)',
    [
      'email-a',
      alice,
      'a',
      'provider-a',
      'private',
      'a@example.com',
      'Alice',
      'sample',
      'https://mail.google.com',
    ],
  );
  await database.exec(
    await readFile('prisma/migrations/20260922000000_workspaces/migration.sql', 'utf8'),
  );
  await database.exec(
    await readFile('prisma/migrations/20260925000000_inbox_read_indexes/migration.sql', 'utf8'),
  );
}, 30000);
afterAll(() => database.close());
it('applies the complete migration with RLS on all application tables', async () => {
  const { rows } = await database.query<{ relname: string; relrowsecurity: boolean }>(
    "SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('users','tags','email_accounts','emails','email_classifications','notification_prefs','push_subscriptions','digest_history')",
  );
  expect(rows).toHaveLength(8);
  expect(rows.every((r) => r.relrowsecurity)).toBe(true);
});
it('isolates direct authenticated tag reads by JWT subject', async () => {
  await database.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${alice}'`);
  try {
    const { rows } = await database.query<{ id: string }>('SELECT id FROM tags');
    expect(rows.map((r) => r.id)).toEqual(['a']);
    await expect(database.query('SELECT "accessToken" FROM email_accounts')).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await database.exec('RESET ROLE');
  }
});
it('rejects cross-tenant foreign keys even on privileged writes', async () => {
  await expect(
    database.query(
      'INSERT INTO email_classifications(id,"userId","emailId","tagId","tagVersion",matched,confidence,decision,reasoning) VALUES ($1,$2,$3,$4,1,true,99,$5,$6)',
      ['bad', alice, 'email-a', 'b', 'match', 'trace'],
    ),
  ).rejects.toThrow(/foreign key/);
});
it('preserves existing mail in Personal and rejects cross-workspace classification', async () => {
  expect(
    (
      await database.query<{ workspace: string }>('SELECT workspace FROM emails WHERE id=$1', [
        'email-a',
      ])
    ).rows[0].workspace,
  ).toBe('PERSONAL');
  await database.query(
    'INSERT INTO tags(id,"userId",workspace,name,"nameKey",prompt,priority,"updatedAt") VALUES ($1,$2,$3,$4,$4,$5,$6,now())',
    ['work-tag', alice, 'WORK', 'private-a', 'Match work messages only', 'HIGH'],
  );
  await expect(
    database.query(
      'INSERT INTO email_classifications(id,"userId",workspace,"emailId","tagId","tagVersion",matched,confidence,decision,reasoning) VALUES ($1,$2,$3,$4,$5,1,true,99,$6,$7)',
      ['cross-workspace', alice, 'PERSONAL', 'email-a', 'work-tag', 'match', 'trace'],
    ),
  ).rejects.toThrow(/foreign key/);
  await expect(
    database.query(
      'INSERT INTO emails(id,"userId",workspace,"accountId","providerMessageId",subject,sender,"senderName",snippet,"receivedAt","webUrl") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)',
      [
        'cross-account',
        alice,
        'WORK',
        'a',
        'other',
        'work',
        'a@example.com',
        'Alice',
        'sample',
        'https://mail.google.com',
      ],
    ),
  ).rejects.toThrow(/foreign key/);
});
it('cascades account disconnect only to that account’s email data', async () => {
  await database.query('DELETE FROM email_accounts WHERE id=$1 AND "userId"=$2', ['a', alice]);
  expect(
    (await database.query('SELECT id FROM emails WHERE id=$1', ['email-a'])).rows,
  ).toHaveLength(0);
  expect(
    (await database.query('SELECT id FROM email_accounts WHERE id=$1', ['b'])).rows,
  ).toHaveLength(1);
});

it('creates workspace keyset, account and classification read indexes', async () => {
  const { rows } = await database.query<{ indexname: string; indexdef: string }>(
    "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'",
  );
  const indexes = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
  expect(indexes.emails_inbox_cursor_idx).toContain(
    '("userId", workspace, "receivedAt" DESC, id DESC)',
  );
  expect(indexes.emails_account_cursor_idx).toContain(
    '("userId", workspace, "accountId", "receivedAt" DESC, id DESC)',
  );
  expect(indexes.classifications_workspace_tag_idx).toContain(
    '("userId", workspace, "tagId", matched, "tagVersion", "emailId")',
  );
});
