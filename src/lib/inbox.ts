import 'server-only';
import { tagMatchScope } from './tag-scope';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { encrypt, decrypt } from './crypto';
import { ApiError } from './errors';
import { workspaceIds } from './workspace-selection';
import { currentModelVersion } from './classification-version';
import type { EmailSummary, InboxPage, InboxCounts } from '@/types';

const filtersSchema = z.object({
  workspace: z.enum(workspaceIds).default('PERSONAL'),
  search: z.string().trim().max(200).default(''),
  tag: z.string().max(100).default(''),
  account: z.string().max(100).default(''),
  range: z.enum(['week', 'month', 'all']).default('all'),
  needs: z.enum(['0', '1']).default('0'),
  cursor: z.string().max(3000).optional(),
});
type Input = z.infer<typeof filtersSchema>;
const cursorSchema = z
  .object({
    v: z.literal(1),
    scope: z.string(),
    receivedAt: z.iso.datetime(),
    id: z.string().min(1).max(100),
  })
  .strict();
function scope(userId: string, input: Input) {
  return JSON.stringify([
    userId,
    input.workspace,
    input.search,
    input.tag,
    input.account,
    input.range,
    input.needs,
  ]);
}
function decodeCursor(input: Input, userId: string) {
  if (!input.cursor) return null;
  try {
    const cursor = cursorSchema.parse(JSON.parse(decrypt(input.cursor)));
    if (cursor.scope !== scope(userId, input)) throw new Error('Wrong scope');
    return cursor;
  } catch {
    throw new ApiError(
      400,
      'INVALID_CURSOR',
      'This inbox page has expired. Return to the first page.',
    );
  }
}
// Shared by summary filtering and counts: all three freshness versions must match.
function classificationJoin() {
  return Prisma.sql`FROM email_classifications c
  JOIN tags t ON t.id = c."tagId" AND t."userId" = c."userId" AND t.workspace = c.workspace
  WHERE c."emailId" = e.id AND c."userId" = e."userId" AND c.workspace = e.workspace
    AND c."tagVersion" = t.version AND e."contentHash" <> '' AND c."contentHash" = e."contentHash" AND c."modelVersion" = ${currentModelVersion()}`;
}
function needsMatch() {
  return Prisma.sql`e.handled = false AND e."isRead" = false AND EXISTS (
  SELECT 1 ${classificationJoin()} AND c.matched = true AND t.priority = 'HIGH'
)`;
}
function where(userId: string, input: Input) {
  const conditions = [
    Prisma.sql`e."inInbox" = true`,
    Prisma.sql`e."userId" = ${userId}`,
    Prisma.sql`e.workspace = ${input.workspace}`,
  ];
  if (input.account) conditions.push(Prisma.sql`e."accountId" = ${input.account}`);
  if (input.tag)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 ${classificationJoin()} AND c.matched = true AND c."tagId" = ${input.tag})`,
    );
  if (input.needs === '1') conditions.push(needsMatch());
  if (input.range !== 'all')
    conditions.push(
      Prisma.sql`e."receivedAt" >= ${new Date(Date.now() - (input.range === 'week' ? 7 : 30) * 86400000)}`,
    );
  if (input.search) {
    // Search is literal; user %/_ characters must not become wildcard scans.
    const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      Prisma.sql`(e.subject LIKE ${search} ESCAPE '\\' OR e.sender LIKE ${search} ESCAPE '\\' OR e."senderName" LIKE ${search} ESCAPE '\\')`,
    );
  }
  return Prisma.join(conditions, ' AND ');
}

export async function getInbox(user: { id: string }, params: URLSearchParams): Promise<InboxPage> {
  const input = filtersSchema.parse(Object.fromEntries(params));
  const cursor = decodeCursor(input, user.id);
  // An explicit projection prevents ever transferring stored bodies into the read process.
  const rows = await db.$queryRaw<
    (Omit<EmailSummary, 'receivedAt' | 'classifications'> & {
      receivedAt: Date;
      classifications: string;
    })[]
  >(Prisma.sql`
    SELECT e.id, e."accountId", e.subject, e.sender, e."senderName", e.snippet,
      e."receivedAt", e."isRead", e.handled, e."webUrl",
      (SELECT json_group_array(json_object(
        'id', c.id, 'tagId', c."tagId", 'tagVersion', c."tagVersion", 'matched', c.matched,
        'confidence', c.confidence, 'reasoning', c.reasoning, 'decision', c.decision,
        'tag', json_object('id', t.id, 'name', t.name, 'priority', t.priority, 'version', t.version)
      ) ORDER BY c.id) ${classificationJoin()}) AS classifications
    FROM emails e WHERE ${where(user.id, input)}
      ${cursor ? Prisma.sql`AND (e."receivedAt", e.id) < (${new Date(cursor.receivedAt)}, ${cursor.id})` : Prisma.empty}
    ORDER BY e."receivedAt" DESC, e.id DESC LIMIT 51
  `);
  const emails = rows.slice(0, 50).map((e) => ({
    ...e,
    receivedAt: e.receivedAt.toISOString(),
    // SQLite JSON carries booleans as 0/1.
    classifications: (JSON.parse(e.classifications) as EmailSummary['classifications']).map(
      (c) => ({ ...c, matched: Boolean(c.matched) }),
    ),
  }));
  const last = emails.at(-1);
  return {
    emails,
    pageSize: 50,
    nextCursor:
      rows.length > 50 && last
        ? encrypt(
            JSON.stringify({
              v: 1,
              scope: scope(user.id, input),
              receivedAt: last.receivedAt,
              id: last.id,
            }),
          )
        : null,
  };
}

const initialSyncCursor = z.object({
  v: z.number(),
  provider: z.enum(['GMAIL', 'OUTLOOK']),
  phase: z.literal('initial'),
  rescan: z.boolean().optional(),
  remaining: z.number().int().nonnegative().optional(),
});
function isInitialImport(cursor: string | null, hasSynced: boolean) {
  if (!cursor) return !hasSynced;
  try {
    const state = initialSyncCursor.parse(JSON.parse(cursor));
    if (state.rescan || state.remaining === 0) return false;
    return state.provider === 'GMAIL'
      ? state.v === 1
      : state.v === 2 && state.remaining !== undefined;
  } catch {
    return false;
  }
}
export async function getInboxCounts(
  user: { id: string },
  params: URLSearchParams,
): Promise<InboxCounts> {
  const input = filtersSchema.parse(Object.fromEntries(params));
  const base = {
    ...input,
    search: '',
    tag: '',
    account: '',
    range: 'all' as const,
    needs: '0' as const,
  };
  const version = currentModelVersion(),
    now = new Date();
  const [progressRows, accounts, owner, cooldown, totals, tagRows] = await Promise.all([
    db.$queryRaw<{ accountId: string; imported: bigint; remaining: bigint; tagged: bigint }[]>(
      Prisma.sql`
      WITH email_progress AS (
        SELECT e."accountId", EXISTS (
            SELECT 1 FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
              AND ${tagMatchScope()}
              AND NOT EXISTS (
                SELECT 1 FROM email_classifications c WHERE c."emailId"=e.id
                  AND c."userId"=e."userId" AND c.workspace=e.workspace AND c."tagId"=t.id
                  AND c."tagVersion"=t.version AND e."contentHash"<>''
                  AND c."contentHash"=e."contentHash" AND c."modelVersion"=${version}
              )
          ) AS pending,
          EXISTS (
            SELECT 1 FROM email_classifications c JOIN tags t ON t.id=c."tagId"
              AND t."userId"=c."userId" AND t.workspace=c.workspace
            WHERE c."emailId"=e.id AND c."userId"=e."userId" AND c.workspace=e.workspace
              AND c."tagVersion"=t.version AND e."contentHash"<>''
              AND c."contentHash"=e."contentHash" AND c."modelVersion"=${version}
          ) AS checked
        FROM emails e WHERE ${where(user.id, base)}
      )
      SELECT "accountId", count(*) AS imported,
        count(*) FILTER (WHERE pending) AS remaining,
        count(*) FILTER (WHERE NOT pending AND checked) AS tagged
      FROM email_progress GROUP BY "accountId"`,
    ),
    db.emailAccount.findMany({
      where: { userId: user.id, workspace: input.workspace },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        email: true,
        syncRequested: true,
        syncLeaseId: true,
        syncLeaseUntil: true,
        cursor: true,
        lastSync: true,
      },
    }),
    db.user.findUnique({ where: { id: user.id }, select: { workNotBefore: true } }),
    db.processingState.findUnique({ where: { id: 'jev' } }),
    db.$queryRaw<{ total: bigint; needsTotal: bigint }[]>(Prisma.sql`
      SELECT (SELECT count(*) FROM emails e WHERE ${where(user.id, input)}) AS total,
        (SELECT count(*) FROM emails e WHERE ${where(user.id, base)} AND ${needsMatch()}) AS "needsTotal"`),
    db.$queryRaw<{ tagId: string; n: bigint }[]>(Prisma.sql`
      SELECT c."tagId", count(*) AS n FROM email_classifications c
      JOIN tags t ON t.id = c."tagId" AND t."userId" = c."userId" AND t.workspace = c.workspace
      JOIN emails e ON e.id = c."emailId" AND e."userId" = c."userId" AND e.workspace = c.workspace
      WHERE e."inInbox" = true AND e."contentHash" <> '' AND c."contentHash" = e."contentHash" AND c."modelVersion" = ${version}
        AND c."userId" = ${user.id} AND c.workspace = ${input.workspace}
        AND c.matched = true AND c."tagVersion" = t.version GROUP BY c."tagId"`),
  ]);
  const progress = new Map(progressRows.map((row) => [row.accountId, row]));
  const accountProgress = accounts.map((account) => {
    const row = progress.get(account.id);
    const importing = account.syncRequested;
    return {
      id: account.id,
      email: account.email,
      imported: Number(row?.imported ?? 0),
      tagged: Number(row?.tagged ?? 0),
      remaining: Number(row?.remaining ?? 0),
      importing,
      syncing: importing && account.syncLeaseId !== null && (account.syncLeaseUntil ?? now) > now,
      // Checkpoints stay server-side. Queue/AI backlog is not active mailbox sync.
      initialSync: importing && isInitialImport(account.cursor, account.lastSync !== null),
    };
  });
  const sum = (key: 'imported' | 'tagged' | 'remaining') =>
    progressRows.reduce((total, row) => total + Number(row[key]), 0);
  return {
    processing: {
      imported: sum('imported'),
      tagged: sum('tagged'),
      remaining: sum('remaining'),
      importing: accounts.some((account) => account.syncRequested),
      paused: (owner?.workNotBefore ?? now) > now || (cooldown?.notBefore ?? now) > now,
      accounts: accountProgress,
    },
    total: Number(totals[0].total),
    needsTotal: Number(totals[0].needsTotal),
    tagCounts: Object.fromEntries(tagRows.map((row) => [row.tagId, Number(row.n)])),
  };
}
