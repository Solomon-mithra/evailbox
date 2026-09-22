import 'server-only';
import { db } from './db';
import { classifyEmailAgainstTags } from './jev';
import { ApiError } from './errors';
import { workspaceIds, type WorkspaceId } from './workspace-selection';
export async function classifyEmails(
  userId: string,
  options: {
    emailIds?: string[];
    tagId?: string;
    force?: boolean;
    deadline?: number;
    workspace?: WorkspaceId;
  } = {},
) {
  const deadline = options.deadline ?? Date.now() + 40000;
  if (!options.workspace) {
    let classified = 0,
      errors = 0,
      remaining = 0;
    for (const workspace of workspaceIds) {
      const result = await classifyEmails(userId, { ...options, workspace, deadline });
      classified += result.classified;
      errors += result.errors;
      remaining += result.remaining;
    }
    return { classified, errors, remaining };
  }
  const workspace = options.workspace;
  const tags = await db.tag.findMany({
    where: { userId, workspace, ...(options.tagId ? { id: options.tagId } : {}) },
    take: 30,
  });
  if (options.tagId && !tags.length) throw new ApiError(404, 'NOT_FOUND', 'Tag not found.');
  if (!tags.length) return { classified: 0, errors: 0, remaining: 0 };
  const emails = await db.email.findMany({
    where: {
      userId,
      workspace,
      ...(options.emailIds
        ? { id: { in: options.emailIds } }
        : {
            OR: tags.map((t) => ({
              classifications: { none: { tagId: t.id, tagVersion: t.version } },
            })),
          }),
    },
    include: { classifications: true },
    orderBy: { receivedAt: 'desc' },
    take: 100,
  });
  let classified = 0,
    errors = 0,
    remaining = 0;
  for (const email of emails) {
    const missing = tags.filter(
      (tag) =>
        options.force ||
        !email.classifications.some((c) => c.tagId === tag.id && c.tagVersion === tag.version),
    );
    if (!missing.length) continue;
    if (Date.now() + 1000 >= deadline) {
      remaining++;
      continue;
    }
    try {
      const results = await classifyEmailAgainstTags(
        email,
        missing,
        80,
        Math.min(20000, deadline - Date.now() - 500),
      );
      for (const tag of missing) {
        const result = results[tag.id];
        if (!result) throw new Error('Missing tag decision');
        const stored = await db.$transaction(async (tx) => {
          const current = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM tags WHERE id=${tag.id} AND "userId"=${userId}::uuid AND version=${tag.version} FOR SHARE`;
          if (!current.length) return false;
          await tx.emailClassification.upsert({
            where: { emailId_tagId: { emailId: email.id, tagId: tag.id } },
            create: {
              userId,
              workspace,
              emailId: email.id,
              tagId: tag.id,
              tagVersion: tag.version,
              ...result,
            },
            update: { tagVersion: tag.version, ...result },
          });
          return true;
        });
        if (stored) classified++;
        else remaining++;
      }
    } catch {
      errors++;
    }
  }
  const backlog = await db.email.count({
    where: {
      userId,
      workspace,
      ...(options.emailIds ? { id: { in: options.emailIds } } : {}),
      OR: tags.map((t) => ({ classifications: { none: { tagId: t.id, tagVersion: t.version } } })),
    },
  });
  return { classified, errors, remaining: Math.max(remaining, backlog) };
}
