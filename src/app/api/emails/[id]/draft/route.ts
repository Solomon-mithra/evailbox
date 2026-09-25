import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { idSchema } from '@/lib/validation';
import { workspaceIds } from '@/lib/workspace-selection';
import { getReplyDraft, saveReplyDraft } from '@/lib/mail-actions';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return route(async (request) => {
    const user = await requireUser();
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const workspace = z.enum(workspaceIds).parse(params.get('workspace') ?? 'PERSONAL');
    const mode = z
      .enum(['reply', 'reply-all'])
      .optional()
      .parse(params.get('mode') ?? undefined);
    return ok(await getReplyDraft(user.id, workspace, idSchema.parse(id), mode));
  })(request);
}
export async function PATCH(request: Request, context: Context) {
  return route(async (request) => {
    const user = await requireUser();
    const { id } = await context.params;
    const workspace = z
      .enum(workspaceIds)
      .parse(new URL(request.url).searchParams.get('workspace') ?? 'PERSONAL');
    return ok(
      await saveReplyDraft(user.id, workspace, idSchema.parse(id), await jsonBody(request)),
    );
  })(request);
}
