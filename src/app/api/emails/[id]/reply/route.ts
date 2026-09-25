import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { idSchema } from '@/lib/validation';
import { workspaceIds } from '@/lib/workspace-selection';
import { sendReplyDraft, reconcileReplyDraft } from '@/lib/mail-actions';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async (request) => {
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const workspace = z
      .enum(workspaceIds)
      .parse(new URL(request.url).searchParams.get('workspace') ?? 'PERSONAL');
    const input = z
      .discriminatedUnion('intent', [
        z
          .object({
            intent: z.literal('send'),
            draftId: idSchema,
            revision: z.number().int().nonnegative(),
          })
          .strict(),
        z.object({ intent: z.literal('reconcile') }).strict(),
      ])
      .parse(await jsonBody(request));
    return ok(
      input.intent === 'reconcile'
        ? await reconcileReplyDraft(user.id, workspace, id)
        : await sendReplyDraft(user.id, workspace, id, {
            draftId: input.draftId,
            revision: input.revision,
          }),
    );
  })(request);
}
