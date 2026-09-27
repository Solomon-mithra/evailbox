import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { idSchema } from '@/lib/validation';
import { workspaceIds } from '@/lib/workspace-selection';
import {
  getReplyDraft,
  getReplyContext,
  beginReplyDraft,
  saveReplyDraft,
} from '@/lib/mail-actions';
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
    const selection = z
      .enum(['0', '1'])
      .optional()
      .parse(params.get('context') ?? undefined);
    const emailId = idSchema.parse(id);
    if (selection === '1') return ok(await getReplyContext(user.id, workspace, emailId, mode));
    if (selection === '0') return ok(await getReplyDraft(user.id, workspace, emailId, mode, false));
    return ok(await getReplyDraft(user.id, workspace, emailId, mode));
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

export async function POST(request: Request, context: Context) {
  return route(async (request) => {
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const workspace = z
      .enum(workspaceIds)
      .parse(new URL(request.url).searchParams.get('workspace') ?? 'PERSONAL');
    const input = z
      .object({
        intent: z.literal('new'),
        draftId: idSchema,
        revision: z.number().int().nonnegative(),
        mode: z.enum(['reply', 'reply-all']).optional(),
      })
      .strict()
      .parse(await jsonBody(request));
    return ok(
      await beginReplyDraft(user.id, workspace, id, {
        draftId: input.draftId,
        revision: input.revision,
        ...(input.mode ? { mode: input.mode } : {}),
      }),
    );
  })(request);
}
