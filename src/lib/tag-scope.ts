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
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  userId: string,
  workspace: WorkspaceId,
  tagId?: string,
) {
  // One statement: it takes SQLite's write lock before reading, so the snapshot cannot miss
  // a page that commits between a separate read and write. Email arrival stamps come from the
  // emails_stamp_arrival trigger under the same lock.
  await tx.$executeRaw(Prisma.sql`
    UPDATE tags SET "matchFrom"=CAST(unixepoch('subsec') * 1000 AS INTEGER), "historyEmailIds"=(
      SELECT json_group_array(id) FROM (
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
          ) ORDER BY e."receivedAt" DESC,e.id DESC LIMIT ${TAG_HISTORY_LIMIT}
      ))
    WHERE "userId"=${userId} AND workspace=${workspace}
      ${tagId ? Prisma.sql`AND id=${tagId}` : Prisma.empty}`);
}
