import 'server-only';
import { db } from './db';
import { bodyKey, type TransientBodies } from './transient-bodies';
import { Prisma, type Tag } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { currentModelVersion, type ClassificationInput } from './classification-version';
import type { Classification } from './jev';
import { classifyEmailAgainstTags } from './jev';
import { jevApiKey } from './app-settings';
import { ApiError } from './errors';
import { fetchMessageText } from './providers/content';
import { withAccountCredentials } from './providers/credentials';
import { withProviderDeadline } from './providers/http';
import type { Provider } from './providers/types';
import { workspaceIds, type WorkspaceId } from './workspace-selection';
import { tagMatchScope } from './tag-scope';
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

export function classificationConcurrency() {
  const value = Number(process.env.JEV_CONCURRENCY ?? 4);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.floor(value))) : 4;
}
type EmailSnapshot = Omit<ClassificationInput, 'body'> & {
  id: string;
  accountId: string;
  providerMessageId: string;
  contentHash: string;
  firstClassifiedAt: Date | null;
  inInbox: boolean;
  eligibleTagIds: string[];
  classifications: {
    tagId: string;
    tagVersion: number;
    contentHash: string;
    modelVersion: string;
  }[];
};
type ClassifiableTag = Omit<Tag, 'keywords' | 'senders'> & {
  keywords: string[];
  senders: string[];
};
type Evaluated = {
  email: EmailSnapshot;
  tags: ClassifiableTag[];
  hash: string;
  results: Record<string, Classification>;
};
function backlogWhere(
  userId: string,
  workspace: WorkspaceId,
  tagIds: string[],
  modelVersion: string,
  emailIds?: string[],
  force = false,
) {
  // Unhashed rows wait for sync; a blank hash can never be recorded as current.
  return Prisma.sql`e."userId"=${userId} AND e.workspace=${workspace} AND e."inInbox"=true AND e."contentHash"<>''
    ${emailIds ? Prisma.sql`AND e.id IN (${Prisma.join(emailIds.length ? emailIds : [''])})` : Prisma.empty}
    AND EXISTS (SELECT 1 FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace AND t.id IN (${Prisma.join(tagIds)})
      AND ${tagMatchScope()}
      ${
        force
          ? Prisma.empty
          : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM email_classifications c WHERE c."emailId"=e.id AND c."tagId"=t.id
        AND c."userId"=e."userId" AND c.workspace=e.workspace AND c."tagVersion"=t.version
        AND e."contentHash"<>'' AND c."contentHash"=e."contentHash" AND c."modelVersion"=${modelVersion})`
      })`;
}
async function readCooldown() {
  const state = await db.processingState.findUnique({ where: { id: 'jev' } });
  return Math.max(0, Math.ceil(((state?.notBefore.getTime() ?? 0) - Date.now()) / 1000));
}
async function setCooldown(userId: string, delay: number) {
  const retryAt = new Date(Date.now() + delay * 1000);
  const notBefore = await db.$transaction(async (tx) => {
    const current = await tx.processingState.findUnique({ where: { id: 'jev' } });
    const notBefore = current && current.notBefore > retryAt ? current.notBefore : retryAt;
    await tx.processingState.upsert({
      where: { id: 'jev' },
      create: { id: 'jev', notBefore },
      update: { notBefore },
    });
    await tx.user.updateMany({ where: { id: userId }, data: { workRequested: true } });
    await tx.user.updateMany({
      where: { id: userId, workNotBefore: { lt: notBefore } },
      data: { workNotBefore: notBefore },
    });
    return notBefore;
  });
  return Math.max(delay, Math.ceil((notBefore.getTime() - Date.now()) / 1000));
}
function metric(
  event: 'classification_batch' | 'classification_completed',
  values: {
    durationMs: number;
    attempted: number;
    classified: number;
    errors: number;
    remaining?: number;
  },
) {
  console.info(JSON.stringify({ event, ...values }));
}
async function saveWave(
  userId: string,
  workspace: WorkspaceId,
  evaluated: Evaluated[],
  modelVersion: string,
  deadline: number,
) {
  const none = { saved: 0, accepted: 0 };
  if (!evaluated.length || currentModelVersion() !== modelVersion || deadline - Date.now() < 1500)
    return none;
  const budget = deadline - Date.now() - 500;
  return db.$transaction(
    async (tx) => {
      // SQLite serializes write transactions, so no row locks are needed here.
      const ids = [...new Set(evaluated.flatMap((item) => item.tags.map((tag) => tag.id)))].sort();
      const tags = await tx.$queryRaw<{ id: string; version: number }[]>(
        Prisma.sql`SELECT id,version FROM tags WHERE "userId"=${userId} AND workspace=${workspace} AND id IN (${Prisma.join(ids)})`,
      );
      const emails = (
        await tx.$queryRaw<
          (Pick<EmailSnapshot, 'id' | 'contentHash' | 'firstClassifiedAt' | 'inInbox'> & {
            eligibleTagIds: string;
          })[]
        >(
          Prisma.sql`SELECT e.id,e."contentHash",e."firstClassifiedAt",e."inInbox",
          (SELECT json_group_array(t.id) FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
            AND t.id IN (${Prisma.join(ids)}) AND ${tagMatchScope()}) AS "eligibleTagIds"
          FROM emails e WHERE e."userId"=${userId} AND e.workspace=${workspace} AND e.id IN (${Prisma.join(evaluated.map((item) => item.email.id))})`,
        )
      ).map((row) => ({ ...row, eligibleTagIds: JSON.parse(row.eligibleTagIds) as string[] }));
      if (currentModelVersion() !== modelVersion) return none;
      const rows: Prisma.Sql[] = [],
        accepted: { id: string; hash: string }[] = [];
      for (const item of evaluated) {
        const email = emails.find((row) => row.id === item.email.id);
        // Sync rewrites the hash when the message changes; reject results for older content.
        if (!email?.inInbox || email.contentHash !== item.hash) continue;
        const valid = item.tags.filter(
          (tag) =>
            email.eligibleTagIds.includes(tag.id) &&
            tags.some((current) => current.id === tag.id && current.version === tag.version),
        );
        if (!valid.length) continue;
        accepted.push({ id: email.id, hash: item.hash });
        for (const tag of valid) {
          const result = item.results[tag.id];
          rows.push(
            Prisma.sql`(${randomUUID()},${userId},${workspace},${email.id},${tag.id},${tag.version},${item.hash},${modelVersion},${result.matched},${result.confidence},${result.decision},${result.reasoning})`,
          );
        }
      }
      if (!rows.length) return none;
      await tx.$executeRaw(Prisma.sql`INSERT INTO email_classifications(id,"userId",workspace,"emailId","tagId","tagVersion","contentHash","modelVersion",matched,confidence,decision,reasoning)
      VALUES ${Prisma.join(rows)} ON CONFLICT("emailId","tagId") DO UPDATE SET "tagVersion"=excluded."tagVersion","contentHash"=excluded."contentHash","modelVersion"=excluded."modelVersion",matched=excluded.matched,confidence=excluded.confidence,decision=excluded.decision,reasoning=excluded.reasoning`);
      for (const item of accepted) {
        const scope = { id: item.id, userId, workspace };
        await tx.email.updateMany({ where: scope, data: { contentHash: item.hash } });
        await tx.email.updateMany({
          where: { ...scope, firstClassifiedAt: null },
          data: { firstClassifiedAt: new Date() },
        });
      }
      return { saved: rows.length, accepted: accepted.length };
    },
    { maxWait: 500, timeout: Math.min(10000, budget - 500) },
  );
}

type ClassificationOptions = {
  emailIds?: string[];
  tagId?: string;
  force?: boolean;
  deadline?: number;
  workspace?: WorkspaceId;
  limit?: number;
  bodies?: TransientBodies;
};
export async function classifyEmails(
  userId: string,
  options: ClassificationOptions = {},
): Promise<BatchResult> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 0 || limit > 100)
    throw new Error('Invalid classification batch limit');
  // Tagging is opt-in: without an AI key, mail still imports and nothing is queued for inference.
  if (!(await jevApiKey())) return { classified: 0, errors: 0, remaining: 0 };
  return classifyBatch(userId, options, { remaining: limit });
}
async function classifyBatch(
  userId: string,
  options: ClassificationOptions,
  budget: { remaining: number },
): Promise<BatchResult> {
  const deadline = options.deadline ?? Date.now() + 40000;
  if (!options.workspace) {
    let classified = 0,
      errors = 0,
      remaining = 0,
      retryAfterSeconds = 0;
    for (const workspace of workspaceIds) {
      const result = await classifyBatch(userId, { ...options, workspace, deadline }, budget);
      classified += result.classified;
      errors += result.errors;
      remaining += result.remaining;
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds ?? 0);
    }
    return {
      classified,
      errors,
      remaining,
      ...(retryAfterSeconds ? { rateLimited: true as const, retryAfterSeconds } : {}),
    };
  }
  const started = Date.now(),
    workspace = options.workspace,
    modelVersion = currentModelVersion();
  // Tag lists are Json columns in SQLite; tagSchema guarantees string arrays on write.
  const tags = (
    await db.tag.findMany({
      where: { userId, workspace, ...(options.tagId ? { id: options.tagId } : {}) },
      take: 30,
    })
  ).map((tag) => ({
    ...tag,
    keywords: tag.keywords as string[],
    senders: tag.senders as string[],
  }));
  if (options.tagId && !tags.length) throw new ApiError(404, 'NOT_FOUND', 'Tag not found.');
  if (!tags.length) return { classified: 0, errors: 0, remaining: 0 };
  const where = backlogWhere(
    userId,
    workspace,
    tags.map((tag) => tag.id),
    modelVersion,
    options.emailIds,
  );
  let classified = 0,
    errors = 0,
    attempted = 0,
    retryAfterSeconds = await readCooldown();
  let unsaved = 0;
  if (budget.remaining > 0 && !retryAfterSeconds && Date.now() + 3000 < deadline) {
    const selection = options.force
      ? backlogWhere(
          userId,
          workspace,
          tags.map((tag) => tag.id),
          modelVersion,
          options.emailIds,
          true,
        )
      : where;
    const emails = (
      await db.$queryRaw<
        (Omit<EmailSnapshot, 'eligibleTagIds' | 'classifications'> & {
          eligibleTagIds: string;
          classifications: string;
        })[]
      >(Prisma.sql`SELECT e.id,e."accountId",e."providerMessageId",e.subject,e.sender,e.snippet,e."contentHash",e."firstClassifiedAt",e."inInbox",
      (SELECT json_group_array(t.id) FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
        AND t.id IN (${Prisma.join(tags.map((tag) => tag.id))}) AND ${tagMatchScope()}) AS "eligibleTagIds",
      (SELECT json_group_array(json_object('tagId',c."tagId",'tagVersion',c."tagVersion",'contentHash',c."contentHash",'modelVersion',c."modelVersion")) FROM email_classifications c WHERE c."emailId"=e.id AND c."userId"=e."userId" AND c.workspace=e.workspace) AS classifications
      FROM emails e WHERE ${selection} ORDER BY e."receivedAt" DESC,e.id DESC LIMIT ${budget.remaining}`)
    ).map((row) => ({
      ...row,
      eligibleTagIds: JSON.parse(row.eligibleTagIds) as string[],
      classifications: JSON.parse(row.classifications) as EmailSnapshot['classifications'],
    }));
    const pending = emails
      .map((email) => ({ email, hash: email.contentHash }))
      .map((item) => ({
        ...item,
        tags: tags.filter(
          (tag) =>
            item.email.eligibleTagIds.includes(tag.id) &&
            (options.force ||
              !item.email.classifications.some(
                (c) =>
                  c.tagId === tag.id &&
                  c.tagVersion === tag.version &&
                  c.contentHash === item.hash &&
                  c.modelVersion === modelVersion,
              )),
        ),
      }))
      .filter((item) => item.tags.length);
    // Hold the account lock only while obtaining a fresh token, not during fetches.
    const credentials = new Map<string, Promise<{ provider: Provider; token: string }>>();
    const credentialsFor = (accountId: string) => {
      if (!credentials.has(accountId))
        credentials.set(
          accountId,
          withAccountCredentials(
            userId,
            workspace,
            accountId,
            async (account, token) => ({ provider: account.provider, token }),
            deadline,
          ),
        );
      return credentials.get(accountId)!;
    };
    const concurrency = classificationConcurrency();
    for (let index = 0; index < pending.length; index += concurrency) {
      if (retryAfterSeconds || Date.now() + 3000 >= deadline) break;
      retryAfterSeconds = await readCooldown();
      if (retryAfterSeconds || Date.now() + 3000 >= deadline) break;
      const waveStart = Date.now();
      const wave = pending.slice(index, index + concurrency);
      const outcomes = await Promise.all(
        wave.map(async (item) => {
          attempted++;
          budget.remaining--;
          try {
            const cached = options.bodies?.get(
              bodyKey(item.email.accountId, item.email.providerMessageId),
            );
            let body: string | null;
            if (cached && cached.contentHash === item.hash) {
              body = cached.body;
            } else {
              // Retries and reclassification fetch on demand; bodies never cross steps.
              const { provider, token } = await credentialsFor(item.email.accountId);
              body = await withProviderDeadline(deadline - 2500, () =>
                fetchMessageText(provider, token, item.email.providerMessageId),
              );
            }
            const results = await classifyEmailAgainstTags(
              { ...item.email, body },
              item.tags,
              80,
              Math.min(20000, deadline - Date.now() - 2500),
            );
            if (item.tags.some((tag) => !results[tag.id])) throw new Error('Missing tag decision');
            return { ...item, results };
          } catch (error) {
            errors++;
            unsaved++;
            const failure = evaluationFailure(error);
            console.warn(JSON.stringify({ event: 'classification_failed', ...failure }));
            if (failure.statusCode === 429) {
              retryAfterSeconds = Math.max(retryAfterSeconds, failure.retryAfterSeconds!);
              retryAfterSeconds = Math.max(
                retryAfterSeconds,
                await setCooldown(userId, failure.retryAfterSeconds!),
              );
            }
            return null;
          }
        }),
      );
      const evaluated = outcomes.filter((value): value is Evaluated => value !== null);
      const { saved, accepted } = await saveWave(
        userId,
        workspace,
        evaluated,
        modelVersion,
        deadline,
      );
      classified += saved;
      // Count only the emails this wave rejected, not every email that shared the wave.
      unsaved += evaluated.length - accepted;
      metric('classification_batch', {
        durationMs: Date.now() - waveStart,
        attempted: wave.length,
        classified: saved,
        errors: outcomes.length - evaluated.length,
      });
    }
  }
  const [count] = await db.$queryRaw<{ remaining: bigint }[]>(
    Prisma.sql`SELECT count(*) AS remaining FROM emails e WHERE ${where}`,
  );
  const remaining = Math.max(Number(count.remaining), unsaved);
  metric('classification_completed', {
    durationMs: Date.now() - started,
    attempted,
    classified,
    errors,
    remaining,
  });
  return {
    classified,
    errors,
    remaining,
    ...(retryAfterSeconds ? { rateLimited: true as const, retryAfterSeconds } : {}),
  };
}
