import 'server-only';
import { Prisma } from '@prisma/client';
import { currentModelVersion } from './classification-version';
import { TAG_HISTORY_LIMIT } from './tag-policy';
import type { WorkspaceId } from './workspace-selection';

/** SQL aliases must be e (emails) and t (tags). Workers only use the saved history snapshot. */
export function tagMatchScope() {
  return Prisma.sql`(e."createdAt" >= t."matchFrom" OR e.id = ANY(t."historyEmailIds"))`;
}

/** A manual check is one durable batch of pending emails across the selected tags. */
export async function capturePendingTagHistory(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  userId: string,
  workspace: WorkspaceId,
  tagId?: string,
) {
  // Email inserts acquire this same lock before stamping their arrival time.
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`,
  );
  await tx.$executeRaw(Prisma.sql`
    WITH pending AS (
      SELECT e.id FROM emails e
      WHERE e."userId"=${userId}::uuid AND e.workspace=${workspace}::"WorkspaceKind"
        AND e."inInbox"=true AND EXISTS (
          SELECT 1 FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
            ${tagId ? Prisma.sql`AND t.id=${tagId}` : Prisma.empty}
            AND NOT EXISTS (
              SELECT 1 FROM email_classifications c WHERE c."emailId"=e.id AND c."tagId"=t.id
                AND c."userId"=e."userId" AND c.workspace=e.workspace AND c."tagVersion"=t.version
                AND e."contentHash"<>'' AND c."contentHash"=e."contentHash"
                AND c."modelVersion"=${currentModelVersion()}
            )
        ) ORDER BY e."receivedAt" DESC,e.id DESC LIMIT ${TAG_HISTORY_LIMIT}
    ), scope AS MATERIALIZED (
      SELECT clock_timestamp()::timestamp AS since, ARRAY(SELECT id FROM pending) AS ids
    )
    UPDATE tags t SET "matchFrom"=scope.since,"historyEmailIds"=scope.ids FROM scope
    WHERE t."userId"=${userId}::uuid AND t.workspace=${workspace}::"WorkspaceKind"
      ${tagId ? Prisma.sql`AND t.id=${tagId}` : Prisma.empty}
  `);
}
