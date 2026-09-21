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
it('cascades account disconnect only to that account’s email data', async () => {
  await database.query('DELETE FROM email_accounts WHERE id=$1 AND "userId"=$2', ['a', alice]);
  expect(
    (await database.query('SELECT id FROM emails WHERE id=$1', ['email-a'])).rows,
  ).toHaveLength(0);
  expect(
    (await database.query('SELECT id FROM email_accounts WHERE id=$1', ['b'])).rows,
  ).toHaveLength(1);
});
