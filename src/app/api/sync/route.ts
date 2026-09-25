import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { route, ok, jsonBody, ApiError } from '@/lib/errors';
import { idSchema } from '@/lib/validation';
import { workspaceIds } from '@/lib/workspace-selection';
import { requestWork } from '@/lib/work-queue';
import { publishUserWork } from '@/lib/inngest/dispatch';
import { backgroundConfigured } from '@/lib/inngest/client';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  const user = await requireUser();
  const workspace = z
    .enum(workspaceIds)
    .parse(new URL(request.url).searchParams.get('workspace') ?? 'PERSONAL');
  const { accountId } = z
    .object({ accountId: idSchema.optional() })
    .strict()
    .parse(await jsonBody(request));
  if (
    accountId &&
    !(await db.emailAccount.findFirst({
      where: { id: accountId, userId: user.id, workspace },
      select: { id: true },
    }))
  )
    throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  await requestWork(user.id, { sync: true, accountId, workspace });
  after(async () => {
    await publishUserWork(user.id);
  });
  return ok({ queued: true, pending: true, workerAvailable: backgroundConfigured() }, 202);
});
