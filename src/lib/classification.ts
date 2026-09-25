import 'server-only';
import { db } from './db';
import { classifyEmailAgainstTags } from './jev';
import { ApiError } from './errors';
import { workspaceIds, type WorkspaceId } from './workspace-selection';
type BatchResult = {
  classified: number;
  errors: number;
  remaining: number;
  rateLimited?: true;
  retryAfterSeconds?: number;
};

/** Extract only safe metadata; SDK errors can contain the entire private email request. */
function evaluationFailure(error: unknown) {
  let statusCode: number | undefined, generationId: string | undefined, delay: number | undefined;
  const seen = new Set<unknown>();
  for (
    let depth = 0;
    depth < 8 && error && typeof error === 'object' && !seen.has(error);
    depth++
  ) {
    seen.add(error);
    const value = error as Record<string, unknown>;
    if (
      typeof value.statusCode === 'number' &&
      Number.isInteger(value.statusCode) &&
      value.statusCode >= 400 &&
      value.statusCode <= 599
    )
      statusCode ??= value.statusCode;
    if (
      typeof value.generationId === 'string' &&
      /^gen_[a-zA-Z0-9_]{1,100}$/.test(value.generationId)
    )
      generationId ??= value.generationId;
    if (value.responseHeaders && typeof value.responseHeaders === 'object') {
      const headers = value.responseHeaders as Record<string, unknown>;
      const ms = headers['retry-after-ms'];
      const after = headers['retry-after'];
      const candidate =
        typeof ms === 'string' && ms.trim() && Number.isFinite(Number(ms))
          ? Number(ms) / 1000
          : typeof after === 'string' && after.trim()
            ? Number.isFinite(Number(after))
              ? Number(after)
              : (Date.parse(after) - Date.now()) / 1000
            : NaN;
      // Stay inside the range representable by a Date when persisting the cooldown.
      if (Number.isFinite(candidate) && candidate >= 0 && candidate < (8.64e15 - Date.now()) / 1000)
        delay = Math.max(delay ?? 0, Math.ceil(candidate));
    }
    error = value.lastError ?? value.cause;
  }
  return {
    statusCode,
    generationId,
    ...(statusCode === 429 ? { retryAfterSeconds: Math.max(60, delay ?? 0) } : {}),
  };
}

export async function classifyEmails(
  userId: string,
  options: {
    emailIds?: string[];
    tagId?: string;
    force?: boolean;
    deadline?: number;
    workspace?: WorkspaceId;
  } = {},
): Promise<BatchResult> {
  const deadline = options.deadline ?? Date.now() + 40000;
  if (!options.workspace) {
    let classified = 0,
      errors = 0,
      remaining = 0,
      retryAfterSeconds = 0;
    for (const workspace of workspaceIds) {
      // Count the other workspace's backlog, but make no more model calls after a 429.
      const result = await classifyEmails(userId, {
        ...options,
        workspace,
        deadline: retryAfterSeconds ? 0 : deadline,
      });
      classified += result.classified;
      errors += result.errors;
      remaining += result.remaining;
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds ?? 0);
    }
    return {
      classified,
      errors,
      remaining,
      ...(retryAfterSeconds ? ({ rateLimited: true, retryAfterSeconds } as const) : {}),
    };
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
    remaining = 0,
    retryAfterSeconds = 0;
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
    } catch (error) {
      errors++;
      const failure = evaluationFailure(error);
      console.warn(JSON.stringify({ event: 'classification_failed', ...failure }));
      if (failure.statusCode === 429) {
        retryAfterSeconds = failure.retryAfterSeconds!;
        const retryAt = new Date(Date.now() + retryAfterSeconds * 1000);
        await db.user.updateMany({
          where: { id: userId, workNotBefore: { lt: retryAt } },
          data: { workRequested: true, workNotBefore: retryAt },
        });
        break;
      }
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
  return {
    classified,
    errors,
    remaining: Math.max(remaining, backlog),
    ...(retryAfterSeconds ? ({ rateLimited: true, retryAfterSeconds } as const) : {}),
  };
}
