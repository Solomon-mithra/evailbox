import { withAccountLock } from '@/lib/providers/credentials';
import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { requireUser, supabaseServer, adminAuth } from '@/lib/auth';
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
import { requestWork, requestDailySync } from '@/lib/work-queue';
import { publishUserWork, recoverPendingWork } from '@/lib/inngest/dispatch';
import { backgroundConfigured } from '@/lib/inngest/client';
import { POST as queueSync } from '@/app/api/sync/route';
import { constantTimeEqual, decrypt } from '@/lib/crypto';
import { isDemo } from '@/lib/env';
import { workspaceIds } from '@/lib/workspace-selection';
import {
  cleanupMailboxSubscription,
  requestMailboxSubscriptionRenewal,
} from '@/lib/mailbox-subscriptions';
import { emailContentResponse } from '@/lib/email-content';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function dispatch(request: Request) {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\//, ''),
    method = request.method;
  if (path === 'health' && method === 'GET')
    return ok({ status: 'ok', mode: isDemo() ? 'demo' : 'live' });
  if (path.startsWith('cron/') && method === 'GET') {
    if (
      !process.env.CRON_SECRET ||
      !constantTimeEqual(
        request.headers.get('authorization') ?? '',
        `Bearer ${process.env.CRON_SECRET}`,
      )
    )
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid cron authorization.');
    if (isDemo()) return ok({ skipped: true, reason: 'demo' });
    if (path === 'cron/work') return ok(await recoverPendingWork());
    if (path === 'cron/sync') {
      await requestDailySync();
      return ok(await recoverPendingWork());
    }
    throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
  }
  if (isDemo())
    throw new ApiError(503, 'DEMO_MODE', 'This action needs a configured live workspace.');
  if (path === 'auth/signin' && method === 'POST') {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url)
      throw new ApiError(502, 'AUTH_FAILED', 'Google sign-in is temporarily unavailable.');
    return ok({ url: data.url });
  }
  if (path === 'auth/callback' && method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code)
      return NextResponse.redirect(new URL('/signin?error=oauth', process.env.NEXT_PUBLIC_APP_URL));
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return NextResponse.redirect(
      new URL(error ? '/signin?error=oauth' : '/callback', process.env.NEXT_PUBLIC_APP_URL),
    );
  }
  const user = await requireUser();
  if (path === 'auth/me' && method === 'GET') return ok(user);
  if (path === 'auth/signout' && method === 'POST') {
    const { error } = await (await supabaseServer()).auth.signOut();
    if (error) throw new ApiError(502, 'SIGNOUT_FAILED', 'Could not sign out.');
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
    after(async () => {
      await publishUserWork(user.id);
    });
    return ok(
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
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
      }),
      201,
    );
  }
  if (/^tags\/[^/]+$/.test(path)) {
    const id = idSchema.parse(path.split('/')[1]);
    const tag = await db.tag.findFirst({ where: { id, userId: user.id, workspace } });
    if (!tag) throw new ApiError(404, 'NOT_FOUND', 'Tag not found.');
    if (method === 'GET') return ok(tag);
    if (method === 'PATCH') {
      const patch = tagSchema.partial().parse(await jsonBody(request));
      after(async () => {
        await publishUserWork(user.id);
      });
      return ok(
        await db.$transaction(async (tx) => {
          const updated = await tx.tag.update({
            where: { id, userId: user.id, workspace },
            data: {
              ...patch,
              ...(patch.name ? { nameKey: patch.name.toLowerCase() } : {}),
              version: { increment: 1 },
            },
          });
          await tx.emailClassification.deleteMany({
            where: { tagId: id, userId: user.id, workspace },
          });
          await tx.user.update({
            where: { id: user.id },
            data: {
              workRequested: true,
              workRevision: { increment: 1 },
            },
          });
          return updated;
        }),
      );
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
    return action === 'auth'
      ? beginConnection(p, user.id, workspace)
      : finishConnection(p, user.id, url);
  }
  if (/^accounts\/[^/]+$/.test(path) && method === 'DELETE') {
    const id = idSchema.parse(path.split('/')[1]);
    const account = await db.emailAccount.findFirst({
      where: { id, userId: user.id, workspace },
      select: { id: true },
    });
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    await withAccountLock(user.id, workspace, id, async (fresh) => {
      // Disconnect must remain possible even when provider credentials are invalid.
      try {
        await cleanupMailboxSubscription(user.id, id, Date.now() + 10000, {
          account: fresh,
          token: decrypt(fresh.accessToken),
        });
      } catch {
        /* best effort */
      }
      try {
        await db.emailAccount.deleteMany({
          where: { id, userId: user.id, workspace, syncLeaseId: fresh.syncLeaseId },
        });
      } catch (error) {
        await requestMailboxSubscriptionRenewal(user.id, id, workspace).catch(() => undefined);
        throw error;
      }
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
    // Persist a rerun request by removing selected cached decisions before waking the worker.
    if (ids?.length)
      await db.emailClassification.deleteMany({
        where: {
          userId: user.id,
          workspace,
          emailId: { in: ids },
          ...(data.tagId ? { tagId: data.tagId } : {}),
        },
      });
    await requestWork(user.id);
    after(async () => {
      await publishUserWork(user.id);
    });
    return ok({ queued: true, pending: true, workerAvailable: backgroundConfigured() }, 202);
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
  if (path === 'user' && method === 'DELETE') {
    const { confirm } = z.object({ confirm: z.literal('DELETE') }).parse(await jsonBody(request));
    void confirm;
    await db.user.deleteMany({ where: { id: user.id } });
    const { error } = await adminAuth().deleteUser(user.id);
    if (error)
      throw new ApiError(502, 'DELETE_FAILED', 'Account deletion could not finish. Try again.');
    await (await supabaseServer()).auth.signOut();
    return ok({ deleted: true });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
}
export const GET = route(dispatch);
export const POST = route(dispatch);
export const PATCH = route(dispatch);
export const DELETE = route(dispatch);
