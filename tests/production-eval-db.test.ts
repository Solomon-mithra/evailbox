import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { evidenceQuery } from '../scripts/eval-production-db';

// SQL correctness fixtures only. This file produces no performance evidence or benchmark artifacts.
const database = new PGlite();
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
beforeAll(async () => {
  await database.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated;`);
  for (const path of [
    '20260921000000_init',
    '20260922000000_workspaces',
    '20260925030000_classification_freshness',
  ])
    await database.exec(await readFile(`prisma/migrations/${path}/migration.sql`, 'utf8'));
  for (const uid of [user, other]) {
    await database.query('INSERT INTO auth.users(id) VALUES($1)', [uid]);
    await database.query('INSERT INTO users(id,email) VALUES($1,$2)', [uid, `${uid}@example.com`]);
    await database.query(
      `INSERT INTO email_accounts(id,"userId",provider,email,"accessToken","expiresAt")
      VALUES($1::text,$1::uuid,'GMAIL','private@example.com','PRIVATE-TOKEN',now())`,
      [uid],
    );
    await database.query(
      `INSERT INTO emails(id,"userId","accountId","providerMessageId",subject,sender,"senderName",snippet,"receivedAt","webUrl","contentHash")
      VALUES($1::text,$1::uuid,$1::text,'provider-id','PRIVATE-SUBJECT','PRIVATE-SENDER','PRIVATE-NAME','PRIVATE-SNIPPET',now(),'PRIVATE-URL','hash')`,
      [uid],
    );
  }
  for (const id of ['match', 'no-match', 'uncertain', 'old-content', 'old-model', 'old-tag']) {
    await database.query(
      `INSERT INTO tags(id,"userId",name,"nameKey",prompt,"updatedAt") VALUES($1,$2,$1,$1,'PRIVATE-PROMPT',now())`,
      [id, user],
    );
    await database.query(
      `INSERT INTO email_classifications(id,"userId","emailId","tagId","tagVersion","contentHash","modelVersion",matched,confidence,decision,reasoning)
      VALUES($1,$2::uuid,$2::text,$1,$3,$4,$5,$6,50,$7,'PRIVATE-REASONING')`,
      [
        id,
        user,
        id === 'old-tag' ? 0 : 1,
        id === 'old-content' ? 'old-hash' : 'hash',
        id === 'old-model' ? 'old-version' : 'model-version',
        id === 'match',
        id === 'match' ? 'match' : id === 'uncertain' ? 'uncertain' : 'no_match',
      ],
    );
  }
}, 30000);
afterAll(() => database.close());

async function query(max = 100, userId?: string) {
  const sql = evidenceQuery('model-version', max, userId);
  return (await database.query(sql.text, sql.values)).rows as Record<string, unknown>[];
}
it('counts negative and uncertain decisions but rejects each stale version dimension', async () => {
  const rows = await query(100, user);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: user, requiredTags: 6, currentDecisions: 3 });
});
it('does not export content, addresses, tokens, or reasoning', async () => {
  expect(JSON.stringify(await query())).not.toContain('PRIVATE-');
});
it('keeps untagged tenants visible without giving them completed classification credit', async () => {
  expect((await query()).find((e) => e.id === other)).toMatchObject({
    requiredTags: 0,
    currentDecisions: 0,
  });
});
it('fetches a sentinel row so collection can reject silent truncation', async () => {
  expect(await query(1)).toHaveLength(2);
});
