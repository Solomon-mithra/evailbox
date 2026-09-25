import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
const pg = new PGlite();
const uid = '11111111-1111-4111-8111-111111111111';
beforeAll(async () => {
  await pg.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA public,auth TO authenticated;`,
  );
  for (const path of (await readdir('prisma/migrations')).filter((name) => /^\d/.test(name)).sort())
    await pg.exec(await readFile(`prisma/migrations/${path}/migration.sql`, 'utf8'));
  await pg.query('INSERT INTO auth.users(id) VALUES ($1)', [uid]);
  await pg.query('INSERT INTO users(id,email) VALUES($1,$2)', [uid, 'fixture@example.com']);
  await pg.query(
    `INSERT INTO email_accounts(id,"userId",workspace,provider,email,"accessToken","expiresAt") VALUES ('a',$1,'PERSONAL','GMAIL','fixture@example.com','encrypted',now()),('b',$1,'WORK','GMAIL','fixture@example.com','encrypted',now())`,
    [uid],
  );
  await pg.query(
    `INSERT INTO emails(id,"userId",workspace,"accountId","providerMessageId",subject,sender,"senderName",snippet,"receivedAt","webUrl") VALUES ('e',$1,'PERSONAL','a','p','subject','a@sample.test','A','snippet',now(),'https://mail.google.com')`,
    [uid],
  );
}, 30000);
afterAll(() => pg.close());
it('applies every migration and locks private background tables from authenticated clients', async () => {
  const result = await pg.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('mailbox_subscriptions','reply_drafts','monthly_usage','processing_state')`,
  );
  expect(result.rows).toHaveLength(4);
  expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  await pg.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${uid}'`);
  try {
    for (const table of [
      'mailbox_subscriptions',
      'reply_drafts',
      'monthly_usage',
      'processing_state',
    ])
      await expect(pg.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
    await expect(pg.query("UPDATE users SET plan='HEAVY'")).rejects.toThrow(/permission denied/);
  } finally {
    await pg.exec('RESET ROLE');
  }
});
it('prevents cross-workspace subscription and draft attachment', async () => {
  await expect(
    pg.query(
      `INSERT INTO mailbox_subscriptions("accountId","userId",workspace,provider,"updatedAt") VALUES ('a',$1,'WORK','GMAIL',now())`,
      [uid],
    ),
  ).rejects.toThrow(/foreign key/);
  await expect(
    pg.query(
      `INSERT INTO reply_drafts(id,"userId",workspace,"accountId","emailId","rfcMessageId","updatedAt") VALUES ('draft',$1,'WORK','b','e','unique',now())`,
      [uid],
    ),
  ).rejects.toThrow(/foreign key/);
});
it('deletes all private app state with the Supabase identity', async () => {
  await pg.query(
    `INSERT INTO mailbox_subscriptions("accountId","userId",workspace,provider,"updatedAt") VALUES ('a',$1,'PERSONAL','GMAIL',now())`,
    [uid],
  );
  await pg.query(
    `INSERT INTO reply_drafts(id,"userId",workspace,"accountId","emailId","rfcMessageId","updatedAt") VALUES ('draft',$1,'PERSONAL','a','e','unique',now())`,
    [uid],
  );
  await pg.query(`INSERT INTO monthly_usage("userId",month,emails) VALUES ($1,CURRENT_DATE,1)`, [
    uid,
  ]);
  await pg.query('DELETE FROM auth.users WHERE id=$1', [uid]);
  for (const table of [
    'users',
    'email_accounts',
    'emails',
    'mailbox_subscriptions',
    'reply_drafts',
    'monthly_usage',
  ])
    expect((await pg.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
});
it('has no server-side column for message bodies', async () => {
  const columns = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='emails'`,
  );
  expect(columns.rows.map((row) => row.column_name)).not.toContain('body');
});
