import { withAccountLock } from '@/lib/providers/credentials';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import {
  SESSION_COOKIE,
  checkPassword,
  createSessionToken,
  passwordProtected,
} from '@/lib/session';
import { db } from '@/lib/db';
import { route, ok, ApiError, jsonBody } from '@/lib/errors';
import { tagSchema, preferencesSchema, classifySchema, idSchema } from '@/lib/validation';
import {
  getWorkspace,
  getWorkspaceMetadata,
  getWorkspaceSettings,
  publicAccount,
  publicPrefs,
} from '@/lib/workspace';
import { getInbox, getInboxCounts } from '@/lib/inbox';
import { beginConnection, finishConnection } from '@/lib/oauth';
import { kickWork } from '@/lib/background';
import { requestWork } from '@/lib/work-queue';
import { appSettingsSchema, publicAppSettings, updateAppSettings } from '@/lib/app-settings';
import { POST as queueSync } from '@/app/api/sync/route';
import { appUrl, isDemo } from '@/lib/env';
import { workspaceIds } from '@/lib/workspace-selection';
import { emailContentResponse } from '@/lib/email-content';
import { capturePendingTagHistory, tagMatchScope } from '@/lib/tag-scope';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Scope snapshots may wait for an import page's transaction (up to 20 seconds).
const tagTransactionOptions = { maxWait: 5000, timeout: 30000 };
async function dispatch(request: Request) {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\//, ''),
    method = request.method;
  if (path === 'health' && method === 'GET')
    return ok({ status: 'ok', mode: isDemo() ? 'demo' : 'live' });
  if (isDemo())
    throw new ApiError(503, 'DEMO_MODE', 'This action needs a configured live workspace.');
  if (path === 'auth/signin' && method === 'POST') {
    const { password } = z.object({ password: z.string().max(500) }).parse(await jsonBody(request));
    if (!passwordProtected() || !(await checkPassword(password))) {
      // ponytail: fixed delay, not a lockout; put a rate-limiting proxy in front if exposed publicly.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      throw new ApiError(401, 'INVALID_PASSWORD', 'That password is not correct.');
    }
    const { token, maxAge } = await createSessionToken();
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: appUrl().startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    return ok({ signedIn: true });
  }
  const user = await requireUser();
  if (path === 'auth/me' && method === 'GET') return ok(user);
  if (path === 'auth/signout' && method === 'POST') {
    (await cookies()).delete(SESSION_COOKIE);
    return ok({ signedOut: true });
  }
  const workspace = z.enum(workspaceIds).parse(url.searchParams.get('workspace') ?? 'PERSONAL');
  if (/^emails\/[^/]+\/content$/.test(path) && method === 'GET')
    return emailContentResponse(
      user.id,
      workspace,
      idSchema.parse(path.split('/')[1]),
      url.searchParams.get('images') === '1',
    );
  if (path === 'inbox' && method === 'GET') return ok(await getInbox(user, url.searchParams));
  if (path === 'workspace/metadata' && method === 'GET')
    return ok(await getWorkspaceMetadata(user, url.searchParams));
  if (path === 'workspace/counts' && method === 'GET')
    return ok(await getInboxCounts(user, url.searchParams));
  if (path === 'workspace/settings' && method === 'GET')
    return ok(await getWorkspaceSettings(user));
  if (path === 'workspace' && method === 'GET')
    return ok(await getWorkspace(user, url.searchParams));
  if (path === 'tags' && method === 'GET')
    return ok(
      await db.tag.findMany({
        where: { userId: user.id, workspace },
        orderBy: { createdAt: 'asc' },
      }),
    );
  if (path === 'tags' && method === 'POST') {
    const data = tagSchema.parse(await jsonBody(request));
    const created = await db.$transaction(async (tx) => {
      if ((await tx.tag.count({ where: { userId: user.id, workspace } })) >= 30)
        throw new ApiError(409, 'TAG_LIMIT', 'You can create up to 30 tags.');
      const created = await tx.tag.create({
        data: { ...data, userId: user.id, workspace, nameKey: data.name.toLowerCase() },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          workRequested: true,
          workRevision: { increment: 1 },
        },
      });
      return created;
    }, tagTransactionOptions);
    kickWork();
    return ok(created, 201);
  }
  if (/^tags\/[^/]+$/.test(path)) {
    const id = idSchema.parse(path.split('/')[1]);
    const tag = await db.tag.findFirst({ where: { id, userId: user.id, workspace } });
    if (!tag) throw new ApiError(404, 'NOT_FOUND', 'Tag not found.');
    if (method === 'GET') return ok(tag);
    if (method === 'PATCH') {
      const patch = tagSchema.partial().parse(await jsonBody(request));
      const updated = await db.$transaction(async (tx) => {
        const current = await tx.tag.findUniqueOrThrow({
          where: { id, userId: user.id, workspace },
        });
        const matchingChanged = (['name', 'prompt', 'keywords', 'senders'] as const).some(
          (key) =>
            patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(current[key]),
        );
        const updated = await tx.tag.update({
          where: { id, userId: user.id, workspace },
          data: {
            ...patch,
            ...(patch.name ? { nameKey: patch.name.toLowerCase() } : {}),
            ...(matchingChanged ? { version: { increment: 1 } } : {}),
          },
        });
        if (matchingChanged) {
          await tx.emailClassification.deleteMany({
            where: { tagId: id, userId: user.id, workspace },
          });
          await tx.user.update({
            where: { id: user.id },
            data: { workRequested: true, workRevision: { increment: 1 } },
          });
        }
        return updated;
      }, tagTransactionOptions);
      kickWork();
      return ok(updated);
    }
    if (method === 'DELETE') {
      await db.tag.delete({ where: { id, userId: user.id, workspace } });
      return ok({ deleted: true });
    }
  }
  if (path === 'accounts' && method === 'GET')
    return ok(
      await db.emailAccount.findMany({
        where: { userId: user.id, workspace },
        select: publicAccount,
      }),
    );
  if (/^accounts\/(gmail|outlook)\/(auth|callback)$/.test(path) && method === 'GET') {
    const [, provider, action] = path.split('/');
    const p = provider === 'gmail' ? 'GMAIL' : 'OUTLOOK';
    if (action === 'callback') return finishConnection(p, user.id, url);
    try {
      return await beginConnection(p, user.id, workspace);
    } catch (error) {
      // Browser navigation: send the user to the missing keys instead of a JSON error.
      if (error instanceof ApiError && error.code.endsWith('_NOT_CONFIGURED'))
        return NextResponse.redirect(new URL(`/settings?setup=${provider}`, appUrl()));
      throw error;
    }
  }
  if (/^accounts\/[^/]+$/.test(path) && method === 'DELETE') {
    const id = idSchema.parse(path.split('/')[1]);
    const account = await db.emailAccount.findFirst({
      where: { id, userId: user.id, workspace },
      select: { id: true },
    });
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    await withAccountLock(user.id, workspace, id, async (fresh) => {
      await db.emailAccount.deleteMany({
        where: { id, userId: user.id, workspace, syncLeaseId: fresh.syncLeaseId },
      });
    });
    return ok({ deleted: true });
  }
  if (path === 'sync' && method === 'POST') return queueSync(request);
  if ((path === 'classify' || path === 'classify/batch') && method === 'POST') {
    const data = classifySchema.parse(await jsonBody(request));
    if (path === 'classify' && !data.emailId)
      throw new ApiError(400, 'EMAIL_REQUIRED', 'Choose an email.');
    const ids = data.emailId ? [data.emailId] : data.emailIds;
    if (
      ids &&
      (await db.email.count({ where: { id: { in: ids }, userId: user.id, workspace } })) !==
        new Set(ids).size
    )
      throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
    if (
      data.tagId &&
      !(await db.tag.findFirst({ where: { id: data.tagId, userId: user.id, workspace } }))
    )
      throw new ApiError(404, 'NOT_FOUND', 'Tag not found.');
    await db.$transaction(async (tx) => {
      if (!ids) {
        await capturePendingTagHistory(tx, user.id, workspace, data.tagId);
      } else if (ids.length) {
        // Explicit reruns must not erase old matches that the worker is no longer allowed to check.
        await tx.$executeRaw(Prisma.sql`DELETE FROM email_classifications WHERE id IN (
          SELECT c.id FROM email_classifications c JOIN emails e ON c."emailId"=e.id JOIN tags t ON c."tagId"=t.id
          WHERE c."userId"=e."userId"
            AND c.workspace=e.workspace AND t."userId"=e."userId" AND t.workspace=e.workspace
            AND e."userId"=${user.id} AND e.workspace=${workspace}
            AND e.id IN (${Prisma.join(ids)}) AND ${tagMatchScope()}
            ${data.tagId ? Prisma.sql`AND t.id=${data.tagId}` : Prisma.empty})`);
      }
      await tx.user.update({
        where: { id: user.id },
        data: { workRequested: true, workRevision: { increment: 1 } },
      });
    }, tagTransactionOptions);
    kickWork();
    return ok({ queued: true, pending: true, workerAvailable: true }, 202);
  }
  if (path === 'emails' && method === 'GET') return ok(await getWorkspace(user, url.searchParams));
  if (/^emails\/[^/]+$/.test(path)) {
    const id = path.split('/')[1];
    if (method === 'GET') {
      const email = await db.email.findFirst({
        where: { id, userId: user.id, workspace },
        include: {
          classifications: {
            include: { tag: { select: { id: true, name: true, priority: true, version: true } } },
          },
        },
      });
      if (!email) throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
      return ok({
        ...email,
        classifications: email.classifications.filter((c) => c.tagVersion === c.tag.version),
      });
    }
    if (method === 'PATCH') {
      const data = z
        .object({ handled: z.boolean() })
        .strict()
        .parse(await jsonBody(request));
      const result = await db.email.updateMany({ where: { id, userId: user.id, workspace }, data });
      if (!result.count) throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
      return ok({ updated: true });
    }
  }
  if (path === 'settings' && method === 'GET') return ok(await getWorkspaceSettings(user));
  if (path === 'settings' && method === 'PATCH') {
    const data = preferencesSchema.parse(await jsonBody(request));
    return ok(
      await db.notificationPref.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...data },
        update: data,
        select: publicPrefs,
      }),
    );
  }
  if (path === 'app-settings' && method === 'GET') return ok(await publicAppSettings());
  if (path === 'app-settings' && method === 'PATCH') {
    const patch = appSettingsSchema.parse(await jsonBody(request));
    const saved = await updateAppSettings(patch);
    // A new AI key unblocks tagging for everything already imported.
    if (patch.jevApiKey) {
      await requestWork(user.id);
      kickWork();
    }
    return ok(saved);
  }
  if (path === 'user' && method === 'DELETE') {
    const { confirm } = z.object({ confirm: z.literal('DELETE') }).parse(await jsonBody(request));
    void confirm;
    // Resets all mail data; OAuth keys in Settings are kept. The owner row is recreated on demand.
    await db.user.deleteMany({ where: { id: user.id } });
    return ok({ deleted: true });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
}
export const GET = route(dispatch);
export const POST = route(dispatch);
export const PATCH = route(dispatch);
export const DELETE = route(dispatch);
