import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok } from '@/lib/errors';
import { workspaceIds } from '@/lib/workspace-selection';
import { listReplyDrafts } from '@/lib/mail-actions';
export const runtime = 'nodejs';
export const GET = route(async (request) => {
  const user = await requireUser();
  const workspace = z
    .enum(workspaceIds)
    .parse(new URL(request.url).searchParams.get('workspace') ?? 'PERSONAL');
  return ok(await listReplyDrafts(user.id, workspace));
});
