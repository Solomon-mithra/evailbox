import 'server-only';
import { db } from './db';
import { bodyKey, type TransientBodies } from './transient-bodies';
import { Prisma, type Tag } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { currentModelVersion, type ClassificationInput } from './classification-version';
import type { Classification } from './jev';
import { classifyEmailAgainstTags } from './jev';
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
type Evaluated = {
  email: EmailSnapshot;
  tags: Tag[];
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
  return Prisma.sql`e."userId"=${userId}::uuid AND e.workspace=${workspace}::"WorkspaceKind" AND e."inInbox"=true AND e."contentHash"<>''
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
  const rows = await db.$queryRaw<{ notBefore: Date }[]>(
    Prisma.sql`SELECT "notBefore" AT TIME ZONE 'UTC' AS "notBefore" FROM processing_state WHERE id='jev'`,
  );
  return Math.max(0, Math.ceil(((rows[0]?.notBefore.getTime() ?? 0) - Date.now()) / 1000));
}
async function setCooldown(userId: string, delay: number) {
  const retryAt = new Date(Date.now() + delay * 1000).toISOString();
  const rows = await db.$queryRaw<{ notBefore: Date }[]>(Prisma.sql`
    INSERT INTO processing_state(id,"notBefore") VALUES('jev',${retryAt}::timestamp)
    ON CONFLICT(id) DO UPDATE SET "notBefore"=GREATEST(processing_state."notBefore",EXCLUDED."notBefore")
    RETURNING "notBefore" AT TIME ZONE 'UTC' AS "notBefore"`);
  await db.$executeRaw(
    Prisma.sql`UPDATE users SET "workRequested"=true,"workNotBefore"=GREATEST("workNotBefore",${rows[0].notBefore.toISOString()}::timestamp) WHERE id=${userId}::uuid`,
  );
  return Math.max(delay, Math.ceil((rows[0].notBefore.getTime() - Date.now()) / 1000));
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
      // Stable lock order avoids two workers acquiring the same rows in opposite order.
      const ids = [...new Set(evaluated.flatMap((item) => item.tags.map((tag) => tag.id)))].sort();
      const tags = await tx.$queryRaw<{ id: string; version: number }[]>(
        Prisma.sql`SELECT id,version FROM tags WHERE "userId"=${userId}::uuid AND workspace=${workspace}::"WorkspaceKind" AND id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
      );
      const emails = await tx.$queryRaw<
        Pick<
          EmailSnapshot,
          'id' | 'contentHash' | 'firstClassifiedAt' | 'inInbox' | 'eligibleTagIds'
        >[]
      >(
        Prisma.sql`SELECT e.id,e."contentHash",e."firstClassifiedAt",e."inInbox",
          ARRAY(SELECT t.id FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
            AND t.id IN (${Prisma.join(ids)}) AND ${tagMatchScope()}) AS "eligibleTagIds"
          FROM emails e WHERE e."userId"=${userId}::uuid AND e.workspace=${workspace}::"WorkspaceKind" AND e.id IN (${Prisma.join(evaluated.map((item) => item.email.id).sort())}) ORDER BY e.id FOR UPDATE`,
      );
      if (currentModelVersion() !== modelVersion) return none;
      const rows: Prisma.Sql[] = [],
        accepted: { id: string; hash: string }[] = [];
      let firstClassifications = 0;
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
        if (!email.firstClassifiedAt) firstClassifications++;
        for (const tag of valid) {
          const result = item.results[tag.id];
          rows.push(
            Prisma.sql`(${randomUUID()},${userId}::uuid,${workspace}::"WorkspaceKind",${email.id},${tag.id},${tag.version},${item.hash},${modelVersion},${result.matched},${result.confidence},${result.decision},${result.reasoning})`,
          );
        }
      }
      if (!rows.length) return none;
      await tx.$executeRaw(Prisma.sql`INSERT INTO email_classifications(id,"userId",workspace,"emailId","tagId","tagVersion","contentHash","modelVersion",matched,confidence,decision,reasoning)
      VALUES ${Prisma.join(rows)} ON CONFLICT("emailId","tagId") DO UPDATE SET "tagVersion"=EXCLUDED."tagVersion","contentHash"=EXCLUDED."contentHash","modelVersion"=EXCLUDED."modelVersion",matched=EXCLUDED.matched,confidence=EXCLUDED.confidence,decision=EXCLUDED.decision,reasoning=EXCLUDED.reasoning`);
      await tx.$executeRaw(Prisma.sql`UPDATE emails e SET "contentHash"=v.hash,"firstClassifiedAt"=COALESCE(e."firstClassifiedAt",CURRENT_TIMESTAMP)
      FROM (VALUES ${Prisma.join(accepted.map((item) => Prisma.sql`(${item.id},${item.hash})`))}) AS v(id,hash) WHERE e.id=v.id AND e."userId"=${userId}::uuid AND e.workspace=${workspace}::"WorkspaceKind"`);
      if (firstClassifications)
        await tx.$executeRaw(Prisma.sql`INSERT INTO monthly_usage("userId",month,emails) VALUES(${userId}::uuid,date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,${firstClassifications})
      ON CONFLICT("userId",month) DO UPDATE SET emails=monthly_usage.emails+EXCLUDED.emails`);
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
  const tags = await db.tag.findMany({
    where: { userId, workspace, ...(options.tagId ? { id: options.tagId } : {}) },
    take: 30,
  });
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
    const emails = await db.$queryRaw<
      EmailSnapshot[]
    >(Prisma.sql`SELECT e.id,e."accountId",e."providerMessageId",e.subject,e.sender,e.snippet,e."contentHash",e."firstClassifiedAt",e."inInbox",
      ARRAY(SELECT t.id FROM tags t WHERE t."userId"=e."userId" AND t.workspace=e.workspace
        AND t.id IN (${Prisma.join(tags.map((tag) => tag.id))}) AND ${tagMatchScope()}) AS "eligibleTagIds",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('tagId',c."tagId",'tagVersion',c."tagVersion",'contentHash',c."contentHash",'modelVersion',c."modelVersion")) FROM email_classifications c WHERE c."emailId"=e.id AND c."userId"=e."userId" AND c.workspace=e.workspace),'[]'::jsonb) AS classifications
      FROM emails e WHERE ${selection} ORDER BY e."receivedAt" DESC,e.id DESC LIMIT ${budget.remaining}`);
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
  const [count] = await db.$queryRaw<{ remaining: number }[]>(
    Prisma.sql`SELECT count(*)::int AS remaining FROM emails e WHERE ${where}`,
  );
  const remaining = Math.max(count.remaining, unsaved);
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
