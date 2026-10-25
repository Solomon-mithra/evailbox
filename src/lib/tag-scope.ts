import 'server-only';
import { Prisma } from '@prisma/client';
import { currentModelVersion } from './classification-version';
import { TAG_HISTORY_LIMIT } from './tag-policy';
import type { WorkspaceId } from './workspace-selection';

/** SQL aliases must be e (emails) and t (tags). Workers only use the saved history snapshot. */
export function tagMatchScope() {
  return Prisma.sql`(e."createdAt" >= t."matchFrom" OR e.id IN (SELECT value FROM json_each(t."historyEmailIds")))`;
}

/** A manual check is one durable batch of pending emails across the selected tags. */
export async function capturePendingTagHistory(
  tx: Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>,
  userId: string,
  workspace: WorkspaceId,
  tagId?: string,
) {
  // SQLite serializes writers, so the transaction itself orders this against email inserts.
  const pending = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT e.id FROM emails e
    WHERE e."userId"=${userId} AND e.workspace=${workspace}
      AND e."inInbox"=true AND EXISTS (
        SELECT 1 FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
          ${tagId ? Prisma.sql`AND t.id=${tagId}` : Prisma.empty}
          AND NOT EXISTS (
            SELECT 1 FROM email_classifications c WHERE c."emailId"=e.id AND c."tagId"=t.id
              AND c."userId"=e."userId" AND c.workspace=e.workspace AND c."tagVersion"=t.version
              AND e."contentHash"<>'' AND c."contentHash"=e."contentHash"
              AND c."modelVersion"=${currentModelVersion()}
          )
      ) ORDER BY e."receivedAt" DESC,e.id DESC LIMIT ${TAG_HISTORY_LIMIT}`);
  await tx.$executeRaw(Prisma.sql`
    UPDATE tags SET "matchFrom"=${new Date()},"historyEmailIds"=${JSON.stringify(pending.map((row) => row.id))}
    WHERE "userId"=${userId} AND workspace=${workspace}
      ${tagId ? Prisma.sql`AND id=${tagId}` : Prisma.empty}`);
}
