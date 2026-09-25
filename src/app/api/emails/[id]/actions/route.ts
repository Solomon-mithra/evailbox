import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { idSchema } from '@/lib/validation';
import { workspaceIds } from '@/lib/workspace-selection';
import { changeMailboxMessage } from '@/lib/mail-actions';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async (request) => {
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const workspace = z
      .enum(workspaceIds)
      .parse(new URL(request.url).searchParams.get('workspace') ?? 'PERSONAL');
    const { action } = z
      .object({ action: z.enum(['read', 'unread', 'archive']) })
      .strict()
      .parse(await jsonBody(request));
    return ok(await changeMailboxMessage(user.id, workspace, id, action));
  })(request);
}
