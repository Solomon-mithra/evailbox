import 'server-only';
import { tagMatchScope } from './tag-scope';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { encrypt, decrypt } from './crypto';
import { ApiError } from './errors';
import { workspaceIds } from './workspace-selection';
import { currentModelVersion } from './classification-version';
import type {
  EmailSummary,
  InboxPage,
  InboxCounts,
  InboxProcessing,
  InboxAccountProgress,
} from '@/types';

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
    Prisma.sql`e."userId" = ${userId}::uuid`,
    Prisma.sql`e.workspace = ${input.workspace}::"WorkspaceKind"`,
  ];
  if (input.account) conditions.push(Prisma.sql`e."accountId" = ${input.account}`);
  if (input.tag)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 ${classificationJoin()} AND c.matched = true AND c."tagId" = ${input.tag})`,
    );
  if (input.needs === '1') conditions.push(needsMatch());
  if (input.range !== 'all')
    conditions.push(
      Prisma.sql`e."receivedAt" >= ${new Date(Date.now() - (input.range === 'week' ? 7 : 30) * 86400000).toISOString()}::timestamp`,
    );
  if (input.search) {
    // Search is literal; user %/_ characters must not become wildcard scans.
    const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      Prisma.sql`(e.subject ILIKE ${search} OR e.sender ILIKE ${search} OR e."senderName" ILIKE ${search})`,
    );
  }
  return Prisma.join(conditions, ' AND ');
}

export async function getInbox(user: { id: string }, params: URLSearchParams): Promise<InboxPage> {
  const input = filtersSchema.parse(Object.fromEntries(params));
  const cursor = decodeCursor(input, user.id);
  // An explicit projection prevents ever transferring stored bodies into the read process.
  const rows = await db.$queryRaw<
    (Omit<EmailSummary, 'receivedAt'> & { receivedAt: Date })[]
  >(Prisma.sql`
    SELECT e.id, e."accountId", e.subject, e.sender, e."senderName", e.snippet,
      e."receivedAt" AT TIME ZONE 'UTC' AS "receivedAt", e."isRead", e.handled, e."webUrl",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'tagId', c."tagId", 'tagVersion', c."tagVersion", 'matched', c.matched,
        'confidence', c.confidence, 'reasoning', c.reasoning, 'decision', c.decision,
        'tag', jsonb_build_object('id', t.id, 'name', t.name, 'priority', t.priority, 'version', t.version)
      ) ORDER BY c.id) ${classificationJoin()}), '[]'::jsonb) AS classifications
    FROM emails e WHERE ${where(user.id, input)}
      ${cursor ? Prisma.sql`AND (e."receivedAt", e.id) < (${cursor.receivedAt}::timestamp, ${cursor.id})` : Prisma.empty}
    ORDER BY e."receivedAt" DESC, e.id DESC LIMIT 51
  `);
  const emails = rows.slice(0, 50).map((e) => ({ ...e, receivedAt: e.receivedAt.toISOString() }));
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
type InboxCountsRow = Omit<InboxCounts, 'processing'> & {
  processing: Omit<InboxProcessing, 'accounts'> & {
    accounts: (Omit<InboxAccountProgress, 'initialSync'> & {
      cursor: string | null;
      hasSynced: boolean;
    })[];
  };
};

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
  const rows = await db.$queryRaw<InboxCountsRow[]>(Prisma.sql`
    WITH email_progress AS (
      SELECT e."accountId", EXISTS (
          SELECT 1 FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
            AND ${tagMatchScope()}
            AND NOT EXISTS (
              SELECT 1 FROM email_classifications c WHERE c."emailId"=e.id
                AND c."userId"=e."userId" AND c.workspace=e.workspace AND c."tagId"=t.id
                AND c."tagVersion"=t.version AND e."contentHash"<>''
                AND c."contentHash"=e."contentHash" AND c."modelVersion"=${currentModelVersion()}
            )
        ) AS pending,
        EXISTS (
          SELECT 1 FROM email_classifications c JOIN tags t ON t.id=c."tagId"
            AND t."userId"=c."userId" AND t.workspace=c.workspace
          WHERE c."emailId"=e.id AND c."userId"=e."userId" AND c.workspace=e.workspace
            AND c."tagVersion"=t.version AND e."contentHash"<>''
            AND c."contentHash"=e."contentHash" AND c."modelVersion"=${currentModelVersion()}
        ) AS checked
      FROM emails e WHERE ${where(user.id, base)}
    ), account_progress AS (
      SELECT "accountId", count(*)::int AS imported,
        count(*) FILTER (WHERE pending)::int AS remaining,
        count(*) FILTER (WHERE NOT pending AND checked)::int AS tagged
      FROM email_progress GROUP BY "accountId"
    ), progress AS (
      SELECT COALESCE(sum(imported), 0)::int AS imported,
        COALESCE(sum(tagged), 0)::int AS tagged,
        COALESCE(sum(remaining), 0)::int AS remaining FROM account_progress
    )
    SELECT
      (SELECT jsonb_build_object(
        'imported', p.imported, 'tagged', p.tagged, 'remaining', p.remaining,
        'importing', EXISTS (SELECT 1 FROM email_accounts a WHERE a."userId"=${user.id}::uuid
          AND a.workspace=${input.workspace}::"WorkspaceKind" AND a."syncRequested"=true),
        'paused', EXISTS (SELECT 1 FROM users u WHERE u.id=${user.id}::uuid AND u."workNotBefore">CURRENT_TIMESTAMP)
          OR EXISTS (SELECT 1 FROM processing_state WHERE id='jev' AND "notBefore">CURRENT_TIMESTAMP),
        'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'email', a.email, 'imported', COALESCE(ap.imported, 0),
          'tagged', COALESCE(ap.tagged, 0),
          'remaining', COALESCE(ap.remaining, 0), 'importing', a."syncRequested",
          'syncing', a."syncRequested" AND a."syncLeaseId" IS NOT NULL
            AND COALESCE(a."syncLeaseUntil">CURRENT_TIMESTAMP, false),
          'cursor', a.cursor, 'hasSynced', a."lastSync" IS NOT NULL
        ) ORDER BY a."createdAt", a.id)
          FROM email_accounts a LEFT JOIN account_progress ap ON ap."accountId"=a.id
          WHERE a."userId"=${user.id}::uuid AND a.workspace=${input.workspace}::"WorkspaceKind"
        ), '[]'::jsonb)
      ) FROM progress p) AS processing,
      (SELECT count(*)::int FROM emails e WHERE ${where(user.id, input)}) AS total,
      (SELECT count(*)::int FROM emails e WHERE ${where(user.id, base)} AND ${needsMatch()}) AS "needsTotal",
      COALESCE((SELECT jsonb_object_agg(counts."tagId", counts.n) FROM (
        SELECT c."tagId", count(*)::int AS n FROM email_classifications c
        JOIN tags t ON t.id = c."tagId" AND t."userId" = c."userId" AND t.workspace = c.workspace
        JOIN emails e ON e.id = c."emailId" AND e."userId" = c."userId" AND e.workspace = c.workspace
        WHERE e."inInbox" = true AND e."contentHash" <> '' AND c."contentHash" = e."contentHash" AND c."modelVersion" = ${currentModelVersion()}
          AND c."userId" = ${user.id}::uuid AND c.workspace = ${input.workspace}::"WorkspaceKind"
          AND c.matched = true AND c."tagVersion" = t.version GROUP BY c."tagId"
      ) counts), '{}'::jsonb) AS "tagCounts"
  `);
  const { accounts, ...processing } = rows[0].processing;
  // Checkpoints stay server-side. Queue/AI backlog is not active mailbox sync.
  const result: InboxCounts = {
    ...rows[0],
    processing: {
      ...processing,
      accounts: accounts.map(({ cursor, hasSynced, ...account }) => ({
        ...account,
        initialSync: account.importing && isInitialImport(cursor, hasSynced),
      })),
    },
  };
  return result;
}
