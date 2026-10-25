import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { closeTestDb, resetTestDb, testDb } from './helpers/sqlite';
vi.mock('@/lib/db', async () => ({ db: (await import('./helpers/sqlite')).testDb }));
import { getInbox, getInboxCounts } from '@/lib/inbox';
import { currentModelVersion } from '@/lib/classification-version';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' };
const other = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' };
const receivedAt = new Date('2026-09-25T10:00:00Z');
afterAll(closeTestDb);
afterEach(() => vi.restoreAllMocks());
// Every test starts from the same fixture, so mutations never leak between tests.
beforeEach(async () => {
  await resetTestDb();
  await testDb.user.createMany({ data: [user, other] });
  const rows = [
    ['a', user.id, 'PERSONAL'],
    ['w', user.id, 'WORK'],
    ['b', other.id, 'PERSONAL'],
  ] as const;
  for (const [id, userId, workspace] of rows) {
    await testDb.emailAccount.create({
      data: {
        id,
        userId,
        workspace,
        provider: 'GMAIL',
        email: `${id}@example.com`,
        accessToken: 'secret',
        expiresAt: new Date(),
      },
    });
    await testDb.tag.create({
      data: {
        id,
        userId,
        workspace,
        name: id,
        nameKey: id,
        prompt: 'private rule',
        priority: 'HIGH',
        version: 2,
      },
    });
    const emails = Array.from(
      { length: id === 'a' ? 55 : 1 },
      (_, i) => `${id}-${String(i).padStart(3, '0')}`,
    );
    await testDb.email.createMany({
      data: emails.map((eid) => ({
        id: eid,
        userId,
        workspace,
        accountId: id,
        providerMessageId: eid,
        subject: 'Meeting',
        sender: 'sender@example.com',
        senderName: 'Sender',
        snippet: 'Summary',
        contentHash: 'current-hash',
        receivedAt,
        webUrl: 'https://mail.google.com',
      })),
    });
    await testDb.emailClassification.createMany({
      data: emails.map((eid, i) => ({
        id: eid,
        userId,
        workspace,
        emailId: eid,
        tagId: id,
        tagVersion: i === 0 ? 1 : 2,
        contentHash: 'current-hash',
        modelVersion: currentModelVersion(),
        matched: true,
        confidence: 90,
        decision: 'match',
        reasoning: 'trace',
      })),
    });
  }
}, 30000);
const raw = () => vi.spyOn(testDb, '$queryRaw');
it('projects body-free summaries and paginates equal timestamps without duplicates or offset scans', async () => {
  const query = raw();
  const first = await getInbox(user, new URLSearchParams());
  expect(first.emails).toHaveLength(50);
  expect(first.emails[0].id).toBe('a-054');
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(query).toHaveBeenCalledOnce();
  const sql = query.mock.calls[0][0] as unknown as Prisma.Sql;
  expect(sql.sql).not.toMatch(/\bbody\b|\boffset\b|e\.\*/i);
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
  const query = raw();
  for (const [who, params] of [
    [user, { cursor: 'invalid' }],
    [user, { cursor: first.nextCursor! + 'x' }],
    [other, { cursor: first.nextCursor! }],
    [user, { cursor: first.nextCursor!, workspace: 'WORK' }],
    [user, { cursor: first.nextCursor!, search: 'new' }],
  ] as const)
    await expect(getInbox(who, new URLSearchParams(params))).rejects.toMatchObject({ status: 400 });
  expect(query).not.toHaveBeenCalled();
});
it('counts only current matching classifications with the same tenant and workspace filters', async () => {
  const counts = await getInboxCounts(user, new URLSearchParams());
  expect(counts).toMatchObject({ total: 55, needsTotal: 54, tagCounts: { a: 54 } });
  expect(await getInboxCounts(user, new URLSearchParams({ tag: 'a' }))).toMatchObject({
    total: 54,
  });
});

it('keeps a cursor usable when its anchor is deleted and newer mail arrives', async () => {
  {
    const first = await getInbox(user, new URLSearchParams());
    await testDb.email.delete({ where: { id: 'a-005' } });
    await testDb.email.create({
      data: {
        id: 'a-new',
        userId: user.id,
        accountId: 'a',
        providerMessageId: 'new',
        subject: 'New',
        sender: 'a@example.com',
        senderName: 'A',
        snippet: 'New',
        receivedAt: new Date('2026-09-26T00:00:00Z'),
        webUrl: 'https://mail.google.com',
      },
    });
    const next = await getInbox(user, new URLSearchParams({ cursor: first.nextCursor! }));
    expect(next.emails.map((e) => e.id)).toEqual(['a-004', 'a-003', 'a-002', 'a-001', 'a-000']);
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
  {
    await testDb.emailClassification.updateMany({
      where: { emailId: 'a-054' },
      data: { contentHash: 'old' },
    });
    await testDb.emailClassification.updateMany({
      where: { emailId: 'a-053' },
      data: { modelVersion: 'old' },
    });
    await testDb.email.update({ where: { id: 'a-052' }, data: { inInbox: false } });
    await testDb.email.update({ where: { id: 'a-051' }, data: { contentHash: '' } });
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
  {
    await testDb.emailAccount.create({
      data: {
        id: 'new',
        userId: user.id,
        provider: 'GMAIL',
        email: 'new@example.com',
        accessToken: 'secret',
        expiresAt: new Date(),
      },
    });
    await testDb.emailAccount.update({ where: { id: 'a' }, data: { syncRequested: false } });
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
  }
});

it('separates initial import, active mailbox sync and pending AI work across both providers', async () => {
  {
    await testDb.user.update({
      where: { id: user.id },
      data: { workRequested: true, workNotBefore: new Date(Date.now() + 3_600_000) },
    });
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
      await testDb.emailAccount.update({
        where: { id: 'a' },
        data: {
          cursor,
          lastSync: item.synced ? new Date() : null,
          syncRequested: true,
          syncLeaseUntil: null,
          syncLeaseId: null,
        },
      });
      const counts = await getInboxCounts(user, new URLSearchParams());
      expect(counts.processing?.accounts?.[0]).toMatchObject({
        initialSync: item.initialSync,
        syncing: false,
      });
      expect(JSON.stringify(counts)).not.toMatch(/PRIVATE-CURSOR-TOKEN|pageToken|cursor|hasSynced/);
    }
    await testDb.emailAccount.update({
      where: { id: 'a' },
      data: { syncLeaseId: 'active', syncLeaseUntil: new Date(Date.now() + 60_000) },
    });
    expect(
      (await getInboxCounts(user, new URLSearchParams())).processing?.accounts?.[0].syncing,
    ).toBe(true);
    await testDb.emailAccount.update({
      where: { id: 'a' },
      data: { syncLeaseUntil: new Date(Date.now() - 60_000) },
    });
    expect(
      (await getInboxCounts(user, new URLSearchParams())).processing?.accounts?.[0].syncing,
    ).toBe(false);
  }
});
