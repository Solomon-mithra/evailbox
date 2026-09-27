import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getEmailThread } from '@/lib/email-thread';
import { route, ok } from '@/lib/errors';
import { idSchema } from '@/lib/validation';
import { workspaceIds } from '@/lib/workspace-selection';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const response = await route(async (request) => {
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const query = new URL(request.url).searchParams;
    const workspace = z.enum(workspaceIds).parse(query.get('workspace') ?? 'PERSONAL');
    const images = z.enum(['0', '1']).parse(query.get('images') ?? '0') === '1';
    return ok(await getEmailThread(user.id, workspace, id, images));
  })(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
