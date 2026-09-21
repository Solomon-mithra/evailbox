import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, supabaseServer, adminAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { route, ok, ApiError, jsonBody } from '@/lib/errors';
import { tagSchema, preferencesSchema, classifySchema, idSchema } from '@/lib/validation';
import { getWorkspace, publicAccount, publicPrefs } from '@/lib/workspace';
import { beginConnection, finishConnection } from '@/lib/oauth';
import {
  requestWork,
  requestDailySync,
  processPendingWork,
  processUserWork,
  withUserWorkLease,
} from '@/lib/work-queue';
import { classifyEmails } from '@/lib/classification';
import { sendDigests } from '@/lib/digest';
import { notifyUser } from '@/lib/notifications';
import { constantTimeEqual } from '@/lib/crypto';
import { isDemo } from '@/lib/env';
import { isPushEndpoint } from '@/lib/notification-utils';
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
    if (path === 'cron/digest') return ok(await sendDigests());
    if (path === 'cron/work') return ok(await processPendingWork());
    if (path === 'cron/sync') {
      await requestDailySync();
      return ok(await processPendingWork());
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
  if (path === 'unsubscribe' && method === 'POST') {
    const { token } = z.object({ token: z.uuid() }).parse(await jsonBody(request));
    await db.notificationPref.updateMany({
      where: { unsubscribeToken: token },
      data: { dailyDigest: false },
    });
    return ok({ unsubscribed: true });
  }
  const user = await requireUser();
  if (path === 'auth/me' && method === 'GET') return ok(user);
  if (path === 'auth/signout' && method === 'POST') {
    const { error } = await (await supabaseServer()).auth.signOut();
    if (error) throw new ApiError(502, 'SIGNOUT_FAILED', 'Could not sign out.');
    return ok({ signedOut: true });
  }
  if (path === 'workspace' && method === 'GET')
    return ok(await getWorkspace(user, url.searchParams));
  if (path === 'tags' && method === 'GET')
    return ok(await db.tag.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }));
  if (path === 'tags' && method === 'POST') {
    const data = tagSchema.parse(await jsonBody(request));
    return ok(
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
        if ((await tx.tag.count({ where: { userId: user.id } })) >= 30)
          throw new ApiError(409, 'TAG_LIMIT', 'You can create up to 30 tags.');
        const created = await tx.tag.create({
          data: { ...data, userId: user.id, nameKey: data.name.toLowerCase() },
        });
        await tx.user.update({
          where: { id: user.id },
          data: {
            workRequested: true,
            workRevision: { increment: 1 },
            workNotBefore: new Date(),
            workFailures: 0,
          },
        });
        return created;
      }),
      201,
    );
  }
  if (/^tags\/[^/]+$/.test(path)) {
    const id = idSchema.parse(path.split('/')[1]);
    const tag = await db.tag.findFirst({ where: { id, userId: user.id } });
    if (!tag) throw new ApiError(404, 'NOT_FOUND', 'Tag not found.');
    if (method === 'GET') return ok(tag);
    if (method === 'PATCH') {
      const patch = tagSchema.partial().parse(await jsonBody(request));
      return ok(
        await db.$transaction(async (tx) => {
          const updated = await tx.tag.update({
            where: { id, userId: user.id },
            data: {
              ...patch,
              ...(patch.name ? { nameKey: patch.name.toLowerCase() } : {}),
              version: { increment: 1 },
            },
          });
          await tx.emailClassification.deleteMany({ where: { tagId: id, userId: user.id } });
          await tx.user.update({
            where: { id: user.id },
            data: {
              workRequested: true,
              workRevision: { increment: 1 },
              workNotBefore: new Date(),
              workFailures: 0,
            },
          });
          return updated;
        }),
      );
    }
    if (method === 'DELETE') {
      await db.tag.delete({ where: { id, userId: user.id } });
      return ok({ deleted: true });
    }
  }
  if (path === 'accounts' && method === 'GET')
    return ok(
      await db.emailAccount.findMany({ where: { userId: user.id }, select: publicAccount }),
    );
  if (/^accounts\/(gmail|outlook)\/(auth|callback)$/.test(path) && method === 'GET') {
    const [, provider, action] = path.split('/');
    const p = provider === 'gmail' ? 'GMAIL' : 'OUTLOOK';
    return action === 'auth' ? beginConnection(p, user.id) : finishConnection(p, user.id, url);
  }
  if (/^accounts\/[^/]+$/.test(path) && method === 'DELETE') {
    const result = await db.emailAccount.deleteMany({
      where: { id: path.split('/')[1], userId: user.id },
    });
    if (!result.count) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    return ok({ deleted: true });
  }
  if (path === 'sync' && method === 'POST') {
    const { accountId } = z
      .object({ accountId: idSchema.optional() })
      .strict()
      .parse(await jsonBody(request));
    if (
      accountId &&
      !(await db.emailAccount.findFirst({ where: { id: accountId, userId: user.id } }))
    )
      throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    await requestWork(user.id, { sync: true, accountId });
    try {
      return ok(await processUserWork(user.id));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WORK_IN_PROGRESS')
        return ok({ synced: 0, classified: 0, errors: 0, pending: true, queued: true });
      throw e;
    }
  }
  if ((path === 'classify' || path === 'classify/batch') && method === 'POST') {
    const data = classifySchema.parse(await jsonBody(request));
    if (path === 'classify' && !data.emailId)
      throw new ApiError(400, 'EMAIL_REQUIRED', 'Choose an email.');
    const ids = data.emailId ? [data.emailId] : data.emailIds;
    if (
      ids &&
      (await db.email.count({ where: { id: { in: ids }, userId: user.id } })) !== new Set(ids).size
    )
      throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
    await requestWork(user.id);
    const result = await withUserWorkLease(user.id, () =>
      classifyEmails(user.id, { emailIds: ids, tagId: data.tagId, force: !!ids }),
    );
    await notifyUser(user.id);
    return ok(result);
  }
  if (path === 'emails' && method === 'GET') return ok(await getWorkspace(user, url.searchParams));
  if (/^emails\/[^/]+$/.test(path)) {
    const id = path.split('/')[1];
    if (method === 'GET') {
      const email = await db.email.findFirst({
        where: { id, userId: user.id },
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
      const result = await db.email.updateMany({ where: { id, userId: user.id }, data });
      if (!result.count) throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
      return ok({ updated: true });
    }
  }
  if (path === 'settings' && method === 'GET')
    return ok(
      await db.notificationPref.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
        select: publicPrefs,
      }),
    );
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
  if (path === 'push/key' && method === 'GET') return ok({ key: process.env.VAPID_PUBLIC_KEY });
  if (path === 'push/subscriptions' && method === 'POST') {
    const data = z
      .object({
        endpoint: z.url().max(4000).refine(isPushEndpoint, 'Unsupported push service'),
        keys: z.object({
          p256dh: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/)
            .max(200),
          auth: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/)
            .max(100),
        }),
      })
      .parse(await jsonBody(request));
    const existing = await db.pushSubscription.findUnique({ where: { endpoint: data.endpoint } });
    if (existing && existing.userId !== user.id)
      throw new ApiError(
        409,
        'SUBSCRIPTION_CONFLICT',
        'This browser subscription belongs to another account.',
      );
    return ok(
      existing
        ? await db.pushSubscription.update({
            where: { id: existing.id, userId: user.id },
            data: data.keys,
          })
        : await db.pushSubscription.create({
            data: { userId: user.id, endpoint: data.endpoint, ...data.keys },
          }),
      201,
    );
  }
  if (path === 'push/subscriptions' && method === 'DELETE') {
    const { endpoint } = z.object({ endpoint: z.url() }).parse(await jsonBody(request));
    await db.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
    return ok({ deleted: true });
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
