import { afterAll, beforeEach, expect, it } from 'vitest';
import { closeTestDb, resetTestDb, testDb } from './helpers/sqlite';

const alice = '11111111-1111-4111-8111-111111111111',
  bob = '22222222-2222-4222-8222-222222222222';
const mail = (id: string, userId: string, accountId: string, workspace = 'PERSONAL') => ({
  id,
  userId,
  accountId,
  workspace: workspace as 'PERSONAL' | 'WORK',
  providerMessageId: id,
  subject: 'private',
  sender: 'a@example.com',
  senderName: 'Alice',
  snippet: 'sample',
  receivedAt: new Date(),
  webUrl: 'https://mail.google.com',
});
const classification = (
  id: string,
  userId: string,
  emailId: string,
  tagId: string,
  workspace = 'PERSONAL',
) => ({
  id,
  userId,
  emailId,
  tagId,
  workspace: workspace as 'PERSONAL' | 'WORK',
  tagVersion: 1,
  matched: true,
  confidence: 99,
  decision: 'match',
  reasoning: 'trace',
});
afterAll(closeTestDb);
beforeEach(async () => {
  await resetTestDb();
  for (const [id, userId] of [
    ['a', alice],
    ['b', bob],
  ]) {
    await testDb.user.create({ data: { id: userId, email: `${id}@example.com` } });
    await testDb.tag.create({
      data: { id, userId, name: `private-${id}`, nameKey: `private-${id}`, prompt: 'Match mine' },
    });
    await testDb.emailAccount.create({
      data: {
        id,
        userId,
        provider: 'GMAIL',
        email: `${id}@example.com`,
        accessToken: 'encrypted',
        expiresAt: new Date(),
      },
    });
  }
  await testDb.email.create({ data: mail('email-a', alice, 'a') });
  await testDb.emailClassification.create({
    data: classification('c-a', alice, 'email-a', 'a'),
  });
  await testDb.replyDraft.create({
    data: {
      userId: alice,
      workspace: 'PERSONAL',
      accountId: 'a',
      emailId: 'email-a',
      rfcMessageId: '<d@example.com>',
    },
  });
}, 30000);

it('applies the complete migration, including app_settings and the workspace indexes', async () => {
  const objects = await testDb.$queryRaw<{ name: string; type: string }[]>`
    SELECT name,type FROM sqlite_master WHERE name NOT LIKE '_prisma%' AND name NOT LIKE 'sqlite_%'`;
  const names = new Set(objects.map((o) => o.name));
  for (const table of [
    'users',
    'tags',
    'email_accounts',
    'emails',
    'email_classifications',
    'notification_prefs',
    'reply_drafts',
    'processing_state',
    'app_settings',
  ])
    expect(names.has(table), table).toBe(true);
  for (const index of [
    'emails_inbox_cursor_idx',
    'emails_account_cursor_idx',
    'classifications_workspace_tag_idx',
  ])
    expect(names.has(index), index).toBe(true);
  expect(await testDb.appSettings.count()).toBe(0);
  await testDb.appSettings.create({ data: {} });
  expect(await testDb.appSettings.findUniqueOrThrow({ where: { id: 'app' } })).toMatchObject({
    googleClientId: '',
    googleClientSecret: null,
    microsoftTenantId: 'common',
    jevApiKey: null,
  });
});
it('stores no message body: emails has no body column', async () => {
  const columns = await testDb.$queryRaw<
    { name: string }[]
  >`SELECT name FROM pragma_table_info('emails')`;
  expect(columns.length).toBeGreaterThan(5);
  expect(columns.map((c) => c.name)).not.toContain('body');
});
it('cascades deleting the user to accounts, emails, tags, classifications and drafts', async () => {
  await testDb.user.delete({ where: { id: alice } });
  expect(await testDb.emailAccount.findMany({ where: { userId: alice } })).toHaveLength(0);
  expect(await testDb.email.findMany({ where: { userId: alice } })).toHaveLength(0);
  expect(await testDb.tag.findMany({ where: { userId: alice } })).toHaveLength(0);
  expect(await testDb.emailClassification.findMany({ where: { userId: alice } })).toHaveLength(0);
  expect(await testDb.replyDraft.findMany({ where: { userId: alice } })).toHaveLength(0);
  expect(await testDb.emailAccount.count({ where: { userId: bob } })).toBe(1);
});
it('rejects cross-tenant foreign keys even on privileged writes', async () => {
  await expect(
    testDb.emailClassification.create({ data: classification('bad', alice, 'email-a', 'b') }),
  ).rejects.toThrow(/foreign key/i);
});
it('rejects cross-workspace classification and an email in another workspace than its account', async () => {
  expect((await testDb.email.findUniqueOrThrow({ where: { id: 'email-a' } })).workspace).toBe(
    'PERSONAL',
  );
  await testDb.tag.create({
    data: {
      id: 'work-tag',
      userId: alice,
      workspace: 'WORK',
      name: 'private-a',
      nameKey: 'private-a',
      prompt: 'Work only',
    },
  });
  await expect(
    testDb.emailClassification.create({
      data: classification('cross-workspace', alice, 'email-a', 'work-tag', 'PERSONAL'),
    }),
  ).rejects.toThrow(/foreign key/i);
  await expect(
    testDb.email.create({ data: mail('cross-account', alice, 'a', 'WORK') }),
  ).rejects.toThrow(/foreign key/i);
});
it('cascades account disconnect only to that account’s email data', async () => {
  await testDb.emailAccount.delete({ where: { id: 'a' } });
  expect(await testDb.email.findMany({ where: { id: 'email-a' } })).toHaveLength(0);
  expect(await testDb.emailAccount.findMany({ where: { id: 'b' } })).toHaveLength(1);
});
