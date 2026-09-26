import { Prisma, type PrismaClient } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import type { EmailEvidence, Snapshot } from './eval-production-core';

/** Mirrors the application's user/workspace + tag/content/model freshness predicate. */
export function evidenceQuery(modelVersion: string, maxRows: number, userId?: string) {
  return Prisma.sql`
    WITH tag_sets AS (
      SELECT "userId", workspace, count(*)::int AS n,
        jsonb_agg(jsonb_build_array(id,version) ORDER BY id)::text AS signature
      FROM tags ${userId ? Prisma.sql`WHERE "userId"=${userId}::uuid` : Prisma.empty}
      GROUP BY "userId",workspace
    )
    SELECT e.id,e."userId",e.workspace,e."createdAt" AT TIME ZONE 'UTC' AS "createdAt",
      e."firstClassifiedAt" AT TIME ZONE 'UTC' AS "firstClassifiedAt",
      e."inInbox",e."contentHash",COALESCE(t.n,0)::int AS "requiredTags",
      COALESCE(t.signature,'') AS "rulesSignature",
      (SELECT count(*)::int FROM email_classifications c
        JOIN tags ct ON ct.id=c."tagId" AND ct."userId"=c."userId" AND ct.workspace=c.workspace
        WHERE c."emailId"=e.id AND c."userId"=e."userId" AND c.workspace=e.workspace
          AND c."tagVersion"=ct.version AND e."contentHash"<>''
          AND c."contentHash"=e."contentHash" AND c."modelVersion"=${modelVersion}
      ) AS "currentDecisions"
    FROM emails e LEFT JOIN tag_sets t ON t."userId"=e."userId" AND t.workspace=e.workspace
    ${userId ? Prisma.sql`WHERE e."userId"=${userId}::uuid` : Prisma.empty}
    ORDER BY e."createdAt",e.id LIMIT ${maxRows + 1}`;
}

export async function collectSnapshot(
  db: PrismaClient,
  modelVersion: string,
  maxRows: number,
  userId?: string,
): Promise<Snapshot> {
  const start = performance.now();
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 15000');
      const [clock] = await tx.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
      const userWhere = userId ? Prisma.sql`WHERE id=${userId}::uuid` : Prisma.empty;
      const ownedWhere = userId ? Prisma.sql`WHERE "userId"=${userId}::uuid` : Prisma.empty;
      const [inventory] = await tx.$queryRaw<Snapshot['inventory'][]>(Prisma.sql`
      WITH u AS (SELECT "workRequested","workFailures" FROM users ${userWhere}),
        a AS (SELECT "syncRequested","syncError" FROM email_accounts ${ownedWhere})
      SELECT (SELECT count(*)::int FROM u) AS users,
        (SELECT count(*)::int FROM a) AS accounts,
        (SELECT count(*)::int FROM u WHERE "workRequested") AS "pendingUsers",
        (SELECT count(*)::int FROM u WHERE "workFailures">0) AS "usersWithFailures",
        (SELECT count(*)::int FROM a WHERE "syncRequested") AS "pendingAccounts",
        (SELECT count(*)::int FROM a WHERE "syncError" IS NOT NULL) AS "accountsWithErrors",
        (SELECT count(*)::int FROM email_classifications ${ownedWhere}) AS decisions,
        EXISTS(SELECT 1 FROM processing_state WHERE id='jev' AND "notBefore">CURRENT_TIMESTAMP) AS "jevCooldown"`);
      const rows = await tx.$queryRaw<
        (Omit<EmailEvidence, 'createdAt' | 'firstClassifiedAt'> & {
          createdAt: Date;
          firstClassifiedAt: Date | null;
        })[]
      >(evidenceQuery(modelVersion, maxRows, userId));
      if (rows.length > maxRows) throw new Error('EVAL_ROW_LIMIT');
      const [end] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
      return {
        startedAt: clock.at.toISOString(),
        finishedAt: end.at.toISOString(),
        inventory,
        emails: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          firstClassifiedAt: row.firstClassifiedAt?.toISOString() ?? null,
        })),
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 25000, maxWait: 10000 },
  );
  return { ...result, queryWallMs: performance.now() - start };
}
